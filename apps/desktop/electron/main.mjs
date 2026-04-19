import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  Notification,
  powerMonitor,
  protocol,
  shell,
} from "electron";
import { createServer } from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const heicConvert = require("heic-convert");
import { ConfigStore } from "./services/config-store.mjs";
import { PendingUploads } from "./services/pending-uploads.mjs";
import { HttpClient } from "./services/http-client.mjs";
import { CalendarReminderService } from "./services/calendar-reminder-service.mjs";
import { ImportService } from "./services/import-service.mjs";
import { createDesktopLogger } from "./services/desktop-logger.mjs";

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
let configStore;
let pendingUploads;
let httpClient;
let calendarReminderService;
let slateDesktopLogger = null;

// Compatibility shim: the rest of main.mjs uses metadataStore.getSetting/setSetting.
// ConfigStore uses get/set with the same semantics.
// Compatibility shim: the rest of main.mjs uses metadataStore.getSetting/setSetting.
// ConfigStore uses get/set with the same semantics.
const metadataStore = {
  getSetting(key, defaultValue) {
    return configStore?.get(key) ?? defaultValue;
  },
  setSetting(key, value) {
    configStore?.set(key, value);
  },
  /** Note bodies and paths live in RxDB (renderer); main no longer persists note rows. */
  getNoteById(_noteId) {
    return null;
  },
  getCalendarReminderSettings() {
    return (
      configStore?.get("calendarReminderSettings") ?? {
        enabled: false,
        minutesBefore: 5,
        sound: true,
      }
    );
  },
  setCalendarReminderSettings(payload) {
    configStore?.set("calendarReminderSettings", payload);
  },
  getCalendarReminderFired(currentNow = Date.now()) {
    const cutoff = currentNow - 14 * 24 * 60 * 60 * 1000;
    let fired = configStore?.get("calendarReminderFired") ?? {};
    fired = Object.fromEntries(
      Object.entries(fired).filter(([, entry]) => Date.parse(entry.firedAt) >= cutoff),
    );
    configStore?.set("calendarReminderFired", fired);
    return fired;
  },
  markCalendarReminderFired(key, firedAt, currentNow) {
    const fired = this.getCalendarReminderFired(currentNow);
    fired[key] = { firedAt };
    configStore?.set("calendarReminderFired", fired);
  },
  getShortcuts() {
    return configStore?.get("keyboardShortcuts") ?? {};
  },
  setShortcut(action, shortcut) {
    const shortcuts = configStore?.get("keyboardShortcuts") ?? {};
    shortcuts[action] = shortcut;
    configStore?.set("keyboardShortcuts", shortcuts);
  },
};
let activeOidcAbort = null;

function cancelActiveSendMessageStream() {
  httpClient?.cancelChatStream();
}

async function createWindow() {
  const appIconPath = path.join(__dirname, "../build/icon.png");
  const appIcon = nativeImage.createFromPath(appIconPath);
  mainWindow = new BrowserWindow({
    width: 960,
    height: 700,
    minWidth: 640,
    minHeight: 560,
    icon: appIcon.isEmpty() ? appIconPath : appIcon,
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
      spellcheck: true,
    },
  });

  // Open external links (https://, mailto:) in the system browser
  // instead of navigating the Electron window or opening a blank popup.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://") || url.startsWith("mailto:")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const appOrigin = mainWindow.webContents.getURL();
    if (appOrigin && url.startsWith(appOrigin.split("#")[0])) return; // allow in-app navigation
    if (url.startsWith("https://") || url.startsWith("http://") || url.startsWith("mailto:")) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

function buildBackendConfig() {
  const endpoint = metadataStore.getSetting("backendEndpoint", "");
  const authStatus = metadataStore.getSetting("authStatus", "signed_out");
  const userId = metadataStore.getSetting("authenticatedUserId", null);
  const email = metadataStore.getSetting("authenticatedEmail", null);
  const displayName = metadataStore.getSetting("authenticatedDisplayName", null);
  const isAdmin = metadataStore.getSetting("authenticatedIsAdmin", false);
  const tokenExpiry = metadataStore.getSetting("tokenExpiresAtUnix", null);
  const providers = metadataStore.getSetting("authProviders", []);
  const clientId =
    metadataStore.getSetting("clientId") ||
    (() => {
      const id = crypto.randomUUID();
      metadataStore.setSetting("clientId", id);
      return id;
    })();
  return {
    endpoint,
    clientId,
    backendReachable: metadataStore.getSetting("backendReachable", false),
    authStatus,
    authProviders: providers,
    authenticatedUserId: userId,
    authenticatedEmail: email,
    authenticatedDisplayName: displayName,
    authenticatedIsAdmin: isAdmin,
    tokenExpiresAtUnix: tokenExpiry,
  };
}

function isUnauthorizedHttpError(error) {
  return (
    typeof error === "object" && error !== null && "status" in error && Number(error.status) === 401
  );
}

function isTransientSlateAuthError(error) {
  return typeof error === "object" && error !== null && error.slateTransientAuth === true;
}

function isBackendConnectionError(error) {
  if (!(error instanceof Error)) return false;
  if (error.message === "fetch failed") return true;
  const cause = error.cause;
  if (!cause || typeof cause !== "object") return false;
  if ("code" in cause && cause.code === "ECONNREFUSED") return true;
  if ("errors" in cause && Array.isArray(cause.errors)) {
    return cause.errors.some(
      (entry) =>
        entry && typeof entry === "object" && "code" in entry && entry.code === "ECONNREFUSED",
    );
  }
  return false;
}

