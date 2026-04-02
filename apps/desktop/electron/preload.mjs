import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("slateDesktop", {
  getSnapshot: () => ipcRenderer.invoke("desktop:getSnapshot"),
  chooseWorkspaceDirectory: () => ipcRenderer.invoke("desktop:chooseWorkspaceDirectory"),
  createNote: (parentPath) => ipcRenderer.invoke("desktop:createNote", parentPath),
  createDailyNote: () => ipcRenderer.invoke("desktop:createDailyNote"),
  createFolder: (parentPath) => ipcRenderer.invoke("desktop:createFolder", parentPath),
  loadNote: (noteId) => ipcRenderer.invoke("desktop:loadNote", noteId),
  saveNote: (payload) => ipcRenderer.invoke("desktop:saveNote", payload),
  deleteNote: (noteId) => ipcRenderer.invoke("desktop:deleteNote", noteId),
  togglePinNote: (noteId, pinned) => ipcRenderer.invoke("desktop:togglePinNote", noteId, pinned),
  rescanNote: (noteId) => ipcRenderer.invoke("desktop:rescanNote", noteId),
  moveNote: (noteId, targetFolderPath) =>
    ipcRenderer.invoke("desktop:moveNote", noteId, targetFolderPath),
  renameFolder: (folderPath, nextName) =>
    ipcRenderer.invoke("desktop:renameFolder", folderPath, nextName),
  moveFolder: (folderPath, targetParentPath) =>
    ipcRenderer.invoke("desktop:moveFolder", folderPath, targetParentPath),
  deleteFolder: (folderPath) => ipcRenderer.invoke("desktop:deleteFolder", folderPath),
  setBackendEndpoint: (endpoint) => ipcRenderer.invoke("desktop:setBackendEndpoint", endpoint),
  checkBackendConnection: (endpoint) =>
    ipcRenderer.invoke("desktop:checkBackendConnection", endpoint),
  refreshBackendStatus: () => ipcRenderer.invoke("desktop:refreshBackendStatus"),
  loginWithPassword: (payload) => ipcRenderer.invoke("desktop:loginWithPassword", payload),
  loginWithOidc: (providerId) => ipcRenderer.invoke("desktop:loginWithOidc", providerId),
  cancelOidc: () => ipcRenderer.invoke("desktop:cancelOidc"),
  uploadAttachment: (payload) =>
    ipcRenderer.invoke("desktop:uploadAttachment", {
      ...payload,
      buffer: new Uint8Array(payload.buffer),
    }),
  resolveAttachmentUrl: (contentUrl) =>
    ipcRenderer.invoke("desktop:resolveAttachmentUrl", contentUrl),
  signOutBackend: () => ipcRenderer.invoke("desktop:signOutBackend"),
  connectBackend: () => ipcRenderer.invoke("desktop:connectBackend"),
  syncNow: () => ipcRenderer.invoke("desktop:syncNow"),
  fullSync: () => ipcRenderer.invoke("desktop:fullSync"),
  showContextMenu: (items) => ipcRenderer.invoke("desktop:showContextMenu", items),
  getLastOpenNoteId: () => ipcRenderer.invoke("desktop:getLastOpenNoteId"),
  setLastOpenNoteId: (noteId) => ipcRenderer.invoke("desktop:setLastOpenNoteId", noteId),
  getLastSidebarMode: () => ipcRenderer.invoke("desktop:getLastSidebarMode"),
  setLastSidebarMode: (mode) => ipcRenderer.invoke("desktop:setLastSidebarMode", mode),
  getCalendarVisibilityFilters: () => ipcRenderer.invoke("desktop:getCalendarVisibilityFilters"),
  setCalendarVisibilityFilters: (payload) =>
    ipcRenderer.invoke("desktop:setCalendarVisibilityFilters", payload),
  getLastCalendarView: () => ipcRenderer.invoke("desktop:getLastCalendarView"),
  setLastCalendarView: (view) => ipcRenderer.invoke("desktop:setLastCalendarView", view),
  getLastCalendarDate: () => ipcRenderer.invoke("desktop:getLastCalendarDate"),
  setLastCalendarDate: (date) => ipcRenderer.invoke("desktop:setLastCalendarDate", date),
  getLastActiveChatConversationId: () =>
    ipcRenderer.invoke("desktop:getLastActiveChatConversationId"),
  setLastActiveChatConversationId: (conversationId) =>
    ipcRenderer.invoke("desktop:setLastActiveChatConversationId", conversationId),
  getKeyboardShortcuts: () => ipcRenderer.invoke("desktop:getKeyboardShortcuts"),
  setKeyboardShortcut: (action, shortcut) =>
    ipcRenderer.invoke("desktop:setKeyboardShortcut", action, shortcut),
  // AI Chat
  getAiConfig: () => ipcRenderer.invoke("desktop:getAiConfig"),
  updateAiConfig: (config) => ipcRenderer.invoke("desktop:updateAiConfig", config),
  createConversation: () => ipcRenderer.invoke("desktop:createConversation"),
  listConversations: () => ipcRenderer.invoke("desktop:listConversations"),
  deleteConversation: (id) => ipcRenderer.invoke("desktop:deleteConversation", id),
  getConversationMessages: (conversationId) =>
    ipcRenderer.invoke("desktop:getConversationMessages", conversationId),
  sendMessage: (conversationId, content, onEvent) => {
    const handler = (_event, event) => onEvent(event);
    ipcRenderer.on("desktop:aiChatEvent", handler);
    return ipcRenderer.invoke("desktop:sendMessage", conversationId, content).finally(() => {
      setTimeout(() => {
        ipcRenderer.removeListener("desktop:aiChatEvent", handler);
      }, 0);
    });
  },
  cancelSendMessage: () => ipcRenderer.invoke("desktop:cancelSendMessage"),
  triggerEmbedding: () => ipcRenderer.invoke("desktop:triggerEmbedding"),
  // Calendar
  getCalendarStatus: () => ipcRenderer.invoke("desktop:getCalendarStatus"),
  startCalendarOAuth: (payload) => ipcRenderer.invoke("desktop:startCalendarOAuth", payload),
  disconnectCalendar: (payload) => ipcRenderer.invoke("desktop:disconnectCalendar", payload),
  listCalendars: (payload) => ipcRenderer.invoke("desktop:listCalendars", payload),
  subscribeCalendar: (payload) => ipcRenderer.invoke("desktop:subscribeCalendar", payload),
  unsubscribeCalendar: (payload) => ipcRenderer.invoke("desktop:unsubscribeCalendar", payload),
  updateCalendarSubscription: (payload) =>
    ipcRenderer.invoke("desktop:updateCalendarSubscription", payload),
  addIcsSubscription: (payload) => ipcRenderer.invoke("desktop:addIcsSubscription", payload),
  removeIcsSubscription: (payload) => ipcRenderer.invoke("desktop:removeIcsSubscription", payload),
  updateIcsSubscription: (payload) => ipcRenderer.invoke("desktop:updateIcsSubscription", payload),
  fetchCalendarEvents: (payload) => ipcRenderer.invoke("desktop:fetchCalendarEvents", payload),
  createCalendarEvent: (payload) => ipcRenderer.invoke("desktop:createCalendarEvent", payload),
  updateCalendarEvent: (payload) => ipcRenderer.invoke("desktop:updateCalendarEvent", payload),
  deleteCalendarEvent: (payload) => ipcRenderer.invoke("desktop:deleteCalendarEvent", payload),
  rsvpCalendarEvent: (payload) => ipcRenderer.invoke("desktop:rsvpCalendarEvent", payload),
  getCrdtState: (noteId) => ipcRenderer.invoke("desktop:getCrdtState", noteId),
  applyCrdtUpdate: (noteId, update) =>
    ipcRenderer.invoke("desktop:applyCrdtUpdate", noteId, update),
  onRemoteCrdtUpdate: (callback) => ipcRenderer.on("desktop:remoteCrdtUpdate", callback),
  offRemoteCrdtUpdate: () => ipcRenderer.removeAllListeners("desktop:remoteCrdtUpdate"),
  onCrdtStateReset: (callback) => ipcRenderer.on("desktop:crdtStateReset", callback),
  offCrdtStateReset: () => ipcRenderer.removeAllListeners("desktop:crdtStateReset"),
  onSyncStatus: (callback) =>
    ipcRenderer.on("desktop:syncStatus", (_event, status) => callback(status)),
  offSyncStatus: () => ipcRenderer.removeAllListeners("desktop:syncStatus"),
  onWorkspaceChanged: (callback) =>
    ipcRenderer.on("desktop:workspaceChanged", (_event, diskRelPaths) =>
      callback(diskRelPaths ?? []),
    ),
  offWorkspaceChanged: () => ipcRenderer.removeAllListeners("desktop:workspaceChanged"),
  openExternal: (url) => ipcRenderer.invoke("desktop:openExternal", url),
});
