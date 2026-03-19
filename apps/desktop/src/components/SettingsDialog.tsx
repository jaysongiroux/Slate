import type { DesktopSnapshot } from "@slate/shared/index";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Separator } from "./ui/separator";

export type ConnectionStatus = "idle" | "testing" | "success" | "error";

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: DesktopSnapshot;
  backendEndpoint: string;
  onBackendEndpointChange: (value: string) => void;
  workspaceLoading: boolean;
  workspaceStatus: string;
  connectionStatus: ConnectionStatus;
  connectionError: string;
  authEmail: string;
  authPassword: string;
  onAuthEmailChange: (value: string) => void;
  onAuthPasswordChange: (value: string) => void;
  authSubmitting: boolean;
  authError: string;
  onChooseWorkspace: () => Promise<void>;
  onTestConnection: () => Promise<void>;
  onSaveEndpoint: () => Promise<void>;
  onLogin: () => Promise<void>;
  onLoginWithOidc: (providerId: string) => Promise<void>;
  onCancelOidc: () => void;
  onSignOut: () => Promise<void>;
}

export function SettingsDialog({
  open,
  onOpenChange,
  snapshot,
  backendEndpoint,
  onBackendEndpointChange,
  workspaceLoading,
  workspaceStatus,
  connectionStatus,
  connectionError,
  authEmail,
  authPassword,
  onAuthEmailChange,
  onAuthPasswordChange,
  authSubmitting,
  authError,
  onChooseWorkspace,
  onTestConnection,
  onSaveEndpoint,
  onLogin,
  onLoginWithOidc,
  onCancelOidc,
  onSignOut,
}: SettingsDialogProps) {
  function handleOpenChange(next: boolean) {
    if (workspaceLoading || authSubmitting) return;
    if (next) {
      onBackendEndpointChange(snapshot.backend.endpoint);
    }
    onOpenChange(next);
  }

  const passwordProvider = snapshot.backend.authProviders.find((provider) => provider.type === "password");
  const oidcProviders = snapshot.backend.authProviders.filter((provider) => provider.type === "oidc");
  const passwordAuthAvailable = Boolean(passwordProvider);
  const isAuthenticated = snapshot.backend.authStatus === "authenticated";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="settings-dialog">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Manage your workspace and backend sync.</DialogDescription>
        </DialogHeader>

        <div className="settings-dialog__scroll">
          <div className="settings-panel">
            <div className="settings-section__title">Workspace</div>
            <div className="settings-field">
              <div className="settings-field__label">Root folder</div>
              <div className="settings-field__value">{snapshot.workspace.rootPath}</div>
            </div>

            <Button variant="secondary" onClick={() => void onChooseWorkspace()} disabled={workspaceLoading}>
              {workspaceLoading ? "Loading..." : "Choose root folder"}
            </Button>

            {workspaceStatus ? (
              <div className="settings-status">
                <div className="settings-status__label">{workspaceStatus}</div>
                <div className="settings-status__bar">
                  <div className={`settings-status__fill ${workspaceLoading ? "is-loading" : "is-complete"}`} />
                </div>
              </div>
            ) : null}

            <Separator />

            <div className="settings-section__title">Backend</div>
            <div className="settings-field">
              <div className="settings-field__label">Server URL</div>
              <input
                className="ui-input ui-input--bordered"
                value={backendEndpoint}
                onChange={(e) => {
                  onBackendEndpointChange(e.target.value);
                }}
                placeholder="your-server.example.com:50051"
              />
            </div>

            <div className="settings-field__row">
              <Button variant="secondary" onClick={() => void onTestConnection()} disabled={connectionStatus === "testing"}>
                {connectionStatus === "testing" ? "Testing..." : "Test connection"}
              </Button>
              <Button
                variant="primary"
                onClick={() => void onSaveEndpoint()}
                disabled={
                  !backendEndpoint.trim() ||
                  (backendEndpoint.trim() === snapshot.backend.endpoint && connectionStatus !== "success")
                }
              >
                Save
              </Button>
            </div>

            {connectionStatus === "success" ? (
              <div className="settings-connection settings-connection--success">Backend reachable</div>
            ) : null}

            {connectionStatus === "error" ? (
              <div className="settings-connection settings-connection--error">
                {connectionError || "Could not reach server"}
              </div>
            ) : null}

            <div className="settings-field">
              <div className="settings-field__label">Status</div>
              <div className="settings-field__value">
                {!snapshot.backend.backendReachable
                  ? "Offline"
                  : isAuthenticated
                    ? "Logged in"
                    : "Connected, sign in required"}
              </div>
            </div>

            {!snapshot.backend.backendReachable ? null : (
              <>
                <Separator />
                <div className="settings-section__title">Authentication</div>

                {isAuthenticated ? (
                  <div className="settings-auth-card">
                    <div className="settings-auth-card__headline">
                      {snapshot.backend.authenticatedDisplayName || snapshot.backend.authenticatedEmail || "Logged in"}
                    </div>
                    <div className="settings-auth-card__copy">
                      {snapshot.backend.authenticatedEmail || "Session active"}
                    </div>
                    <div className="settings-auth-card__copy">
                      {snapshot.backend.authenticatedWorkspaceName || "Workspace linked"}
                    </div>
                    <Button variant="secondary" onClick={() => void onSignOut()} disabled={authSubmitting}>
                      Sign out
                    </Button>
                  </div>
                ) : passwordAuthAvailable || oidcProviders.length > 0 ? (
                  <>
                    {oidcProviders.length > 0 ? (
                      <div className="settings-auth-form">
                        <div className="settings-field__label">Single Sign-On</div>
                        <div className="settings-field__row">
                          {oidcProviders.map((provider) => (
                            <Button
                              key={provider.id}
                              variant="secondary"
                              onClick={() => void onLoginWithOidc(provider.id)}
                              disabled={authSubmitting}
                            >
                              {authSubmitting ? "Waiting for browser..." : `Continue with ${provider.label}`}
                            </Button>
                          ))}
                          {authSubmitting ? (
                            <Button variant="secondary" onClick={onCancelOidc}>
                              Cancel
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    {passwordAuthAvailable ? (
                      <form
                        className="settings-auth-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void onLogin();
                        }}
                      >
                        <div className="settings-field">
                          <div className="settings-field__label">Email</div>
                          <input
                            className="ui-input ui-input--bordered"
                            type="email"
                            autoComplete="username"
                            value={authEmail}
                            onChange={(event) => onAuthEmailChange(event.target.value)}
                            placeholder="you@example.com"
                          />
                        </div>

                        <div className="settings-field">
                          <div className="settings-field__label">Password</div>
                          <input
                            className="ui-input ui-input--bordered"
                            type="password"
                            autoComplete="current-password"
                            value={authPassword}
                            onChange={(event) => onAuthPasswordChange(event.target.value)}
                            placeholder="Password"
                          />
                        </div>

                        <div className="settings-field__value">
                          Account creation is managed by an administrator through the admin portal.
                        </div>

                        <Button
                          variant="primary"
                          type="submit"
                          disabled={authSubmitting || !authEmail.trim() || !authPassword}
                        >
                          {authSubmitting ? "Signing in..." : "Sign in with password"}
                        </Button>
                      </form>
                    ) : null}
                  </>
                ) : (
                  <div className="settings-field__value">No password authentication provider is available on this backend.</div>
                )}

                {authError ? <div className="settings-connection settings-connection--error">{authError}</div> : null}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