async function refreshStoredBackendStatus(endpoint) {
  if (!endpoint) {
    metadataStore.setSetting("backendReachable", false);
    metadataStore.setSetting("authProviders", []);
    return buildBackendConfig();
  }

  const status = await httpClient.getBackendStatus(endpoint);
  metadataStore.setSetting("backendReachable", status.backendReachable);
  metadataStore.setSetting("authProviders", status.authProviders);
  return buildBackendConfig();
}

function clearStoredAuthSession(reason = "unspecified") {
  slateDesktopLogger?.child("auth")?.warn?.("session_cleared", { reason });
  metadataStore.setSetting("accessToken", null);
  metadataStore.setSetting("refreshToken", null);
  metadataStore.setSetting("tokenExpiresAtUnix", null);
  metadataStore.setSetting("authStatus", "signed_out");
  metadataStore.setSetting("authenticatedUserId", null);
  metadataStore.setSetting("authenticatedEmail", null);
  metadataStore.setSetting("authenticatedDisplayName", null);
  metadataStore.setSetting("authenticatedIsAdmin", false);
  httpClient.cancelChatStream();
}

async function syncNotesFromServer() {
  const token = metadataStore.getSetting("accessToken", null);
  if (!token || !metadataStore.getSetting("backendReachable", false)) {
    slateDesktopLogger?.child("sync")?.debug?.("sync_notes_skipped", {
      hasToken: Boolean(token),
      backendReachable: metadataStore.getSetting("backendReachable", false),
    });
    return;
  }
  try {
    // Session check; merging remote documents into RxDB is handled in the renderer when implemented.
    await httpClient.listNotesRemote();
    slateDesktopLogger?.child("sync")?.info?.("sync_notes_ok", {});
    mainWindow?.webContents.send("desktop:workspaceChanged", []);
  } catch (err) {
    // Do not flip backendReachable here: health was already checked at startup/login.
    // A transient /api/notes failure must not force the UI offline (regression vs refresh).
    slateDesktopLogger?.child("sync")?.warn?.("sync_notes_failed", {
      message: err instanceof Error ? err.message : String(err),
      transient: isTransientSlateAuthError(err),
    });
  }
}

/** Normalize zip bytes from renderer IPC (Uint8Array, number[], or plain indexed object). */
function bufferFromZipExportData(data) {
  if (data == null) {
    throw new Error("saveZipExport: data is required");
  }
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof Uint8Array) {
    return Buffer.from(data);
  }
  if (Array.isArray(data)) {
    return Buffer.from(data);
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }
  if (typeof data === "object" && data.buffer instanceof ArrayBuffer) {
    const { buffer, byteOffset = 0, byteLength = buffer.byteLength } = data;
    return Buffer.from(new Uint8Array(buffer, byteOffset, byteLength));
  }
  if (typeof data === "object") {
    const keys = Object.keys(data);
    if (
      keys.length > 0 &&
      keys.every((k) => /^\d+$/.test(k)) &&
      keys.length === Object.keys(data).length
    ) {
      const sorted = keys.sort((a, b) => Number(a) - Number(b));
      return Buffer.from(sorted.map((k) => Number(data[k])));
    }
  }
  throw new Error("saveZipExport: unsupported data format");
}

async function withUnauthorizedCalendarFallback(task, label, fallbackValue) {
  try {
    return await task();
  } catch (error) {
    if (isBackendConnectionError(error)) {
      slateDesktopLogger?.child("calendar")?.warn?.("calendar_ipc_backend_unreachable", {
        label,
        error,
      });
      metadataStore.setSetting("backendReachable", false);
      metadataStore.setSetting("authProviders", []);
      return fallbackValue;
    }
    if (isTransientSlateAuthError(error)) {
      slateDesktopLogger?.child("calendar")?.warn?.("calendar_ipc_auth_refresh_transient", {
        label,
        error,
      });
      return fallbackValue;
    }
    if (!isUnauthorizedHttpError(error)) {
      slateDesktopLogger?.child("calendar")?.error?.("calendar_ipc_unauthorized_error", {
        label,
        error,
      });
      throw error;
    }
    slateDesktopLogger?.child("calendar")?.warn?.("calendar_ipc_unauthorized_clearing_session", {
      label,
      error,
    });
    clearStoredAuthSession("calendar_api_401");
    return fallbackValue;
  }
}

