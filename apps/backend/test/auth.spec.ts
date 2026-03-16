import { hash } from "argon2";
import * as OTPAuth from "otpauth";
import { createTestApp, resetDatabase } from "./helpers/test-app";
import { AuthService } from "../src/auth/auth.service";

describe("AuthService", () => {
  it("authenticates password + totp against the real database", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);

    const passwordHash = await hash("secret-pass");
    const user = await prisma.user.create({
      data: {
        email: "ada@example.com",
        displayName: "Ada",
        passwordHash
      }
    });

    const workspace = await prisma.workspace.create({
      data: {
        name: "Ada Workspace",
        ownerUserId: user.id,
        members: {
          create: {
            userId: user.id,
            role: "OWNER"
          }
        }
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
    expect(session.workspaceId).toBe(workspace.id);
    expect(session.tokens.accessToken).toBeTruthy();

    await app.close();
  });
});

