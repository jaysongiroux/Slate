import type { FastifyInstance } from "fastify";
import type { ForgeErrorCode } from "@slate/shared";

function cacheKey(
  userId: string,
  instanceId: string,
  kind: string,
  cursor?: string,
  extra?: string,
): string {
  return `${userId}:${instanceId}:${kind}:${cursor ?? "first"}${extra ? `:${extra}` : ""}`;
}

function mapErrorToResponse(err: unknown): {
  status: number;
  body: { error: ForgeErrorCode; message: string; resetAt?: string };
} {
  const e = err as {
    code?: string;
    message?: string;
    status?: number;
    resetAt?: string;
  };
  if (e?.code === "FORGE_NOT_FOUND") {
    return {
      status: 404,
      body: { error: "FORGE_NOT_FOUND", message: e.message ?? "Not found" },
    };
  }
  if (e?.status === 400 || e?.status === 422) {
    return {
      status: 400,
      body: { error: "FORGE_INVALID_QUERY", message: e?.message ?? "Invalid forge query" },
    };
  }
  if (e?.status === 401 || /invalid|unauthorized|bad credentials/i.test(e?.message ?? "")) {
    return {
      status: 401,
      body: { error: "FORGE_TOKEN_INVALID", message: e?.message ?? "Invalid token" },
    };
  }
  if (e?.status === 403 && /scope|permission|not accessible|forbidden/i.test(e?.message ?? "")) {
    return {
      status: 403,
      body: { error: "FORGE_SCOPE_MISSING", message: e?.message ?? "Insufficient scope" },
    };
  }
  if (e?.status === 429 || (e?.status === 403 && /rate limit/i.test(e?.message ?? ""))) {
    return {
      status: 429,
      body: { error: "FORGE_RATE_LIMITED", message: "Rate limited", resetAt: e?.resetAt },
    };
  }
  return {
    status: 502,
    body: { error: "FORGE_UNREACHABLE", message: e?.message ?? "Provider error" },
  };
}

