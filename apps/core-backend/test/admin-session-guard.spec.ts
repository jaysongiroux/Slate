import { shouldBypassAdminSessionGuard } from "../src/admin/session-guard";

describe("admin session guard", () => {
  const rootPath = "/admin";
  const loginPath = "/admin/login";
  const logoutPath = "/admin/logout";
  const setupPath = "/admin/setup";
  const assetPaths = [
    "/frontend/assets/app.bundle.js",
    "/frontend/assets/global.bundle.js",
    "/frontend/assets/design-system.bundle.js",
  ];
  const buildComponentPath = "/frontend/assets/components.bundle.js";

  const defaults = {
    assetPaths,
    buildComponentPath,
    loginPath,
    logoutPath,
    setupPath,
    rootPath,
  };

  it("bypasses guard for login and logout routes", () => {
    expect(shouldBypassAdminSessionGuard({ ...defaults, url: "/admin/login" })).toBe(true);
    expect(shouldBypassAdminSessionGuard({ ...defaults, url: "/admin/logout" })).toBe(true);
  });

  it("bypasses guard for the setup route", () => {
    expect(shouldBypassAdminSessionGuard({ ...defaults, url: "/admin/setup" })).toBe(true);
  });

  it("bypasses guard for AdminJS frontend assets", () => {
    expect(
      shouldBypassAdminSessionGuard({
        ...defaults,
        url: "/admin/frontend/assets/app.bundle.js",
      }),
    ).toBe(true);
  });

  it("bypasses guard for the AdminJS component bundle route", () => {
    expect(
      shouldBypassAdminSessionGuard({
        ...defaults,
        url: "/admin/frontend/assets/components.bundle.js",
      }),
    ).toBe(true);
  });

  it("requires a session for protected admin routes", () => {
    expect(shouldBypassAdminSessionGuard({ ...defaults, url: "/admin/resources/User" })).toBe(
      false,
    );
  });
});
