import { useState } from "react";
import type { ConnectionStatus } from "../SettingsDialog";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

const bannerEnter =
  "motion-safe:animate-[settings-banner-enter_0.28s_cubic-bezier(0.22,1,0.36,1)_both] motion-reduce:animate-none";

export interface ServerSectionProps {
  endpointId: string;
  endpointErrorId: string;
  backendEndpoint: string;
  onBackendEndpointChange: (value: string) => void;
  showEndpointError: boolean;
  endpointError: string | null;
  onEndpointBlur: () => void;
  connectionStatus: ConnectionStatus;
  connectionError: string;
  canSaveEndpoint: boolean;
  onTestConnectionClick: () => void;
  onSaveEndpointClick: () => void;
  savedEndpoint: string;
  backendReachable: boolean;
  isAuthenticated: boolean;
  endpointDirty: boolean;
  onFullSync: () => Promise<void>;
  onResetFromServer: () => Promise<void>;
  fullSyncing: boolean;
  SettingsFieldError: React.ComponentType<{ id: string; message: string }>;
}

export function ServerSection({
  endpointId,
  endpointErrorId,
  backendEndpoint,
  onBackendEndpointChange,
  showEndpointError,
  endpointError,
  onEndpointBlur,
  connectionStatus,
  connectionError,
  canSaveEndpoint,
  onTestConnectionClick,
  onSaveEndpointClick,
  savedEndpoint,
  backendReachable,
  isAuthenticated,
  endpointDirty,
  onFullSync,
  onResetFromServer,
  fullSyncing,
  SettingsFieldError,
}: ServerSectionProps) {
  const [confirmingReset, setConfirmingReset] = useState(false);

  return (
    <>
      <div className="grid gap-1.5">
        <label htmlFor={endpointId} className="text-[0.84rem] text-muted">
          API endpoint
        </label>
        <Input
          id={endpointId}
          variant="bordered"
          invalid={showEndpointError}
          value={backendEndpoint}
          onChange={(e) => onBackendEndpointChange(e.target.value)}
          onBlur={onEndpointBlur}
          placeholder="http://localhost:4000"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={showEndpointError}
          aria-describedby={showEndpointError ? endpointErrorId : undefined}
        />
        {showEndpointError ? (
          <SettingsFieldError id={endpointErrorId} message={endpointError!} />
        ) : null}
        <p className="m-0 text-[0.78rem] leading-snug text-faint">
          Use a full URL with <code className="font-mono">http://</code> or{" "}
          <code className="font-mono">https://</code>. Test connection checks{" "}
          <code className="font-mono">/api/health</code> without saving.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="dialog-secondary"
          onClick={onTestConnectionClick}
          disabled={connectionStatus === "testing" || !backendEndpoint.trim()}
        >
          {connectionStatus === "testing" ? "Testing…" : "Test connection"}
        </Button>
        <Button variant="dialog-primary" onClick={onSaveEndpointClick} disabled={!canSaveEndpoint}>
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
          Health check passed
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
          {connectionError || "Health check failed."}
        </div>
      ) : null}

      <div className="grid gap-3 rounded-[14px] border border-white/[0.06] bg-white/[0.04] p-3.5">
        <div className="grid gap-1.5">
          <div className="text-[0.84rem] text-muted">Saved endpoint</div>
          <div className="break-words font-[ui-monospace,'SF_Mono',SFMono-Regular,Menlo,Monaco,Consolas,monospace] text-[0.86rem] leading-snug text-muted">
            {savedEndpoint || "Not set"}
          </div>
        </div>

        <div className="grid gap-1.5">
          <div className="text-[0.84rem] text-muted">Saved server status</div>
          <div className="break-words text-[0.94rem] text-foreground">
            {!backendReachable
              ? "Offline"
              : isAuthenticated
                ? "Connected and signed in"
                : "Connected, sign in required"}
          </div>
        </div>

        {endpointDirty ? (
          <p className="m-0 text-[0.78rem] leading-snug text-faint">
            You have unsaved endpoint changes. The saved server status above still reflects the
            active endpoint until you press Save.
          </p>
        ) : null}
      </div>

      {isAuthenticated ? (
        <div className="grid gap-2">
          <Button variant="dialog-secondary" onClick={() => void onFullSync()} disabled={fullSyncing}>
            {fullSyncing ? "Refreshing…" : "Refresh from server"}
          </Button>

          {!confirmingReset ? (
            <Button
              variant="dialog-secondary"
              onClick={() => setConfirmingReset(true)}
              disabled={fullSyncing}
            >
              Reset local data from server
            </Button>
          ) : (
            <div
              className={cn(
                "grid gap-2 rounded-lg border border-danger/30 bg-danger/[0.08] p-3",
                bannerEnter,
              )}
            >
              <p className="m-0 text-[0.84rem] text-danger">
                This will delete all local data and replace it with the server copy. Unsynced local
                changes will be lost.
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="dialog-primary"
                  className="bg-danger hover:bg-danger/90"
                  disabled={fullSyncing}
                  onClick={() => {
                    setConfirmingReset(false);
                    void onResetFromServer();
                  }}
                >
                  {fullSyncing ? "Resetting…" : "Confirm reset"}
                </Button>
                <Button
                  variant="dialog-secondary"
                  onClick={() => setConfirmingReset(false)}
                  disabled={fullSyncing}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </>
  );
}
