import type { DesktopSnapshot } from "@slate/shared";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { AiSettingsSection } from "./AiSettingsSection";

export type ConnectionStatus = "idle" | "testing" | "success" | "error";

export type SettingsSectionId = "workspace" | "backend" | "authentication" | "ai";

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
  onFullSync: () => Promise<void>;
  fullSyncing: boolean;
}

function validateBackendEndpoint(raw: string): string | null {
  const t = raw.trim();
  if (!t) return "Enter a server address.";
  if (/\s/.test(t)) return "Remove spaces from the address.";
  if (t.length > 512) return "Address is too long.";
  if (/^https?:\/\//i.test(t)) {
    try {
      const u = new URL(t);
      if (!u.hostname) return "Enter a valid URL with a host.";
      return null;
    } catch {
      return "That URL doesn't look valid.";
    }
  }
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}(:\d{1,5})?$/;
  const ipv6 = /^\[[0-9a-fA-F:]+\](:\d{1,5})?$/;
  const namedHost =
    /^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?(:\d{1,5})?$|^localhost(:\d{1,5})?$/;
  if (!ipv4.test(t) && !ipv6.test(t) && !namedHost.test(t)) {
    return "Use host:port (e.g. localhost:50051) or a full URL.";
  }
  const portMatch = t.match(/:(\d+)$/);
  if (portMatch) {
    const n = Number(portMatch[1]);
    if (n < 1 || n > 65535) return "Port must be between 1 and 65535.";
  }
  return null;
}

function validateLoginEmail(raw: string): string | null {
  const t = raw.trim();
  if (!t) return "Email is required.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return "Enter a valid email address.";
  return null;
}

function validateLoginPassword(raw: string): string | null {
  if (!raw) return "Password is required.";
  return null;
}

