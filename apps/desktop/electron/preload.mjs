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
  subscribeAppLog: (onEvent) => {
    const subscriptionId =
      globalThis.crypto?.randomUUID?.() ??
      `app-log-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const handler = (_event, message) => {
      if (message?.subscriptionId === subscriptionId) {
        onEvent(message.event);
      }
    };
    ipcRenderer.on("desktop:appLogEvent", handler);
    return invoke("desktop:subscribeAppLog", { subscriptionId })
      .then((result) => ({
        ...result,
        unsubscribe: () => {
          ipcRenderer.removeListener("desktop:appLogEvent", handler);
          return invoke("desktop:unsubscribeAppLog", { subscriptionId });
        },
      }))
      .catch((err) => {
        ipcRenderer.removeListener("desktop:appLogEvent", handler);
        throw err;
      });
  },
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
  triggerPendingEmbedding: () => invoke("desktop:triggerPendingEmbedding"),
  getEmbedStatus: () => invoke("desktop:getEmbedStatus"),
  getNoteGraph: () => invoke("desktop:getNoteGraph"),
  deleteNoteGraphEdges: () => invoke("desktop:deleteNoteGraphEdges"),
  enqueueNoteGraphRebuild: () => invoke("desktop:enqueueNoteGraphRebuild"),
  // Diagrams
  listDiagrams: () => invoke("desktop:listDiagrams"),
  getDiagram: (id) => invoke("desktop:getDiagram", id),
  createDiagram: (title) => invoke("desktop:createDiagram", title),
  updateDiagram: (payload) => invoke("desktop:updateDiagram", payload),
  deleteDiagram: (id) => invoke("desktop:deleteDiagram", id),
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
  // Forge (GitHub / GitLab)
  getForgeInstances: () => invoke("desktop:getForgeInstances"),
  addForgeInstance: (payload) => invoke("desktop:addForgeInstance", payload),
  updateForgeInstance: (payload) => invoke("desktop:updateForgeInstance", payload),
  removeForgeInstance: (payload) => invoke("desktop:removeForgeInstance", payload),
  getForgeCounts: (payload) => invoke("desktop:getForgeCounts", payload),
  getForgeList: (payload) => invoke("desktop:getForgeList", payload),
  getForgeRepoPRs: (payload) => invoke("desktop:getForgeRepoPRs", payload),
  getForgeRepoIssues: (payload) => invoke("desktop:getForgeRepoIssues", payload),
  getForgePinned: (payload) => invoke("desktop:getForgePinned", payload),
  addForgePinned: (payload) => invoke("desktop:addForgePinned", payload),
  removeForgePinned: (payload) => invoke("desktop:removeForgePinned", payload),
  getForgePinnedStatus: (payload) => invoke("desktop:getForgePinnedStatus", payload),
  getForgeStarred: (payload) => invoke("desktop:getForgeStarred", payload),
  addForgeStarred: (payload) => invoke("desktop:addForgeStarred", payload),
  removeForgeStarred: (payload) => invoke("desktop:removeForgeStarred", payload),
  getForgeSavedSearches: (payload) => invoke("desktop:getForgeSavedSearches", payload),
  addForgeSavedSearch: (payload) => invoke("desktop:addForgeSavedSearch", payload),
  removeForgeSavedSearch: (payload) => invoke("desktop:removeForgeSavedSearch", payload),
  getForgeSavedSearchResults: (payload) => invoke("desktop:getForgeSavedSearchResults", payload),
  refreshForgeCache: (payload) => invoke("desktop:refreshForgeCache", payload),
  // Home Assistant
  getHomeAssistantInstances: () => invoke("desktop:getHomeAssistantInstances"),
  addHomeAssistantInstance: (payload) => invoke("desktop:addHomeAssistantInstance", payload),
  updateHomeAssistantInstance: (payload) => invoke("desktop:updateHomeAssistantInstance", payload),
  removeHomeAssistantInstance: (payload) => invoke("desktop:removeHomeAssistantInstance", payload),
  testHomeAssistantConnection: (payload) => invoke("desktop:testHomeAssistantConnection", payload),
  getHomeAssistantDashboards: (payload) => invoke("desktop:getHomeAssistantDashboards", payload),
  getHomeAssistantDashboard: (payload) => invoke("desktop:getHomeAssistantDashboard", payload),
  getHomeAssistantAreas: (payload) => invoke("desktop:getHomeAssistantAreas", payload),
  getHomeAssistantDevices: (payload) => invoke("desktop:getHomeAssistantDevices", payload),
  getHomeAssistantEntities: (payload) => invoke("desktop:getHomeAssistantEntities", payload),
  getHomeAssistantEntity: (payload) => invoke("desktop:getHomeAssistantEntity", payload),
  getHomeAssistantEntityHistory: (payload) =>
    invoke("desktop:getHomeAssistantEntityHistory", payload),
  getHomeAssistantState: (payload) => invoke("desktop:getHomeAssistantState", payload),
  controlHomeAssistantEntity: (payload) => invoke("desktop:controlHomeAssistantEntity", payload),
  resolveHomeAssistantCameraSnapshotUrl: (payload) =>
    invoke("desktop:resolveHomeAssistantCameraSnapshotUrl", payload),
  subscribeHomeAssistantEvents: (payload, onEvent) => {
    const subscriptionId =
      globalThis.crypto?.randomUUID?.() ??
      `home-assistant-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const handler = (_event, message) => {
      if (message?.subscriptionId === subscriptionId) {
        onEvent(message.event);
      }
    };
    ipcRenderer.on("desktop:homeAssistantEvent", handler);
    return invoke("desktop:subscribeHomeAssistantEvents", {
      ...payload,
      subscriptionId,
    })
      .then(() => () => {
        ipcRenderer.removeListener("desktop:homeAssistantEvent", handler);
        return invoke("desktop:unsubscribeHomeAssistantEvents", { subscriptionId });
      })
      .catch((err) => {
        ipcRenderer.removeListener("desktop:homeAssistantEvent", handler);
        throw err;
      });
  },
  unsubscribeHomeAssistantEvents: (payload) =>
    invoke("desktop:unsubscribeHomeAssistantEvents", payload),
  // Jira
  getJiraInstances: () => invoke("desktop:getJiraInstances"),
  addJiraInstance: (payload) => invoke("desktop:addJiraInstance", payload),
  updateJiraInstance: (payload) => invoke("desktop:updateJiraInstance", payload),
  removeJiraInstance: (payload) => invoke("desktop:removeJiraInstance", payload),
  testJiraConnection: (payload) => invoke("desktop:testJiraConnection", payload),
  getJiraProjects: (payload) => invoke("desktop:getJiraProjects", payload),
  getJiraIssues: (payload) => invoke("desktop:getJiraIssues", payload),
  getJiraIssue: (payload) => invoke("desktop:getJiraIssue", payload),
  updateJiraIssue: (payload) => invoke("desktop:updateJiraIssue", payload),
  getJiraTransitions: (payload) => invoke("desktop:getJiraTransitions", payload),
  transitionJiraIssue: (payload) => invoke("desktop:transitionJiraIssue", payload),
  addJiraComment: (payload) => invoke("desktop:addJiraComment", payload),
  searchJiraUsers: (payload) => invoke("desktop:searchJiraUsers", payload),
  getJiraPriorities: (payload) => invoke("desktop:getJiraPriorities", payload),
  getJiraIssueTypes: (payload) => invoke("desktop:getJiraIssueTypes", payload),
  createJiraIssue: (payload) => invoke("desktop:createJiraIssue", payload),
  getJiraLabels: (payload) => invoke("desktop:getJiraLabels", payload),
  getJiraCreateFieldsMeta: (payload) => invoke("desktop:getJiraCreateFieldsMeta", payload),
  getJiraBoards: (payload) => invoke("desktop:getJiraBoards", payload),
  getJiraBoardConfig: (payload) => invoke("desktop:getJiraBoardConfig", payload),
  getJiraSprints: (payload) => invoke("desktop:getJiraSprints", payload),
  getJiraSprintIssues: (payload) => invoke("desktop:getJiraSprintIssues", payload),
  getJiraBoardIssues: (payload) => invoke("desktop:getJiraBoardIssues", payload),
  getJiraSavedQueries: () => invoke("desktop:getJiraSavedQueries"),
  addJiraSavedQuery: (payload) => invoke("desktop:addJiraSavedQuery", payload),
  updateJiraSavedQuery: (payload) => invoke("desktop:updateJiraSavedQuery", payload),
  removeJiraSavedQuery: (payload) => invoke("desktop:removeJiraSavedQuery", payload),
  // MCP
  getMcpServers: () => invoke("desktop:getMcpServers"),
  putMcpServers: (servers) => invoke("desktop:putMcpServers", servers),
  testMcpServer: (server) => invoke("desktop:testMcpServer", server),
  listMcpServerTools: (serverId) => invoke("desktop:listMcpServerTools", serverId),
  getMcpStatus: () => invoke("desktop:getMcpStatus"),
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
  onCopySelectionAsMarkdown: (callback) =>
    ipcRenderer.on("desktop:copySelectionAsMarkdown", callback),
  offCopySelectionAsMarkdown: () =>
    ipcRenderer.removeAllListeners("desktop:copySelectionAsMarkdown"),
});