export default async function forgeRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] };

  // ---------------- Instance CRUD ----------------

  fastify.get("/api/forge/instances", auth, async (request) => {
    return { instances: await fastify.forgeService.listInstances(request.user!.userId) };
  });

  fastify.post("/api/forge/instances", auth, async (request, reply) => {
    const body = request.body as {
      provider: "github" | "gitlab";
      baseUrl: string;
      token: string;
      name?: string;
    };
    try {
      const instance = await fastify.forgeService.addInstance(request.user!.userId, body);
      return { instance };
    } catch (err) {
      const { status, body: payload } = mapErrorToResponse(err);
      return reply.code(status).send(payload);
    }
  });

  fastify.patch("/api/forge/instances/:id", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      name?: string;
      baseUrl?: string;
      provider?: "github" | "gitlab";
      token?: string;
    };
    try {
      const instance = await fastify.forgeService.updateInstance(request.user!.userId, id, body);
      fastify.forgeCache.invalidatePrefix(`${request.user!.userId}:${id}:`);
      return { instance };
    } catch (err) {
      const { status, body: payload } = mapErrorToResponse(err);
      return reply.code(status).send(payload);
    }
  });

  fastify.delete("/api/forge/instances/:id", auth, async (request) => {
    const { id } = request.params as { id: string };
    await fastify.forgeService.removeInstance(request.user!.userId, id);
    fastify.forgeCache.invalidatePrefix(`${request.user!.userId}:${id}:`);
    return { ok: true };
  });

  // ---------------- Counts ----------------

  fastify.get("/api/forge/:id/counts", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.userId;
    try {
      const counts = await fastify.forgeCache.getOrLoad(
        cacheKey(userId, id, "counts"),
        async () => {
          const provider = await fastify.forgeService.getProviderForInstance(userId, id);
          return provider.getCounts();
        },
      );
      return counts;
    } catch (err) {
      const { status, body } = mapErrorToResponse(err);
      return reply.code(status).send(body);
    }
  });

  // ---------------- Quick-filter lists ----------------

  type ListMethod =
    | "listMyPullRequests"
    | "listReviewRequests"
    | "listNotifications"
    | "listAssignedIssues"
    | "listRepos";

  async function handleList(
    fn: ListMethod,
    kindKey: string,
    request: any,
    reply: any,
  ): Promise<unknown> {
    const { id } = request.params as { id: string };
    const { cursor } = request.query as { cursor?: string };
    const userId = request.user!.userId;
    try {
      return await fastify.forgeCache.getOrLoad(cacheKey(userId, id, kindKey, cursor), async () => {
        const provider = await fastify.forgeService.getProviderForInstance(userId, id);
        return (provider as any)[fn](cursor);
      });
    } catch (err) {
      const { status, body } = mapErrorToResponse(err);
      return reply.code(status).send(body);
    }
  }

  fastify.get("/api/forge/:id/my-prs", auth, (req, reply) =>
    handleList("listMyPullRequests", "my-prs", req, reply),
  );
  fastify.get("/api/forge/:id/reviewing", auth, (req, reply) =>
    handleList("listReviewRequests", "reviewing", req, reply),
  );
  fastify.get("/api/forge/:id/notifications", auth, (req, reply) =>
    handleList("listNotifications", "notifications", req, reply),
  );
  fastify.get("/api/forge/:id/assigned-issues", auth, (req, reply) =>
    handleList("listAssignedIssues", "assigned-issues", req, reply),
  );
  fastify.get("/api/forge/:id/repos", auth, (req, reply) =>
    handleList("listRepos", "repos", req, reply),
  );

  // ---------------- Repo-scoped lists ----------------
  // Full repo path is passed as a query param so nested GitLab paths
  // (group/subgroup/project) are not truncated by /:owner/:repo routing.

  async function handleRepoPRs(request: any, reply: any, searchRequired: boolean) {
    const { id } = request.params as { id: string };
    const { cursor, repo, q } = request.query as { cursor?: string; repo?: string; q?: string };
    const userId = request.user!.userId;
    const fullName = (repo ?? "").trim();
    if (!fullName) {
      return reply
        .code(400)
        .send({ error: "FORGE_NOT_FOUND", message: "repo query param is required" });
    }
    const query = typeof q === "string" ? q.trim() : undefined;
    if (
      (searchRequired && (!query || query.length > 200)) ||
      (!searchRequired && q !== undefined) ||
      (cursor !== undefined && (!/^[1-9]\d*$/.test(cursor) || Number(cursor) > 1000))
    ) {
      return reply.code(400).send({
        error: "FORGE_INVALID_QUERY",
        message: "Enter 1–200 characters and a valid cursor.",
      });
    }
    try {
      return await fastify.forgeCache.getOrLoad(
        cacheKey(userId, id, "repo-prs", JSON.stringify([fullName, query ?? "", cursor ?? "1"])),
        async () => {
          const provider = await fastify.forgeService.getProviderForInstance(userId, id);
          return provider.listRepoPullRequests(fullName, cursor, query);
        },
      );
    } catch (err) {
      const { status, body } = mapErrorToResponse(err);
      return reply.code(status).send(body);
    }
  }

  fastify.get("/api/forge/:id/repo-prs", auth, (request, reply) =>
    handleRepoPRs(request, reply, false),
  );
  fastify.get("/api/forge/:id/repo-prs/search", auth, (request, reply) =>
    handleRepoPRs(request, reply, true),
  );

  fastify.get("/api/forge/:id/repo-issues", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { cursor, repo } = request.query as { cursor?: string; repo?: string };
    const userId = request.user!.userId;
    const fullName = (repo ?? "").trim();
    if (!fullName) {
      return reply
        .code(400)
        .send({ error: "FORGE_NOT_FOUND", message: "repo query param is required" });
    }
    try {
      return await fastify.forgeCache.getOrLoad(
        cacheKey(userId, id, "repo-issues", cursor, fullName),
        async () => {
          const provider = await fastify.forgeService.getProviderForInstance(userId, id);
          return provider.listRepoIssues(fullName, cursor);
        },
      );
    } catch (err) {
      const { status, body } = mapErrorToResponse(err);
      return reply.code(status).send(body);
    }
  });

  // ---------------- Account-scoped PR / MR search ----------------

  fastify.get("/api/forge/:id/search-prs", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { q, state = "all", cursor } = request.query as Record<string, unknown>;
    const query = typeof q === "string" ? q.trim() : "";
    const validState =
      state === "all" || state === "open" || state === "merged" || state === "closed";
    const validCursor =
      cursor === undefined ||
      (typeof cursor === "string" && /^[1-9]\d*$/.test(cursor) && Number(cursor) <= 1000);
    if (!query || query.length > 200 || !validState || !validCursor) {
      return reply.code(400).send({
        error: "FORGE_INVALID_QUERY",
        message: "Enter 1–200 characters and a valid state or cursor.",
      });
    }
    const userId = request.user!.userId;
    try {
      return await fastify.forgeCache.getOrLoad(
        cacheKey(userId, id, "search-prs", JSON.stringify([query, state, cursor ?? "1"])),
        async () => {
          const provider = await fastify.forgeService.getProviderForInstance(userId, id);
          return provider.searchPullRequests(query, state, cursor as string | undefined);
        },
      );
    } catch (err) {
      const { status, body } = mapErrorToResponse(err);
      return reply.code(status).send(body);
    }
  });

  // ---------------- Pinned ----------------

  fastify.get("/api/forge/:id/pinned", auth, async (request) => {
    const { id } = request.params as { id: string };
    return { items: await fastify.forgeService.listPinned(request.user!.userId, id) };
  });

  fastify.post("/api/forge/:id/pinned", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { kind: "pr" | "issue"; repo: string; number: number };
    try {
      const pinned = await fastify.forgeService.pin(request.user!.userId, id, body);
      return { pinned };
    } catch (err) {
      const { status, body: payload } = mapErrorToResponse(err);
      return reply.code(status).send(payload);
    }
  });

  fastify.delete("/api/forge/pinned/:pinId", auth, async (request) => {
    const { pinId } = request.params as { pinId: string };
    await fastify.forgeService.unpin(request.user!.userId, pinId);
    return { ok: true };
  });

  fastify.post("/api/forge/:id/pinned/status", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      items: { pinId: string; kind: "pr" | "issue"; repo: string; number: number }[];
    };
    const userId = request.user!.userId;
    try {
      return await fastify.forgeCache.getOrLoad(
        cacheKey(
          userId,
          id,
          "pinned-status",
          undefined,
          body.items
            .map((i) => i.pinId)
            .sort()
            .join(","),
        ),
        async () => {
          const provider = await fastify.forgeService.getProviderForInstance(userId, id);
          const statuses = await provider.getPinnedItemStatus(body.items);
          return { statuses };
        },
      );
    } catch (err) {
      const { status, body: payload } = mapErrorToResponse(err);
      return reply.code(status).send(payload);
    }
  });

  // ---------------- Starred ----------------

  fastify.get("/api/forge/:id/starred", auth, async (request) => {
    const { id } = request.params as { id: string };
    return { repos: await fastify.forgeService.listStarred(request.user!.userId, id) };
  });

  fastify.post("/api/forge/:id/starred", auth, async (request) => {
    const { id } = request.params as { id: string };
    const { repo } = request.body as { repo: string };
    await fastify.forgeService.star(request.user!.userId, id, repo);
    return { ok: true };
  });

  fastify.post("/api/forge/:id/starred/remove", auth, async (request) => {
    const { id } = request.params as { id: string };
    const { repo } = request.body as { repo: string };
    await fastify.forgeService.unstar(request.user!.userId, id, repo);
    return { ok: true };
  });

  // ---------------- Saved searches ----------------

  fastify.get("/api/forge/:id/saved-searches", auth, async (request) => {
    const { id } = request.params as { id: string };
    return {
      searches: await fastify.forgeService.listSavedSearches(request.user!.userId, id),
    };
  });

  fastify.post("/api/forge/:id/saved-searches", auth, async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { name: string; kind: "pr" | "issue"; query: string };
    const saved = await fastify.forgeService.saveSearch(request.user!.userId, {
      instanceId: id,
      name: body.name,
      kind: body.kind,
      query: body.query,
    });
    return { saved };
  });

  fastify.delete("/api/forge/saved-searches/:searchId", auth, async (request) => {
    const { searchId } = request.params as { searchId: string };
    await fastify.forgeService.removeSavedSearch(request.user!.userId, searchId);
    return { ok: true };
  });

  fastify.get("/api/forge/:id/saved-searches/:searchId/results", auth, async (request, reply) => {
    const { id, searchId } = request.params as { id: string; searchId: string };
    const { cursor } = request.query as { cursor?: string };
    const userId = request.user!.userId;
    try {
      return await fastify.forgeCache.getOrLoad(
        cacheKey(userId, id, "saved-search", cursor, searchId),
        async () => {
          const [searches, provider] = await Promise.all([
            fastify.forgeService.listSavedSearches(userId, id),
            fastify.forgeService.getProviderForInstance(userId, id),
          ]);
          const saved = searches.find((s) => s.id === searchId);
          if (!saved) {
            throw Object.assign(new Error("Saved search not found"), {
              code: "FORGE_NOT_FOUND",
            });
          }
          return provider.searchSaved(saved, cursor);
        },
      );
    } catch (err) {
      const { status, body } = mapErrorToResponse(err);
      return reply.code(status).send(body);
    }
  });

  // ---------------- Refresh ----------------

  fastify.post("/api/forge/:id/refresh", auth, async (request) => {
    const { id } = request.params as { id: string };
    fastify.forgeCache.invalidatePrefix(`${request.user!.userId}:${id}:`);
    return { ok: true };
  });
}
