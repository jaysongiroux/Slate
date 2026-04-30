import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { cn } from "../../lib/utils";
import { useServerMigration, type MigrationState } from "../../hooks/useServerMigration";

const bannerEnter =
  "motion-safe:animate-[settings-banner-enter_0.28s_cubic-bezier(0.22,1,0.36,1)_both] motion-reduce:animate-none";

export interface ServerMigrationDialogProps {
  open: boolean;
  oldEndpoint: string;
  newEndpoint: string;
  onClose: (committed: boolean) => void;
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

export function ServerMigrationDialog({
  open,
  oldEndpoint,
  newEndpoint,
  onClose,
}: ServerMigrationDialogProps) {
  const migration = useServerMigration({ oldEndpoint, newEndpoint, onClose });
  const { state } = migration;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const passwordProvider =
    state.kind === "awaiting-new-server-auth"
      ? state.probe.authProviders.find((p) => p.type === "password")
      : undefined;
  const oidcProviders =
    state.kind === "awaiting-new-server-auth"
      ? state.probe.authProviders.filter((p) => p.type === "oidc")
      : [];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
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
              You'll be prompted to sign in to the new server before any data moves. Your
              current server stays active until that sign-in succeeds.
            </p>

            <div className="grid gap-2 rounded-[14px] border border-white/[0.06] bg-white/[0.04] p-3.5">
              <div className="text-[0.84rem] font-semibold text-foreground">
                Push: copy your data to the new server
              </div>
              <ul className="m-0 grid list-disc gap-1 pl-5 text-[0.84rem] text-muted">
                <li>
                  {migration.localCounts ? (
                    <>
                      <span className="text-foreground">{migration.localCounts.notes}</span>{" "}
                      notes,{" "}
                      <span className="text-foreground">{migration.localCounts.folders}</span>{" "}
                      folders, plus all diagrams and attachments owned by you on the current
                      server
                    </>
                  ) : (
                    <>Your notes, folders, diagrams, and attachments on the current server</>
                  )}
                </li>
                <li>
                  Migratable settings:{" "}
                  <span className="text-foreground">
                    {migration.localCounts?.migratableSettings ?? "—"}
                  </span>{" "}
                  (keyboard shortcuts, checklists, feature toggles)
                </li>
                <li>
                  <span className="text-foreground">Skipped:</span> Linkwarden, Forge, Jira,
                  and Home Assistant configuration and tokens (
                  {migration.localCounts?.skippedExtensionSettings ?? 0} server-bound{" "}
                  {migration.localCounts?.skippedExtensionSettings === 1
                    ? "setting"
                    : "settings"}
                  ). Reconnect those on the new server after sign-in.
                </li>
              </ul>
            </div>

            <div className="grid gap-2 rounded-[14px] border border-white/[0.06] bg-white/[0.04] p-3.5">
              <div className="text-[0.84rem] font-semibold text-foreground">
                Reset: discard local data and pull from the new server
              </div>
              <ul className="m-0 grid list-disc gap-1 pl-5 text-[0.84rem] text-muted">
                <li>
                  Replaces your local copy of{" "}
                  <span className="text-foreground">
                    {migration.localCounts?.notes ?? "—"} notes
                  </span>{" "}
                  and{" "}
                  <span className="text-foreground">
                    {migration.localCounts?.folders ?? "—"} folders
                  </span>{" "}
                  with whatever the new server has for your account
                </li>
                <li>Unsynced local changes are lost</li>
                <li>Diagrams and attachments come from the new server only</li>
              </ul>
            </div>

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
              Sign in to the new server. Your current server stays active until sign-in
              succeeds.
            </p>

            {oidcProviders.length > 0 ? (
              <div className="grid gap-2">
                <div className="text-[0.84rem] text-muted">Single sign-on</div>
                <div className="flex flex-wrap items-center gap-2">
                  {oidcProviders.map((provider) => (
                    <Button
                      key={provider.id}
                      variant="dialog-secondary"
                      onClick={() => void migration.submitOidcLogin(provider.id)}
                      disabled={state.authSubmitting}
                    >
                      {state.authSubmitting
                        ? "Waiting for browser…"
                        : `Continue with ${provider.label}`}
                    </Button>
                  ))}
                  {state.authSubmitting ? (
                    <Button
                      variant="dialog-secondary"
                      type="button"
                      onClick={() => void migration.cancelOidc()}
                    >
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {passwordProvider ? (
              <form
                className="grid gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!email.trim() || !password) return;
                  void migration.submitPasswordLogin(email.trim(), password);
                }}
                noValidate
              >
                <div className="grid gap-1.5">
                  <label className="text-[0.84rem] text-muted">Email</label>
                  <Input
                    variant="bordered"
                    type="email"
                    autoComplete="username"
                    inputMode="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                  />
                </div>
                <div className="grid gap-1.5">
                  <label className="text-[0.84rem] text-muted">Password</label>
                  <Input
                    variant="bordered"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Password"
                  />
                </div>
                <Button
                  variant="dialog-primary"
                  type="submit"
                  disabled={state.authSubmitting || !email.trim() || !password}
                >
                  {state.authSubmitting ? "Signing in…" : "Sign in to new server"}
                </Button>
              </form>
            ) : null}

            {!passwordProvider && oidcProviders.length === 0 ? (
              <p className="m-0 text-[0.9rem] text-danger">
                No authentication providers available on the new server.
              </p>
            ) : null}

            {state.authError ? (
              <div
                className={cn(
                  "rounded-lg px-3 py-2 text-[0.84rem] bg-[rgba(255,146,136,0.12)] text-danger",
                  bannerEnter,
                )}
                role="alert"
              >
                {state.authError}
              </div>
            ) : null}

            <Button variant="dialog-secondary" onClick={() => migration.cancel()}>
              Cancel migration (stay on current server)
            </Button>
          </div>
        ) : null}

        {state.kind === "awaiting-conflict-resolution" ? (
          <div className="grid gap-3">
            <p className="m-0 text-[0.9rem] text-foreground">
              Some IDs in your data already exist on the new server under another account
              (likely a leftover from a prior migration attempt).
            </p>
            <ul className="m-0 grid list-disc gap-0.5 pl-5 text-[0.84rem] text-muted">
              {state.counts.folders > 0 ? <li>{state.counts.folders} folders</li> : null}
              {state.counts.notes > 0 ? <li>{state.counts.notes} notes</li> : null}
              {state.counts.diagrams > 0 ? <li>{state.counts.diagrams} diagrams</li> : null}
              {state.counts.attachments > 0 ? (
                <li>{state.counts.attachments} attachments</li>
              ) : null}
              {state.counts.settings > 0 ? <li>{state.counts.settings} settings</li> : null}
            </ul>
            <p className="m-0 text-[0.84rem] text-muted">
              Choose <span className="text-foreground">Generate fresh IDs</span> to give the
              conflicting items new IDs and import them alongside the existing rows.
              References inside notes and diagrams are rewritten so attachments stay linked.
              Choose <span className="text-foreground">Cancel</span> to back out and clean up
              the new server's database manually instead.
            </p>
            <Button
              variant="dialog-primary"
              onClick={() => void migration.regenerateAndContinue()}
            >
              Generate fresh IDs and continue
            </Button>
            <Button variant="dialog-secondary" onClick={() => migration.cancel()}>
              Cancel migration
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
                ? "Migration complete."
                : "Local data replaced from the new server."}
            </p>
            {state.mode === "push" && state.skipped ? (
              <div
                className={cn(
                  "grid gap-1 rounded-lg px-3 py-2 text-[0.84rem] bg-[rgba(255,200,80,0.12)] text-[#dba84b]",
                  bannerEnter,
                )}
                role="status"
              >
                <div className="font-semibold">Some items were not imported</div>
                <ul className="m-0 grid list-disc gap-0.5 pl-5">
                  {state.skipped.folders > 0 ? <li>{state.skipped.folders} folders</li> : null}
                  {state.skipped.notes > 0 ? <li>{state.skipped.notes} notes</li> : null}
                  {state.skipped.diagrams > 0 ? (
                    <li>{state.skipped.diagrams} diagrams</li>
                  ) : null}
                  {state.skipped.settings > 0 ? (
                    <li>{state.skipped.settings} settings</li>
                  ) : null}
                  {state.skipped.attachments > 0 ? (
                    <li>{state.skipped.attachments} attachments</li>
                  ) : null}
                </ul>
                <div className="text-[0.78rem] leading-snug">
                  These IDs are owned by a different user on the new server (usually a
                  leftover from a prior migration attempt under another login). Items
                  referencing them may appear missing until the server-side rows are cleaned
                  up.
                </div>
              </div>
            ) : null}
            <Button variant="dialog-primary" onClick={() => migration.close(true)}>
              Close
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
