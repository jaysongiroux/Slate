import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WorkspaceService } from "./services/workspace-service.mjs";
import { MetadataStore } from "./services/metadata-store.mjs";
import { BackendClient } from "./services/backend-client.mjs";
import { SyncService } from "./services/sync-service.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    metadataStore.setSetting("backendEndpoint", endpoint);
    metadataStore.setSetting("connected", false);
    return syncService.getSnapshot().then((s) => s.backend);
  });
  ipcMain.handle("desktop:checkBackendConnection", async (_event, endpoint) => {
    await backendClient.checkConnection(endpoint);
    return true;
  });
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
