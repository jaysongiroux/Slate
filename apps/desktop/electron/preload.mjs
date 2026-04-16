import { contextBridge, ipcRenderer } from "electron";

/**
 * Wrap ipcRenderer.invoke to strip Electron's verbose error prefix.
 * Electron wraps IPC errors as: "Error invoking remote method 'channel': Error: actual message"
 * This extracts just the actual message so the UI gets clean errors.
 */
function invoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args).catch((err) => {
    if (err instanceof Error) {
      const match = err.message.match(/^Error invoking remote method '[^']+': (?:Error: )?(.+)$/s);
      if (match) {
        const clean = new Error(match[1]);
        clean.stack = err.stack;
        throw clean;
      }
    }
    throw err;
  });
}

contextBridge.exposeInMainWorld("slateDesktop", {
  writeDiagLog: (payload) => invoke("desktop:writeDiagLog", payload),
  // Config (new — replaces MetadataStore settings)
  getConfig: (key) => invoke("desktop:getConfig", key),
  setConfig: (key, value) => invoke("desktop:setConfig", key, value),
  listPendingUploads: () => invoke("desktop:listPendingUploads"),

  // Snapshot (backend config only — notes/folders come from RxDB)
  getSnapshot: () => invoke("desktop:getSnapshot"),
  importFolder: () => invoke("desktop:importFolder"),
  importFiles: () => invoke("desktop:importFiles"),
  saveZipExport: (payload) =>
    invoke("desktop:saveZipExport", {
      ...payload,
      data: payload?.data instanceof Uint8Array ? new Uint8Array(payload.data) : payload?.data,
    }),
  setBackendEndpoint: (endpoint) => invoke("desktop:setBackendEndpoint", endpoint),
  checkBackendConnection: (endpoint) => invoke("desktop:checkBackendConnection", endpoint),
  refreshBackendStatus: () => invoke("desktop:refreshBackendStatus"),
  loginWithPassword: (payload) => invoke("desktop:loginWithPassword", payload),
  loginWithOidc: (providerId) => invoke("desktop:loginWithOidc", providerId),
  cancelOidc: () => invoke("desktop:cancelOidc"),
  uploadAttachment: (payload) =>
    invoke("desktop:uploadAttachment", {
      ...payload,
      buffer: new Uint8Array(payload.buffer),
    }),
  resolveAttachmentUrl: (contentUrl) => invoke("desktop:resolveAttachmentUrl", contentUrl),
  signOutBackend: () => invoke("desktop:signOutBackend"),
  connectBackend: () => invoke("desktop:connectBackend"),
  showContextMenu: (items) => invoke("desktop:showContextMenu", items),
  getLastOpenNoteId: () => invoke("desktop:getLastOpenNoteId"),
  setLastOpenNoteId: (noteId) => invoke("desktop:setLastOpenNoteId", noteId),
  getLastSidebarMode: () => invoke("desktop:getLastSidebarMode"),
  setLastSidebarMode: (mode) => invoke("desktop:setLastSidebarMode", mode),
  getCalendarVisibilityFilters: () => invoke("desktop:getCalendarVisibilityFilters"),
  setCalendarVisibilityFilters: (payload) =>
    invoke("desktop:setCalendarVisibilityFilters", payload),
  getCalendarReminderSettings: () => invoke("desktop:getCalendarReminderSettings"),
  setCalendarReminderSettings: (payload) => invoke("desktop:setCalendarReminderSettings", payload),
  getLastCalendarView: () => invoke("desktop:getLastCalendarView"),
  setLastCalendarView: (view) => invoke("desktop:setLastCalendarView", view),
  getLastCalendarDate: () => invoke("desktop:getLastCalendarDate"),
  setLastCalendarDate: (date) => invoke("desktop:setLastCalendarDate", date),
  getLastActiveChatConversationId: () => invoke("desktop:getLastActiveChatConversationId"),
  setLastActiveChatConversationId: (conversationId) =>
    invoke("desktop:setLastActiveChatConversationId", conversationId),
  getKeyboardShortcuts: () => invoke("desktop:getKeyboardShortcuts"),
  setKeyboardShortcut: (action, shortcut) =>
    invoke("desktop:setKeyboardShortcut", action, shortcut),
  // AI Chat
  getAiConfig: () => invoke("desktop:getAiConfig"),
  updateAiConfig: (config) => invoke("desktop:updateAiConfig", config),
  createConversation: () => invoke("desktop:createConversation"),
  listConversations: () => invoke("desktop:listConversations"),
  deleteConversation: (id) => invoke("desktop:deleteConversation", id),
  getConversationMessages: (conversationId) =>
    invoke("desktop:getConversationMessages", conversationId),
  sendMessage: (conversationId, content, onEvent, enabledCalendarIds, enabledIcsIds, timezone) => {
    const handler = (_event, event) => onEvent(event);
    ipcRenderer.on("desktop:aiChatEvent", handler);
    return invoke(
      "desktop:sendMessage",
      conversationId,
      content,
      enabledCalendarIds,
      enabledIcsIds,
      timezone,
    ).finally(() => {
      setTimeout(() => {
        ipcRenderer.removeListener("desktop:aiChatEvent", handler);
      }, 0);
    });
  },
  cancelSendMessage: () => invoke("desktop:cancelSendMessage"),
  triggerEmbedding: () => invoke("desktop:triggerEmbedding"),
  getEmbedStatus: () => invoke("desktop:getEmbedStatus"),
  getNoteGraph: () => invoke("desktop:getNoteGraph"),
  deleteNoteGraphEdges: () => invoke("desktop:deleteNoteGraphEdges"),
  enqueueNoteGraphRebuild: () => invoke("desktop:enqueueNoteGraphRebuild"),
  // Calendar
  getCalendarStatus: () => invoke("desktop:getCalendarStatus"),
  startCalendarOAuth: (payload) => invoke("desktop:startCalendarOAuth", payload),
  disconnectCalendar: (payload) => invoke("desktop:disconnectCalendar", payload),
  listCalendars: (payload) => invoke("desktop:listCalendars", payload),
  subscribeCalendar: (payload) => invoke("desktop:subscribeCalendar", payload),
  unsubscribeCalendar: (payload) => invoke("desktop:unsubscribeCalendar", payload),
  updateCalendarSubscription: (payload) => invoke("desktop:updateCalendarSubscription", payload),
  addIcsSubscription: (payload) => invoke("desktop:addIcsSubscription", payload),
  removeIcsSubscription: (payload) => invoke("desktop:removeIcsSubscription", payload),
  updateIcsSubscription: (payload) => invoke("desktop:updateIcsSubscription", payload),
  fetchCalendarEvents: (payload) => invoke("desktop:fetchCalendarEvents", payload),
  searchCalendarAttendees: (payload) => invoke("desktop:searchCalendarAttendees", payload),
  createCalendarEvent: (payload) => invoke("desktop:createCalendarEvent", payload),
  updateCalendarEvent: (payload) => invoke("desktop:updateCalendarEvent", payload),
  deleteCalendarEvent: (payload) => invoke("desktop:deleteCalendarEvent", payload),
  rsvpCalendarEvent: (payload) => invoke("desktop:rsvpCalendarEvent", payload),
  flushContactCache: () => invoke("desktop:flushContactCache"),
  // LinkWarden
  getLinkwardenInstances: () => invoke("desktop:getLinkwardenInstances"),
  addLinkwardenInstance: (payload) => invoke("desktop:addLinkwardenInstance", payload),
  removeLinkwardenInstance: (payload) => invoke("desktop:removeLinkwardenInstance", payload),
  getLinkwardenLinks: (payload) => invoke("desktop:getLinkwardenLinks", payload),
  getLinkwardenCollections: (payload) => invoke("desktop:getLinkwardenCollections", payload),
  getLinkwardenTags: (payload) => invoke("desktop:getLinkwardenTags", payload),
  getLinkwardenDashboard: (payload) => invoke("desktop:getLinkwardenDashboard", payload),
  createLinkwardenLink: (payload) => invoke("desktop:createLinkwardenLink", payload),
  resolveLinkwardenPreviewUrl: (payload) => invoke("desktop:resolveLinkwardenPreviewUrl", payload),
  // Settings
  getSetting: (key) => invoke("desktop:getSetting", key),
  setSetting: (key, value) => invoke("desktop:setSetting", key, value),
  // Workspace changed (kept for note tree refresh)
  onWorkspaceChanged: (callback) =>
    ipcRenderer.on("desktop:workspaceChanged", (_event, diskRelPaths) =>
      callback(diskRelPaths ?? []),
    ),
  offWorkspaceChanged: () => ipcRenderer.removeAllListeners("desktop:workspaceChanged"),
  openExternal: (url) => invoke("desktop:openExternal", url),
  onPasteMarkdown: (callback) => ipcRenderer.on("desktop:pasteMarkdown", callback),
  offPasteMarkdown: () => ipcRenderer.removeAllListeners("desktop:pasteMarkdown"),
});