function SettingsFieldError({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} className="settings-field__error" role="alert">
      {message}
    </p>
  );
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
  onFullSync,
  fullSyncing,
}: SettingsDialogProps) {
  const baseId = useId();
  const panelId = `${baseId}-panel`;
  const endpointId = `${baseId}-endpoint`;
  const endpointErrorId = `${baseId}-endpoint-err`;
  const authEmailId = `${baseId}-auth-email`;
  const authEmailErrorId = `${baseId}-auth-email-err`;
  const authPasswordId = `${baseId}-auth-password`;
  const authPasswordErrorId = `${baseId}-auth-password-err`;

  const showAuthSection = snapshot.backend.backendReachable;

  const sections = useMemo(() => {
    const list: { id: SettingsSectionId; label: string }[] = [
      { id: "workspace", label: "Workspace" },
      { id: "backend", label: "Backend" },
    ];
    if (showAuthSection) {
      list.push({ id: "authentication", label: "Authentication" });
    }
    list.push({ id: "ai", label: "AI chat" });
    return list;
  }, [showAuthSection]);

  const [activeSection, setActiveSection] = useState<SettingsSectionId>("workspace");

  const [endpointBlurred, setEndpointBlurred] = useState(false);
  const [endpointActionAttempted, setEndpointActionAttempted] = useState(false);
  const [authEmailBlurred, setAuthEmailBlurred] = useState(false);
  const [authPasswordBlurred, setAuthPasswordBlurred] = useState(false);
  const [loginAttempted, setLoginAttempted] = useState(false);

  useEffect(() => {
    if (!open) return;
    setActiveSection("workspace");
    setEndpointBlurred(false);
    setEndpointActionAttempted(false);
    setAuthEmailBlurred(false);
    setAuthPasswordBlurred(false);
    setLoginAttempted(false);
  }, [open]);

  useEffect(() => {
    if (!showAuthSection && activeSection === "authentication") {
      setActiveSection("backend");
    }
  }, [showAuthSection, activeSection]);

  const resolvedSection: SettingsSectionId =
    activeSection === "authentication" && !showAuthSection ? "backend" : activeSection;

  const focusTab = useCallback(
    (id: SettingsSectionId) => {
      queueMicrotask(() => {
        document.getElementById(`${baseId}-tab-${id}`)?.focus();
      });
    },
    [baseId],
  );

  const goTab = useCallback(
    (id: SettingsSectionId) => {
      setActiveSection(id);
      focusTab(id);
    },
    [focusTab],
  );

  function handleNavKeyDown(event: React.KeyboardEvent<HTMLUListElement>) {
    const idx = sections.findIndex((s) => s.id === resolvedSection);
    if (idx < 0) return;

    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      const next = sections[(idx + 1) % sections.length];
      goTab(next.id);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      const next = sections[(idx - 1 + sections.length) % sections.length];
      goTab(next.id);
    } else if (event.key === "Home") {
      event.preventDefault();
      goTab(sections[0].id);
    } else if (event.key === "End") {
      event.preventDefault();
      goTab(sections[sections.length - 1].id);
    }
  }

  function handleOpenChange(next: boolean) {
    if (workspaceLoading || authSubmitting) return;
    if (next) {
      onBackendEndpointChange(snapshot.backend.endpoint);
    }
    onOpenChange(next);
  }

  const endpointError = useMemo(() => validateBackendEndpoint(backendEndpoint), [backendEndpoint]);
  const showEndpointError = Boolean(endpointError && (endpointBlurred || endpointActionAttempted));

  const emailError = useMemo(() => validateLoginEmail(authEmail), [authEmail]);
  const passwordError = useMemo(() => validateLoginPassword(authPassword), [authPassword]);
  const showEmailError = Boolean(emailError && (authEmailBlurred || loginAttempted));
  const showPasswordError = Boolean(passwordError && (authPasswordBlurred || loginAttempted));

  const endpointValid = endpointError === null;
  const canSaveEndpoint =
    endpointValid &&
    backendEndpoint.trim() &&
    (backendEndpoint.trim() !== snapshot.backend.endpoint || connectionStatus === "success");

  const passwordProvider = snapshot.backend.authProviders.find((provider) => provider.type === "password");
  const oidcProviders = snapshot.backend.authProviders.filter((provider) => provider.type === "oidc");
  const passwordAuthAvailable = Boolean(passwordProvider);
  const isAuthenticated = snapshot.backend.authStatus === "authenticated";

  const displayName = snapshot.backend.authenticatedDisplayName?.trim();
  const accountEmail = snapshot.backend.authenticatedEmail?.trim();

  function handleTestConnectionClick() {
    setEndpointActionAttempted(true);
    if (validateBackendEndpoint(backendEndpoint)) return;
    void onTestConnection();
  }

  function handleSaveEndpointClick() {
    setEndpointActionAttempted(true);
    if (validateBackendEndpoint(backendEndpoint)) return;
    void onSaveEndpoint();
  }

  function handleLoginSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoginAttempted(true);
    if (validateLoginEmail(authEmail) || validateLoginPassword(authPassword)) return;
    void onLogin();
  }

  let panelTitle = "Workspace";
  if (resolvedSection === "backend") panelTitle = "Backend";
  else if (resolvedSection === "authentication") panelTitle = "Authentication";
  else if (resolvedSection === "ai") panelTitle = "AI chat";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="settings-dialog">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <div className="settings-dialog__body">
          <nav className="settings-dialog__nav" aria-label="Settings categories">
            <ul
              className="settings-dialog__nav-list"
              role="tablist"
              aria-orientation="vertical"
              onKeyDown={handleNavKeyDown}
            >
              {sections.map(({ id, label }) => (
                <li key={id} className="settings-dialog__nav-item" role="presentation">
                  <button
                    type="button"
                    role="tab"
                    id={`${baseId}-tab-${id}`}
                    aria-selected={resolvedSection === id}
                    aria-controls={panelId}
                    tabIndex={resolvedSection === id ? 0 : -1}
                    className={`settings-dialog__nav-btn${resolvedSection === id ? " is-active" : ""}`}
                    onClick={() => setActiveSection(id)}
                  >
                    {label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div
            role="tabpanel"
            id={panelId}
            aria-labelledby={`${baseId}-tab-${resolvedSection}`}
            tabIndex={0}
            className="settings-dialog__detail"
          >
            <div className="settings-dialog__detail-scroll">
              <div key={resolvedSection} className="settings-dialog__tabpanel-inner settings-section--enter">
                <section className="settings-section" aria-labelledby={`${baseId}-panel-heading`}>
                  <h2 id={`${baseId}-panel-heading`} className="settings-section__title">
                    {panelTitle}
                  </h2>

                  <div className="settings-panel">
                    {resolvedSection === "workspace" ? (
                      <>
                        <div className="settings-field">
                          <div className="settings-field__label">Root folder</div>
                          <div className="settings-field__value settings-field__value--mono">
                            {snapshot.workspace.rootPath}
                          </div>
                        </div>

                        <Button variant="secondary" onClick={() => void onChooseWorkspace()} disabled={workspaceLoading}>
                          {workspaceLoading ? "Loading…" : "Choose root folder"}
                        </Button>

                        {workspaceStatus ? (
                          <div className="settings-status settings-status--enter">
                            <div className="settings-status__label">{workspaceStatus}</div>
                            <div className="settings-status__bar">
                              <div
                                className={`settings-status__fill ${workspaceLoading ? "is-loading" : "is-complete"}`}
                              />
                            </div>
                          </div>
                        ) : null}
                      </>
                    ) : null}

                    {resolvedSection === "backend" ? (
                      <>
                        <div className="settings-field">
                          <label htmlFor={endpointId} className="settings-field__label">
                            Server URL
                          </label>
                          <input
                            id={endpointId}
                            className={`ui-input ui-input--bordered${showEndpointError ? " ui-input--invalid" : ""}`}
                            value={backendEndpoint}
                            onChange={(e) => onBackendEndpointChange(e.target.value)}
                            onBlur={() => setEndpointBlurred(true)}
                            placeholder="localhost:50051"
                            autoComplete="off"
                            spellCheck={false}
                            aria-invalid={showEndpointError}
                            aria-describedby={showEndpointError ? endpointErrorId : undefined}
                          />
                          {showEndpointError ? (
                            <SettingsFieldError id={endpointErrorId} message={endpointError!} />
                          ) : null}
                          <p className="settings-field__hint">Host and port, or a full http(s) URL.</p>
                        </div>

                        <div className="settings-field__row">
                          <Button
                            variant="secondary"
                            onClick={handleTestConnectionClick}
                            disabled={connectionStatus === "testing" || !backendEndpoint.trim()}
                          >
                            {connectionStatus === "testing" ? "Testing…" : "Test connection"}
                          </Button>
                          <Button variant="primary" onClick={handleSaveEndpointClick} disabled={!canSaveEndpoint}>
                            Save
                          </Button>
                        </div>

                        {connectionStatus === "success" ? (
                          <div
                            className="settings-connection settings-connection--success settings-banner--enter"
                            role="status"
                          >
                            Backend reachable
                          </div>
                        ) : null}

                        {connectionStatus === "error" ? (
                          <div
                            className="settings-connection settings-connection--error settings-banner--enter"
                            role="alert"
                          >
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

                        {isAuthenticated ? (
                          <Button variant="secondary" onClick={() => void onFullSync()} disabled={fullSyncing}>
                            {fullSyncing ? "Syncing…" : "Force full sync"}
                          </Button>
                        ) : null}
                      </>
                    ) : null}

                    {resolvedSection === "authentication" ? (
                      <>
                        {isAuthenticated ? (
                          <div className="settings-auth-card settings-auth-card--enter">
                            <div className="settings-auth-card__headline">
                              {displayName || accountEmail || "Signed in"}
                            </div>
                            {displayName && accountEmail && displayName !== accountEmail ? (
                              <div className="settings-auth-card__copy">{accountEmail}</div>
                            ) : displayName && !accountEmail ? (
                              <div className="settings-auth-card__copy">Session active</div>
                            ) : !displayName && !accountEmail ? (
                              <div className="settings-auth-card__copy">Session active</div>
                            ) : null}
                            <Button variant="secondary" onClick={() => void onSignOut()} disabled={authSubmitting}>
                              Sign out
                            </Button>
                          </div>
                        ) : passwordAuthAvailable || oidcProviders.length > 0 ? (
                          <>
                            {oidcProviders.length > 0 ? (
                              <div className="settings-auth-form">
                                <div className="settings-field__label">Single sign-on</div>
                                <div className="settings-field__row settings-field__row--wrap">
                                  {oidcProviders.map((provider) => (
                                    <Button
                                      key={provider.id}
                                      variant="secondary"
                                      onClick={() => void onLoginWithOidc(provider.id)}
                                      disabled={authSubmitting}
                                    >
                                      {authSubmitting ? "Waiting for browser…" : `Continue with ${provider.label}`}
                                    </Button>
                                  ))}
                                  {authSubmitting ? (
                                    <Button variant="secondary" type="button" onClick={onCancelOidc}>
                                      Cancel
                                    </Button>
                                  ) : null}
                                </div>
                              </div>
                            ) : null}

                            {passwordAuthAvailable ? (
                              <form className="settings-auth-form" onSubmit={handleLoginSubmit} noValidate>
                                <div className="settings-field">
                                  <label htmlFor={authEmailId} className="settings-field__label">
                                    Email
                                  </label>
                                  <input
                                    id={authEmailId}
                                    className={`ui-input ui-input--bordered${showEmailError ? " ui-input--invalid" : ""}`}
                                    type="email"
                                    autoComplete="username"
                                    inputMode="email"
                                    value={authEmail}
                                    onChange={(event) => onAuthEmailChange(event.target.value)}
                                    onBlur={() => setAuthEmailBlurred(true)}
                                    placeholder="you@example.com"
                                    aria-invalid={showEmailError}
                                    aria-describedby={showEmailError ? authEmailErrorId : undefined}
                                  />
                                  {showEmailError ? (
                                    <SettingsFieldError id={authEmailErrorId} message={emailError!} />
                                  ) : null}
                                </div>

                                <div className="settings-field">
                                  <label htmlFor={authPasswordId} className="settings-field__label">
                                    Password
                                  </label>
                                  <input
                                    id={authPasswordId}
                                    className={`ui-input ui-input--bordered${showPasswordError ? " ui-input--invalid" : ""}`}
                                    type="password"
                                    autoComplete="current-password"
                                    value={authPassword}
                                    onChange={(event) => onAuthPasswordChange(event.target.value)}
                                    onBlur={() => setAuthPasswordBlurred(true)}
                                    placeholder="Password"
                                    aria-invalid={showPasswordError}
                                    aria-describedby={showPasswordError ? authPasswordErrorId : undefined}
                                  />
                                  {showPasswordError ? (
                                    <SettingsFieldError id={authPasswordErrorId} message={passwordError!} />
                                  ) : null}
                                </div>

                                <p className="settings-field__hint">
                                  Account creation is managed by an administrator through the admin portal.
                                </p>

                                <Button
                                  variant="primary"
                                  type="submit"
                                  disabled={authSubmitting || !authEmail.trim() || !authPassword}
                                >
                                  {authSubmitting ? "Signing in…" : "Sign in with password"}
                                </Button>
                              </form>
                            ) : null}
                          </>
                        ) : (
                          <p className="settings-field__value">
                            No password authentication provider is available on this backend.
                          </p>
                        )}

                        {authError ? (
                          <div
                            className="settings-connection settings-connection--error settings-banner--enter"
                            role="alert"
                          >
                            {authError}
                          </div>
                        ) : null}
                      </>
                    ) : null}

                    {resolvedSection === "ai" ? (
                      <AiSettingsSection isAuthenticated={snapshot.backend?.authStatus === "authenticated"} />
                    ) : null}
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
