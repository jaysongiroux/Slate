import { useEffect } from "react";
import type { DesktopSnapshot } from "@slate/shared";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import { useServerMigration, type MigrationState } from "../../hooks/useServerMigration";
import { AuthenticationSection } from "./AuthenticationSection";

export interface ServerMigrationDialogProps {
  open: boolean;
  oldEndpoint: string;
  newEndpoint: string;
  snapshot: DesktopSnapshot;
  onClose: (committed: boolean) => void;
  setBackendEndpoint: (endpoint: string) => Promise<void>;
  getAccessToken: () => Promise<string | null>;

  authEmail: string;
  authPassword: string;
  onAuthEmailChange: (value: string) => void;
  onAuthPasswordChange: (value: string) => void;
  authSubmitting: boolean;
  authError: string;
  authEmailId: string;
  authEmailErrorId: string;
  authPasswordId: string;
  authPasswordErrorId: string;
  showEmailError: boolean;
  showPasswordError: boolean;
  emailError: string | null;
  passwordError: string | null;
  onEmailBlur: () => void;
  onPasswordBlur: () => void;
  onLoginSubmit: (event: React.FormEvent) => void;
  onLoginWithOidc: (providerId: string) => Promise<void>;
  onCancelOidc: () => void;
  onSignOut: () => Promise<void>;
  SettingsFieldError: React.ComponentType<{ id: string; message: string }>;
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 100 : Math.round((done / total) * 100);
  return (
    <div className="grid gap-1">
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full bg-foreground transition-[width] duration-200 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-[0.78rem] leading-snug text-faint">
        {done} of {total}
      </div>
    </div>
  );
}

function Summary({
  summary,
}: {
  summary: NonNullable<Extract<MigrationState, { kind: "running" }>["summary"]>;
}) {
  return (
    <p className="m-0 text-[0.84rem] text-muted">
      Migrating {summary.notes} notes, {summary.folders} folders, {summary.diagrams} diagrams,{" "}
      {summary.attachments} attachments, {summary.settings} settings.
    </p>
  );
}

export function ServerMigrationDialog(props: ServerMigrationDialogProps) {
  const {
    open,
    oldEndpoint,
    newEndpoint,
    snapshot,
    onClose,
    setBackendEndpoint,
    getAccessToken,
  } = props;

  const migration = useServerMigration({
    oldEndpoint,
    newEndpoint,
    onClose,
    getAccessToken,
    setBackendEndpoint,
  });

  const { state, notifyAuthSucceeded } = migration;
  const authStatus = snapshot.backend.authStatus;

  // Resume migration once the snapshot reports the new server is authenticated.
  useEffect(() => {
    if (state.kind === "awaiting-new-server-auth" && authStatus === "authenticated") {
      notifyAuthSucceeded();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind, authStatus]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // No close-via-Esc/X — only explicit button actions can close the dialog.
        if (next) return;
      }}
    >
      <DialogContent
        className="flex w-[min(560px,calc(100vw-40px))] flex-col gap-4 p-6"
        bodyClassName="flex flex-col gap-4"
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Switch server</DialogTitle>
        </DialogHeader>

        <div className="grid gap-1.5">
          <div className="text-[0.84rem] text-muted">From</div>
          <div className="font-[ui-monospace,'SF_Mono',Menlo,monospace] text-[0.86rem] text-foreground">
            {oldEndpoint || "Not set"}
          </div>
          <div className="text-[0.84rem] text-muted">To</div>
          <div className="font-[ui-monospace,'SF_Mono',Menlo,monospace] text-[0.86rem] text-foreground">
            {newEndpoint}
          </div>
        </div>

        {state.kind === "chooser" ? (
          <div className="grid gap-3">
            <p className="m-0 text-[0.9rem] text-muted">
              Choose how to handle your existing data:
            </p>
            <Button variant="dialog-primary" onClick={() => void migration.startPush()}>
              Push my data to the new server
            </Button>
            <Button variant="dialog-secondary" onClick={() => void migration.startReset()}>
              Reset and start fresh from the new server
            </Button>
            <Button variant="dialog-secondary" onClick={() => migration.cancel()}>
              Cancel
            </Button>
          </div>
        ) : null}

        {state.kind === "running" ? (
          <div className="grid gap-3">
            {state.summary ? <Summary summary={state.summary} /> : null}
            <p className="m-0 text-[0.9rem] text-foreground">{state.step}</p>
            {state.progress ? (
              <ProgressBar done={state.progress.done} total={state.progress.total} />
            ) : null}
          </div>
        ) : null}

        {state.kind === "awaiting-new-server-auth" ? (
          <div className="grid gap-3">
            <p className="m-0 text-[0.9rem] text-foreground">
              Sign in to the new server to continue.
            </p>
            <AuthenticationSection
              isAuthenticated={false}
              displayName={undefined}
              accountEmail={undefined}
              passwordAuthAvailable={
                !!snapshot.backend.authProviders.find((p) => p.type === "password")
              }
              oidcProviders={snapshot.backend.authProviders.filter((p) => p.type === "oidc")}
              authEmail={props.authEmail}
              authPassword={props.authPassword}
              onAuthEmailChange={props.onAuthEmailChange}
              onAuthPasswordChange={props.onAuthPasswordChange}
              authSubmitting={props.authSubmitting}
              authError={props.authError}
              authEmailId={props.authEmailId}
              authEmailErrorId={props.authEmailErrorId}
              authPasswordId={props.authPasswordId}
              authPasswordErrorId={props.authPasswordErrorId}
              showEmailError={props.showEmailError}
              showPasswordError={props.showPasswordError}
              emailError={props.emailError}
              passwordError={props.passwordError}
              onEmailBlur={props.onEmailBlur}
              onPasswordBlur={props.onPasswordBlur}
              onLoginSubmit={props.onLoginSubmit}
              onLoginWithOidc={props.onLoginWithOidc}
              onCancelOidc={props.onCancelOidc}
              onSignOut={props.onSignOut}
              SettingsFieldError={props.SettingsFieldError}
            />
            <Button variant="dialog-secondary" onClick={() => migration.close(true)}>
              Stop migration (endpoint already switched)
            </Button>
          </div>
        ) : null}

        {state.kind === "error" ? (
          <div className="grid gap-3">
            <div
              className="rounded-lg px-3 py-2 text-[0.84rem] bg-[rgba(255,146,136,0.12)] text-danger"
              role="alert"
            >
              {state.message}
            </div>
            {state.canRetry ? (
              <Button variant="dialog-primary" onClick={() => migration.retry()}>
                Retry
              </Button>
            ) : null}
            <Button
              variant="dialog-secondary"
              onClick={() => migration.close(migration.switched)}
            >
              {state.canRetry ? "Cancel" : "Close"}
            </Button>
          </div>
        ) : null}

        {state.kind === "done" ? (
          <div className="grid gap-3">
            <p className="m-0 text-[0.9rem] text-foreground">
              {state.mode === "push"
                ? "All data uploaded to the new server."
                : "Local data replaced from the new server."}
            </p>
            <Button variant="dialog-primary" onClick={() => migration.close(true)}>
              Close
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
