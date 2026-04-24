import { createTestApp, resetDatabase } from "../../../test/helpers/test-app";
import { ForgeService } from "../forge.service";

async function createUser(prisma: any, email: string) {
  return prisma.user.create({
    data: { email, displayName: email, normalizedUsername: email },
  });
}

describe("ForgeService", () => {
  it("adds and lists an instance, round-trips the encrypted token", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);
    const user = await createUser(prisma, "forge-add@example.com");

    const svc = new ForgeService(prisma, "unit-test-secret");

    (svc as any).buildProvider = async () => ({
      validateToken: async () => ({ username: "jgiroux" }),
    });

    const instance = await svc.addInstance(user.id, {
      provider: "github",
      baseUrl: "https://api.github.com",
      token: "ghp_secret_token_value",
      name: "Personal",
    });

    expect(instance.provider).toBe("github");
    expect((instance as any).token).toBeUndefined();

    const list = await svc.listInstances(user.id);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(instance.id);

    const plaintext = await (svc as any).decryptTokenForInstance(user.id, instance.id);
    expect(plaintext).toBe("ghp_secret_token_value");

    await app.close();
  });

  it("user B cannot see or remove user A's instance", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);

    const userA = await createUser(prisma, "a@example.com");
    const userB = await createUser(prisma, "b@example.com");

    const svc = new ForgeService(prisma, "unit-test-secret");
    (svc as any).buildProvider = async () => ({
      validateToken: async () => ({ username: "a" }),
    });

    const addedForA = await svc.addInstance(userA.id, {
      provider: "github",
      baseUrl: "https://api.github.com",
      token: "ghp_x",
    });

    expect(await svc.listInstances(userB.id)).toHaveLength(0);

    await expect(svc.removeInstance(userB.id, addedForA.id)).resolves.not.toThrow();
    expect(await svc.listInstances(userA.id)).toHaveLength(1);

    await app.close();
  });

  it("pin() enriches record via provider.fetchItemDetails and persists", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);
    const user = await createUser(prisma, "pin@example.com");

    const svc = new ForgeService(prisma, "unit-test-secret");
    (svc as any).buildProvider = async () => ({
      validateToken: async () => ({ username: "me" }),
      fetchItemDetails: async () => ({
        title: "Add forge",
        webUrl: "https://github.com/acme/frontend/pull/101",
      }),
    });

    const inst = await svc.addInstance(user.id, {
      provider: "github",
      baseUrl: "https://api.github.com",
      token: "t",
    });

    const pinned = await svc.pin(user.id, inst.id, {
      kind: "pr",
      repo: "acme/frontend",
      number: 101,
    });

    expect(pinned).toMatchObject({
      instanceId: inst.id,
      kind: "pr",
      repo: "acme/frontend",
      number: 101,
      title: "Add forge",
      webUrl: "https://github.com/acme/frontend/pull/101",
    });

    const list = await svc.listPinned(user.id, inst.id);
    expect(list).toHaveLength(1);

    await app.close();
  });

  it("star and unstar a repo persist in forge.starredRepos", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);
    const user = await createUser(prisma, "star@example.com");

    const svc = new ForgeService(prisma, "unit-test-secret");
    (svc as any).buildProvider = async () => ({
      validateToken: async () => ({ username: "me" }),
    });
    const inst = await svc.addInstance(user.id, {
      provider: "github",
      baseUrl: "https://api.github.com",
      token: "t",
    });

    await svc.star(user.id, inst.id, "acme/frontend");
    await svc.star(user.id, inst.id, "acme/backend");
    expect(await svc.listStarred(user.id, inst.id)).toEqual(["acme/frontend", "acme/backend"]);

    await svc.unstar(user.id, inst.id, "acme/frontend");
    expect(await svc.listStarred(user.id, inst.id)).toEqual(["acme/backend"]);

    await app.close();
  });

  it("saved search CRUD is scoped per user", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);
    const userA = await createUser(prisma, "sa@example.com");
    const userB = await createUser(prisma, "sb@example.com");

    const svc = new ForgeService(prisma, "unit-test-secret");
    (svc as any).buildProvider = async () => ({
      validateToken: async () => ({ username: "a" }),
    });

    const instA = await svc.addInstance(userA.id, {
      provider: "github",
      baseUrl: "https://api.github.com",
      token: "t",
    });

    const saved = await svc.saveSearch(userA.id, {
      instanceId: instA.id,
      name: "Waiting on me",
      kind: "pr",
      query: "is:open is:pr review-requested:@me",
    });

    expect(await svc.listSavedSearches(userA.id, instA.id)).toHaveLength(1);
    expect(await svc.listSavedSearches(userB.id, instA.id)).toHaveLength(0);

    await svc.removeSavedSearch(userB.id, saved.id);
    expect(await svc.listSavedSearches(userA.id, instA.id)).toHaveLength(1);

    await app.close();
  });

  it("removeInstance deletes the token row and pinned items for that instance only", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);
    const user = await createUser(prisma, "del@example.com");

    const svc = new ForgeService(prisma, "unit-test-secret");
    (svc as any).buildProvider = async () => ({
      validateToken: async () => ({ username: "me" }),
      fetchItemDetails: async () => ({ title: "T", webUrl: "u" }),
    });

    const inst1 = await svc.addInstance(user.id, {
      provider: "github",
      baseUrl: "https://api.github.com",
      token: "t1",
    });
    const inst2 = await svc.addInstance(user.id, {
      provider: "gitlab",
      baseUrl: "https://gitlab.com/api/v4",
      token: "t2",
    });
    await svc.pin(user.id, inst1.id, { kind: "pr", repo: "a/b", number: 1 });
    await svc.pin(user.id, inst2.id, { kind: "pr", repo: "c/d", number: 2 });

    await svc.removeInstance(user.id, inst1.id);

    expect(await svc.listInstances(user.id)).toHaveLength(1);
    expect(await svc.listPinned(user.id, inst1.id)).toHaveLength(0);
    expect(await svc.listPinned(user.id, inst2.id)).toHaveLength(1);

    await app.close();
  });
});
