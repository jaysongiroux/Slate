import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("slateDesktop", {
  getSnapshot: () => ipcRenderer.invoke("desktop:getSnapshot"),
  chooseWorkspaceDirectory: () => ipcRenderer.invoke("desktop:chooseWorkspaceDirectory"),
  createNote: (parentPath) => ipcRenderer.invoke("desktop:createNote", parentPath),
  loadNote: (noteId) => ipcRenderer.invoke("desktop:loadNote", noteId),
  saveNote: (payload) => ipcRenderer.invoke("desktop:saveNote", payload),
  deleteNote: (noteId) => ipcRenderer.invoke("desktop:deleteNote", noteId),
  renameFolder: (folderPath, nextName) => ipcRenderer.invoke("desktop:renameFolder", folderPath, nextName),
  deleteFolder: (folderPath) => ipcRenderer.invoke("desktop:deleteFolder", folderPath),
  connectBackend: () => ipcRenderer.invoke("desktop:connectBackend"),
  syncNow: () => ipcRenderer.invoke("desktop:syncNow")
});
