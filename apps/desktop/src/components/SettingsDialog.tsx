import type { DesktopSnapshot } from "@slate/shared";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import type { MarkdownImportResult } from "../lib/api/ipc-core";
import { cn } from "../lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { AiSettingsSection } from "./AiSettingsSection";
import type { CalendarReminderSettings } from "../lib/api";
import { StorageSection } from "./settings/StorageSection";
import { ServerSection } from "./settings/ServerSection";
import { CalendarSection } from "./settings/CalendarSection";
import { AuthenticationSection } from "./settings/AuthenticationSection";
import { KeyboardShortcutsSection } from "./settings/KeyboardShortcutsSection";
import { ExtensionsSection } from "./settings/ExtensionsSection";
import { AppSettingsSection } from "./settings/AppSettingsSection";
import { ServerMigrationDialog } from "./settings/ServerMigrationDialog";

// Re-export formatShortcut so existing consumers keep working
export { formatShortcut } from "./settings/KeyboardShortcutsSection";

export type ConnectionStatus = "idle" | "testing" | "success" | "error";

export type SettingsSectionId =
  | "storage"
  | "calendar"
  | "server"
  | "authentication"
  | "extensions"
  | "ai"
  | "shortcuts"
  | "app-settings";

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  focus?: string;
  snapshot: DesktopSnapshot;
  notes: Array<{ id: string; isDeleted?: boolean; isTemplate?: boolean; [key: string]: any }>;
  folders: string[];
  backendEndpoint: string;
  onBackendEndpointChange: (value: string) => void;
  connectionStatus: ConnectionStatus;
  connectionError: string;
  authEmail: string;
  authPassword: string;
  onAuthEmailChange: (value: string) => void;
  onAuthPasswordChange: (value: string) => void;
  authSubmitting: boolean;
  authError: string;
  calendarReminderSettings: CalendarReminderSettings;
  calendarReminderSources: { id: string; name: string; color: string }[];
  onCalendarReminderSettingsChange: (value: CalendarReminderSettings) => void;
  onTestConnection: () => Promise<void>;
  onSaveEndpoint: () => Promise<void>;
  onLogin: () => Promise<void>;
  onLoginWithOidc: (providerId: string) => Promise<void>;
  onCancelOidc: () => void;
  onSignOut: () => Promise<void>;
  onFullSync: () => Promise<void>;
  onResetFromServer: () => Promise<void>;
  fullSyncing: boolean;
  onImportFolder?: () => Promise<MarkdownImportResult | null>;
  onImportFiles?: () => Promise<MarkdownImportResult | null>;
  onExportNotes?: () => void;
}

