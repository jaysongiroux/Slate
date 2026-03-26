import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } from "electron";
import { createServer } from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const heicConvert = require("heic-convert");
import { WorkspaceService } from "./services/workspace-service.mjs";
import { MetadataStore } from "./services/metadata-store.mjs";
import { BackendClient } from "./services/backend-client.mjs";
import { SyncService } from "./services/sync-service.mjs";
import { syncVerbose } from "./services/sync-logger.mjs";
import { YDocManager } from "./services/ydoc-manager.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Set the app name so macOS shows "Slate" in the menu bar (not "Electron").
app.name = "Slate";
app.productName = "Slate";

// In dev, Electron defaults to an "Electron" userData directory.
// Set a stable app-specific path before the store is created so settings survive reloads.
const defaultUserData = app.getPath("userData");
if (defaultUserData.includes("Electron")) {
  app.setPath("userData", path.join(app.getPath("appData"), "Slate"));
}

let mainWindow;
let workspaceService;
let syncService;
let backendClient;
let metadataStore;
let ydocManager;
let activeOidcAbort = null;
/** Avoid running a full sync on every dock/Cmd-Tab foreground switch (main-thread jank + IPC pile-up). */
let lastActivateSyncMs = 0;
const ACTIVATE_SYNC_MIN_INTERVAL_MS = 90_000;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 700,
    minWidth: 960,
    minHeight: 700,
    icon: path.join(__dirname, "../build/icon.png"),
    frame: false,
    hasShadow: false,
    transparent: true,
    vibrancy: "fullscreen-ui",
    backgroundMaterial: "acrylic",
    visualEffectState: process.platform === "darwin" ? "active" : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

function toUint8Array(update) {
  if (update == null) return new Uint8Array();
  if (update instanceof Uint8Array) return new Uint8Array(update);
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(update)) return new Uint8Array(update);
  if (Array.isArray(update)) return new Uint8Array(update);
  if (update instanceof ArrayBuffer) return new Uint8Array(update);
  if (ArrayBuffer.isView(update)) {
    return new Uint8Array(update.buffer, update.byteOffset, update.byteLength);
  }
  return new Uint8Array(update);
}

const materializeTimers = new Map();
function scheduleMaterialize(noteId) {
  if (materializeTimers.has(noteId)) clearTimeout(materializeTimers.get(noteId));
  materializeTimers.set(noteId, setTimeout(async () => {
    materializeTimers.delete(noteId);
    try {
      const markdown = await ydocManager.materializeMarkdown(noteId);
      const row = metadataStore.getNoteById(noteId);
      if (row && markdown !== undefined) {
        await workspaceService.writeMarkdownFile(row.relative_path, markdown);
      }
    } catch (err) {
      console.error("Failed to materialize markdown for", noteId, err);
    }
  }, 500));
}

