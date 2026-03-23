import { hash } from "argon2";
import { AppConfigName } from "@slate/server-db";
import * as OTPAuth from "otpauth";
import { createTestApp, resetDatabase } from "./helpers/test-app";
import { AuthService } from "../src/auth/auth.service";

describe("AuthService", () => {
  it("advertises password auth", async () => {
    const { app } = await createTestApp();
    await resetDatabase(app);
    const authService = app.get(AuthService);

    const providers = await authService.listProviders();
    expect(providers.providers.some((provider: { id: string; type: string }) => provider.id === "password" && provider.type === "password")).toBe(true);
    expect(providers.providers.find((provider: { id: string }) => provider.id === "password")?.accountCreationEnabled).toBe(true);

    await app.close();
  });

  it("hides password provider when password auth is disabled", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);
    const authService = app.get(AuthService);

    await prisma.appConfig.update({
      where: { name: AppConfigName.PASSWORD_AUTH_ENABLED },
      data: { value: "false" },
    });

    const providers = await authService.listProviders();
    expect(providers.providers.some((provider: { id: string }) => provider.id === "password")).toBe(false);

    await app.close();
  });

  it("registers a new account without provisioning workspace state", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);
    const authService = app.get(AuthService);
    await authService.setupInitialAdmin({
      email: "admin@example.com",
      password: "secret-pass",
      displayName: "Admin",
    });

    const session = await authService.registerWithPassword({
      email: "new@example.com",
      password: "secret-pass",
      displayName: "NewUser",
      clientId: "desktop-main",
    });

    expect(session.tokens.accessToken).toBeTruthy();
    expect(session.userId).toBeTruthy();
    expect(session.displayName).toBe("NewUser");
    expect(session.isAdmin).toBe(false);
    expect(session).not.toHaveProperty("workspaceId");
    expect(session).not.toHaveProperty("workspaceName");

    const user = await prisma.user.findUniqueOrThrow({ where: { email: "new@example.com" } });
    expect(user.normalizedUsername).toBe("newuser");
    expect(await prisma.deviceCursor.count()).toBe(0);

    await app.close();
  });

  it("rejects duplicate usernames case-insensitively", async () => {
    const { app } = await createTestApp();
    await resetDatabase(app);
    const authService = app.get(AuthService);
    await authService.setupInitialAdmin({
      email: "admin@example.com",
      password: "secret-pass",
      displayName: "Admin",
    });

    await authService.registerWithPassword({
      email: "first@example.com",
      password: "secret-pass",
      displayName: "Ada",
      clientId: "desktop-main",
    });

    await expect(
      authService.registerWithPassword({
        email: "second@example.com",
        password: "secret-pass",
        displayName: "ada",
        clientId: "desktop-main",
      })
    ).rejects.toThrow("This username is already taken");

    await app.close();
  });

  it("rejects registration when account creation is disabled", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);
    const authService = app.get(AuthService);
    await authService.setupInitialAdmin({
      email: "admin@example.com",
      password: "secret-pass",
      displayName: "Admin",
    });
    await prisma.appConfig.update({
      where: { name: AppConfigName.ACCOUNT_CREATION_ENABLED },
      data: { value: "false" },
    });

    await expect(
      authService.registerWithPassword({
        email: "blocked@example.com",
        password: "secret-pass",
        displayName: "BlockedUser",
        clientId: "desktop-main",
      })
    ).rejects.toThrow("Account creation is disabled on this server");

    await app.close();
  });

  it("blocks password registration until initial admin setup is completed", async () => {
    const { app } = await createTestApp();
    await resetDatabase(app);
    const authService = app.get(AuthService);

    await expect(
      authService.registerWithPassword({
        email: "first@example.com",
        password: "secret-pass",
        displayName: "FirstUser",
        clientId: "desktop-main",
      })
    ).rejects.toThrow("Initial administrator setup must be completed at /admin/setup");

    await app.close();
  });

  it("authenticates password + totp against the real database", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);

    const passwordHash = await hash("secret-pass");
    const user = await prisma.user.create({
      data: {
        email: "ada@example.com",
        displayName: "Ada",
        normalizedUsername: "ada",
        passwordHash
      }
    });

    const totp = new OTPAuth.TOTP({ secret: "JBSWY3DPEHPK3PXP", algorithm: "SHA1", digits: 6 });
    await prisma.totpEnrollment.create({
      data: {
        userId: user.id,
        secretBase32: "JBSWY3DPEHPK3PXP",
        enabled: true
      }
    });

    const authService = app.get(AuthService);
    const session = await authService.loginWithPassword({
      email: user.email,
      password: "secret-pass",
      totpCode: totp.generate(),
      clientId: "desktop-main"
    });

    expect(session.userId).toBe(user.id);
    expect(session.tokens.accessToken).toBeTruthy();
    expect(session.isAdmin).toBe(false);
    expect(session).not.toHaveProperty("workspaceId");
    expect(session).not.toHaveProperty("workspaceName");

    await app.close();
  });
});
