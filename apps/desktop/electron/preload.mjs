import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("slateDesktop", {
  getSnapshot: () => ipcRenderer.invoke("desktop:getSnapshot"),
  chooseWorkspaceDirectory: () => ipcRenderer.invoke("desktop:chooseWorkspaceDirectory"),
  createNote: (parentPath) => ipcRenderer.invoke("desktop:createNote", parentPath),
  createFolder: (parentPath) => ipcRenderer.invoke("desktop:createFolder", parentPath),
  loadNote: (noteId) => ipcRenderer.invoke("desktop:loadNote", noteId),
  saveNote: (payload) => ipcRenderer.invoke("desktop:saveNote", payload),
  deleteNote: (noteId) => ipcRenderer.invoke("desktop:deleteNote", noteId),
  renameFolder: (folderPath, nextName) => ipcRenderer.invoke("desktop:renameFolder", folderPath, nextName),
  deleteFolder: (folderPath) => ipcRenderer.invoke("desktop:deleteFolder", folderPath),
  setBackendEndpoint: (endpoint) => ipcRenderer.invoke("desktop:setBackendEndpoint", endpoint),
  checkBackendConnection: (endpoint) => ipcRenderer.invoke("desktop:checkBackendConnection", endpoint),
  refreshBackendStatus: () => ipcRenderer.invoke("desktop:refreshBackendStatus"),
  loginWithPassword: (payload) => ipcRenderer.invoke("desktop:loginWithPassword", payload),
  loginWithOidc: (providerId) => ipcRenderer.invoke("desktop:loginWithOidc", providerId),
  cancelOidc: () => ipcRenderer.invoke("desktop:cancelOidc"),
  uploadAttachment: (payload) => ipcRenderer.invoke("desktop:uploadAttachment", {
    ...payload,
    buffer: new Uint8Array(payload.buffer),
  }),
  resolveAttachmentUrl: (contentUrl) => ipcRenderer.invoke("desktop:resolveAttachmentUrl", contentUrl),
  signOutBackend: () => ipcRenderer.invoke("desktop:signOutBackend"),
  connectBackend: () => ipcRenderer.invoke("desktop:connectBackend"),
  syncNow: () => ipcRenderer.invoke("desktop:syncNow"),
  showContextMenu: (items) => ipcRenderer.invoke("desktop:showContextMenu", items),
  getLastOpenNoteId: () => ipcRenderer.invoke("desktop:getLastOpenNoteId"),
  setLastOpenNoteId: (noteId) => ipcRenderer.invoke("desktop:setLastOpenNoteId", noteId),
  getKeyboardShortcuts: () => ipcRenderer.invoke("desktop:getKeyboardShortcuts"),
  setKeyboardShortcut: (action, shortcut) => ipcRenderer.invoke("desktop:setKeyboardShortcut", action, shortcut)
});
