import type { FastifyInstance } from "fastify";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setupPage(errorMessage = "") {
  const errorHtml = errorMessage
    ? `<div class="banner error">${escapeHtml(errorMessage)}</div>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Slate Initial Admin Setup</title>
    <style>
      body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d0f13;color:#f5f7fb;font:16px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif}
      .card{width:min(460px,calc(100vw - 32px));padding:28px;border-radius:18px;background:rgba(19,22,29,.95);border:1px solid rgba(255,255,255,.08)}
      h1{margin:0 0 8px;font-size:28px;letter-spacing:-0.03em}
      p{margin:0 0 16px;color:rgba(245,247,251,.7)}
      label{display:block;margin:14px 0 6px;font-size:14px;color:rgba(245,247,251,.85)}
      input{width:100%;padding:12px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:#121722;color:#fff;box-sizing:border-box}
      button{margin-top:16px;width:100%;padding:12px;border:none;border-radius:10px;background:#f5f7fb;color:#111;font-weight:600;cursor:pointer}
      .banner.error{margin-bottom:12px;padding:10px 12px;border-radius:10px;background:#3f1b1f;color:#ffbac2;border:1px solid rgba(255,186,194,.22)}
    </style>
  </head>
  <body>
    <form class="card" method="post" action="/admin/setup">
      <h1>Initial setup</h1>
      <p>Create the first administrator account. This page is disabled after the first user exists.</p>
      ${errorHtml}
      <label for="displayName">Display name</label>
      <input id="displayName" name="displayName" type="text" required />
      <label for="email">Email</label>
      <input id="email" name="email" type="email" required />
      <label for="password">Password</label>
      <input id="password" name="password" type="password" minlength="8" required />
      <button type="submit">Create initial admin</button>
    </form>
  </body>
</html>`;
}

export default async function adminUiRoutes(fastify: FastifyInstance) {
  fastify.get("/admin/setup", async (_request, reply) => {
    const userCount = await fastify.authAdminService.userCount();
    if (userCount > 0) {
      return reply.redirect("/admin/login");
    }

    return reply.type("text/html").send(setupPage());
  });

  fastify.post("/admin/setup", async (request, reply) => {
    const payload = request.body as {
      displayName?: string;
      email?: string;
      password?: string;
    };

    try {
      await fastify.authAdminService.setupInitialAdmin({
        displayName: String(payload.displayName ?? ""),
        email: String(payload.email ?? ""),
        password: String(payload.password ?? ""),
      });
      return reply.redirect("/admin/login?created=1");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create initial admin";
      return reply.status(400).type("text/html").send(setupPage(message));
    }
  });
}
