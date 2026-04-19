import type { FastifyInstance } from "fastify";
import type { JiraInstanceType } from "@slate/shared";

/**
 * Extract a human-readable error message from a jira.js error.
 * jira.js wraps Jira REST errors in an AxiosError-like shape with
 * `response.data` containing `{ errorMessages, errors }`.
 */
function extractJiraError(err: unknown, fallback: string, log: FastifyInstance["log"]): string {
  const anyErr = err as any;

  // jira.js wraps Axios errors — the real detail is in response.data
  const data = anyErr?.response?.data;
  if (data && typeof data === "object") {
    const parts: string[] = [];

    if (Array.isArray(data.errorMessages)) {
      for (const msg of data.errorMessages) {
        if (typeof msg === "string" && msg) parts.push(msg);
      }
    }
    if (data.errors && typeof data.errors === "object") {
      for (const [field, msg] of Object.entries(data.errors)) {
        if (typeof msg === "string" && msg) parts.push(`${field}: ${msg}`);
      }
    }

    if (parts.length > 0) {
      const detail = parts.join("; ");
      log.warn({ jiraError: data, status: anyErr.response?.status }, `Jira API error: ${detail}`);
      return detail;
    }
  }

  // Fallback: plain message
  const message = anyErr?.message ?? "";
  if (message) {
    log.warn({ err }, `Jira API error: ${message}`);

    // "Request failed with status code 400" is useless — return the fallback instead
    if (/^Request failed with status code \d+$/.test(message)) return fallback;
    return message;
  }

  log.warn({ err }, `Jira API error (unknown shape)`);
  return fallback;
}