function registerIpc() {
  ipcMain.handle("desktop:writeDiagLog", (_event, payload) => {
    try {
      const line =
        typeof payload === "string"
          ? payload.endsWith("\n")
            ? payload
            : `${payload}\n`
          : `${JSON.stringify({
              ts: new Date().toISOString(),
              source: "renderer",
              ...(payload && typeof payload === "object" ? payload : { data: payload }),
            })}\n`;
      slateDesktopLogger?.rawLine(line);
    } catch {
      // ignore malformed diag payloads
    }
  });

  const withReminderRefresh =
    (handler) =>
    async (event, ...args) => {
      const result = await handler(event, ...args);
      await calendarReminderService?.refreshNow?.();
      return result;
    };

  // ── Config (replaces MetadataStore settings) ──
  ipcMain.handle("desktop:getConfig", (_event, key) => configStore.get(key));
  ipcMain.handle("desktop:setConfig", (_event, key, value) => configStore.set(key, value));
  ipcMain.handle("desktop:listPendingUploads", () => pendingUploads.list());

  // ── Snapshot (backend config only — notes/folders come from RxDB) ──
  ipcMain.handle("desktop:getSnapshot", () => {
    return { backend: buildBackendConfig(), notes: [], folders: [] };
  });
  ipcMain.handle("desktop:importFolder", async () => {
    if (!mainWindow) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      title: "Import Markdown folder",
    });
    if (canceled || !filePaths?.[0]) return null;
    const service = new ImportService({ httpClient });
    return service.importDirectory(filePaths[0]);
  });
  ipcMain.handle("desktop:importFiles", async () => {
    if (!mainWindow) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
      title: "Import Markdown files",
    });
    if (canceled || !filePaths?.length) return null;
    const mdPaths = filePaths.filter((p) => /\.(md|markdown)$/i.test(p));
    if (!mdPaths.length) {
      return { total: 0, imported: 0, errors: 0, notes: [] };
    }
    const service = new ImportService({ httpClient });
    return service.importFiles(mdPaths);
  });
  ipcMain.handle("desktop:saveZipExport", async (_event, payload) => {
    if (!mainWindow) return { canceled: true };
    const defaultFilename =
      typeof payload?.defaultFilename === "string" ? payload.defaultFilename : "export.zip";
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: "Export notes",
      defaultPath: path.join(app.getPath("documents"), defaultFilename),
      filters: [{ name: "Zip archive", extensions: ["zip"] }],
    });
    if (canceled || !filePath) return { canceled: true };
    const buf = bufferFromZipExportData(payload?.data);
    await fs.promises.writeFile(filePath, buf);
    return { ok: true, path: filePath };
  });
  // ── Backend / Auth ──
  ipcMain.handle("desktop:setBackendEndpoint", async (_event, endpoint) => {
    const trimmed = typeof endpoint === "string" ? endpoint.trim() : "";
    if (!trimmed) return buildBackendConfig();
    const normalized = trimmed.replace(/:50051$/, ":4000");
    metadataStore.setSetting("backendEndpoint", normalized);
    metadataStore.setSetting("backendReachable", false);
    metadataStore.setSetting("authStatus", "signed_out");
    return refreshStoredBackendStatus(normalized);
  });
  ipcMain.handle("desktop:checkBackendConnection", async (_event, endpoint) => {
    return httpClient.checkConnection(endpoint);
  });
  ipcMain.handle("desktop:refreshBackendStatus", async () => {
    const endpoint = metadataStore.getSetting("backendEndpoint", "");
    return refreshStoredBackendStatus(endpoint);
  });
  ipcMain.handle("desktop:loginWithPassword", async (_event, payload) => {
    const endpoint = metadataStore.getSetting("backendEndpoint", "");
    const clientId = buildBackendConfig().clientId;
    const result = await httpClient.loginWithPassword(endpoint, { ...payload, clientId });
    metadataStore.setSetting("accessToken", result.tokens.accessToken);
    metadataStore.setSetting("refreshToken", result.tokens.refreshToken);
    metadataStore.setSetting("tokenExpiresAtUnix", result.tokens.expiresAtUnix);
    metadataStore.setSetting("authStatus", "authenticated");
    metadataStore.setSetting("authenticatedUserId", result.userId);
    metadataStore.setSetting("authenticatedEmail", result.email);
    metadataStore.setSetting("authenticatedDisplayName", result.displayName);
    metadataStore.setSetting("authenticatedIsAdmin", result.isAdmin);
    void syncNotesFromServer();
    return buildBackendConfig();
  });
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
        const errorDescription =
          callbackUrl.searchParams.get("error_description") ?? "OIDC login failed";

        response.setHeader("connection", "close");
        response.statusCode = error ? 400 : 200;
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(
          `<!doctype html><html><body style=\"font-family: -apple-system, sans-serif; padding: 24px;\">${
            error
              ? "Sign-in failed. You can close this window."
              : "Sign-in complete. You can close this window."
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
          const endpoint = metadataStore.getSetting("backendEndpoint", "");
          const clientId = buildBackendConfig().clientId;
          const started = await httpClient.startOidc(endpoint, {
            providerId: providerId.trim(),
            redirectUri,
            clientId,
          });
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

    const endpoint = metadataStore.getSetting("backendEndpoint", "");
    const clientId = buildBackendConfig().clientId;
    const result = await httpClient.completeOidc(endpoint, {
      providerId: providerId.trim(),
      redirectUri: callbackResult.redirectUri,
      state: callbackResult.state,
      code: callbackResult.code,
      clientId,
    });
    metadataStore.setSetting("accessToken", result.tokens.accessToken);
    metadataStore.setSetting("refreshToken", result.tokens.refreshToken);
    metadataStore.setSetting("tokenExpiresAtUnix", result.tokens.expiresAtUnix);
    metadataStore.setSetting("authStatus", "authenticated");
    metadataStore.setSetting("authenticatedUserId", result.userId);
    metadataStore.setSetting("authenticatedEmail", result.email);
    metadataStore.setSetting("authenticatedDisplayName", result.displayName);
    metadataStore.setSetting("authenticatedIsAdmin", result.isAdmin);
    void syncNotesFromServer();
    return buildBackendConfig();
  });
  ipcMain.handle("desktop:cancelOidc", async () => {
    if (activeOidcAbort) {
      activeOidcAbort();
    }
  });
  // ── Attachments ──
  ipcMain.handle(
    "desktop:uploadAttachment",
    async (_event, { buffer, fileName, mimeType, documentId }) => {
      let fileBuffer = Buffer.from(buffer);
      let finalMimeType = mimeType;
      let finalFileName = fileName;

      if (finalMimeType === "image/heic" || finalMimeType === "image/heif") {
        try {
          const jpegBuffer = await heicConvert({
            buffer: fileBuffer,
            format: "JPEG",
            quality: 0.9,
          });
          fileBuffer = Buffer.from(jpegBuffer);
          finalMimeType = "image/jpeg";
          finalFileName = finalFileName.replace(/\.hei[cf]$/i, ".jpg");
        } catch (err) {
          console.error("HEIC conversion failed:", err);
        }
      }

      const endpoint = metadataStore.getSetting("backendEndpoint", "");
      const accessToken = metadataStore.getSetting("accessToken", "");
      const isOnline =
        metadataStore.getSetting("backendReachable", false) &&
        metadataStore.getSetting("authStatus", "signed_out") === "authenticated" &&
        accessToken;

      if (isOnline) {
        try {
          return await httpClient.uploadAttachment(endpoint, accessToken, {
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
      const localPath = path.join(pendingUploads.stagingDir, `${id}-${finalFileName}`);
      fs.writeFileSync(localPath, fileBuffer);

      pendingUploads.add({
        id,
        fileName: finalFileName,
        mimeType: finalMimeType,
        localPath,
        documentId: documentId || "local",
      });

      return { id, contentUrl: `/api/attachments/pending/${id}/content`, pending: true };
    },
  );
  ipcMain.handle("desktop:resolveAttachmentUrl", (_event, contentUrl) => {
    const pendingMatch = contentUrl.match(/^\/api\/attachments\/pending\/([^/]+)\/content$/);
    if (pendingMatch) {
      const pending = pendingUploads.list().find((p) => p.id === pendingMatch[1]);
      if (pending && fs.existsSync(pending.local_path)) {
        return `slate-attachment://${encodeURIComponent(pending.local_path)}`;
      }
    }
    const endpoint = metadataStore.getSetting("backendEndpoint", "");
    const accessToken = metadataStore.getSetting("accessToken", "");
    return httpClient.resolveAttachmentUrl(endpoint, accessToken, contentUrl);
  });
  ipcMain.handle(
    "desktop:signOutBackend",
    withReminderRefresh(async () => {
      clearStoredAuthSession("user_sign_out");
      return buildBackendConfig();
    }),
  );
  ipcMain.handle(
    "desktop:connectBackend",
    withReminderRefresh(async () => {
      const endpoint = metadataStore.getSetting("backendEndpoint", "");
      return refreshStoredBackendStatus(endpoint);
    }),
  );
  // ── AI Chat ──
  ipcMain.handle("desktop:getAiConfig", () => httpClient.getAiConfig());
  ipcMain.handle("desktop:updateAiConfig", async (_event, config) => {
    const result = await httpClient.updateAiConfig(config);
    if (result.chatStreamingConfigChanged) cancelActiveSendMessageStream();
    return result;
  });
  ipcMain.handle("desktop:createConversation", () => httpClient.createConversation());
  ipcMain.handle("desktop:listConversations", () => httpClient.listConversations());
  ipcMain.handle("desktop:deleteConversation", (_event, id) => httpClient.deleteConversation(id));
  ipcMain.handle("desktop:getConversationMessages", (_event, conversationId) =>
    httpClient.getConversationMessages(conversationId),
  );
  ipcMain.handle(
    "desktop:sendMessage",
    async (_event, conversationId, content, enabledCalendarIds, enabledIcsIds, timezone) => {
      if (httpClient.isStreamingChat()) httpClient.cancelChatStream();
      const events = [];
      let resolved = false;

      await new Promise((resolve) => {
        void httpClient
          .streamSendMessage(
            {
              conversationId,
              content,
              enabledCalendarIds: enabledCalendarIds ?? [],
              enabledIcsIds: enabledIcsIds ?? [],
              timezone: timezone ?? "",
            },
            (event) => {
              mainWindow?.webContents.send("desktop:aiChatEvent", event);
              events.push(event);
            },
          )
          .then(() => {
            resolved = true;
            resolve();
          });
      });

      const lastEvent = events[events.length - 1];
      const wasCancelled =
        !resolved || !lastEvent || (lastEvent.type !== "done" && lastEvent.type !== "error");
      return wasCancelled ? { cancelled: true } : events;
    },
  );
  ipcMain.handle("desktop:cancelSendMessage", () => httpClient.cancelChatStream());
  ipcMain.handle("desktop:triggerEmbedding", () => httpClient.triggerEmbedding());
  ipcMain.handle("desktop:getEmbedStatus", () => httpClient.getEmbedStatus());
  ipcMain.handle("desktop:getNoteGraph", () => httpClient.getNoteGraph());
  ipcMain.handle("desktop:deleteNoteGraphEdges", () => httpClient.deleteNoteGraphEdges());
  ipcMain.handle("desktop:enqueueNoteGraphRebuild", () => httpClient.enqueueNoteGraphRebuild());

  // ── Calendar ──
  ipcMain.handle("desktop:getCalendarStatus", () =>
    withUnauthorizedCalendarFallback(() => httpClient.getCalendarStatus(), "getCalendarStatus", {
      providers: [],
      connections: [],
      icsSubscriptions: [],
    }),
  );
  ipcMain.handle(
    "desktop:startCalendarOAuth",
    withReminderRefresh(async (_event, payload) => {
      const callbackResult = await new Promise((resolve, reject) => {
        const openSockets = new Set();

        const server = createServer((request, response) => {
          const callbackBase = `http://127.0.0.1:${server.address()?.port ?? 0}`;
          const callbackUrl = new URL(request.url ?? "/", callbackBase);
          if (callbackUrl.pathname !== "/calendar/oauth/callback") {
            response.statusCode = 404;
            response.end("Not found");
            return;
          }
          const code = callbackUrl.searchParams.get("code") ?? "";
          const state = callbackUrl.searchParams.get("state") ?? "";
          const error = callbackUrl.searchParams.get("error") ?? "";
          const errorDescription =
            callbackUrl.searchParams.get("error_description") ?? "Calendar authorization failed";
          response.setHeader("connection", "close");
          response.statusCode = error ? 400 : 200;
          response.setHeader("content-type", "text/html; charset=utf-8");
          response.end(
            `<!doctype html><html><body style="font-family: -apple-system, sans-serif; padding: 24px; background:#111; color:#fafaf9; display:flex; align-items:center; justify-content:center; height:90vh;">${
              error
                ? "<div style='text-align:center'><h2>Connection failed</h2><p style='opacity:0.6'>You can close this window.</p></div>"
                : "<div style='text-align:center'><h2>Calendar authorization received!</h2><p style='opacity:0.6'>You can close this window and return to Slate.</p></div>"
            }</body></html>`,
          );
          clearTimeout(timer);
          server.close(() => {
            if (error) {
              reject(new Error(errorDescription));
              return;
            }
            if (!code || !state) {
              reject(new Error("Calendar OAuth callback is missing code/state"));
              return;
            }
            resolve({ code, state, redirectUri: `${callbackBase}/calendar/oauth/callback` });
          });
          for (const socket of openSockets) socket.destroy();
        });

        server.on("connection", (socket) => {
          openSockets.add(socket);
          socket.on("close", () => openSockets.delete(socket));
        });

        server.listen(0, "127.0.0.1", async () => {
          try {
            const port = server.address()?.port;
            if (!port || typeof port !== "number")
              throw new Error("Failed to bind calendar OAuth callback listener");
            const redirectUri = `http://127.0.0.1:${port}/calendar/oauth/callback`;
            const started = await httpClient.startCalendarOAuth({ ...payload, redirectUri });
            await shell.openExternal(started.authorizationUrl);
          } catch (error) {
            clearTimeout(timer);
            server.close(() => reject(error));
            for (const socket of openSockets) socket.destroy();
          }
        });

        const timer = setTimeout(() => {
          server.close(() => reject(new Error("Timed out waiting for calendar OAuth callback")));
          for (const socket of openSockets) socket.destroy();
        }, 180_000);
      });

      return httpClient.completeCalendarOAuth({
        providerId: payload.providerId,
        code: callbackResult.code,
        state: callbackResult.state,
        redirectUri: callbackResult.redirectUri,
      });
    }),
  );
  ipcMain.handle(
    "desktop:disconnectCalendar",
    withReminderRefresh((_event, payload) => httpClient.disconnectCalendar(payload)),
  );
  ipcMain.handle("desktop:listCalendars", (_event, payload) =>
    withUnauthorizedCalendarFallback(() => httpClient.listCalendars(payload), "listCalendars", {
      calendars: [],
    }),
  );
  ipcMain.handle(
    "desktop:subscribeCalendar",
    withReminderRefresh((_event, payload) => httpClient.subscribeCalendar(payload)),
  );
  ipcMain.handle(
    "desktop:unsubscribeCalendar",
    withReminderRefresh((_event, payload) => httpClient.unsubscribeCalendar(payload)),
  );
  ipcMain.handle(
    "desktop:updateCalendarSubscription",
    withReminderRefresh((_event, payload) => httpClient.updateCalendarSubscription(payload)),
  );
  ipcMain.handle(
    "desktop:addIcsSubscription",
    withReminderRefresh((_event, payload) => httpClient.addIcsSubscription(payload)),
  );
  ipcMain.handle(
    "desktop:removeIcsSubscription",
    withReminderRefresh((_event, payload) => httpClient.removeIcsSubscription(payload)),
  );
  ipcMain.handle(
    "desktop:updateIcsSubscription",
    withReminderRefresh((_event, payload) => httpClient.updateIcsSubscription(payload)),
  );
  ipcMain.handle("desktop:fetchCalendarEvents", (_event, payload) =>
    withUnauthorizedCalendarFallback(
      () => httpClient.fetchCalendarEvents(payload),
      "fetchCalendarEvents",
      { events: [] },
    ),
  );
  ipcMain.handle("desktop:searchCalendarAttendees", (_event, payload) =>
    withUnauthorizedCalendarFallback(
      () => httpClient.searchCalendarAttendees(payload),
      "searchCalendarAttendees",
      { attendees: [] },
    ),
  );
  ipcMain.handle(
    "desktop:createCalendarEvent",
    withReminderRefresh((_event, payload) => httpClient.createCalendarEvent(payload)),
  );
  ipcMain.handle(
    "desktop:updateCalendarEvent",
    withReminderRefresh((_event, payload) => httpClient.updateCalendarEvent(payload)),
  );
  ipcMain.handle(
    "desktop:deleteCalendarEvent",
    withReminderRefresh((_event, payload) => httpClient.deleteCalendarEvent(payload)),
  );
  ipcMain.handle(
    "desktop:rsvpCalendarEvent",
    withReminderRefresh((_event, payload) => httpClient.rsvpCalendarEvent(payload)),
  );
  ipcMain.handle("desktop:flushContactCache", (_event) => httpClient.flushContactCache());

  // ── LinkWarden IPC ────────────────────────────────────────────────────

  ipcMain.handle("desktop:getLinkwardenInstances", () => httpClient.getLinkwardenInstances());

  ipcMain.handle("desktop:addLinkwardenInstance", async (_event, payload) =>
    httpClient.addLinkwardenInstance(payload),
  );

  ipcMain.handle("desktop:removeLinkwardenInstance", async (_event, payload) =>
    httpClient.removeLinkwardenInstance(payload.id),
  );

  ipcMain.handle("desktop:getLinkwardenLinks", async (_event, payload) =>
    httpClient.getLinkwardenLinks(payload.instanceId, payload),
  );

  ipcMain.handle("desktop:getLinkwardenCollections", async (_event, payload) =>
    httpClient.getLinkwardenCollections(payload.instanceId),
  );

  ipcMain.handle("desktop:getLinkwardenTags", async (_event, payload) =>
    httpClient.getLinkwardenTags(payload.instanceId),
  );

  ipcMain.handle("desktop:getLinkwardenDashboard", async (_event, payload) =>
    httpClient.getLinkwardenDashboard(payload.instanceId),
  );

  ipcMain.handle("desktop:createLinkwardenLink", async (_event, payload) =>
    httpClient.createLinkwardenLink(payload.instanceId, payload),
  );

  ipcMain.handle("desktop:resolveLinkwardenPreviewUrl", (_event, payload) => {
    const endpoint = metadataStore.getSetting("backendEndpoint", "");
    const accessToken = metadataStore.getSetting("accessToken", "");
    return httpClient.resolveLinkwardenPreviewUrl(
      endpoint,
      accessToken,
      payload.instanceId,
      payload.linkId,
    );
  });

  // ── Home Assistant IPC ────────────────────────────────────────────────

  ipcMain.handle("desktop:getHomeAssistantInstances", () => httpClient.getHomeAssistantInstances());

  ipcMain.handle("desktop:addHomeAssistantInstance", async (_event, payload) =>
    httpClient.addHomeAssistantInstance(payload),
  );

  ipcMain.handle("desktop:removeHomeAssistantInstance", async (_event, payload) =>
    httpClient.removeHomeAssistantInstance(payload.id),
  );

  ipcMain.handle("desktop:testHomeAssistantConnection", async (_event, payload) =>
    httpClient.testHomeAssistantConnection(payload.instanceId),
  );

  ipcMain.handle("desktop:getHomeAssistantDashboards", async (_event, payload) =>
    httpClient.getHomeAssistantDashboards(payload.instanceId),
  );

  ipcMain.handle("desktop:getHomeAssistantDashboard", async (_event, payload) =>
    httpClient.getHomeAssistantDashboard(payload.instanceId, payload.dashboardId),
  );

  ipcMain.handle("desktop:getHomeAssistantAreas", async (_event, payload) =>
    httpClient.getHomeAssistantAreas(payload.instanceId),
  );

  ipcMain.handle("desktop:getHomeAssistantDevices", async (_event, payload) =>
    httpClient.getHomeAssistantDevices(payload.instanceId),
  );

  ipcMain.handle("desktop:getHomeAssistantEntities", async (_event, payload) =>
    httpClient.getHomeAssistantEntities(payload.instanceId),
  );

  ipcMain.handle("desktop:getHomeAssistantEntity", async (_event, payload) =>
    httpClient.getHomeAssistantEntity(payload.instanceId, payload.entityId),
  );

  ipcMain.handle("desktop:getHomeAssistantState", async (_event, payload) =>
    httpClient.getHomeAssistantState(payload.instanceId),
  );

  ipcMain.handle("desktop:controlHomeAssistantEntity", async (_event, payload) =>
    httpClient.controlHomeAssistantEntity(payload.instanceId, payload.request),
  );

  ipcMain.handle("desktop:resolveHomeAssistantCameraSnapshotUrl", async (_event, payload) => {
    const endpoint = metadataStore.getSetting("backendEndpoint", "");
    const accessToken = metadataStore.getSetting("accessToken", "");
    return httpClient.resolveHomeAssistantCameraSnapshotUrl(
      endpoint,
      accessToken,
      payload.instanceId,
      payload.entityId,
    );
  });

  ipcMain.handle("desktop:subscribeHomeAssistantEvents", async (event, payload) =>
    httpClient.subscribeHomeAssistantEvents(
      payload.subscriptionId,
      payload.instanceId,
      (streamEvent) => {
        event.sender.send("desktop:homeAssistantEvent", {
          subscriptionId: payload.subscriptionId,
          event: streamEvent,
        });
      },
    ),
  );

  ipcMain.handle("desktop:unsubscribeHomeAssistantEvents", async (_event, payload) =>
    httpClient.unsubscribeHomeAssistantEvents(payload.subscriptionId),
  );

  // ── Jira IPC ──────────────────────────────────────────────────────────

  ipcMain.handle("desktop:getJiraInstances", () => httpClient.getJiraInstances());

  ipcMain.handle("desktop:addJiraInstance", async (_event, payload) =>
    httpClient.addJiraInstance(payload),
  );

  ipcMain.handle("desktop:updateJiraInstance", async (_event, payload) =>
    httpClient.updateJiraInstance(payload.id, payload),
  );

  ipcMain.handle("desktop:removeJiraInstance", async (_event, payload) =>
    httpClient.removeJiraInstance(payload.id),
  );

  ipcMain.handle("desktop:testJiraConnection", async (_event, payload) =>
    httpClient.testJiraConnection(payload.instanceId),
  );

  ipcMain.handle("desktop:getJiraProjects", async (_event, payload) =>
    httpClient.getJiraProjects(payload.instanceId),
  );

  ipcMain.handle("desktop:getJiraIssues", async (_event, payload) =>
    httpClient.getJiraIssues(payload.instanceId, payload),
  );

  ipcMain.handle("desktop:getJiraIssue", async (_event, payload) =>
    httpClient.getJiraIssue(payload.instanceId, payload.issueKey),
  );

  ipcMain.handle("desktop:updateJiraIssue", async (_event, payload) =>
    httpClient.updateJiraIssue(payload.instanceId, payload.issueKey, payload.fields),
  );

  ipcMain.handle("desktop:getJiraTransitions", async (_event, payload) =>
    httpClient.getJiraTransitions(payload.instanceId, payload.issueKey),
  );

  ipcMain.handle("desktop:transitionJiraIssue", async (_event, payload) =>
    httpClient.transitionJiraIssue(payload.instanceId, payload.issueKey, {
      transitionId: payload.transitionId,
      fields: payload.fields,
    }),
  );

  ipcMain.handle("desktop:addJiraComment", async (_event, payload) =>
    httpClient.addJiraComment(payload.instanceId, payload.issueKey, { body: payload.body }),
  );

  ipcMain.handle("desktop:searchJiraUsers", async (_event, payload) =>
    httpClient.searchJiraUsers(payload.instanceId, payload.query),
  );

  ipcMain.handle("desktop:getJiraPriorities", async (_event, payload) =>
    httpClient.getJiraPriorities(payload.instanceId),
  );

  ipcMain.handle("desktop:getJiraIssueTypes", async (_event, payload) =>
    httpClient.getJiraIssueTypes(payload.instanceId, payload.projectKey),
  );

  ipcMain.handle("desktop:createJiraIssue", async (_event, payload) =>
    httpClient.createJiraIssue(payload.instanceId, payload.fields),
  );

  ipcMain.handle("desktop:getJiraCreateFieldsMeta", async (_event, payload) =>
    httpClient.getJiraCreateFieldsMeta(payload.instanceId, payload.projectKey, payload.issueTypeId),
  );

  ipcMain.handle("desktop:getJiraLabels", async (_event, payload) =>
    httpClient.getJiraLabels(payload.instanceId),
  );

  ipcMain.handle("desktop:getJiraBoards", async (_event, payload) =>
    httpClient.getJiraBoards(payload.instanceId, payload.projectKey),
  );

  ipcMain.handle("desktop:getJiraBoardConfig", async (_event, payload) =>
    httpClient.getJiraBoardConfig(payload.instanceId, payload.boardId),
  );

  ipcMain.handle("desktop:getJiraSprints", async (_event, payload) =>
    httpClient.getJiraSprints(payload.instanceId, payload.boardId),
  );

  ipcMain.handle("desktop:getJiraSprintIssues", async (_event, payload) =>
    httpClient.getJiraSprintIssues(payload.instanceId, payload.sprintId),
  );

  ipcMain.handle("desktop:getJiraBoardIssues", async (_event, payload) =>
    httpClient.getJiraBoardIssues(payload.instanceId, payload.boardId),
  );

  // ── Settings ──
  ipcMain.handle("desktop:getSetting", (_event, key) => metadataStore.getSetting(key, null));
  ipcMain.handle("desktop:setSetting", (_event, key, value) =>
    metadataStore.setSetting(key, value),
  );
  ipcMain.handle("desktop:getLastOpenNoteId", () =>
    metadataStore.getSetting("lastOpenNoteId", null),
  );
  ipcMain.handle("desktop:setLastOpenNoteId", (_event, noteId) =>
    metadataStore.setSetting("lastOpenNoteId", noteId),
  );
  ipcMain.handle("desktop:getLastSidebarMode", () =>
    metadataStore.getSetting("lastSidebarMode", null),
  );
  ipcMain.handle("desktop:setLastSidebarMode", (_event, mode) =>
    metadataStore.setSetting("lastSidebarMode", mode),
  );
  ipcMain.handle("desktop:getCalendarVisibilityFilters", () =>
    metadataStore.getSetting("calendarVisibilityFilters", null),
  );
  ipcMain.handle(
    "desktop:setCalendarVisibilityFilters",
    withReminderRefresh((_event, payload) =>
      metadataStore.setSetting("calendarVisibilityFilters", payload),
    ),
  );
  ipcMain.handle("desktop:getCalendarReminderSettings", () =>
    metadataStore.getCalendarReminderSettings(),
  );
  ipcMain.handle(
    "desktop:setCalendarReminderSettings",
    withReminderRefresh((_event, payload) => metadataStore.setCalendarReminderSettings(payload)),
  );
  ipcMain.handle("desktop:getLastCalendarView", () =>
    metadataStore.getSetting("lastCalendarView", null),
  );
  ipcMain.handle("desktop:setLastCalendarView", (_event, view) =>
    metadataStore.setSetting("lastCalendarView", view),
  );
  ipcMain.handle("desktop:getLastCalendarDate", () =>
    metadataStore.getSetting("lastCalendarDate", null),
  );
  ipcMain.handle("desktop:setLastCalendarDate", (_event, date) =>
    metadataStore.setSetting("lastCalendarDate", date),
  );
  ipcMain.handle("desktop:getLastActiveChatConversationId", () =>
    metadataStore.getSetting("lastActiveChatConversationId", null),
  );
  ipcMain.handle("desktop:setLastActiveChatConversationId", (_event, id) =>
    metadataStore.setSetting("lastActiveChatConversationId", id),
  );
  ipcMain.handle("desktop:getKeyboardShortcuts", () => metadataStore.getShortcuts());
  ipcMain.handle("desktop:setKeyboardShortcut", (_event, action, shortcut) =>
    metadataStore.setShortcut(action, shortcut),
  );

  ipcMain.handle("desktop:showContextMenu", (_event, items) => {
    return new Promise((resolve) => {
      const template = items.map((item) => {
        if (item.type === "separator") return { type: "separator" };
        return {
          label: item.label,
          enabled: item.enabled !== false,
          click: () => resolve(item.id),
        };
      });
      const menu = Menu.buildFromTemplate(template);
      menu.popup({ window: mainWindow, callback: () => resolve(null) });
    });
  });

  ipcMain.handle("desktop:getNotePath", (_event, noteId) => {
    const row = metadataStore.getNoteById(noteId);
    return row?.relative_path ?? null;
  });
  ipcMain.handle("desktop:getNoteCrdtState", () => null); // CRDT state lives in IndexedDB

  ipcMain.handle("desktop:openExternal", async (_event, url) => {
    if (
      typeof url === "string" &&
      (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("mailto:"))
    ) {
      await shell.openExternal(url);
    }
  });
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "slate-attachment",
    privileges: { bypassCSP: true, stream: true, supportFetchAPI: true },
  },
]);