function registerIpc() {
  ipcMain.handle("desktop:getSnapshot", async () => syncService.getSnapshot());
  ipcMain.handle("desktop:chooseWorkspaceDirectory", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"]
    });

    if (!result.canceled && result.filePaths[0]) {
      await workspaceService.setWorkspaceRoot(result.filePaths[0]);
    }

    return syncService.getSnapshot().then((snapshot) => snapshot.workspace);
  });
  ipcMain.handle("desktop:createNote", async (_event, parentPath) => workspaceService.createNote(parentPath));
  ipcMain.handle("desktop:createDailyNote", async () => workspaceService.createDailyNote());
  ipcMain.handle("desktop:createFolder", async (_event, parentPath) => workspaceService.createFolder(parentPath));
  ipcMain.handle("desktop:loadNote", async (_event, noteId) => workspaceService.loadNote(noteId));
  ipcMain.handle("desktop:saveNote", async (_event, payload) => workspaceService.saveNote(payload));
  ipcMain.handle("desktop:deleteNote", async (_event, noteId) => workspaceService.deleteNote(noteId));
  ipcMain.handle("desktop:togglePinNote", async (_event, noteId, pinned) => {
    metadataStore.setPinned(noteId, pinned);
    metadataStore.markDirty(noteId);
  });
  ipcMain.handle("desktop:moveNote", async (_event, noteId, targetFolderPath) =>
    workspaceService.moveNote(noteId, targetFolderPath),
  );
  ipcMain.handle("desktop:renameFolder", async (_event, folderPath, nextName) => workspaceService.renameFolder(folderPath, nextName));
  ipcMain.handle("desktop:deleteFolder", async (_event, folderPath) => workspaceService.deleteFolder(folderPath));
  ipcMain.handle("desktop:setBackendEndpoint", async (_event, endpoint) => {
    const trimmed = typeof endpoint === "string" ? endpoint.trim() : "";
    if (!trimmed) {
      return syncService.getSnapshot().then((s) => s.backend);
    }
    metadataStore.setSetting("backendEndpoint", trimmed);
    return syncService.clearBackendStateForEndpoint(trimmed);
  });
  ipcMain.handle("desktop:checkBackendConnection", async (_event, endpoint) => {
    await backendClient.checkConnection(endpoint);
    return true;
  });
  ipcMain.handle("desktop:refreshBackendStatus", async () => syncService.refreshBackendStatus());
  ipcMain.handle("desktop:loginWithPassword", async (_event, payload) => syncService.loginWithPassword(payload));
  ipcMain.handle("desktop:loginWithOidc", async (_event, providerId) => {
    if (typeof providerId !== "string" || !providerId.trim()) {
      throw new Error("providerId is required");
    }

    const callbackResult = await new Promise((resolve, reject) => {
      const openSockets = new Set();

      function teardown(reason) {
        activeOidcAbort = null;
        clearTimeout(timer);
        server.close(() => {
          reject(new Error(reason));
        });
        for (const socket of openSockets) {
          socket.destroy();
        }
      }

      activeOidcAbort = () => teardown("OIDC login was cancelled");

      const server = createServer((request, response) => {
        const callbackBase = `http://127.0.0.1:${server.address()?.port ?? 0}`;
        const callbackUrl = new URL(request.url ?? "/", callbackBase);
        if (callbackUrl.pathname !== "/oidc/callback") {
          response.statusCode = 404;
          response.end("Not found");
          return;
        }

        const code = callbackUrl.searchParams.get("code") ?? "";
        const state = callbackUrl.searchParams.get("state") ?? "";
        const error = callbackUrl.searchParams.get("error") ?? "";
        const errorDescription = callbackUrl.searchParams.get("error_description") ?? "OIDC login failed";

        response.setHeader("connection", "close");
        response.statusCode = error ? 400 : 200;
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(
          `<!doctype html><html><body style=\"font-family: -apple-system, sans-serif; padding: 24px;\">${
            error ? "Sign-in failed. You can close this window." : "Sign-in complete. You can close this window."
          }</body></html>`,
        );

        activeOidcAbort = null;
        clearTimeout(timer);
        server.close(() => {
          if (error) {
            reject(new Error(errorDescription));
            return;
          }
          if (!code || !state) {
            reject(new Error("OIDC callback is missing code/state"));
            return;
          }
          resolve({ code, state, redirectUri: `${callbackBase}/oidc/callback` });
        });

        for (const socket of openSockets) {
          socket.destroy();
        }
      });

      server.on("connection", (socket) => {
        openSockets.add(socket);
        socket.on("close", () => openSockets.delete(socket));
      });

      server.listen(0, "127.0.0.1", async () => {
        try {
          const port = server.address()?.port;
          if (!port || typeof port !== "number") {
            throw new Error("Failed to bind OIDC callback listener");
          }

          const redirectUri = `http://127.0.0.1:${port}/oidc/callback`;
          const started = await syncService.startOidcLogin(providerId.trim(), redirectUri);
          await shell.openExternal(started.authorizationUrl);
        } catch (error) {
          activeOidcAbort = null;
          clearTimeout(timer);
          server.close(() => {
            reject(error);
          });
          for (const socket of openSockets) {
            socket.destroy();
          }
        }
      });

      const timer = setTimeout(() => teardown("Timed out waiting for OIDC callback"), 180_000);
    });

    return syncService.completeOidcLogin({
      providerId: providerId.trim(),
      redirectUri: callbackResult.redirectUri,
      state: callbackResult.state,
      code: callbackResult.code,
    });
  });
  ipcMain.handle("desktop:cancelOidc", async () => {
    if (activeOidcAbort) {
      activeOidcAbort();
    }
  });
  ipcMain.handle("desktop:uploadAttachment", async (_event, { buffer, fileName, mimeType, documentId }) => {
    let fileBuffer = Buffer.from(buffer);
    let finalMimeType = mimeType;
    let finalFileName = fileName;

    // Convert HEIC/HEIF to JPEG via heic-convert (pure JS, no native codec needed)
    if (finalMimeType === "image/heic" || finalMimeType === "image/heif") {
      try {
        const jpegBuffer = await heicConvert({ buffer: fileBuffer, format: "JPEG", quality: 0.9 });
        fileBuffer = Buffer.from(jpegBuffer);
        finalMimeType = "image/jpeg";
        finalFileName = finalFileName.replace(/\.hei[cf]$/i, ".jpg");
      } catch (err) {
        console.error("HEIC conversion failed:", err);
      }
    }

    const endpoint = metadataStore.getSetting("backendEndpoint", "localhost:50051");
    const accessToken = metadataStore.getSetting("accessToken", "");
    const isOnline = metadataStore.getSetting("backendReachable", false)
      && metadataStore.getSetting("authStatus", "signed_out") === "authenticated"
      && accessToken;

    if (isOnline) {
      try {
        return await backendClient.uploadAttachment(endpoint, accessToken, {
          buffer: fileBuffer,
          fileName: finalFileName,
          mimeType: finalMimeType,
          documentId,
        });
      } catch {
        // Fall through to offline storage
      }
    }

    // Offline: save locally and queue for later upload
    const id = crypto.randomUUID();
    const stagingDir = path.join(app.getPath("userData"), "pending-attachments");
    fs.mkdirSync(stagingDir, { recursive: true });
    const localPath = path.join(stagingDir, `${id}-${finalFileName}`);
    fs.writeFileSync(localPath, fileBuffer);

    metadataStore.insertPendingAttachment({
      id,
      fileName: finalFileName,
      mimeType: finalMimeType,
      localPath,
      userId: metadataStore.getSetting("authenticatedUserId", "local"),
      documentId: documentId || "local",
    });

    return { id, contentUrl: `/api/attachments/pending/${id}/content`, pending: true };
  });
  ipcMain.handle("desktop:resolveAttachmentUrl", (_event, contentUrl) => {
    // Serve pending (offline) attachments via custom protocol
    const pendingMatch = contentUrl.match(/^\/api\/attachments\/pending\/([^/]+)\/content$/);
    if (pendingMatch) {
      const pending = metadataStore.listPendingAttachments().find((p) => p.id === pendingMatch[1]);
      if (pending && fs.existsSync(pending.local_path)) {
        return `slate-attachment://${encodeURIComponent(pending.local_path)}`;
      }
    }

    const endpoint = metadataStore.getSetting("backendEndpoint", "localhost:50051");
    const accessToken = metadataStore.getSetting("accessToken", "");
    return backendClient.resolveAttachmentUrl(endpoint, accessToken, contentUrl);
  });
  ipcMain.handle("desktop:signOutBackend", async () => syncService.signOut());
  ipcMain.handle("desktop:connectBackend", async () => syncService.connectBackend());
  ipcMain.handle("desktop:syncNow", async () => {
    syncVerbose("IPC desktop:syncNow invoked");
    return syncService.syncNow({ forceFull: true });
  });
  ipcMain.handle("desktop:fullSync", async () => {
    syncVerbose("IPC desktop:fullSync invoked");
    await syncService.fullSync();
    return syncService.getSnapshot();
  });
  ipcMain.handle("desktop:getLastOpenNoteId", async () => metadataStore.getSetting("lastOpenNoteId", null));
  ipcMain.handle("desktop:setLastOpenNoteId", async (_event, noteId) => metadataStore.setSetting("lastOpenNoteId", noteId));
  ipcMain.handle("desktop:getLastActiveChatConversationId", async () =>
    metadataStore.getSetting("lastActiveChatConversationId", null),
  );
  ipcMain.handle("desktop:setLastActiveChatConversationId", async (_event, conversationId) =>
    metadataStore.setSetting("lastActiveChatConversationId", conversationId),
  );
  ipcMain.handle("desktop:getKeyboardShortcuts", async () => metadataStore.getShortcuts());
  ipcMain.handle("desktop:setKeyboardShortcut", async (_event, action, shortcut) => {
    metadataStore.setShortcut(action, shortcut);
  });
  ipcMain.handle("desktop:showContextMenu", async (_event, items) => {
    return new Promise((resolve) => {
      const template = items.map((item) => {
        if (item.type === "separator") {
          return { type: "separator" };
        }
        return {
          label: item.label,
          click: () => resolve(item.id),
        };
      });
      const menu = Menu.buildFromTemplate(template);
      menu.popup({ window: mainWindow, callback: () => resolve(null) });
    });
  });

  // --- AI Chat IPC handlers ---

  ipcMain.handle("desktop:getAiConfig", async () => backendClient.getAiConfig());
  ipcMain.handle("desktop:updateAiConfig", async (_event, config) => backendClient.updateAiConfig(config));
  ipcMain.handle("desktop:createConversation", async () => backendClient.createConversation());
  ipcMain.handle("desktop:listConversations", async () => {
    const response = await backendClient.listConversations();
    return response.conversations || [];
  });
  ipcMain.handle("desktop:deleteConversation", async (_event, id) => backendClient.deleteConversation({ id }));
  ipcMain.handle("desktop:getConversationMessages", async (_event, conversationId) => {
    const response = await backendClient.getConversationMessages({ conversationId });
    return response.messages || [];
  });
  ipcMain.handle("desktop:sendMessage", async (_event, conversationId, content) => {
    return new Promise((resolve, reject) => {
      const events = [];
      backendClient.streamSendMessage({ conversationId, content }, (event) => {
        if (event.type === "error") {
          mainWindow?.webContents.send("desktop:aiChatEvent", event);
          reject(new Error(event.content ?? "Request failed"));
          return;
        }
        mainWindow?.webContents.send("desktop:aiChatEvent", event);
        events.push(event);
        if (event.type === "done") {
          resolve(events);
        }
      });
    });
  });
  ipcMain.handle("desktop:triggerEmbedding", async () => backendClient.triggerEmbedding());

  // --- CRDT IPC handlers ---

  ipcMain.handle("desktop:getCrdtState", async (_event, noteId) => {
    // Lazy migration: if no CRDT state, bootstrap from markdown
    if (!ydocManager.hasCrdtState(noteId)) {
      const row = metadataStore.getNoteById(noteId);
      if (row) {
        const markdown = await workspaceService.readNoteMarkdown(row.relative_path);
        if (markdown !== null && markdown !== undefined) {
          await ydocManager.bootstrapFromMarkdown(noteId, markdown);
        }
      }
    }
    const state = ydocManager.getFullState(noteId);
    return state && state.byteLength > 0 ? state : null;
  });

  ipcMain.handle("desktop:applyCrdtUpdate", async (_event, noteId, update) => {
    ydocManager.applyUpdate(noteId, toUint8Array(update));
    metadataStore.markDirty(noteId);
    // Debounced: materialize markdown and write .md file
    scheduleMaterialize(noteId);
  });
  ipcMain.handle("desktop:openExternal", async (_event, url) => {
    if (typeof url === "string" && (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("mailto:"))) {
      await shell.openExternal(url);
    }
  });
}