export default async function jiraRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] };

  // -------------------------------------------------------------------------
  // Instance management
  // -------------------------------------------------------------------------

  fastify.get("/api/jira/instances", auth, async (request) => {
    return { instances: await fastify.jiraService.listInstances(request.user!.userId) };
  });

  fastify.post("/api/jira/instances", auth, async (request, reply) => {
    const { baseUrl, email, token, type, name } = request.body as {
      baseUrl: string;
      email: string;
      token: string;
      type: JiraInstanceType;
      name?: string;
    };
    try {
      const instance = await fastify.jiraService.addInstance(
        request.user!.userId,
        baseUrl,
        email,
        token,
        type,
        name,
      );
      return { instance };
    } catch (err) {
      return reply
        .code(400)
        .send({ error: extractJiraError(err, "Failed to connect.", fastify.log) });
    }
  });

  fastify.put("/api/jira/instances/:id", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      name?: string;
      baseUrl?: string;
      email?: string;
      token?: string;
      type?: JiraInstanceType;
    };
    try {
      const instance = await fastify.jiraService.updateInstance(request.user!.userId, id, body);
      return { instance };
    } catch (err) {
      return reply
        .code(400)
        .send({ error: extractJiraError(err, "Failed to update instance.", fastify.log) });
    }
  });

  fastify.delete("/api/jira/instances/:id", auth, async (request) => {
    const { id } = request.params as { id: string };
    await fastify.jiraService.removeInstance(request.user!.userId, id);
    return { ok: true };
  });

  fastify.post("/api/jira/instances/:id/test", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const result = await fastify.jiraService.testConnection(request.user!.userId, id);
      return result;
    } catch (err) {
      return reply
        .code(400)
        .send({ error: extractJiraError(err, "Connection failed.", fastify.log) });
    }
  });

  // -------------------------------------------------------------------------
  // Projects & Issues
  // -------------------------------------------------------------------------

  fastify.get("/api/jira/:instanceId/projects", auth, async (request) => {
    const { instanceId } = request.params as { instanceId: string };
    return fastify.jiraService.getProjects(request.user!.userId, instanceId);
  });

  fastify.get("/api/jira/:instanceId/issues", auth, async (request) => {
    const { instanceId } = request.params as { instanceId: string };
    const query = request.query as {
      projectKey?: string;
      jql?: string;
      assignee?: string;
      watcher?: string;
      nextPageToken?: string;
      maxResults?: string;
    };
    return fastify.jiraService.getIssues(request.user!.userId, instanceId, {
      projectKey: query.projectKey,
      jql: query.jql,
      assignee: query.assignee,
      watcher: query.watcher,
      nextPageToken: query.nextPageToken,
      maxResults: query.maxResults ? Number(query.maxResults) : undefined,
    });
  });

  // -------------------------------------------------------------------------
  // Create issue
  // -------------------------------------------------------------------------

  fastify.post("/api/jira/:instanceId/issues", auth, async (request, reply) => {
    const { instanceId } = request.params as { instanceId: string };
    const body = request.body as {
      projectKey: string;
      issueTypeId: string;
      summary: string;
      description?: string;
      assigneeId?: string;
      priorityId?: string;
      labels?: string[];
    };
    try {
      const issue = await fastify.jiraService.createIssue(request.user!.userId, instanceId, body);
      return { issue };
    } catch (err) {
      return reply
        .code(400)
        .send({ error: extractJiraError(err, "Failed to create issue.", fastify.log) });
    }
  });

  // -------------------------------------------------------------------------
  // Issue detail, editing, transitions, comments
  // -------------------------------------------------------------------------

  fastify.get("/api/jira/:instanceId/issues/:issueKey", auth, async (request) => {
    const { instanceId, issueKey } = request.params as { instanceId: string; issueKey: string };
    return fastify.jiraService.getIssue(request.user!.userId, instanceId, issueKey);
  });

  fastify.put("/api/jira/:instanceId/issues/:issueKey", auth, async (request, reply) => {
    const { instanceId, issueKey } = request.params as { instanceId: string; issueKey: string };
    const body = request.body as {
      summary?: string;
      description?: string;
      assigneeId?: string;
      priorityId?: string;
      labels?: string[];
      customFields?: Record<string, unknown>;
    };
    try {
      await fastify.jiraService.updateIssue(request.user!.userId, instanceId, issueKey, body);
      return { ok: true };
    } catch (err) {
      return reply
        .code(400)
        .send({ error: extractJiraError(err, "Failed to update issue.", fastify.log) });
    }
  });

  fastify.get("/api/jira/:instanceId/issues/:issueKey/transitions", auth, async (request) => {
    const { instanceId, issueKey } = request.params as { instanceId: string; issueKey: string };
    return fastify.jiraService.getTransitions(request.user!.userId, instanceId, issueKey);
  });

  fastify.post(
    "/api/jira/:instanceId/issues/:issueKey/transition",
    auth,
    async (request, reply) => {
      const { instanceId, issueKey } = request.params as { instanceId: string; issueKey: string };
      const { transitionId, fields } = request.body as {
        transitionId: string;
        fields?: Record<string, unknown>;
      };
      try {
        await fastify.jiraService.transitionIssue(
          request.user!.userId,
          instanceId,
          issueKey,
          transitionId,
          fields,
        );
        return { ok: true };
      } catch (err) {
        return reply
          .code(400)
          .send({ error: extractJiraError(err, "Failed to transition issue.", fastify.log) });
      }
    },
  );

  fastify.post("/api/jira/:instanceId/issues/:issueKey/comments", auth, async (request, reply) => {
    const { instanceId, issueKey } = request.params as { instanceId: string; issueKey: string };
    const { body } = request.body as { body: string };
    try {
      const comment = await fastify.jiraService.addComment(
        request.user!.userId,
        instanceId,
        issueKey,
        body,
      );
      return { comment };
    } catch (err) {
      return reply
        .code(400)
        .send({ error: extractJiraError(err, "Failed to add comment.", fastify.log) });
    }
  });

  // -------------------------------------------------------------------------
  // Metadata: users, priorities, issue types
  // -------------------------------------------------------------------------

  fastify.get("/api/jira/:instanceId/users", auth, async (request) => {
    const { instanceId } = request.params as { instanceId: string };
    const { query } = request.query as { query?: string };
    return fastify.jiraService.searchUsers(request.user!.userId, instanceId, query ?? "");
  });

  fastify.get("/api/jira/:instanceId/priorities", auth, async (request) => {
    const { instanceId } = request.params as { instanceId: string };
    return fastify.jiraService.getPriorities(request.user!.userId, instanceId);
  });

  fastify.get("/api/jira/:instanceId/labels", auth, async (request) => {
    const { instanceId } = request.params as { instanceId: string };
    return fastify.jiraService.getLabels(request.user!.userId, instanceId);
  });

  fastify.get("/api/jira/:instanceId/projects/:projectKey/issue-types", auth, async (request) => {
    const { instanceId, projectKey } = request.params as { instanceId: string; projectKey: string };
    return fastify.jiraService.getIssueTypes(request.user!.userId, instanceId, projectKey);
  });

  fastify.get(
    "/api/jira/:instanceId/projects/:projectKey/issue-types/:issueTypeId/fields",
    auth,
    async (request) => {
      const { instanceId, projectKey, issueTypeId } = request.params as {
        instanceId: string;
        projectKey: string;
        issueTypeId: string;
      };
      return fastify.jiraService.getCreateFieldsMeta(
        request.user!.userId,
        instanceId,
        projectKey,
        issueTypeId,
      );
    },
  );

  // -------------------------------------------------------------------------
  // Boards & Sprints
  // -------------------------------------------------------------------------

  fastify.get("/api/jira/:instanceId/boards", auth, async (request, reply) => {
    const { instanceId } = request.params as { instanceId: string };
    const { projectKey } = request.query as { projectKey?: string };
    try {
      return await fastify.jiraService.getBoards(request.user!.userId, instanceId, projectKey);
    } catch (err) {
      return reply
        .code(400)
        .send({ error: extractJiraError(err, "Failed to fetch boards.", fastify.log) });
    }
  });

  fastify.get("/api/jira/:instanceId/boards/:boardId/config", auth, async (request, reply) => {
    const { instanceId, boardId } = request.params as { instanceId: string; boardId: string };
    try {
      return await fastify.jiraService.getBoardConfiguration(
        request.user!.userId,
        instanceId,
        Number(boardId),
      );
    } catch (err) {
      return reply.code(400).send({
        error: extractJiraError(err, "Failed to fetch board configuration.", fastify.log),
      });
    }
  });

  fastify.get("/api/jira/:instanceId/boards/:boardId/sprints", auth, async (request, reply) => {
    const { instanceId, boardId } = request.params as { instanceId: string; boardId: string };
    try {
      return await fastify.jiraService.getSprints(
        request.user!.userId,
        instanceId,
        Number(boardId),
      );
    } catch (err) {
      return reply
        .code(400)
        .send({ error: extractJiraError(err, "Failed to fetch sprints.", fastify.log) });
    }
  });

  fastify.get("/api/jira/:instanceId/sprints/:sprintId/issues", auth, async (request, reply) => {
    const { instanceId, sprintId } = request.params as { instanceId: string; sprintId: string };
    try {
      return await fastify.jiraService.getSprintIssues(
        request.user!.userId,
        instanceId,
        Number(sprintId),
      );
    } catch (err) {
      return reply
        .code(400)
        .send({ error: extractJiraError(err, "Failed to fetch sprint issues.", fastify.log) });
    }
  });

  fastify.get("/api/jira/:instanceId/boards/:boardId/issues", auth, async (request, reply) => {
    const { instanceId, boardId } = request.params as { instanceId: string; boardId: string };
    try {
      return await fastify.jiraService.getBoardIssues(
        request.user!.userId,
        instanceId,
        Number(boardId),
      );
    } catch (err) {
      return reply
        .code(400)
        .send({ error: extractJiraError(err, "Failed to fetch board issues.", fastify.log) });
    }
  });
}
