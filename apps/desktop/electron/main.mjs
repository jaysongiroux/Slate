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
import { MetadataStore } from "./services/metadata-store.mjs";
import { NoteStore } from "./services/note-store.mjs";
import { HttpClient } from "./services/http-client.mjs";
import { ImportService } from "./services/import-service.mjs";
import { CalendarReminderService } from "./services/calendar-reminder-service.mjs";

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
let metadataStore;
let noteStore;
let httpClient;
let importService;
let calendarReminderService;
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

function clearStoredAuthSession() {
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

async function withUnauthorizedCalendarFallback(task, label, fallbackValue) {
  try {
    return await task();
  } catch (error) {
    if (!isUnauthorizedHttpError(error)) {
      throw error;
    }
    console.warn(`[SlateCalendar] ${label} returned 401. Clearing stored session.`);
    clearStoredAuthSession();
    return fallbackValue;
  }
}

function registerIpc() {
  const withReminderRefresh =
    (handler) =>
    async (event, ...args) => {
      const result = await handler(event, ...args);
      await calendarReminderService?.refreshNow?.();
      return result;
    };

  // ── Snapshot ──
  ipcMain.handle("desktop:getSnapshot", () => {
    const { notes, folders } = noteStore.getSnapshot();
    return { backend: buildBackendConfig(), notes, folders };
  });
  // ── Note CRUD ──
  ipcMain.handle("desktop:createNote", (_event, parentPath, name) =>
    noteStore.createNote({ parentPath, name }),
  );
  ipcMain.handle("desktop:createDailyNote", () => noteStore.createDailyNote());
  ipcMain.handle("desktop:createFolder", (_event, parentPath, name) =>
    noteStore.createFolder(parentPath, name),
  );
  ipcMain.handle("desktop:listTemplates", () => noteStore.listTemplates());
  ipcMain.handle("desktop:createTemplate", (_event, parentPath, name) =>
    noteStore.createTemplate({ parentPath, name }),
  );
  ipcMain.handle("desktop:readTemplateContent", () => null); // content lives in Y.Doc
  ipcMain.handle("desktop:loadNote", (_event, noteId) => noteStore.getNoteById(noteId));
  ipcMain.handle("desktop:saveNote", (_event, payload) => {
    if (!payload?.id || typeof payload.title !== "string") return null;
    return noteStore.updateTitleFromContent(payload.id, payload.title);
  });
  ipcMain.handle("desktop:rescanNote", () => null); // no-op
  ipcMain.handle("desktop:deleteNote", (_event, noteId) => noteStore.deleteNote(noteId));
  ipcMain.handle("desktop:renameNote", (_event, noteId, nextTitle) => {
    const note = noteStore.renameNote(noteId, nextTitle);
    const token = metadataStore.getSetting("accessToken");
    if (token) {
      httpClient.updateNoteRemote(noteId, { path: note.path }).catch(() => {});
    }
    mainWindow?.webContents.send("desktop:workspaceChanged", []);
    return note;
  });
  ipcMain.handle("desktop:togglePinNote", (_event, noteId, pinned) => {
    noteStore.togglePinNote(noteId, pinned);
    const token = metadataStore.getSetting("accessToken");
    if (token) httpClient.updateNoteRemote(noteId, { pinned }).catch(() => {});
  });
  ipcMain.handle("desktop:moveNote", (_event, noteId, targetFolderPath) => {
    const note = noteStore.moveNote(noteId, targetFolderPath);
    const token = metadataStore.getSetting("accessToken");
    if (token) httpClient.updateNoteRemote(noteId, { path: note.path }).catch(() => {});
    mainWindow?.webContents.send("desktop:workspaceChanged", []);
    return note;
  });
  ipcMain.handle("desktop:renameFolder", (_event, folderPath, nextName) => {
    noteStore.renameFolder(folderPath, nextName);
    mainWindow?.webContents.send("desktop:workspaceChanged", []);
  });
  ipcMain.handle("desktop:moveFolder", (_event, folderPath, targetParentPath) => {
    noteStore.moveFolder(folderPath, targetParentPath);
    mainWindow?.webContents.send("desktop:workspaceChanged", []);
  });
  ipcMain.handle("desktop:deleteFolder", (_event, folderPath) => {
    noteStore.deleteFolder(folderPath);
    mainWindow?.webContents.send("desktop:workspaceChanged", []);
  });
  ipcMain.handle("desktop:updateNotePlainText", (_event, noteId, plainText) => {
    noteStore.updatePlainText(noteId, plainText);
    const token = metadataStore.getSetting("accessToken");
    if (token) httpClient.updateNoteRemote(noteId, { plainText }).catch(() => {});
  });
  ipcMain.handle("desktop:importFolder", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: "Choose a folder to import",
      buttonLabel: "Import",
    });

    if (result.canceled || !result.filePaths[0]) return null;

    const dirPath = result.filePaths[0];
    const files = await importService.scanDirectory(dirPath);
    const templateCount = files.filter((f) => f.isTemplate).length;
    const noteCount = files.length - templateCount;

    if (files.length === 0) {
      return { total: 0, imported: 0, errors: 0 };
    }

    const confirm = await dialog.showMessageBox({
      type: "question",
      buttons: ["Import", "Cancel"],
      defaultId: 0,
      title: "Import Notes",
      message: `Import ${noteCount} note${noteCount !== 1 ? "s" : ""}${templateCount > 0 ? ` and ${templateCount} template${templateCount !== 1 ? "s" : ""}` : ""}?`,
      detail: `From: ${dirPath}`,
    });

    if (confirm.response !== 0) return null;

    const importResult = await importService.importDirectory(dirPath);
    mainWindow?.webContents.send("desktop:workspaceChanged", []);

    return {
      total: importResult.total,
      imported: importResult.imported,
      errors: importResult.errors.length,
    };
  });
  // ── Backend / Auth ──
  ipcMain.handle("desktop:setBackendEndpoint", async (_event, endpoint) => {
    const trimmed = typeof endpoint === "string" ? endpoint.trim() : "";
    if (!trimmed) return buildBackendConfig();
    const normalized = trimmed.replace(/:50051$/, ":4000");
    metadataStore.setSetting("backendEndpoint", normalized);
    metadataStore.setSetting("backendReachable", false);
    metadataStore.setSetting("authStatus", "signed_out");
    try {
      const providers = await httpClient.listAuthProviders(normalized);
      metadataStore.setSetting("backendReachable", true);
      metadataStore.setSetting("authProviders", providers.providers ?? []);
    } catch {
      metadataStore.setSetting("backendReachable", false);
    }
    return buildBackendConfig();
  });
  ipcMain.handle("desktop:checkBackendConnection", async (_event, endpoint) => {
    return httpClient.checkConnection(endpoint);
  });
  ipcMain.handle("desktop:refreshBackendStatus", async () => {
    const endpoint = metadataStore.getSetting("backendEndpoint", "");
    if (endpoint) {
      try {
        const providers = await httpClient.listAuthProviders(endpoint);
        metadataStore.setSetting("backendReachable", true);
        metadataStore.setSetting("authProviders", providers.providers ?? []);
      } catch {
        metadataStore.setSetting("backendReachable", false);
      }
    }
    return buildBackendConfig();
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
    },
  );
  ipcMain.handle("desktop:resolveAttachmentUrl", (_event, contentUrl) => {
    const pendingMatch = contentUrl.match(/^\/api\/attachments\/pending\/([^/]+)\/content$/);
    if (pendingMatch) {
      const pending = metadataStore.listPendingAttachments().find((p) => p.id === pendingMatch[1]);
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
      clearStoredAuthSession();
      return buildBackendConfig();
    }),
  );
  ipcMain.handle(
    "desktop:connectBackend",
    withReminderRefresh(async () => {
      const endpoint = metadataStore.getSetting("backendEndpoint", "");
      if (endpoint) {
        try {
          const providers = await httpClient.listAuthProviders(endpoint);
          metadataStore.setSetting("backendReachable", true);
          metadataStore.setSetting("authProviders", providers.providers ?? []);
        } catch {
          metadataStore.setSetting("backendReachable", false);
        }
      }
      return buildBackendConfig();
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
  metadataStore = new MetadataStore(app.getPath("userData"));
  noteStore = new NoteStore({ metadataStore });
  httpClient = new HttpClient({ metadataStore });
  importService = new ImportService({ noteStore, httpClient });

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
  await createWindow();

  powerMonitor.on("resume", () => {
    void calendarReminderService?.handleWake?.();
  });

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
