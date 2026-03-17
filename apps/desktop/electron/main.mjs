import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WorkspaceService } from "./services/workspace-service.mjs";
import { MetadataStore } from "./services/metadata-store.mjs";
import { BackendClient } from "./services/backend-client.mjs";
import { SyncService } from "./services/sync-service.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 700,
    minWidth: 960,
    minHeight: 700,
    frame: false,
    hasShadow: false,
    transparent: true,
    vibrancy: "fullscreen-ui",
    backgroundMaterial: "acrylic",
    // vibrancy: process.platform === "darwin" ? "under-window" : undefined,
    visualEffectState: process.platform === "darwin" ? "active" : undefined,
    // backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
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
  ipcMain.handle("desktop:createFolder", async (_event, parentPath) => workspaceService.createFolder(parentPath));
  ipcMain.handle("desktop:loadNote", async (_event, noteId) => workspaceService.loadNote(noteId));
  ipcMain.handle("desktop:saveNote", async (_event, payload) => workspaceService.saveNote(payload));
  ipcMain.handle("desktop:deleteNote", async (_event, noteId) => workspaceService.deleteNote(noteId));
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

        response.statusCode = error ? 400 : 200;
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(
          `<!doctype html><html><body style=\"font-family: -apple-system, sans-serif; padding: 24px;\">${
            error ? "Sign-in failed. You can close this window." : "Sign-in complete. You can close this window."
          }</body></html>`,
        );

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
          server.close(() => {
            reject(error);
          });
        }
      });

      setTimeout(() => {
        server.close(() => {
          reject(new Error("Timed out waiting for OIDC callback"));
        });
      }, 180_000);
    });

    return syncService.completeOidcLogin({
      providerId: providerId.trim(),
      redirectUri: callbackResult.redirectUri,
      state: callbackResult.state,
      code: callbackResult.code,
    });
  });
  ipcMain.handle("desktop:signOutBackend", async () => syncService.signOut());
  ipcMain.handle("desktop:connectBackend", async () => syncService.connectBackend());
  ipcMain.handle("desktop:syncNow", async () => syncService.syncNow());
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
}

app.whenReady().then(async () => {
  metadataStore = new MetadataStore(app.getPath("userData"));
  workspaceService = new WorkspaceService({
    metadataStore,
    defaultWorkspaceRoot: path.join(app.getPath("documents"), "Slate")
  });
  backendClient = new BackendClient({
    protoPath: path.resolve(__dirname, "./proto/slate.proto"),
    metadataStore
  });
  syncService = new SyncService({
    metadataStore,
    workspaceService,
    backendClient
  });

  await workspaceService.initialize();
  await syncService.initialize();
  registerIpc();
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
