import { useState, useEffect, useRef, useCallback } from "react";
import { CHAT_MODEL_PRESETS, EMBEDDING_MODEL_PRESETS } from "@slate/shared";
import { getAiConfig, updateAiConfig, triggerEmbedding, getEmbedStatus } from "../lib/api";
import type { AiConfigResponse, UpdateAiConfigRequest, EmbedStatusResponse } from "../lib/api";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Input, nativeFieldBorderedClassName } from "./ui/input";

const EMBEDDING_PROVIDERS = ["OPENAI", "OLLAMA", "OPENAI_COMPATIBLE"] as const;
const CHAT_PROVIDERS = ["OPENAI", "ANTHROPIC", "OLLAMA", "OPENAI_COMPATIBLE"] as const;

const ENDPOINT_PROVIDERS = new Set(["OLLAMA", "OPENAI_COMPATIBLE"]);
const API_KEY_PROVIDERS = new Set(["OPENAI", "ANTHROPIC", "OPENAI_COMPATIBLE"]);

const OTHER = "__other__";

function ModelSelect({
  provider,
  presets,
  value,
  onChange,
  placeholder,
}: {
  provider: string;
  presets: Record<string, string[]>;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const options = presets[provider];
  const [forceCustom, setForceCustom] = useState(false);

  // Reset custom flag when provider changes
  useEffect(() => {
    setForceCustom(false);
  }, [provider]);

  // No presets for this provider — just show a text input
  if (!options) {
    return (
      <Input
        variant="bordered"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    );
  }

  const isPreset = options.includes(value);
  const showCustomInput = forceCustom || (value !== "" && !isPreset);

  return (
    <div className="flex flex-col gap-1.5">
      <select
        className={nativeFieldBorderedClassName}
        value={showCustomInput ? OTHER : value}
        onChange={(e) => {
          if (e.target.value === OTHER) {
            setForceCustom(true);
            onChange("");
          } else {
            setForceCustom(false);
            onChange(e.target.value);
          }
        }}
      >
        <option value="">-- Select model --</option>
        {options.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
        <option value={OTHER}>Other...</option>
      </select>
      {showCustomInput && (
        <Input
          variant="bordered"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus
        />
      )}
    </div>
  );
}

interface AiSettingsSectionProps {
  isAuthenticated: boolean;
}

interface FormState {
  embeddingProvider: string;
  embeddingModel: string;
  embeddingEndpoint: string;
  embeddingApiKey: string;
  chatProvider: string;
  chatModel: string;
  chatEndpoint: string;
  chatApiKey: string;
}

const defaultForm: FormState = {
  embeddingProvider: "",
  embeddingModel: "",
  embeddingEndpoint: "",
  embeddingApiKey: "",
  chatProvider: "",
  chatModel: "",
  chatEndpoint: "",
  chatApiKey: "",
};

function configToForm(config: AiConfigResponse): FormState {
  return {
    embeddingProvider: config.embeddingProvider ?? "",
    embeddingModel: config.embeddingModel ?? "",
    embeddingEndpoint: config.embeddingEndpoint ?? "",
    embeddingApiKey: "",
    chatProvider: config.chatProvider ?? "",
    chatModel: config.chatModel ?? "",
    chatEndpoint: config.chatEndpoint ?? "",
    chatApiKey: "",
  };
}

export function AiSettingsSection({ isAuthenticated }: AiSettingsSectionProps) {
  const [form, setForm] = useState<FormState>(defaultForm);
  const [saveStatus, setSaveStatus] = useState("");
  const [embedStatus, setEmbedStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [embedding, setEmbedding] = useState(false);
  const [embedProgress, setEmbedProgress] = useState<EmbedStatusResponse | null>(null);
  const [progressVisible, setProgressVisible] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    const poll = async () => {
      try {
        const status = await getEmbedStatus();
        setEmbedProgress(status);
        if (status.remaining === 0) {
          stopPolling();
          // Animate out, then clear
          setTimeout(() => {
            setProgressVisible(false);
            setTimeout(() => setEmbedProgress(null), 250);
          }, 500);
          return;
        }
        setProgressVisible(true);
      } catch {
        // Polling failure is non-fatal — just skip this tick
      }
    };
    void poll();
    pollRef.current = setInterval(() => void poll(), 2000);
  }, [stopPolling]);

  useEffect(() => {
    if (!isAuthenticated) return;
    void getAiConfig().then((config) => {
      setForm(configToForm(config));
    });
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    void getEmbedStatus().then((status) => {
      if (status.remaining > 0) {
        setEmbedProgress(status);
        setProgressVisible(true);
        startPolling();
      }
    });
    return () => stopPolling();
  }, [isAuthenticated, startPolling, stopPolling]);

  if (!isAuthenticated) {
    return (
      <div className="break-words text-[0.94rem] text-foreground">
        Sign in to configure AI settings.
      </div>
    );
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setSaveStatus("");
    try {
      const payload: UpdateAiConfigRequest = {
        embeddingProvider: form.embeddingProvider || undefined,
        embeddingModel: form.embeddingModel || undefined,
        embeddingEndpoint: form.embeddingEndpoint || undefined,
        embeddingApiKey: form.embeddingApiKey || undefined,
        chatProvider: form.chatProvider || undefined,
        chatModel: form.chatModel || undefined,
        chatEndpoint: form.chatEndpoint || undefined,
        chatApiKey: form.chatApiKey || undefined,
      };
      const updated = await updateAiConfig(payload);
      if (updated.embeddingModelOrProviderChanged) {
        setEmbedProgress({ total: 0, embedded: 0, remaining: 0 });
        setProgressVisible(true);
        startPolling();
      }
      setForm((prev) => ({
        ...configToForm(updated),
        // Clear API key fields after save
        embeddingApiKey: "",
        chatApiKey: "",
        // Preserve any unsaved endpoint/model edits that came back from server
        embeddingProvider: updated.embeddingProvider ?? prev.embeddingProvider,
        embeddingModel: updated.embeddingModel ?? prev.embeddingModel,
        embeddingEndpoint: updated.embeddingEndpoint ?? prev.embeddingEndpoint,
        chatProvider: updated.chatProvider ?? prev.chatProvider,
        chatModel: updated.chatModel ?? prev.chatModel,
        chatEndpoint: updated.chatEndpoint ?? prev.chatEndpoint,
      }));
      setSaveStatus("Settings saved.");
      window.dispatchEvent(new CustomEvent("slate-ai-config-changed"));
    } catch (err) {
      setSaveStatus(`Error saving settings: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleReEmbed() {
    const confirmed = confirm("Re-index all documents? This may take a while.");
    if (!confirmed) return;
    setEmbedding(true);
    setEmbedStatus("");
    try {
      await triggerEmbedding();
      setProgressVisible(true);
      startPolling();
    } catch (err) {
      setEmbedStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setEmbedding(false);
    }
  }

  const showEmbeddingEndpoint = ENDPOINT_PROVIDERS.has(form.embeddingProvider);
  const showEmbeddingApiKey = API_KEY_PROVIDERS.has(form.embeddingProvider);
  const showChatEndpoint = ENDPOINT_PROVIDERS.has(form.chatProvider);
  const showChatApiKey = API_KEY_PROVIDERS.has(form.chatProvider);

  return (
    <div className="flex flex-col gap-4">
      {/* Embedding Model */}
      <div className="flex flex-col gap-1">
        <div className="mb-2 text-[0.82rem] font-semibold uppercase tracking-[0.04em] text-faint">
          Embedding Model
        </div>

        <div className="grid gap-1.5">
          <div className="text-[0.84rem] text-muted">Provider</div>
          <select
            className={nativeFieldBorderedClassName}
            value={form.embeddingProvider}
            onChange={(e) => {
              setField("embeddingProvider", e.target.value);
              setField("embeddingModel", "");
            }}
          >
            <option value="">-- Select provider --</option>
            {EMBEDDING_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-1.5">
          <div className="text-[0.84rem] text-muted">Model</div>
          <ModelSelect
            provider={form.embeddingProvider}
            presets={EMBEDDING_MODEL_PRESETS}
            value={form.embeddingModel}
            onChange={(v) => setField("embeddingModel", v)}
            placeholder="e.g. text-embedding-3-small"
          />
        </div>

        {showEmbeddingEndpoint && (
          <div className="grid gap-1.5">
            <div className="text-[0.84rem] text-muted">Endpoint</div>
            <Input
              variant="bordered"
              value={form.embeddingEndpoint}
              onChange={(e) => setField("embeddingEndpoint", e.target.value)}
              placeholder="http://localhost:11434"
            />
          </div>
        )}

        {showEmbeddingApiKey && (
          <div className="grid gap-1.5">
            <div className="text-[0.84rem] text-muted">API key</div>
            <Input
              variant="bordered"
              type="password"
              value={form.embeddingApiKey}
              onChange={(e) => setField("embeddingApiKey", e.target.value)}
              placeholder="Leave blank to keep existing key"
              autoComplete="off"
            />
          </div>
        )}
      </div>

      {/* Chat Model */}
      <div className="flex flex-col gap-1">
        <div className="mb-2 text-[0.82rem] font-semibold uppercase tracking-[0.04em] text-faint">
          Chat Model
        </div>

        <div className="grid gap-1.5">
          <div className="text-[0.84rem] text-muted">Provider</div>
          <select
            className={nativeFieldBorderedClassName}
            value={form.chatProvider}
            onChange={(e) => {
              setField("chatProvider", e.target.value);
              setField("chatModel", "");
            }}
          >
            <option value="">-- Select provider --</option>
            {CHAT_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-1.5">
          <div className="text-[0.84rem] text-muted">Model</div>
          <ModelSelect
            provider={form.chatProvider}
            presets={CHAT_MODEL_PRESETS}
            value={form.chatModel}
            onChange={(v) => setField("chatModel", v)}
            placeholder="e.g. gpt-4o"
          />
        </div>

        {showChatEndpoint && (
          <div className="grid gap-1.5">
            <div className="text-[0.84rem] text-muted">Endpoint</div>
            <Input
              variant="bordered"
              value={form.chatEndpoint}
              onChange={(e) => setField("chatEndpoint", e.target.value)}
              placeholder="http://localhost:11434"
            />
          </div>
        )}

        {showChatApiKey && (
          <div className="grid gap-1.5">
            <div className="text-[0.84rem] text-muted">API key</div>
            <Input
              variant="bordered"
              type="password"
              value={form.chatApiKey}
              onChange={(e) => setField("chatApiKey", e.target.value)}
              placeholder="Leave blank to keep existing key"
              autoComplete="off"
            />
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button variant="primary" onClick={() => void handleSave()} disabled={saving}>
          {saving ? "Saving..." : "Save AI settings"}
        </Button>
        <Button variant="secondary" onClick={() => void handleReEmbed()} disabled={embedding}>
          {embedding ? "Starting..." : "Re-scan documents"}
        </Button>
      </div>

      {saveStatus && (
        <div
          className={cn(
            "rounded-lg px-3 py-2 text-[0.84rem]",
            saveStatus.startsWith("Error")
              ? "bg-[rgba(255,146,136,0.12)] text-danger"
              : "bg-[rgba(40,200,64,0.12)] text-[#6fcf7f]",
          )}
        >
          {saveStatus}
        </div>
      )}

      {/* Embedding progress */}
      <div
        className={cn(
          "overflow-hidden transition-all duration-200 ease-in-out",
          progressVisible && embedProgress ? "max-h-20 opacity-100" : "max-h-0 opacity-0",
        )}
      >
        {embedProgress && (
          <div className="flex flex-col gap-1">
            <div className="h-2 overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-300 ease-in-out"
                style={{
                  width:
                    embedProgress.total > 0
                      ? `${(embedProgress.embedded / embedProgress.total) * 100}%`
                      : "0%",
                }}
              />
            </div>
            <div className="text-[0.75rem] text-muted">
              Embedding {embedProgress.embedded} / {embedProgress.total} documents...
            </div>
          </div>
        )}
      </div>

      {embedStatus && (
        <div
          className={cn(
            "rounded-lg px-3 py-2 text-[0.84rem]",
            embedStatus.startsWith("Error")
              ? "bg-[rgba(255,146,136,0.12)] text-danger"
              : "bg-[rgba(40,200,64,0.12)] text-[#6fcf7f]",
          )}
        >
          {embedStatus}
        </div>
      )}
    </div>
  );
}
