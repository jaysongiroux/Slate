import { useState } from "react";
import {
  mcpApi,
  type McpServerPublic,
  type McpServerSaveInput,
  type McpServerStatus,
  type McpToolDescriptor,
  type McpTransport,
  type McpAuthInput,
} from "../../lib/api/mcp-api";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { nativeFieldBorderedClassName } from "../ui/input";

const NAME_REGEX = /^[a-z0-9_-]{1,32}$/;

interface Props {
  open: boolean;
  initial?: McpServerPublic;
  onSave: (input: McpServerSaveInput) => Promise<void>;
  onClose: () => void;
}

type AuthFormType = "none" | "bearer" | "headers";

export function McpServerDialog({ open, initial, onSave, onClose }: Props) {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [transport, setTransport] = useState<McpTransport>(initial?.transport ?? "streamable-http");
  const [authType, setAuthType] = useState<AuthFormType>(initial?.auth.type ?? "none");
  const [token, setToken] = useState("");
  const [keepExistingAuth, setKeepExistingAuth] = useState<boolean>(
    isEdit && initial?.auth.type !== "none",
  );
  const [headers, setHeaders] = useState<Array<{ name: string; value: string }>>(
    initial?.auth.type === "headers"
      ? initial.auth.headerNames.map((n) => ({ name: n, value: "" }))
      : [],
  );
  const [description, setDescription] = useState(initial?.description ?? "");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [testStatus, setTestStatus] = useState<{
    kind: McpServerStatus["kind"];
    message?: string;
    tools?: McpToolDescriptor[];
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const nameError =
    name && !NAME_REGEX.test(name)
      ? "Lowercase, digits, dashes, underscores. Up to 32 chars."
      : null;
  const urlError = url && !/^https?:\/\//.test(url) ? "Must be a valid URL." : null;

  const buildAuth = (): McpAuthInput => {
    if (authType === "none") return { type: "none" };
    if (isEdit && keepExistingAuth) return { type: "unchanged" };
    if (authType === "bearer") return { type: "bearer", token };
    return {
      type: "headers",
      headers: headers.filter((h) => h.name && h.value),
    };
  };

  const buildPayload = (): McpServerSaveInput => ({
    id: initial?.id,
    name,
    url,
    transport,
    auth: buildAuth(),
    enabled,
    enabledTools: initial?.enabledTools ?? null,
    description: description || undefined,
  });

  const handleTest = async () => {
    setBusy(true);
    setTestStatus(null);
    try {
      const result = await mcpApi.testServer(buildPayload());
      if (result.ok) {
        setTestStatus({
          kind: result.status.kind,
          message: `Found ${result.tools.length} tool(s)`,
          tools: result.tools,
        });
      } else {
        setTestStatus({
          kind: result.status.kind,
          message: "error" in result.status ? (result.status as { error: string }).error : "Failed",
        });
      }
    } catch (err) {
      setTestStatus({
        kind: "misconfigured",
        message: (err as Error).message,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    if (nameError || urlError || !name || !url) return;
    setBusy(true);
    try {
      await onSave(buildPayload());
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const canAct = !busy && !nameError && !urlError && !!name && !!url;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit MCP server" : "Add MCP server"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Field label="Name" error={nameError}>
            <input
              className={nativeFieldBorderedClassName}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="linear"
            />
          </Field>

          <Field label="URL" error={urlError}>
            <input
              className={nativeFieldBorderedClassName}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://mcp.example.com/sse"
            />
          </Field>

          <Field label="Transport">
            <select
              className={nativeFieldBorderedClassName}
              value={transport}
              onChange={(e) => setTransport(e.target.value as McpTransport)}
            >
              <option value="streamable-http">Streamable HTTP</option>
              <option value="sse">SSE</option>
              <option value="http">HTTP</option>
            </select>
          </Field>

          <Field label="Authentication">
            <select
              className={nativeFieldBorderedClassName}
              value={authType}
              onChange={(e) => {
                setAuthType(e.target.value as AuthFormType);
                setKeepExistingAuth(false);
              }}
            >
              <option value="none">None</option>
              <option value="bearer">Bearer token</option>
              <option value="headers">Custom headers</option>
            </select>
          </Field>

          {authType === "bearer" && (
            <div className="flex flex-col gap-1">
              {isEdit && initial?.auth.type === "bearer" && keepExistingAuth ? (
                <button
                  className="self-start text-xs text-blue-300 underline"
                  onClick={() => setKeepExistingAuth(false)}
                >
                  •••• token saved (replace?)
                </button>
              ) : (
                <input
                  className={nativeFieldBorderedClassName}
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="paste token"
                />
              )}
            </div>
          )}

          {authType === "headers" && (
            <div className="flex flex-col gap-2">
              {headers.map((h, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    className={nativeFieldBorderedClassName}
                    value={h.name}
                    onChange={(e) => {
                      const next = [...headers];
                      next[i] = { ...next[i], name: e.target.value };
                      setHeaders(next);
                    }}
                    placeholder="Header name"
                  />
                  <input
                    className={nativeFieldBorderedClassName}
                    type="password"
                    value={h.value}
                    onChange={(e) => {
                      const next = [...headers];
                      next[i] = { ...next[i], value: e.target.value };
                      setHeaders(next);
                    }}
                    placeholder={isEdit && keepExistingAuth ? "•••• saved" : "Value"}
                    disabled={isEdit && keepExistingAuth}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setHeaders(headers.filter((_, j) => j !== i))}
                  >
                    ×
                  </Button>
                </div>
              ))}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setHeaders([...headers, { name: "", value: "" }])}
              >
                + Add header
              </Button>
              {isEdit && keepExistingAuth && (
                <button
                  className="self-start text-xs text-blue-300 underline"
                  onClick={() => setKeepExistingAuth(false)}
                >
                  Replace existing values
                </button>
              )}
            </div>
          )}

          <Field label="Description">
            <input
              className={nativeFieldBorderedClassName}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              placeholder="optional"
            />
          </Field>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Enabled
          </label>

          {testStatus && (
            <div
              className={`text-sm ${testStatus.kind === "ok" ? "text-green-400" : "text-red-400"}`}
            >
              {testStatus.kind === "ok"
                ? `Connected — ${testStatus.message}`
                : `Failed (${testStatus.kind}): ${testStatus.message}`}
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-between pt-1">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleTest()}
            disabled={!canAct}
          >
            Test connection
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleSave()}
              disabled={!canAct}
            >
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-[0.78rem] text-muted">{label}</span>
      {children}
      {error ? <span className="text-xs text-red-400">{error}</span> : null}
    </label>
  );
}
