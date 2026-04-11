export function shouldBypassAdminSessionGuard(args: {
  assetPaths: string[];
  buildComponentPath?: string;
  loginPath: string;
  logoutPath: string;
  setupPath: string;
  rootPath: string;
  url: string;
}) {
  const { assetPaths, buildComponentPath, loginPath, logoutPath, setupPath, rootPath, url } = args;

  if (!url.startsWith(rootPath)) {
    return true;
  }

  if (url.startsWith(loginPath) || url.startsWith(logoutPath) || url.startsWith(setupPath)) {
    return true;
  }

  if (assetPaths.some((assetPath) => url.startsWith(`${rootPath}${assetPath}`))) {
    return true;
  }

  if (buildComponentPath && url.startsWith(`${rootPath}${buildComponentPath}`)) {
    return true;
  }

  return false;
}
