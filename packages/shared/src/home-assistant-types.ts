export const HOME_ASSISTANT_ENABLED_SETTING_KEY = "extensions.homeAssistantEnabled";
export const HOME_ASSISTANT_INSTANCES_SETTING_KEY = "homeAssistant.instances";
export const HOME_ASSISTANT_TOKENS_SETTING_KEY = "homeAssistant.tokens";

export interface HomeAssistantInstance {
  id: string;
  name: string;
  url: string;
}

export interface HomeAssistantDashboardSummary {
  id: string;
  title: string;
  path?: string;
  icon?: string | null;
}

export interface HomeAssistantAreaSummary {
  id: string;
  name: string;
}

export interface HomeAssistantDeviceSummary {
  id: string;
  name: string;
  areaId?: string | null;
  manufacturer?: string | null;
  model?: string | null;
}

export interface HomeAssistantState {
  entityId: string;
  state: string;
  attributes: Record<string, unknown>;
  lastChanged?: string;
  lastUpdated?: string;
}

export interface HomeAssistantEntitySummary {
  entityId: string;
  name: string;
  domain: string;
  areaId?: string | null;
  deviceId?: string | null;
  state?: HomeAssistantState | null;
  supportedControls: HomeAssistantControlKind[];
}

export interface HomeAssistantDashboardEntitySummary {
  dashboard: HomeAssistantDashboardSummary;
  entities: HomeAssistantEntitySummary[];
  stale?: boolean;
}

export type HomeAssistantControlKind =
  | "turn_on"
  | "turn_off"
  | "toggle"
  | "light_brightness"
  | "light_color"
  | "climate_temperature"
  | "scene_run"
  | "script_run";

export interface HomeAssistantControlRequest {
  entityId: string;
  control: HomeAssistantControlKind;
  value?: unknown;
}

export interface HomeAssistantControlResult {
  ok: boolean;
  state?: HomeAssistantState | null;
  /** Guidance for LLMs: e.g. brightness uses turn_on and powers on lights that were off */
  hint?: string;
}

export type HomeAssistantLiveStatus = "connecting" | "connected" | "disconnected" | "error";

export type HomeAssistantLiveEvent =
  | {
      type: "status";
      status: HomeAssistantLiveStatus;
      message?: string;
    }
  | {
      type: "state_changed";
      state: HomeAssistantState;
    }
  | {
      type: "error";
      message: string;
    };

export interface HomeAssistantError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/** One row from Home Assistant `/api/history/period/...` (normalized). */
export interface HomeAssistantHistoryEntry {
  entityId: string;
  state: string;
  lastChanged: string;
  lastUpdated?: string;
}

export interface HomeAssistantEntityHistoryResult {
  entries: HomeAssistantHistoryEntry[];
}