function validateBackendEndpoint(raw: string): string | null {
  const t = raw.trim();
  if (!t) return "Enter an API endpoint.";
  if (/\s/.test(t)) return "Remove spaces from the address.";
  if (t.length > 512) return "Address is too long.";
  if (!/^https?:\/\//i.test(t)) {
    return "Enter a URL starting with http:// or https://.";
  }
  try {
    const u = new URL(t);
    if (!u.hostname) return "Enter a valid URL with a host.";
    const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
    if (u.port && (port < 1 || port > 65535)) return "Port must be between 1 and 65535.";
    return null;
  } catch {
    return "That URL doesn't look valid.";
  }
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
  notes: notesList,
  folders: foldersList,
  backendEndpoint,
  onBackendEndpointChange,
  connectionStatus,
  connectionError,
  authEmail,
  authPassword,
  onAuthEmailChange,
  onAuthPasswordChange,
  authSubmitting,
  authError,
  calendarReminderSettings,
  calendarReminderSources,
  onCalendarReminderSettingsChange,
  onTestConnection,
  onSaveEndpoint,
  onLogin,
  onLoginWithOidc,
  onCancelOidc,
  onSignOut,
  onFullSync,
  onResetFromServer,
  fullSyncing,
  onImportFolder,
  onImportFiles,
  onExportNotes,
  focus,
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
      { id: "storage", label: "Storage" },
      { id: "calendar", label: "Calendar" },
      { id: "server", label: "Server" },
    ];
    if (showAuthSection) {
      list.push({ id: "authentication", label: "Authentication" });
      list.push({ id: "extensions", label: "Extensions" });
    }
    list.push({ id: "ai", label: "AI chat" });
    list.push({ id: "shortcuts", label: "Shortcuts" });
    list.push({ id: "app-settings", label: "App settings" });
    return list;
  }, [showAuthSection]);

  const [activeSection, setActiveSection] = useState<SettingsSectionId>("storage");

  // Deep-link: derive MCP server id from focus prop
  const mcpServerId = focus?.startsWith("mcp:") ? focus.slice(4) : undefined;

  const [endpointBlurred, setEndpointBlurred] = useState(false);
  const [endpointActionAttempted, setEndpointActionAttempted] = useState(false);
  const [authEmailBlurred, setAuthEmailBlurred] = useState(false);
  const [authPasswordBlurred, setAuthPasswordBlurred] = useState(false);
  const [loginAttempted, setLoginAttempted] = useState(false);
  const [migrationOpen, setMigrationOpen] = useState(false);
  const [pendingNewEndpoint, setPendingNewEndpoint] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    // When opening via a focus deep-link, jump to the right section
    setActiveSection(focus?.startsWith("mcp:") ? "ai" : "storage");
    setEndpointBlurred(false);
    setEndpointActionAttempted(false);
    setAuthEmailBlurred(false);
    setAuthPasswordBlurred(false);
    setLoginAttempted(false);
  }, [open, focus]);

  useEffect(() => {
    if (
      !showAuthSection &&
      (activeSection === "authentication" || activeSection === "extensions")
    ) {
      setActiveSection("server");
    }
  }, [showAuthSection, activeSection]);

  const resolvedSection: SettingsSectionId =
    activeSection === "authentication" && !showAuthSection
      ? "server"
      : activeSection === "extensions" && !showAuthSection
        ? "server"
        : activeSection;

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
    if (authSubmitting) return;
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
  const noteCount = (notesList ?? []).filter((note) => !note.isDeleted && !note.isTemplate).length;
  const templateCount = (notesList ?? []).filter(
    (note) => !note.isDeleted && note.isTemplate,
  ).length;
  const folderCount = (foldersList ?? []).length;
  const endpointDraft = backendEndpoint.trim();
  const savedEndpoint = snapshot.backend.endpoint.trim();
  const endpointDirty = endpointDraft !== savedEndpoint;

  function handleTestConnectionClick() {
    setEndpointActionAttempted(true);
    if (validateBackendEndpoint(backendEndpoint)) return;
    void onTestConnection();
  }

  function handleSaveEndpointClick() {
    setEndpointActionAttempted(true);
    if (validateBackendEndpoint(backendEndpoint)) return;
    const draft = backendEndpoint.trim();
    const saved = snapshot.backend.endpoint.trim();
    if (draft !== saved) {
      setPendingNewEndpoint(draft);
      setMigrationOpen(true);
      return;
    }
    void onSaveEndpoint();
  }

  function handleLoginSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoginAttempted(true);
    if (validateLoginEmail(authEmail) || validateLoginPassword(authPassword)) return;
    void onLogin();
  }

  const panelTitleBySection: Record<SettingsSectionId, string> = {
    storage: "Storage",
    calendar: "Calendar",
    server: "Server",
    authentication: "Authentication",
    extensions: "Extensions",
    ai: "AI chat",
    shortcuts: "Shortcuts",
    "app-settings": "App settings",
  };
  const panelTitle = panelTitleBySection[resolvedSection];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          "flex h-[min(82vh,760px)] max-h-[min(82vh,760px)] !w-[min(880px,calc(100vw-40px))] flex-col overflow-hidden",
          "max-[640px]:!w-[min(720px,calc(100vw-24px))]",
        )}
        bodyClassName="flex h-full min-h-0 flex-col overflow-hidden !px-[22px] !pt-[22px] !pb-0"
      >
        <DialogHeader className="shrink-0 pr-9">
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <div className="m-[0_-6px_0_-2px] flex min-h-0 flex-1 gap-0 pb-5 max-[640px]:m-0 max-[640px]:flex-col max-[640px]:pb-4">
          <nav
            className="min-h-0 min-w-0 shrink-0 basis-[200px] overflow-y-auto overscroll-contain border-r border-border-soft py-1 pr-3 pb-2 pl-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden max-[640px]:max-h-[136px] max-[640px]:basis-auto max-[640px]:w-full max-[640px]:border-b max-[640px]:border-r-0 max-[640px]:px-0.5 max-[640px]:pb-3 max-[640px]:pt-0"
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
                      "focus-visible:border focus-visible:border-white/20 focus-visible:shadow-[0_0_0_3px_rgba(255,255,255,0.08)] focus-visible:outline-none block w-full cursor-pointer rounded-[10px] border-0 bg-transparent py-2.5 px-3 text-left text-[0.9rem] font-medium text-muted transition-[background-color,color,border-color] duration-150 ease-out hover:bg-white/[0.05] hover:text-foreground ",
                      resolvedSection === id &&
                        "border-white/[0.08] bg-white/[0.04] text-foreground",
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
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pl-4 outline-none focus-visible:rounded-xl focus-visible:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] max-[640px]:pl-0.5 max-[640px]:pt-3"
          >
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-1 py-1 pb-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              <div
                key={resolvedSection}
                className="motion-safe:animate-[settings-section-enter_0.32s_cubic-bezier(0.22,1,0.36,1)_backwards] motion-reduce:animate-none"
              >
                <section
                  className="flex flex-col gap-1"
                  aria-labelledby={`${baseId}-panel-heading`}
                >
                  <h2
                    id={`${baseId}-panel-heading`}
                    className="m-0 text-[0.82rem] font-semibold uppercase tracking-[0.04em] text-faint"
                  >
                    {panelTitle}
                  </h2>

                  <div className="grid gap-4 px-0.5 pb-24">
                    {resolvedSection === "storage" ? (
                      <StorageSection
                        noteCount={noteCount}
                        templateCount={templateCount}
                        folderCount={folderCount}
                        onImportFiles={onImportFiles}
                        onImportFolder={onImportFolder}
                        onExportNotes={onExportNotes}
                      />
                    ) : null}

                    {resolvedSection === "server" ? (
                      <ServerSection
                        endpointId={endpointId}
                        endpointErrorId={endpointErrorId}
                        backendEndpoint={backendEndpoint}
                        onBackendEndpointChange={onBackendEndpointChange}
                        showEndpointError={showEndpointError}
                        endpointError={endpointError}
                        onEndpointBlur={() => setEndpointBlurred(true)}
                        connectionStatus={connectionStatus}
                        connectionError={connectionError}
                        canSaveEndpoint={!!canSaveEndpoint}
                        onTestConnectionClick={handleTestConnectionClick}
                        onSaveEndpointClick={handleSaveEndpointClick}
                        savedEndpoint={savedEndpoint}
                        backendReachable={snapshot.backend.backendReachable}
                        isAuthenticated={isAuthenticated}
                        endpointDirty={endpointDirty}
                        onFullSync={onFullSync}
                        onResetFromServer={onResetFromServer}
                        fullSyncing={fullSyncing}
                        SettingsFieldError={SettingsFieldError}
                      />
                    ) : null}

                    {resolvedSection === "calendar" ? (
                      <CalendarSection
                        baseId={baseId}
                        calendarReminderSettings={calendarReminderSettings}
                        calendarReminderSources={calendarReminderSources}
                        onCalendarReminderSettingsChange={onCalendarReminderSettingsChange}
                      />
                    ) : null}

                    {resolvedSection === "extensions" ? (
                      <ExtensionsSection
                        backendReachable={snapshot.backend.backendReachable}
                        isAuthenticated={isAuthenticated}
                      />
                    ) : null}

                    {resolvedSection === "authentication" ? (
                      <AuthenticationSection
                        isAuthenticated={isAuthenticated}
                        displayName={displayName}
                        accountEmail={accountEmail}
                        passwordAuthAvailable={passwordAuthAvailable}
                        oidcProviders={oidcProviders}
                        authEmail={authEmail}
                        authPassword={authPassword}
                        onAuthEmailChange={onAuthEmailChange}
                        onAuthPasswordChange={onAuthPasswordChange}
                        authSubmitting={authSubmitting}
                        authError={authError}
                        authEmailId={authEmailId}
                        authEmailErrorId={authEmailErrorId}
                        authPasswordId={authPasswordId}
                        authPasswordErrorId={authPasswordErrorId}
                        showEmailError={showEmailError}
                        showPasswordError={showPasswordError}
                        emailError={emailError}
                        passwordError={passwordError}
                        onEmailBlur={() => setAuthEmailBlurred(true)}
                        onPasswordBlur={() => setAuthPasswordBlurred(true)}
                        onLoginSubmit={handleLoginSubmit}
                        onLoginWithOidc={onLoginWithOidc}
                        onCancelOidc={onCancelOidc}
                        onSignOut={onSignOut}
                        SettingsFieldError={SettingsFieldError}
                      />
                    ) : null}

                    {resolvedSection === "ai" ? (
                      <AiSettingsSection
                        isAuthenticated={snapshot.backend?.authStatus === "authenticated"}
                        focusMcpServerId={mcpServerId}
                      />
                    ) : null}

                    {resolvedSection === "shortcuts" ? <KeyboardShortcutsSection /> : null}

                    {resolvedSection === "app-settings" ? <AppSettingsSection /> : null}
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
      {migrationOpen ? (
        <ServerMigrationDialog
          open={migrationOpen}
          oldEndpoint={snapshot.backend.endpoint}
          newEndpoint={pendingNewEndpoint}
          snapshot={snapshot}
          onClose={() => {
            setMigrationOpen(false);
            setPendingNewEndpoint("");
          }}
          setBackendEndpoint={async (endpoint) => {
            const api = (window as any).slateDesktop;
            await api.setBackendEndpoint(endpoint);
          }}
          getAccessToken={async () => {
            const api = (window as any).slateDesktop;
            return await api.getConfig("accessToken");
          }}
          authEmail={authEmail}
          authPassword={authPassword}
          onAuthEmailChange={onAuthEmailChange}
          onAuthPasswordChange={onAuthPasswordChange}
          authSubmitting={authSubmitting}
          authError={authError}
          authEmailId={authEmailId}
          authEmailErrorId={authEmailErrorId}
          authPasswordId={authPasswordId}
          authPasswordErrorId={authPasswordErrorId}
          showEmailError={showEmailError}
          showPasswordError={showPasswordError}
          emailError={emailError}
          passwordError={passwordError}
          onEmailBlur={() => setAuthEmailBlurred(true)}
          onPasswordBlur={() => setAuthPasswordBlurred(true)}
          onLoginSubmit={handleLoginSubmit}
          onLoginWithOidc={onLoginWithOidc}
          onCancelOidc={onCancelOidc}
          onSignOut={onSignOut}
          SettingsFieldError={SettingsFieldError}
        />
      ) : null}
    </Dialog>
  );
}
