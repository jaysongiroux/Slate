import request from "supertest";
import { AuthIdentityType } from "@slate/server-db";
import { createTestApp, resetDatabase } from "./helpers/test-app";

describe("Internal admin API", () => {
  it("serves admin setup before the first user exists and redirects after bootstrap", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);

    await request(app.server)
      .get("/admin/setup")
      .expect(200)
      .expect(({ text }) => {
        expect(text).toContain("Initial setup");
        expect(text).toContain("Create initial admin");
      });

    await request(app.server)
      .post("/admin/setup")
      .send({
        displayName: "Slate Admin",
        email: "admin@example.com",
        password: "secret-pass",
      })
      .expect(302)
      .expect("location", "/admin/login?created=1");

    const user = await prisma.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    expect(user.isAdmin).toBe(true);

    await request(app.server).get("/admin/setup").expect(302).expect("location", "/admin/login");

    await app.close();
  });

  it("creates the initial admin through internal bootstrap endpoint", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);

    await request(app.server)
      .get("/internal/admin/bootstrap-status")
      .expect(200)
      .expect(({ body }) => {
        expect(body.requiresInitialSetup).toBe(true);
        expect(body.userCount).toBe(0);
      });

    await request(app.server)
      .post("/internal/admin/setup-initial")
      .send({
        displayName: "Slate Admin",
        email: "admin@example.com",
        password: "secret-pass",
      })
      .expect(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    expect(user.isAdmin).toBe(true);

    await request(app.server)
      .get("/internal/admin/bootstrap-status")
      .expect(200)
      .expect(({ body }) => {
        expect(body.requiresInitialSetup).toBe(false);
        expect(body.userCount).toBe(1);
      });

    await app.close();
  });

  it("allows only admins to create an internal admin session", async () => {
    const { app } = await createTestApp();
    await resetDatabase(app);
    const authService = app.authService;

    await authService.createPasswordAccount({
      email: "member@example.com",
      password: "secret-pass",
      displayName: "Member",
      isAdmin: false,
    });

    await authService.createPasswordAccount({
      email: "admin@example.com",
      password: "secret-pass",
      displayName: "Admin",
      isAdmin: true,
    });

    await request(app.server)
      .post("/internal/admin/auth/login")
      .send({ email: "member@example.com", password: "secret-pass" })
      .expect(401);

    const loginResponse = await request(app.server)
      .post("/internal/admin/auth/login")
      .send({ email: "admin@example.com", password: "secret-pass" })
      .expect(200);

    expect(loginResponse.body.accessToken).toBeTruthy();
    expect(loginResponse.body.user.email).toBe("admin@example.com");

    await request(app.server).get("/internal/admin/me").expect(401);

    await request(app.server)
      .get("/internal/admin/me")
      .set("authorization", `Bearer ${loginResponse.body.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.email).toBe("admin@example.com");
        expect(body.isAdmin).toBe(true);
      });

    await app.close();
  });

  it("provisions users and updates account creation setting through admin endpoints", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);
    const authService = app.authService;

    await authService.createPasswordAccount({
      email: "admin@example.com",
      password: "secret-pass",
      displayName: "Admin",
      isAdmin: true,
    });

    const loginResponse = await request(app.server)
      .post("/internal/admin/auth/login")
      .send({ email: "admin@example.com", password: "secret-pass" })
      .expect(200);

    const token = loginResponse.body.accessToken;

    const createResponse = await request(app.server)
      .post("/internal/admin/users")
      .set("authorization", `Bearer ${token}`)
      .send({
        email: "managed@example.com",
        displayName: "ManagedUser",
        password: "secret-pass",
        isAdmin: false,
      })
      .expect(200);

    const managedUser = await prisma.user.findUniqueOrThrow({
      where: { email: "managed@example.com" },
    });
    expect(createResponse.body.id).toBe(managedUser.id);

    await request(app.server)
      .patch("/internal/admin/settings/account-creation-enabled")
      .set("authorization", `Bearer ${token}`)
      .send({ enabled: false })
      .expect(200)
      .expect(({ body }) => {
        expect(body.accountCreationEnabled).toBe(false);
      });

    await expect(
      authService.registerWithPassword({
        email: "blocked@example.com",
        password: "secret-pass",
        displayName: "BlockedUser",
        clientId: "desktop-main",
      }),
    ).rejects.toThrow("Account creation is disabled on this server");

    await app.close();
  });

  it("guards password-auth disable behind OIDC readiness checks", async () => {
    const { app } = await createTestApp();
    await resetDatabase(app);
    const authService = app.authService;

    await authService.createPasswordAccount({
      email: "admin@example.com",
      password: "secret-pass",
      displayName: "Admin",
      isAdmin: true,
    });

    const loginResponse = await request(app.server)
      .post("/internal/admin/auth/login")
      .send({ email: "admin@example.com", password: "secret-pass" })
      .expect(200);

    await request(app.server)
      .patch("/internal/admin/settings/password-auth-enabled")
      .set("authorization", `Bearer ${loginResponse.body.accessToken}`)
      .send({ enabled: false })
      .expect(409);

    await app.close();
  });

  it("disables password auth when OIDC requirements are met and blocks unsafe follow-up mutations", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);
    const authService = app.authService;

    const admin = await authService.createPasswordAccount({
      email: "admin@example.com",
      password: "secret-pass",
      displayName: "Admin",
      isAdmin: true,
    });

    await prisma.oidcProviderConfig.create({
      data: {
        providerId: "corp",
        label: "Corp SSO",
        issuerUrl: "https://id.example.com",
        clientId: "client-id",
        clientSecretEncrypted: "dummy",
        enabled: true,
        scopes: "openid profile email",
      },
    });

    await prisma.authIdentity.create({
      data: {
        userId: admin.userId,
        type: AuthIdentityType.OIDC,
        provider: "corp",
        providerSubject: "admin-subject",
        lastUsedAt: new Date(),
        lastLoginAt: new Date(),
        loginCount: 1,
      },
    });

    const loginResponse = await request(app.server)
      .post("/internal/admin/auth/login")
      .send({ email: "admin@example.com", password: "secret-pass" })
      .expect(200);
    const token = loginResponse.body.accessToken;

    await request(app.server)
      .patch("/internal/admin/settings/password-auth-enabled")
      .set("authorization", `Bearer ${token}`)
      .send({ enabled: false })
      .expect(200)
      .expect(({ body }) => {
        expect(body.passwordAuthEnabled).toBe(false);
      });

    await expect(
      authService.loginWithPassword({
        email: "admin@example.com",
        password: "secret-pass",
        clientId: "desktop-main",
      }),
    ).rejects.toThrow("Password authentication is disabled");

    await request(app.server)
      .patch("/internal/admin/oidc/providers/corp")
      .set("authorization", `Bearer ${token}`)
      .send({ enabled: false })
      .expect(409);

    await request(app.server)
      .patch(`/internal/admin/users/${admin.userId}`)
      .set("authorization", `Bearer ${token}`)
      .send({
        email: "admin@example.com",
        displayName: "Admin",
        isAdmin: false,
      })
      .expect(409);

    await app.close();
  });
});
