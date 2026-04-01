import type { DesktopSnapshot } from "@slate/shared";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { AiSettingsSection } from "./AiSettingsSection";
import { useKeyboardShortcuts } from "../lib/shortcuts";

export type ConnectionStatus = "idle" | "testing" | "success" | "error";

export type SettingsSectionId = "workspace" | "backend" | "authentication" | "ai" | "shortcuts";

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
  const namedHost = /^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?(:\d{1,5})?$|^localhost(:\d{1,5})?$/;
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

const bannerEnter =
  "motion-safe:animate-[settings-banner-enter_0.28s_cubic-bezier(0.22,1,0.36,1)_both] motion-reduce:animate-none";

function SettingsFieldError({ id, message }: { id: string; message: string }) {
  return (
    <p
      id={id}
      className="m-0 text-[0.78rem] leading-snug text-danger motion-safe:animate-[settings-field-error-in_0.22s_cubic-bezier(0.22,1,0.36,1)] motion-reduce:animate-none"
      role="alert"
    >
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
    list.push({ id: "shortcuts", label: "Shortcuts" });
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

  const passwordProvider = snapshot.backend.authProviders.find(
    (provider) => provider.type === "password",
  );
  const oidcProviders = snapshot.backend.authProviders.filter(
    (provider) => provider.type === "oidc",
  );
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
      <DialogContent
        className={cn(
          "flex h-[min(82vh,760px)] max-h-[min(82vh,760px)] !w-[min(880px,calc(100vw-40px))] flex-col overflow-hidden !p-[22px] !pb-0",
          "max-[640px]:!w-[min(720px,calc(100vw-24px))]",
        )}
      >
        <DialogHeader className="shrink-0 pr-9">
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <div className="m-[0_-6px_0_-2px] flex min-h-0 flex-1 gap-0 pb-5 max-[640px]:m-0 max-[640px]:flex-col max-[640px]:pb-4">
          <nav
            className="min-w-0 shrink-0 basis-[200px] border-r border-border-soft py-1 pr-3 pb-2 pl-0.5 max-[640px]:basis-auto max-[640px]:w-full max-[640px]:border-b max-[640px]:border-r-0 max-[640px]:px-0.5 max-[640px]:pb-3 max-[640px]:pt-0"
            aria-label="Settings categories"
          >
            <ul
              className="list-none m-0 flex flex-col gap-1 p-0 max-[640px]:flex-row max-[640px]:flex-wrap max-[640px]:gap-1.5"
              role="tablist"
              aria-orientation="vertical"
              onKeyDown={handleNavKeyDown}
            >
              {sections.map(({ id, label }) => (
                <li key={id} className="m-0" role="presentation">
                  <button
                    type="button"
                    role="tab"
                    id={`${baseId}-tab-${id}`}
                    aria-selected={resolvedSection === id}
                    aria-controls={panelId}
                    tabIndex={resolvedSection === id ? 0 : -1}
                    className={cn(
                      "block w-full cursor-pointer rounded-[10px] border border-transparent bg-transparent py-2.5 px-3 text-left text-[0.9rem] font-medium text-muted transition-[background-color,color,border-color] duration-150 ease-out hover:bg-white/[0.05] hover:text-foreground focus-visible:border-white/20 focus-visible:shadow-[0_0_0_3px_rgba(255,255,255,0.08)] focus-visible:outline-none",
                      resolvedSection === id &&
                        "border-white/[0.08] bg-white/[0.08] text-foreground",
                      "max-[640px]:w-auto max-[640px]:px-3 max-[640px]:py-2 max-[640px]:text-[0.84rem]",
                    )}
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
            className="flex min-h-0 min-w-0 flex-1 flex-col pl-4 outline-none focus-visible:rounded-xl focus-visible:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] max-[640px]:pl-0.5 max-[640px]:pt-3"
          >
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-1 py-1 pb-2 [scrollbar-color:rgba(255,255,255,0.12)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/12 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-2">
              <div
                key={resolvedSection}
                className="motion-safe:animate-[settings-section-enter_0.32s_cubic-bezier(0.22,1,0.36,1)_backwards] motion-reduce:animate-none"
              >
                <section
                  className="flex flex-col gap-2"
                  aria-labelledby={`${baseId}-panel-heading`}
                >
                  <h2
                    id={`${baseId}-panel-heading`}
                    className="m-0 text-[0.82rem] font-semibold uppercase tracking-[0.04em] text-faint"
                  >
                    {panelTitle}
                  </h2>

                  <div className="grid gap-4 px-0.5 pb-24">
                    {resolvedSection === "workspace" ? (
                      <>
                        <div className="grid gap-1.5">
                          <div className="text-[0.84rem] text-muted">Root folder</div>
                          <div className="break-words font-[ui-monospace,'SF_Mono',SFMono-Regular,Menlo,Monaco,Consolas,monospace] text-[0.86rem] leading-snug text-muted">
                            {snapshot.workspace.rootPath}
                          </div>
                        </div>

                        <Button
                          variant="secondary"
                          onClick={() => void onChooseWorkspace()}
                          disabled={workspaceLoading}
                        >
                          {workspaceLoading ? "Loading…" : "Choose root folder"}
                        </Button>

                        {workspaceStatus ? (
                          <div
                            className={cn(
                              "grid gap-2",
                              "motion-safe:animate-[settings-banner-enter_0.28s_cubic-bezier(0.22,1,0.36,1)_both] motion-reduce:animate-none",
                            )}
                          >
                            <div className="text-[0.88rem] text-muted">{workspaceStatus}</div>
                            <div className="h-2 overflow-hidden rounded-full bg-white/[0.08]">
                              <div
                                className={cn(
                                  "h-full rounded-full bg-white/70",
                                  workspaceLoading
                                    ? "w-[35%] motion-safe:animate-[settings-progress_1.1s_linear_infinite] motion-reduce:animate-none"
                                    : "w-full",
                                )}
                              />
                            </div>
                          </div>
                        ) : null}
                      </>
                    ) : null}

                    {resolvedSection === "backend" ? (
                      <>
                        <div className="grid gap-1.5">
                          <label htmlFor={endpointId} className="text-[0.84rem] text-muted">
                            Server URL
                          </label>
                          <Input
                            id={endpointId}
                            variant="bordered"
                            invalid={showEndpointError}
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
                          <p className="m-0 text-[0.78rem] leading-snug text-faint">
                            Host and port, or a full http(s) URL.
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <Button
                            variant="secondary"
                            onClick={handleTestConnectionClick}
                            disabled={connectionStatus === "testing" || !backendEndpoint.trim()}
                          >
                            {connectionStatus === "testing" ? "Testing…" : "Test connection"}
                          </Button>
                          <Button
                            variant="primary"
                            onClick={handleSaveEndpointClick}
                            disabled={!canSaveEndpoint}
                          >
                            Save
                          </Button>
                        </div>

                        {connectionStatus === "success" ? (
                          <div
                            className={cn(
                              "rounded-lg px-3 py-2 text-[0.84rem] bg-[rgba(40,200,64,0.12)] text-[#6fcf7f]",
                              bannerEnter,
                            )}
                            role="status"
                          >
                            Backend reachable
                          </div>
                        ) : null}

                        {connectionStatus === "error" ? (
                          <div
                            className={cn(
                              "rounded-lg px-3 py-2 text-[0.84rem] bg-[rgba(255,146,136,0.12)] text-danger",
                              bannerEnter,
                            )}
                            role="alert"
                          >
                            {connectionError || "Could not reach server"}
                          </div>
                        ) : null}

                        <div className="grid gap-1.5">
                          <div className="text-[0.84rem] text-muted">Status</div>
                          <div className="break-words text-[0.94rem] text-foreground">
                            {!snapshot.backend.backendReachable
                              ? "Offline"
                              : isAuthenticated
                                ? "Logged in"
                                : "Connected, sign in required"}
                          </div>
                        </div>

                        {isAuthenticated ? (
                          <Button
                            variant="secondary"
                            onClick={() => void onFullSync()}
                            disabled={fullSyncing}
                          >
                            {fullSyncing ? "Syncing…" : "Force full sync"}
                          </Button>
                        ) : null}
                      </>
                    ) : null}

                    {resolvedSection === "authentication" ? (
                      <>
                        {isAuthenticated ? (
                          <div
                            className={cn(
                              "grid gap-2 rounded-[14px] border border-white/[0.06] bg-white/[0.04] p-3.5",
                              "motion-safe:animate-[settings-banner-enter_0.32s_cubic-bezier(0.22,1,0.36,1)_both] motion-reduce:animate-none",
                            )}
                          >
                            <div className="text-[0.96rem] font-semibold text-foreground">
                              {displayName || accountEmail || "Signed in"}
                            </div>
                            {displayName && accountEmail && displayName !== accountEmail ? (
                              <div className="text-[0.88rem] text-muted">{accountEmail}</div>
                            ) : displayName && !accountEmail ? (
                              <div className="text-[0.88rem] text-muted">Session active</div>
                            ) : !displayName && !accountEmail ? (
                              <div className="text-[0.88rem] text-muted">Session active</div>
                            ) : null}
                            <Button
                              variant="secondary"
                              onClick={() => void onSignOut()}
                              disabled={authSubmitting}
                            >
                              Sign out
                            </Button>
                          </div>
                        ) : passwordAuthAvailable || oidcProviders.length > 0 ? (
                          <>
                            {oidcProviders.length > 0 ? (
                              <div className="grid gap-3">
                                <div className="text-[0.84rem] text-muted">Single sign-on</div>
                                <div className="flex flex-wrap items-center gap-2">
                                  {oidcProviders.map((provider) => (
                                    <Button
                                      key={provider.id}
                                      variant="secondary"
                                      onClick={() => void onLoginWithOidc(provider.id)}
                                      disabled={authSubmitting}
                                    >
                                      {authSubmitting
                                        ? "Waiting for browser…"
                                        : `Continue with ${provider.label}`}
                                    </Button>
                                  ))}
                                  {authSubmitting ? (
                                    <Button
                                      variant="secondary"
                                      type="button"
                                      onClick={onCancelOidc}
                                    >
                                      Cancel
                                    </Button>
                                  ) : null}
                                </div>
                              </div>
                            ) : null}

                            {passwordAuthAvailable ? (
                              <form className="grid gap-3" onSubmit={handleLoginSubmit} noValidate>
                                <div className="grid gap-1.5">
                                  <label
                                    htmlFor={authEmailId}
                                    className="text-[0.84rem] text-muted"
                                  >
                                    Email
                                  </label>
                                  <Input
                                    id={authEmailId}
                                    variant="bordered"
                                    invalid={showEmailError}
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
                                    <SettingsFieldError
                                      id={authEmailErrorId}
                                      message={emailError!}
                                    />
                                  ) : null}
                                </div>

                                <div className="grid gap-1.5">
                                  <label
                                    htmlFor={authPasswordId}
                                    className="text-[0.84rem] text-muted"
                                  >
                                    Password
                                  </label>
                                  <Input
                                    id={authPasswordId}
                                    variant="bordered"
                                    invalid={showPasswordError}
                                    type="password"
                                    autoComplete="current-password"
                                    value={authPassword}
                                    onChange={(event) => onAuthPasswordChange(event.target.value)}
                                    onBlur={() => setAuthPasswordBlurred(true)}
                                    placeholder="Password"
                                    aria-invalid={showPasswordError}
                                    aria-describedby={
                                      showPasswordError ? authPasswordErrorId : undefined
                                    }
                                  />
                                  {showPasswordError ? (
                                    <SettingsFieldError
                                      id={authPasswordErrorId}
                                      message={passwordError!}
                                    />
                                  ) : null}
                                </div>

                                <p className="m-0 text-[0.78rem] leading-snug text-faint">
                                  Account creation is managed by an administrator through the admin
                                  portal.
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
                          <p className="break-words text-[0.94rem] text-foreground">
                            No password authentication provider is available on this backend.
                          </p>
                        )}

                        {authError ? (
                          <div
                            className={cn(
                              "rounded-lg px-3 py-2 text-[0.84rem] bg-[rgba(255,146,136,0.12)] text-danger",
                              bannerEnter,
                            )}
                            role="alert"
                          >
                            {authError}
                          </div>
                        ) : null}
                      </>
                    ) : null}

                    {resolvedSection === "ai" ? (
                      <AiSettingsSection
                        isAuthenticated={snapshot.backend?.authStatus === "authenticated"}
                      />
                    ) : null}

                    {resolvedSection === "shortcuts" ? <KeyboardShortcutsSection /> : null}
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

const isMac = typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");

const SHORTCUT_LABELS: Record<string, string> = {
  "command-bar": "Command bar",
  "find-in-note": "Find in note",
  "new-note": "New note / event",
  "toggle-sidebar": "Toggle sidebar",
};

export function formatShortcut(shortcut: string): string {
  return shortcut
    .split("+")
    .map((part) => {
      const p = part.toLowerCase();
      if (p === "mod") return isMac ? "\u2318" : "Ctrl";
      if (p === "shift") return isMac ? "\u21E7" : "Shift";
      if (p === "alt") return isMac ? "\u2325" : "Alt";
      return p.toUpperCase();
    })
    .join(isMac ? "" : "+");
}

function KeyboardShortcutsSection() {
  const { shortcuts } = useKeyboardShortcuts();

  return (
    <div className="grid gap-4">
      <p className="text-[0.84rem] text-muted">Keyboard shortcuts used throughout the app.</p>
      <table className="w-full text-[0.84rem]">
        <thead>
          <tr className="border-b border-border-soft text-left text-muted">
            <th className="pb-2 font-medium">Action</th>
            <th className="pb-2 text-right font-medium">Shortcut</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(shortcuts).map(([action, shortcut]) => (
            <tr key={action} className="border-b border-border-soft/50">
              <td className="py-2 text-foreground">{SHORTCUT_LABELS[action] ?? action}</td>
              <td className="py-2 text-right">
                <kbd className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[0.78rem] text-muted">
                  {formatShortcut(shortcut)}
                </kbd>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