protocol.registerSchemesAsPrivileged([
  { scheme: "slate-attachment", privileges: { bypassCSP: true, stream: true, supportFetchAPI: true } },
]);

app.whenReady().then(async () => {
  protocol.handle("slate-attachment", (request) => {
    const filePath = decodeURIComponent(request.url.replace("slate-attachment://", ""));
    return net.fetch(pathToFileURL(filePath).href);
  });
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(path.join(__dirname, "../build/icon.png"));
  }
  metadataStore = new MetadataStore(app.getPath("userData"));
  ydocManager = new YDocManager({ metadataStore });
  workspaceService = new WorkspaceService({
    metadataStore,
    defaultWorkspaceRoot: path.join(app.getPath("documents"), "Slate"),
    ydocManager
  });
  backendClient = new BackendClient({
    protoPath: path.resolve(__dirname, "./proto/slate.proto"),
    metadataStore
  });
  syncService = new SyncService({
    metadataStore,
    workspaceService,
    backendClient,
    ydocManager
  });

  // Wire up remote CRDT update sender for both services
  function sendRemoteCrdtUpdate(noteId, update) {
    const u8 = toUint8Array(update);
    mainWindow?.webContents.send("desktop:remoteCrdtUpdate", {
      noteId,
      update: u8,
    });
  }
  function sendCrdtStateReset(noteId) {
    mainWindow?.webContents.send("desktop:crdtStateReset", { noteId });
  }
  syncService.sendRemoteCrdtUpdate = sendRemoteCrdtUpdate;
  syncService.sendCrdtStateReset = sendCrdtStateReset;
  workspaceService.sendCrdtStateReset = sendCrdtStateReset;
  syncService.sendSyncStatus = (status) => {
    mainWindow?.webContents.send("desktop:syncStatus", status);
  };
  syncService.sendWorkspaceChanged = (diskRelPaths) => {
    mainWindow?.webContents.send("desktop:workspaceChanged", diskRelPaths ?? []);
  };

  await workspaceService.initialize();
  await syncService.initialize();
  registerIpc();
  await createWindow();

  // Native right-click: editing commands plus spell suggestions (custom menu replaces Chromium default)
  // Note: webContents "context-menu" does not set event.sender (unlike ipcMain); use this window's webContents.
  mainWindow.webContents.on("context-menu", (_event, params) => {
    const wc = mainWindow.webContents;
    const template = [];

    if (params.misspelledWord) {
      const suggestions = params.dictionarySuggestions ?? [];
      if (suggestions.length > 0) {
        for (const suggestion of suggestions) {
          template.push({
            label: suggestion,
            click: () => {
              wc.replaceMisspelling(suggestion);
            },
          });
        }
      } else {
        template.push({ label: "No spelling suggestions", enabled: false });
      }
      template.push({ type: "separator" });
      template.push({
        label: "Add to Dictionary",
        click: () => {
          void wc.session.addWordToSpellCheckerDictionary(params.misspelledWord);
        },
      });
      template.push({ type: "separator" });
    }

    template.push(
      { role: "cut", enabled: params.editFlags.canCut },
      { role: "copy", enabled: params.editFlags.canCopy },
      { role: "paste", enabled: params.editFlags.canPaste },
      { type: "separator" },
      { role: "selectAll", enabled: params.editFlags.canSelectAll },
    );

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: mainWindow });
  });

  // Kick off a full sync on app launch if already authenticated
  if (syncService.syncEnabled()) {
    syncVerbose("app ready: launching background sync (session already authenticated)");
    lastActivateSyncMs = Date.now();
    void syncService.syncInBackground();
  } else {
    syncVerbose("app ready: background sync skipped", {
      backendReachable: syncService.metadataStore?.getSetting?.("backendReachable", false),
      authStatus: syncService.metadataStore?.getSetting?.("authStatus", "signed_out"),
    });
  }

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
    // Re-sync when returning to the app, but not on every focus (pull interval is ~90s anyway).
    if (syncService.syncEnabled()) {
      const now = Date.now();
      if (now - lastActivateSyncMs < ACTIVATE_SYNC_MIN_INTERVAL_MS) {
        syncVerbose("app activate: skip foreground sync (recent run)", {
          msSinceLast: now - lastActivateSyncMs,
        });
      } else {
        lastActivateSyncMs = now;
        syncVerbose("app activate: launching background sync");
        void syncService.syncInBackground();
      }
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
