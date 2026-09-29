export class HttpClient {
  constructor({ metadataStore, log = null } = {}) {
    this._store = metadataStore;
    this._log = log;
    this._activeChatAbort = null;
    this.homeAssistantEventStreams = new Map();
    this._refreshingPromise = null;
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  _httpError(method, path, response, bodyText = "") {
    let parsedBody = null;
    try {
      parsedBody = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      parsedBody = null;
    }
    const messageFromBody =
      parsedBody && typeof parsedBody === "object" && typeof parsedBody.message === "string"
        ? parsedBody.message
        : parsedBody && typeof parsedBody === "object" && typeof parsedBody.error === "string"
          ? parsedBody.error
          : bodyText;
    const suffix = messageFromBody ? `: ${messageFromBody}` : "";
    const error = new Error(
      `${method} ${path} failed${method === "GET" ? ":" : ` (${response.status})`}${method === "GET" ? ` ${response.status}${messageFromBody ? ` ${messageFromBody}` : ""}` : suffix}`,
    );
    error.status = response.status;
    error.bodyText = bodyText;
    error.body = parsedBody;
    if (parsedBody && typeof parsedBody === "object" && typeof parsedBody.code === "string") {
      error.code = parsedBody.code;
    }
    return error;
  }

  _networkError(method, path, cause) {
    const error = new Error(
      `${method} ${path} failed: Could not reach the Slate server. Check that the backend is running, then try again.`,
    );
    error.code = "slate_backend_unreachable";
    error.cause = cause;
    return error;
  }

  /** Normalize stored endpoint to an http:// base URL. */
  baseUrl(endpoint = null) {
    const raw = endpoint ?? this._store.getSetting("backendEndpoint", "");
    if (!raw) return null;
    if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
    return `http://${raw}`;
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

  async getBackendStatus(endpoint, { retries = 2, retryDelayMs = 300 } = {}) {
    const attempts = Math.max(1, retries + 1);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const reachable = await this.checkConnection(endpoint);
      if (reachable) {
        try {
          const providers = await this.listAuthProviders(endpoint);
          return {
            backendReachable: true,
            authProviders: providers.providers ?? [],
          };
        } catch {
          return {
            backendReachable: true,
            authProviders: [],
          };
        }
      }

      if (attempt < attempts - 1) {
        await this._sleep(retryDelayMs);
      }
    }

    return {
      backendReachable: false,
      authProviders: [],
    };
  }

  /**
   * Coalesced refresh. Returns detailed outcome so callers can distinguish
   * invalid sessions from transient network/backend failures.
   * @returns {Promise<{ ok: true } | { ok: false, reason: 'no_credentials' | 'network' | 'rejected', detail?: string }>}
   */
  async tryRefreshDetailed() {
    if (this._refreshingPromise) return this._refreshingPromise;
    this._refreshingPromise = this._doRefreshDetailed().finally(() => {
      this._refreshingPromise = null;
    });
    return this._refreshingPromise;
  }

  /**
   * @returns {Promise<boolean>}
   */
  async tryRefresh() {
    const r = await this.tryRefreshDetailed();
    return r.ok;
  }

  async _doRefreshDetailed() {
    const refreshToken = this._store.getSetting("refreshToken", null);
    const endpoint = this._store.getSetting("backendEndpoint", "");
    this._log?.info?.("auth.refresh_attempt", {
      hasRefreshToken: Boolean(refreshToken),
      hasEndpoint: Boolean(endpoint),
    });
    if (!refreshToken || !endpoint) {
      this._log?.warn?.("auth.refresh_skipped", { reason: "no_credentials" });
      return { ok: false, reason: "no_credentials" };
    }
    try {
      const result = await this.refreshTokens(endpoint, refreshToken);
      this._store.setSetting("accessToken", result.tokens.accessToken);
      this._store.setSetting("refreshToken", result.tokens.refreshToken);
      this._store.setSetting("tokenExpiresAtUnix", result.tokens.expiresAtUnix);
      this._store.setSetting("authStatus", "authenticated");
      this._store.setSetting("authenticatedUserId", result.userId);
      this._store.setSetting("authenticatedEmail", result.email);
      this._store.setSetting("authenticatedDisplayName", result.displayName);
      this._store.setSetting("authenticatedIsAdmin", result.isAdmin);
      this._log?.info?.("auth.refresh_success", { userId: result.userId });
      return { ok: true };
    } catch (err) {
      const status = typeof err?.status === "number" ? err.status : null;
      const detail = err instanceof Error ? err.message : String(err);
      if (status === 401 || status === 403) {
        this._log?.warn?.("auth.refresh_rejected", { status, detail });
        return { ok: false, reason: "rejected", detail };
      }
      if (status != null && status >= 500) {
        this._log?.warn?.("auth.refresh_server_error", { status, detail });
        return { ok: false, reason: "network", detail };
      }
      this._log?.warn?.("auth.refresh_failed_transient", { status, detail });
      return { ok: false, reason: "network", detail };
    }
  }

  /** Returns true if the stored access token is expired or about to expire (within 60s). */
  isTokenExpired() {
    const expiresAt = this._store.getSetting("tokenExpiresAtUnix", null);
    if (!expiresAt) return true;
    return Date.now() / 1000 >= expiresAt - 60;
  }

  /**
   * Run an authenticated fetch, transparently refreshing the token on 401.
   * Transient refresh failures keep the stored session; callers see a marked error instead of a bare 401.
   * @param {() => Promise<Response>} requestFn - function that performs the fetch
   * @param {string} method - HTTP method (for error messages)
   * @param {string} path - request path (for error messages)
   */
  async _authenticatedRequest(requestFn, method, path) {
    let response;
    try {
      response = await requestFn();
    } catch (err) {
      throw this._networkError(method, path, err);
    }
    if (response.status === 401) {
      const refreshResult = await this.tryRefreshDetailed();
      if (refreshResult.ok) {
        try {
          response = await requestFn();
        } catch (err) {
          throw this._networkError(method, path, err);
        }
      } else if (refreshResult.reason === "network") {
        const text = await response.text().catch(() => "");
        const err = this._httpError(method, path, response, text);
        err.slateTransientAuth = true;
        err.refreshFailureReason = "network";
        this._log?.warn?.("http.after_401_refresh_transient", { method, path });
        throw err;
      } else {
        const text = await response.text().catch(() => "");
        this._log?.warn?.("http.after_401_refresh_invalid_session", {
          method,
          path,
          reason: refreshResult.reason,
        });
        throw this._httpError(method, path, response, text);
      }
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw this._httpError(method, path, response, text);
    }
    return response.json();
  }

  async get(path) {
    const base = this.baseUrl();
    return this._authenticatedRequest(
      () => {
        const headers = this._headers();
        delete headers["Content-Type"];
        return fetch(`${base}${path}`, { headers });
      },
      "GET",
      path,
    );
  }

  async post(path, body) {
    const base = this.baseUrl();
    return this._authenticatedRequest(
      () =>
        fetch(`${base}${path}`, {
          method: "POST",
          headers: this._headers(),
          body: JSON.stringify(body),
        }),
      "POST",
      path,
    );
  }

  async patch(path, body) {
    const base = this.baseUrl();
    return this._authenticatedRequest(
      () =>
        fetch(`${base}${path}`, {
          method: "PATCH",
          headers: this._headers(),
          body: JSON.stringify(body),
        }),
      "PATCH",
      path,
    );
  }

  async put(path, body) {
    const base = this.baseUrl();
    return this._authenticatedRequest(
      () =>
        fetch(`${base}${path}`, {
          method: "PUT",
          headers: this._headers(),
          body: JSON.stringify(body),
        }),
      "PUT",
      path,
    );
  }

  async delete(path) {
    const base = this.baseUrl();
    return this._authenticatedRequest(
      () => {
        const headers = this._headers();
        delete headers["Content-Type"];
        return fetch(`${base}${path}`, { method: "DELETE", headers });
      },
      "DELETE",
      path,
    );
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
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.message ?? "Failed to start OIDC");
    }
    return response.json();
  }

  async completeOidc(endpoint, { providerId, redirectUri, state, code, clientId }) {
    const base = this.baseUrl(endpoint);
    const response = await fetch(`${base}/api/auth/oidc/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId, redirectUri, state, code, clientId }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.message ?? "Failed to complete OIDC");
    }
    return response.json();
  }

  async refreshTokens(endpoint, refreshToken) {
    const base = this.baseUrl(endpoint);
    const response = await fetch(`${base}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    const bodyText = await response.text().catch(() => "");
    if (!response.ok) {
      const err = new Error("Token refresh failed");
      err.status = response.status;
      err.bodyText = bodyText;
      throw err;
    }
    try {
      return JSON.parse(bodyText);
    } catch {
      const err = new Error("Token refresh returned invalid JSON");
      err.status = response.status;
      err.bodyText = bodyText;
      throw err;
    }
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

  // ── Diagrams ──

  async listDiagrams() {
    const data = await this.get("/api/diagrams");
    return data.diagrams ?? data;
  }

  async getDiagram(id) {
    return this.get(`/api/diagrams/${id}`);
  }

  async createDiagram(title) {
    return this.post("/api/diagrams", { title });
  }

  async updateDiagram({ id, title, scene }) {
    return this.patch(`/api/diagrams/${id}`, { title, scene });
  }

  async deleteDiagram(id) {
    return this.delete(`/api/diagrams/${id}`);
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

  async triggerPendingEmbedding() {
    return this.post("/api/ai/embed/pending", {});
  }

  async getEmbedStatus() {
    return this.get("/api/ai/embed/status");
  }

  async getNoteGraph() {
    try {
      return await this.get("/api/graph");
    } catch (err) {
      if (typeof err === "object" && err !== null && err.status === 404) {
        return null;
      }
      throw err;
    }
  }

  async deleteNoteGraphEdges() {
    return this.delete("/api/graph");
  }

  async enqueueNoteGraphRebuild() {
    return this.post("/api/graph/rebuild", {});
  }

  isStreamingChat() {
    return this._activeChatAbort !== null;
  }

  cancelChatStream() {
    this._activeChatAbort?.abort();
    this._activeChatAbort = null;
  }

  async streamSendMessage(
    {
      conversationId,
      content,
      enabledCalendarIds = [],
      enabledIcsIds = [],
      timezone = "",
      retry = false,
    },
    onEvent,
  ) {
    const abort = new AbortController();
    this._activeChatAbort = abort;

    const postStream = () => {
      const base = this.baseUrl();
      return fetch(`${base}/api/ai/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify({ content, enabledCalendarIds, enabledIcsIds, timezone, retry }),
        signal: abort.signal,
      });
    };

    try {
      let response = await postStream();

      if (response.status === 401) {
        const refreshResult = await this.tryRefreshDetailed();
        if (refreshResult.ok) {
          response = await postStream();
        } else if (refreshResult.reason === "network") {
          this._log?.warn?.("ai.stream_401_refresh_transient", { conversationId });
          onEvent({
            type: "error",
            code: "session_expired",
            title: "Session could not be refreshed",
            content:
              "Slate could not reach the server to refresh your session. Check your connection, then retry.",
            retryable: true,
          });
          return;
        }
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        onEvent({
          type: "error",
          code: "backend_error",
          title: "Request rejected",
          content: `The Slate backend rejected the request (HTTP ${response.status}). Retry, or check the details below.`,
          detail: text || undefined,
          retryable: true,
        });
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
        onEvent({
          type: "error",
          code: "backend_unreachable",
          title: "Backend unreachable",
          content: "Slate could not reach its backend. Check that it is running, then retry.",
          detail: err.message ?? undefined,
          retryable: true,
        });
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
    return Array.isArray(data) ? { events: data } : { events: data.events ?? [] };
  }

  async searchCalendarAttendees({ subscriptionId, query }) {
    const q = new URLSearchParams({ subscriptionId, q: query }).toString();
    const data = await this.get(`/api/calendar/google/attendees/search?${q}`);
    return { attendees: data.attendees ?? [] };
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

  async flushContactCache() {
    return this.delete("/api/calendar/contact-cache");
  }

  // ── LinkWarden ──────────────────────────────────────────────────────────

  async getLinkwardenInstances() {
    return this.get("/api/linkwarden/instances");
  }

  async addLinkwardenInstance(payload) {
    return this.post("/api/linkwarden/instances", payload);
  }

  async removeLinkwardenInstance(id) {
    return this.delete(`/api/linkwarden/instances/${id}`);
  }

  async getLinkwardenLinks(instanceId, query = {}) {
    const params = new URLSearchParams();
    if (query.collectionId != null) params.set("collectionId", String(query.collectionId));
    if (query.tagId != null) params.set("tagId", String(query.tagId));
    if (query.searchQueryString) params.set("searchQueryString", query.searchQueryString);
    if (query.cursor != null) params.set("cursor", String(query.cursor));
    if (query.sort != null) params.set("sort", String(query.sort));
    const qs = params.toString();
    return this.get(`/api/linkwarden/${instanceId}/links${qs ? `?${qs}` : ""}`);
  }

  async getLinkwardenCollections(instanceId) {
    return this.get(`/api/linkwarden/${instanceId}/collections`);
  }

  async getLinkwardenTags(instanceId) {
    return this.get(`/api/linkwarden/${instanceId}/tags`);
  }

  async getLinkwardenDashboard(instanceId) {
    return this.get(`/api/linkwarden/${instanceId}/dashboard`);
  }

  async createLinkwardenLink(instanceId, payload) {
    return this.post(`/api/linkwarden/${instanceId}/links`, payload);
  }

  // ── Forge (GitHub / GitLab) ─────────────────────────────────────────

  async getForgeInstances() {
    return this.get("/api/forge/instances");
  }
  async addForgeInstance(payload) {
    return this.post("/api/forge/instances", payload);
  }
  async updateForgeInstance(id, payload) {
    return this.patch(`/api/forge/instances/${id}`, payload);
  }
  async removeForgeInstance(id) {
    return this.delete(`/api/forge/instances/${id}`);
  }
  async getForgeCounts(instanceId) {
    return this.get(`/api/forge/${instanceId}/counts`);
  }
  async getForgeList(instanceId, kind, cursor) {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return this.get(`/api/forge/${instanceId}/${kind}${qs}`);
  }
  async getForgeRepoPRs(instanceId, repo, cursor) {
    const params = new URLSearchParams({ repo });
    if (cursor) params.set("cursor", cursor);
    return this.get(`/api/forge/${instanceId}/repo-prs?${params.toString()}`);
  }
  async getForgeRepoIssues(instanceId, repo, cursor) {
    const params = new URLSearchParams({ repo });
    if (cursor) params.set("cursor", cursor);
    return this.get(`/api/forge/${instanceId}/repo-issues?${params.toString()}`);
  }
  async getForgePinned(instanceId) {
    return this.get(`/api/forge/${instanceId}/pinned`);
  }
  async addForgePinned(instanceId, payload) {
    return this.post(`/api/forge/${instanceId}/pinned`, payload);
  }
  async removeForgePinned(pinId) {
    return this.delete(`/api/forge/pinned/${pinId}`);
  }
  async getForgePinnedStatus(instanceId, items) {
    return this.post(`/api/forge/${instanceId}/pinned/status`, { items });
  }
  async getForgeStarred(instanceId) {
    return this.get(`/api/forge/${instanceId}/starred`);
  }
  async addForgeStarred(instanceId, repo) {
    return this.post(`/api/forge/${instanceId}/starred`, { repo });
  }
  async removeForgeStarred(instanceId, repo) {
    return this.post(`/api/forge/${instanceId}/starred/remove`, { repo });
  }
  async getForgeSavedSearches(instanceId) {
    return this.get(`/api/forge/${instanceId}/saved-searches`);
  }
  async addForgeSavedSearch(instanceId, payload) {
    return this.post(`/api/forge/${instanceId}/saved-searches`, payload);
  }
  async removeForgeSavedSearch(searchId) {
    return this.delete(`/api/forge/saved-searches/${searchId}`);
  }
  async getForgeSavedSearchResults(instanceId, searchId, cursor) {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return this.get(`/api/forge/${instanceId}/saved-searches/${searchId}/results${qs}`);
  }
  async refreshForgeCache(instanceId) {
    return this.post(`/api/forge/${instanceId}/refresh`, {});
  }

  // ── Home Assistant ───────────────────────────────────────────────────

  async getHomeAssistantInstances() {
    return this.get("/api/home-assistant/instances");
  }

  async addHomeAssistantInstance(payload) {
    return this.post("/api/home-assistant/instances", payload);
  }

  async updateHomeAssistantInstance(id, payload) {
    return this.put(`/api/home-assistant/instances/${id}`, payload);
  }

  async removeHomeAssistantInstance(id) {
    return this.delete(`/api/home-assistant/instances/${id}`);
  }

  async testHomeAssistantConnection(instanceId) {
    return this.post(`/api/home-assistant/instances/${instanceId}/test`, {});
  }

  async getHomeAssistantDashboards(instanceId) {
    return this.get(`/api/home-assistant/${instanceId}/dashboards`);
  }

  async getHomeAssistantDashboard(instanceId, dashboardId) {
    return this.get(
      `/api/home-assistant/${instanceId}/dashboards/${encodeURIComponent(dashboardId)}`,
    );
  }

  async getHomeAssistantAreas(instanceId) {
    return this.get(`/api/home-assistant/${instanceId}/areas`);
  }

  async getHomeAssistantDevices(instanceId) {
    return this.get(`/api/home-assistant/${instanceId}/devices`);
  }

  async getHomeAssistantEntities(instanceId) {
    return this.get(`/api/home-assistant/${instanceId}/entities`);
  }

  async getHomeAssistantEntity(instanceId, entityId) {
    return this.get(`/api/home-assistant/${instanceId}/entities/${encodeURIComponent(entityId)}`);
  }

  async getHomeAssistantEntityHistory(instanceId, entityId, query) {
    const params = new URLSearchParams();
    if (query?.start) {
      params.set("start", query.start);
    }
    if (query?.end) {
      params.set("end", query.end);
    }
    const qs = params.toString();
    return this.get(
      `/api/home-assistant/${instanceId}/entities/${encodeURIComponent(entityId)}/history${qs ? `?${qs}` : ""}`,
    );
  }

  async getHomeAssistantState(instanceId) {
    return this.get(`/api/home-assistant/${instanceId}/state`);
  }

  async controlHomeAssistantEntity(instanceId, request) {
    return this.post(`/api/home-assistant/${instanceId}/control`, request);
  }

  async resolveHomeAssistantCameraSnapshotUrl(endpoint, accessToken, instanceId, entityId) {
    const base = this.baseUrl(endpoint);
    return `${base}/api/home-assistant/${instanceId}/cameras/${encodeURIComponent(entityId)}/snapshot?token=${encodeURIComponent(accessToken)}`;
  }

  async subscribeHomeAssistantEvents(subscriptionId, instanceId, onEvent) {
    const abort = new AbortController();
    this.homeAssistantEventStreams.set(subscriptionId, abort);

    const logStreamError = (eventName, detail = {}) => {
      this._log?.warn?.(eventName, {
        subscriptionId,
        instanceId,
        ...detail,
      });
    };

    const emitEvent = (event) => {
      if (event?.type === "error") {
        logStreamError("home_assistant.stream_error", {
          message: event.message ?? "Home Assistant stream failed",
        });
      }
      onEvent(event);
    };

    const openStream = () => {
      const base = this.baseUrl();
      const headers = this._headers();
      delete headers["Content-Type"];
      return fetch(`${base}/api/home-assistant/${instanceId}/events`, {
        headers,
        signal: abort.signal,
      });
    };

    const run = async () => {
      try {
        let response = await openStream();

        if (response.status === 401) {
          const refreshResult = await this.tryRefreshDetailed();
          if (refreshResult.ok) {
            response = await openStream();
          } else if (refreshResult.reason === "network") {
            logStreamError("home_assistant.stream_refresh_failed", {
              reason: refreshResult.reason,
              detail: refreshResult.detail ?? null,
            });
            emitEvent({
              type: "error",
              message:
                "Could not reach the server to refresh your session. Check your connection and try again.",
            });
            return;
          }
        }

        if (!response.ok) {
          const text = await response.text().catch(() => "Home Assistant stream failed");
          logStreamError("home_assistant.stream_response_error", {
            status: response.status,
            bodyPreview: text.slice(0, 500),
          });
          emitEvent({ type: "error", message: text });
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
                    emitEvent(JSON.parse(line.slice(6)));
                  } catch {
                    logStreamError("home_assistant.stream_malformed_event", {
                      linePreview: line.slice(0, 500),
                    });
                  }
                }
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
      } catch (err) {
        if (err?.name !== "AbortError") {
          logStreamError("home_assistant.stream_request_failed", {
            message: err?.message ?? "Home Assistant stream failed",
            code: err?.code ?? null,
          });
          emitEvent({ type: "error", message: err?.message ?? "Home Assistant stream failed" });
        }
      } finally {
        if (this.homeAssistantEventStreams.get(subscriptionId) === abort) {
          this.homeAssistantEventStreams.delete(subscriptionId);
        }
      }
    };

    void run();
    return { ok: true };
  }

  async unsubscribeHomeAssistantEvents(subscriptionId) {
    this.homeAssistantEventStreams.get(subscriptionId)?.abort();
    this.homeAssistantEventStreams.delete(subscriptionId);
    return { ok: true };
  }

  // ── Jira ──────────────────────────────────────────────────────────────

  async getJiraInstances() {
    return this.get("/api/jira/instances");
  }

  async addJiraInstance(payload) {
    return this.post("/api/jira/instances", payload);
  }

  async updateJiraInstance(id, payload) {
    return this.put(`/api/jira/instances/${id}`, payload);
  }

  async removeJiraInstance(id) {
    return this.delete(`/api/jira/instances/${id}`);
  }

  async testJiraConnection(instanceId) {
    return this.post(`/api/jira/instances/${instanceId}/test`, {});
  }

  async getJiraProjects(instanceId) {
    return this.get(`/api/jira/${instanceId}/projects`);
  }

  async getJiraIssues(instanceId, query = {}) {
    const params = new URLSearchParams();
    if (query.projectKey) params.set("projectKey", query.projectKey);
    if (query.jql) params.set("jql", query.jql);
    if (query.assignee) params.set("assignee", query.assignee);
    if (query.watcher) params.set("watcher", query.watcher);
    if (query.nextPageToken) params.set("nextPageToken", query.nextPageToken);
    if (query.maxResults != null) params.set("maxResults", String(query.maxResults));
    const qs = params.toString();
    return this.get(`/api/jira/${instanceId}/issues${qs ? `?${qs}` : ""}`);
  }

  async getJiraIssue(instanceId, issueKey) {
    return this.get(`/api/jira/${instanceId}/issues/${issueKey}`);
  }

  async updateJiraIssue(instanceId, issueKey, fields) {
    return this.put(`/api/jira/${instanceId}/issues/${issueKey}`, fields);
  }

  async getJiraTransitions(instanceId, issueKey) {
    return this.get(`/api/jira/${instanceId}/issues/${issueKey}/transitions`);
  }

  async transitionJiraIssue(instanceId, issueKey, body) {
    return this.post(`/api/jira/${instanceId}/issues/${issueKey}/transition`, body);
  }

  async addJiraComment(instanceId, issueKey, body) {
    return this.post(`/api/jira/${instanceId}/issues/${issueKey}/comments`, body);
  }

  async searchJiraUsers(instanceId, query) {
    return this.get(`/api/jira/${instanceId}/users?query=${encodeURIComponent(query)}`);
  }

  async getJiraPriorities(instanceId) {
    return this.get(`/api/jira/${instanceId}/priorities`);
  }

  async createJiraIssue(instanceId, fields) {
    return this.post(`/api/jira/${instanceId}/issues`, fields);
  }

  async getJiraLabels(instanceId) {
    return this.get(`/api/jira/${instanceId}/labels`);
  }

  async getJiraIssueTypes(instanceId, projectKey) {
    return this.get(`/api/jira/${instanceId}/projects/${projectKey}/issue-types`);
  }

  async getJiraCreateFieldsMeta(instanceId, projectKey, issueTypeId) {
    return this.get(
      `/api/jira/${instanceId}/projects/${projectKey}/issue-types/${issueTypeId}/fields`,
    );
  }

  async getJiraBoards(instanceId, projectKey) {
    const qs = projectKey ? `?projectKey=${encodeURIComponent(projectKey)}` : "";
    return this.get(`/api/jira/${instanceId}/boards${qs}`);
  }

  async getJiraBoardConfig(instanceId, boardId) {
    return this.get(`/api/jira/${instanceId}/boards/${boardId}/config`);
  }

  async getJiraSprints(instanceId, boardId) {
    return this.get(`/api/jira/${instanceId}/boards/${boardId}/sprints`);
  }

  async getJiraSprintIssues(instanceId, sprintId) {
    return this.get(`/api/jira/${instanceId}/sprints/${sprintId}/issues`);
  }

  async getJiraBoardIssues(instanceId, boardId) {
    return this.get(`/api/jira/${instanceId}/boards/${boardId}/issues`);
  }

  async getJiraSavedQueries() {
    return this.get(`/api/jira/queries`);
  }

  async addJiraSavedQuery(payload) {
    return this.post(`/api/jira/queries`, payload);
  }

  async updateJiraSavedQuery(queryId, payload) {
    return this.put(`/api/jira/queries/${queryId}`, payload);
  }

  async removeJiraSavedQuery(queryId) {
    return this.delete(`/api/jira/queries/${queryId}`);
  }

  // ── MCP ──

  async getMcpServers() {
    return this.get("/api/mcp/servers");
  }

  async putMcpServers(servers) {
    return this.put("/api/mcp/servers", servers);
  }

  async testMcpServer(server) {
    return this.post("/api/mcp/servers/test", server);
  }

  async listMcpServerTools(serverId) {
    return this.get(`/api/mcp/servers/${encodeURIComponent(serverId)}/tools`);
  }

  async getMcpStatus() {
    return this.get("/api/mcp/status");
  }

  // ── Attachments ──

  async uploadAttachment(
    endpoint,
    accessToken,
    { buffer, fileName, mimeType, containerType, containerId },
  ) {
    const base = this.baseUrl(endpoint);
    const form = new FormData();
    form.append("file", new Blob([buffer], { type: mimeType }), fileName);
    form.append("containerType", containerType);
    form.append("containerId", containerId);
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

  resolveLinkwardenPreviewUrl(endpoint, accessToken, instanceId, linkId) {
    const base = this.baseUrl(endpoint);
    return `${base}/api/linkwarden/${instanceId}/preview/${linkId}?token=${encodeURIComponent(accessToken)}`;
  }
}
