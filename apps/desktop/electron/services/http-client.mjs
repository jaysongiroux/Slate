export class HttpClient {
  constructor({ metadataStore }) {
    this._store = metadataStore;
    this._activeChatAbort = null;
  }

  /** Normalize stored endpoint to an http:// base URL. */
  baseUrl(endpoint = null) {
    const raw = endpoint ?? this._store.getSetting("backendEndpoint", "");
    if (!raw) return null;
    // Convert legacy gRPC port to HTTP port
    const normalized = raw.replace(/:50051$/, ":4000");
    if (normalized.startsWith("http://") || normalized.startsWith("https://")) return normalized;
    return `http://${normalized}`;
  }

  _token() {
    return this._store.getSetting("accessToken", null);
  }

  _headers(extra = {}) {
    const token = this._token();
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extra,
    };
  }

  async checkConnection(endpoint) {
    const base = this.baseUrl(endpoint);
    if (!base) return false;
    try {
      const response = await fetch(`${base}/api/health`, {
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async get(path) {
    const base = this.baseUrl();
    const headers = this._headers();
    delete headers["Content-Type"];
    const response = await fetch(`${base}${path}`, { headers });
    if (!response.ok) throw new Error(`GET ${path} failed: ${response.status}`);
    return response.json();
  }

  async post(path, body) {
    const base = this.baseUrl();
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: this._headers(),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`POST ${path} failed (${response.status}): ${text}`);
    }
    return response.json();
  }

  async patch(path, body) {
    const base = this.baseUrl();
    const response = await fetch(`${base}${path}`, {
      method: "PATCH",
      headers: this._headers(),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`PATCH ${path} failed (${response.status}): ${text}`);
    }
    return response.json();
  }

  async put(path, body) {
    const base = this.baseUrl();
    const response = await fetch(`${base}${path}`, {
      method: "PUT",
      headers: this._headers(),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`PUT ${path} failed (${response.status}): ${text}`);
    }
    return response.json();
  }

  async delete(path) {
    const base = this.baseUrl();
    const headers = this._headers();
    delete headers["Content-Type"];
    const response = await fetch(`${base}${path}`, { method: "DELETE", headers });
    if (!response.ok) throw new Error(`DELETE ${path} failed: ${response.status}`);
    return response.json();
  }

  // ── Auth ──

  async listAuthProviders(endpoint) {
    const base = this.baseUrl(endpoint);
    const response = await fetch(`${base}/api/auth/providers`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Cannot reach backend");
    return response.json();
  }

  async loginWithPassword(endpoint, { email, password, totpCode, clientId }) {
    const base = this.baseUrl(endpoint);
    const response = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, totpCode, clientId }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.message ?? "Login failed");
    }
    return response.json();
  }

  async startOidc(endpoint, { providerId, redirectUri, clientId }) {
    const base = this.baseUrl(endpoint);
    const response = await fetch(`${base}/api/auth/oidc/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId, redirectUri, clientId }),
    });
    if (!response.ok) throw new Error("Failed to start OIDC");
    return response.json();
  }

  async completeOidc(endpoint, { providerId, redirectUri, state, code, clientId }) {
    const base = this.baseUrl(endpoint);
    const response = await fetch(`${base}/api/auth/oidc/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId, redirectUri, state, code, clientId }),
    });
    if (!response.ok) throw new Error("Failed to complete OIDC");
    return response.json();
  }

  async refreshTokens(endpoint, refreshToken) {
    const base = this.baseUrl(endpoint);
    const response = await fetch(`${base}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) throw new Error("Token refresh failed");
    return response.json();
  }

  // ── Notes ──

  async listNotesRemote() {
    return this.get("/api/notes");
  }

  async createNoteRemote({ id, path, title }) {
    return this.post("/api/notes", { id, path, title });
  }

  async updateNoteRemote(id, updates) {
    return this.patch(`/api/notes/${id}`, updates);
  }

  async deleteNoteRemote(id) {
    return this.delete(`/api/notes/${id}`);
  }

  async syncNotesSince(since) {
    const q = since ? `?since=${encodeURIComponent(since)}` : "";
    return this.get(`/api/notes/sync${q}`);
  }

  async importNotesRemote(notes) {
    return this.post("/api/notes/import", { notes });
  }

  // ── AI Chat ──

  async getAiConfig() {
    return this.get("/api/ai/config");
  }

  async updateAiConfig(config) {
    return this.put("/api/ai/config", config);
  }

  async createConversation() {
    return this.post("/api/ai/conversations", {});
  }

  async listConversations() {
    const data = await this.get("/api/ai/conversations");
    return data.conversations ?? data;
  }

  async deleteConversation(id) {
    return this.delete(`/api/ai/conversations/${id}`);
  }

  async getConversationMessages(conversationId) {
    const data = await this.get(`/api/ai/conversations/${conversationId}/messages`);
    return data.messages ?? data;
  }

  async triggerEmbedding() {
    return this.post("/api/ai/embed", {});
  }

  isStreamingChat() {
    return this._activeChatAbort !== null;
  }

  cancelChatStream() {
    this._activeChatAbort?.abort();
    this._activeChatAbort = null;
  }

  async streamSendMessage(
    { conversationId, content, enabledCalendarIds = [], enabledIcsIds = [], timezone = "" },
    onEvent,
  ) {
    const abort = new AbortController();
    this._activeChatAbort = abort;

    try {
      const base = this.baseUrl();
      const response = await fetch(`${base}/api/ai/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify({ content, enabledCalendarIds, enabledIcsIds, timezone }),
        signal: abort.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "Request failed");
        onEvent({ type: "error", content: text });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            for (const line of part.split("\n")) {
              if (line.startsWith("data: ")) {
                try {
                  onEvent(JSON.parse(line.slice(6)));
                } catch {
                  // ignore malformed SSE line
                }
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        onEvent({ type: "error", content: err.message ?? "Stream failed" });
      }
    } finally {
      if (this._activeChatAbort === abort) {
        this._activeChatAbort = null;
      }
    }
  }

  // ── Calendar ──

  async getCalendarStatus() {
    return this.get("/api/calendar/status");
  }

  async startCalendarOAuth(payload) {
    return this.post("/api/calendar/oauth/start", payload);
  }

  async completeCalendarOAuth(payload) {
    return this.post("/api/calendar/oauth/complete", payload);
  }

  async disconnectCalendar(payload) {
    return this.post("/api/calendar/disconnect", payload);
  }

  async listCalendars(payload) {
    const q = payload?.connectionId
      ? `?connectionId=${encodeURIComponent(payload.connectionId)}`
      : "";
    return this.get(`/api/calendar/calendars${q}`);
  }

  async subscribeCalendar(payload) {
    return this.post("/api/calendar/subscribe", payload);
  }

  async unsubscribeCalendar({ subscriptionId }) {
    return this.delete(`/api/calendar/subscribe/${subscriptionId}`);
  }

  async updateCalendarSubscription({ subscriptionId, ...rest }) {
    return this.patch(`/api/calendar/subscribe/${subscriptionId}`, rest);
  }

  async addIcsSubscription(payload) {
    return this.post("/api/calendar/ics", payload);
  }

  async removeIcsSubscription({ id }) {
    return this.delete(`/api/calendar/ics/${id}`);
  }

  async updateIcsSubscription({ id, ...rest }) {
    return this.patch(`/api/calendar/ics/${id}`, rest);
  }

  async fetchCalendarEvents({ timeMin, timeMax }) {
    const q = new URLSearchParams({ timeMin, timeMax }).toString();
    const data = await this.get(`/api/calendar/events?${q}`);
    return data.events ?? data;
  }

  async createCalendarEvent(payload) {
    const data = await this.post("/api/calendar/events", payload);
    return data.event ?? data;
  }

  async updateCalendarEvent({ eventId, ...rest }) {
    const data = await this.patch(`/api/calendar/events/${eventId}`, rest);
    return data.event ?? data;
  }

  async deleteCalendarEvent({ eventId, subscriptionId }) {
    return this.delete(
      `/api/calendar/events/${eventId}?subscriptionId=${encodeURIComponent(subscriptionId)}`,
    );
  }

  async rsvpCalendarEvent({ eventId, ...rest }) {
    return this.post(`/api/calendar/events/${eventId}/rsvp`, rest);
  }

  // ── Attachments ──

  async uploadAttachment(endpoint, accessToken, { buffer, fileName, mimeType, documentId }) {
    const base = this.baseUrl(endpoint);
    const form = new FormData();
    form.append("file", new Blob([buffer], { type: mimeType }), fileName);
    form.append("documentId", documentId);
    const response = await fetch(`${base}/api/attachments/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Upload failed (${response.status}): ${text}`);
    }
    return response.json();
  }

  resolveAttachmentUrl(endpoint, accessToken, contentUrl) {
    const base = this.baseUrl(endpoint);
    return `${base}${contentUrl}?token=${encodeURIComponent(accessToken)}`;
  }
}
