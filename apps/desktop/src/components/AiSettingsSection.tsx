import { useState, useEffect } from 'react';
import {
  CHAT_MODEL_PRESETS,
  EMBEDDING_MODEL_PRESETS,
  getEmbeddingNativeDimensionsHint,
} from "@slate/shared";
import { getAiConfig, updateAiConfig, triggerEmbedding } from '../lib/api';
import type { AiConfigResponse, UpdateAiConfigRequest } from '../lib/api';
import { Button } from './ui/button';

const EMBEDDING_PROVIDERS = ['OPENAI', 'OLLAMA', 'OPENAI_COMPATIBLE'] as const;
const CHAT_PROVIDERS = ['OPENAI', 'ANTHROPIC', 'OLLAMA', 'OPENAI_COMPATIBLE'] as const;

const ENDPOINT_PROVIDERS = new Set(['OLLAMA', 'OPENAI_COMPATIBLE']);
const API_KEY_PROVIDERS = new Set(['OPENAI', 'ANTHROPIC', 'OPENAI_COMPATIBLE']);

const OTHER = '__other__';

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
      <input
        className="ui-input ui-input--bordered"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    );
  }

  const isPreset = options.includes(value);
  const showCustomInput = forceCustom || (value !== '' && !isPreset);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <select
        className="ui-input ui-input--bordered"
        value={showCustomInput ? OTHER : value}
        onChange={(e) => {
          if (e.target.value === OTHER) {
            setForceCustom(true);
            onChange('');
          } else {
            setForceCustom(false);
            onChange(e.target.value);
          }
        }}
      >
        <option value="">-- Select model --</option>
        {options.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
        <option value={OTHER}>Other...</option>
      </select>
      {showCustomInput && (
        <input
          className="ui-input ui-input--bordered"
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
  embeddingProvider: '',
  embeddingModel: '',
  embeddingEndpoint: '',
  embeddingApiKey: '',
  chatProvider: '',
  chatModel: '',
  chatEndpoint: '',
  chatApiKey: '',
};

function configToForm(config: AiConfigResponse): FormState {
  return {
    embeddingProvider: config.embeddingProvider ?? '',
    embeddingModel: config.embeddingModel ?? '',
    embeddingEndpoint: config.embeddingEndpoint ?? '',
    embeddingApiKey: '',
    chatProvider: config.chatProvider ?? '',
    chatModel: config.chatModel ?? '',
    chatEndpoint: config.chatEndpoint ?? '',
    chatApiKey: '',
  };
}

export function AiSettingsSection({ isAuthenticated }: AiSettingsSectionProps) {
  const [form, setForm] = useState<FormState>(defaultForm);
  const [saveStatus, setSaveStatus] = useState('');
  const [embedStatus, setEmbedStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [embedding, setEmbedding] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    void getAiConfig().then((config) => {
      setForm(configToForm(config));
    });
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    return (
      <div className="settings-field__value">Sign in to configure AI settings.</div>
    );
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setSaveStatus('');
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
      setForm((prev) => ({
        ...configToForm(updated),
        // Clear API key fields after save
        embeddingApiKey: '',
        chatApiKey: '',
        // Preserve any unsaved endpoint/model edits that came back from server
        embeddingProvider: updated.embeddingProvider ?? prev.embeddingProvider,
        embeddingModel: updated.embeddingModel ?? prev.embeddingModel,
        embeddingEndpoint: updated.embeddingEndpoint ?? prev.embeddingEndpoint,
        chatProvider: updated.chatProvider ?? prev.chatProvider,
        chatModel: updated.chatModel ?? prev.chatModel,
        chatEndpoint: updated.chatEndpoint ?? prev.chatEndpoint,
      }));
      setSaveStatus('Settings saved.');
      window.dispatchEvent(new CustomEvent('slate-ai-config-changed'));
    } catch (err) {
      setSaveStatus(`Error saving settings: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleReEmbed() {
    const confirmed = confirm('Re-index all documents? This may take a while.');
    if (!confirmed) return;
    setEmbedding(true);
    setEmbedStatus('');
    try {
      const result = await triggerEmbedding();
      setEmbedStatus(`Re-embedding started. ${result.documentsQueued} document(s) queued.`);
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

  const embeddingNativeDimsHint = form.embeddingModel.trim()
    ? getEmbeddingNativeDimensionsHint(form.embeddingModel)
    : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Embedding Model */}
      <div className="settings-section">
        <div className="settings-section__title" style={{ marginBottom: '8px' }}>Embedding Model</div>

        <div className="settings-field">
          <div className="settings-field__label">Provider</div>
          <select
            className="ui-input ui-input--bordered"
            value={form.embeddingProvider}
            onChange={(e) => {
              setField('embeddingProvider', e.target.value);
              setField('embeddingModel', '');
            }}
          >
            <option value="">-- Select provider --</option>
            {EMBEDDING_PROVIDERS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        <div className="settings-field">
          <div className="settings-field__label">Model</div>
          <ModelSelect
            provider={form.embeddingProvider}
            presets={EMBEDDING_MODEL_PRESETS}
            value={form.embeddingModel}
            onChange={(v) => setField('embeddingModel', v)}
            placeholder="e.g. text-embedding-3-small"
          />
        </div>

        {showEmbeddingEndpoint && (
          <div className="settings-field">
            <div className="settings-field__label">Endpoint</div>
            <input
              className="ui-input ui-input--bordered"
              value={form.embeddingEndpoint}
              onChange={(e) => setField('embeddingEndpoint', e.target.value)}
              placeholder="http://localhost:11434"
            />
          </div>
        )}

        {showEmbeddingApiKey && (
          <div className="settings-field">
            <div className="settings-field__label">API key</div>
            <input
              className="ui-input ui-input--bordered"
              type="password"
              value={form.embeddingApiKey}
              onChange={(e) => setField('embeddingApiKey', e.target.value)}
              placeholder="Leave blank to keep existing key"
              autoComplete="off"
            />
          </div>
        )}
      </div>

      {/* Chat Model */}
      <div className="settings-section">
        <div className="settings-section__title" style={{ marginBottom: '8px' }}>Chat Model</div>

        <div className="settings-field">
          <div className="settings-field__label">Provider</div>
          <select
            className="ui-input ui-input--bordered"
            value={form.chatProvider}
            onChange={(e) => {
              setField('chatProvider', e.target.value);
              setField('chatModel', '');
            }}
          >
            <option value="">-- Select provider --</option>
            {CHAT_PROVIDERS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        <div className="settings-field">
          <div className="settings-field__label">Model</div>
          <ModelSelect
            provider={form.chatProvider}
            presets={CHAT_MODEL_PRESETS}
            value={form.chatModel}
            onChange={(v) => setField('chatModel', v)}
            placeholder="e.g. gpt-4o"
          />
        </div>

        {showChatEndpoint && (
          <div className="settings-field">
            <div className="settings-field__label">Endpoint</div>
            <input
              className="ui-input ui-input--bordered"
              value={form.chatEndpoint}
              onChange={(e) => setField('chatEndpoint', e.target.value)}
              placeholder="http://localhost:11434"
            />
          </div>
        )}

        {showChatApiKey && (
          <div className="settings-field">
            <div className="settings-field__label">API key</div>
            <input
              className="ui-input ui-input--bordered"
              type="password"
              value={form.chatApiKey}
              onChange={(e) => setField('chatApiKey', e.target.value)}
              placeholder="Leave blank to keep existing key"
              autoComplete="off"
            />
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="settings-field__row">
        <Button variant="primary" onClick={() => void handleSave()} disabled={saving}>
          {saving ? 'Saving...' : 'Save AI settings'}
        </Button>
        <Button variant="secondary" onClick={() => void handleReEmbed()} disabled={embedding}>
          {embedding ? 'Starting...' : 'Re-scan documents'}
        </Button>
      </div>

      {saveStatus && (
        <div className={`settings-connection ${saveStatus.startsWith('Error') ? 'settings-connection--error' : 'settings-connection--success'}`}>
          {saveStatus}
        </div>
      )}

      {embedStatus && (
        <div className={`settings-connection ${embedStatus.startsWith('Error') ? 'settings-connection--error' : 'settings-connection--success'}`}>
          {embedStatus}
        </div>
      )}
    </div>
  );
}