app.whenReady().then(async () => {
  protocol.handle("slate-attachment", (request) => {
    const filePath = decodeURIComponent(request.url.replace("slate-attachment://", ""));
    return net.fetch(pathToFileURL(filePath).href);
  });
  if (process.platform === "darwin" && app.dock) {
    const dockIconPath = path.join(__dirname, "../build/icon.png");
    const dockIcon = nativeImage.createFromPath(dockIconPath);
    app.dock.setIcon(dockIcon.isEmpty() ? dockIconPath : dockIcon);
  }
  configStore = new ConfigStore(app.getPath("userData"));
  pendingUploads = new PendingUploads(app.getPath("userData"));

  const logDir = path.join(app.getPath("userData"), "logs");
  await fs.promises.mkdir(logDir, { recursive: true });
  slateDesktopLogger = createDesktopLogger({
    logPath: path.join(logDir, "slate-desktop.log"),
  });
  slateDesktopLogger.child("lifecycle").info("app_ready", { userData: app.getPath("userData") });

  httpClient = new HttpClient({ metadataStore, log: slateDesktopLogger.child("http") });

  const reminderIconPath = path.join(__dirname, "../build/icon.png");
  const reminderIcon = nativeImage.createFromPath(reminderIconPath);
  calendarReminderService = new CalendarReminderService({
    backendClient: httpClient,
    metadataStore,
    Notification,
    icon: reminderIcon.isEmpty() ? reminderIconPath : reminderIcon,
    soundPlayer: { beep: () => shell.beep() },
  });

  calendarReminderService.start();
  registerIpc();

  // Refresh expired access token before the UI loads so the session persists across restarts
  if (
    metadataStore.getSetting("authStatus", "signed_out") === "authenticated" &&
    httpClient.isTokenExpired()
  ) {
    const refreshResult = await httpClient.tryRefreshDetailed();
    if (!refreshResult.ok) {
      if (refreshResult.reason === "rejected" || refreshResult.reason === "no_credentials") {
        clearStoredAuthSession("startup_refresh_invalid");
      } else {
        slateDesktopLogger.child("auth").info("startup_refresh_transient_kept_session", {
          reason: refreshResult.reason,
          detail: refreshResult.detail,
        });
      }
    }
  }

  if (metadataStore.getSetting("backendEndpoint", "")) {
    await refreshStoredBackendStatus(metadataStore.getSetting("backendEndpoint", ""));
  }

  await createWindow();
  if (
    metadataStore.getSetting("authStatus", "signed_out") === "authenticated" &&
    metadataStore.getSetting("backendReachable", false)
  ) {
    void syncNotesFromServer();
  }

  powerMonitor.on("resume", () => {
    void calendarReminderService?.handleWake?.();
    void (async () => {
      if (metadataStore.getSetting("authStatus", "signed_out") !== "authenticated") return;
      if (!httpClient.isTokenExpired()) return;
      const r = await httpClient.tryRefreshDetailed();
      slateDesktopLogger.child("auth").info("resume_token_refresh", {
        ok: r.ok,
        ...(r.ok ? {} : { reason: r.reason, detail: r.detail }),
      });
    })();
  });

  setInterval(() => {
    void (async () => {
      try {
        if (metadataStore.getSetting("authStatus", "signed_out") !== "authenticated") return;
        if (!httpClient.isTokenExpired()) return;
        const r = await httpClient.tryRefreshDetailed();
        slateDesktopLogger.child("auth").info("scheduled_token_refresh", {
          ok: r.ok,
          ...(r.ok ? {} : { reason: r.reason, detail: r.detail }),
        });
      } catch (err) {
        slateDesktopLogger.child("auth").warn("scheduled_token_refresh_error", {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }, 90_000);

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
      {
        label: "Paste as Markdown",
        accelerator: "CmdOrCtrl+Shift+V",
        enabled: params.editFlags.canPaste,
        click: () => {
          mainWindow?.webContents.send("desktop:pasteMarkdown", {
            text: clipboard.readText(),
          });
        },
      },
      { type: "separator" },
      { role: "selectAll", enabled: params.editFlags.canSelectAll },
    );

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: mainWindow });
  });

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("before-quit", () => {
  calendarReminderService?.stop?.();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
