import { createTestApp, resetDatabase } from "./helpers/test-app";
import { WorkspacesService } from "../src/workspaces/workspaces.service";

describe("WorkspaceService ResolveDevSession", () => {
  it("creates a personal workspace for a new local desktop client", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);

    const service = app.get(WorkspacesService);
    const session = await service.resolveDevSession("desktop-main", "Jason's MacBook");

    expect(session.clientId).toBe("desktop-main");
    expect(session.userId).toBeTruthy();
    expect(session.workspaceId).toBeTruthy();

    const membership = await prisma.workspaceMember.findFirst({
      where: { userId: session.userId }
    });

    expect(membership?.workspaceId).toBe(session.workspaceId);

    await app.close();
  });

  it("reuses the same workspace for the same local desktop client", async () => {
    const { app } = await createTestApp();
    await resetDatabase(app);

    const service = app.get(WorkspacesService);
    const first = await service.resolveDevSession("desktop-main", "Jason's MacBook");
    const second = await service.resolveDevSession("desktop-main", "Jason's MacBook");

    expect(second.userId).toBe(first.userId);
    expect(second.workspaceId).toBe(first.workspaceId);

    await app.close();
  });
});
