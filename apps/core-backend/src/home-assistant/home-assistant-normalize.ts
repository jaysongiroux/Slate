import type {
  HomeAssistantDashboardEntitySummary,
  HomeAssistantDashboardSummary,
  HomeAssistantEntitySummary,
  HomeAssistantState,
} from "@slate/shared";
import { supportedControlsForEntity } from "./home-assistant-controls";

export interface RawHomeAssistantState {
  entity_id: string;
  state: string;
  attributes?: Record<string, unknown>;
  last_changed?: string;
  last_updated?: string;
}

export interface HomeAssistantEntityRegistryDisplayEntry {
  entity_id: string;
  name_by_user?: string | null;
  name?: string | null;
  original_name?: string | null;
  area_id?: string | null;
  device_id?: string | null;
}

function entityDomain(entityId: string): string {
  return entityId.split(".")[0] ?? "";
}

function fallbackNameFromEntityId(entityId: string): string {
  const [, objectId = entityId] = entityId.split(".");
  return objectId
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function friendlyNameFromAttributes(attributes: Record<string, unknown>): string | null {
  const friendlyName = attributes.friendly_name;
  return typeof friendlyName === "string" && friendlyName.trim() ? friendlyName : null;
}

function displayNameForState(
  state: RawHomeAssistantState,
  registryEntry?: HomeAssistantEntityRegistryDisplayEntry,
): string {
  return (
    registryEntry?.name_by_user?.trim() ||
    registryEntry?.name?.trim() ||
    registryEntry?.original_name?.trim() ||
    friendlyNameFromAttributes(state.attributes ?? {}) ||
    fallbackNameFromEntityId(state.entity_id)
  );
}

export function normalizeHomeAssistantState(raw: RawHomeAssistantState): HomeAssistantState {
  return {
    entityId: raw.entity_id,
    state: raw.state,
    attributes: raw.attributes ?? {},
    lastChanged: raw.last_changed,
    lastUpdated: raw.last_updated,
  };
}

export function normalizeHomeAssistantEntity(
  raw: RawHomeAssistantState,
  registryEntry?: HomeAssistantEntityRegistryDisplayEntry,
): HomeAssistantEntitySummary {
  return {
    entityId: raw.entity_id,
    name: displayNameForState(raw, registryEntry),
    domain: entityDomain(raw.entity_id),
    areaId: registryEntry?.area_id ?? null,
    deviceId: registryEntry?.device_id ?? null,
    state: normalizeHomeAssistantState(raw),
    supportedControls: supportedControlsForEntity(raw.entity_id),
  };
}

function isEntityId(value: string): boolean {
  return /^[a-z_][a-z0-9_]*\.[a-zA-Z0-9_]+$/.test(value);
}

function addEntityId(value: unknown, entityIds: string[]): void {
  if (typeof value === "string" && isEntityId(value) && !entityIds.includes(value)) {
    entityIds.push(value);
  }
}

function visitDashboardNode(value: unknown, entityIds: string[]): void {
  if (typeof value === "string") {
    addEntityId(value, entityIds);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      visitDashboardNode(item, entityIds);
    }
    return;
  }

  if (typeof value !== "object" || value === null) {
    return;
  }

  for (const nestedValue of Object.values(value as Record<string, unknown>)) {
    visitDashboardNode(nestedValue, entityIds);
  }
}

export function extractEntityIdsFromDashboardConfig(config: unknown): string[] {
  const entityIds: string[] = [];
  visitDashboardNode(config, entityIds);
  return entityIds;
}

export function buildDashboardEntitySummary(
  dashboard: HomeAssistantDashboardSummary,
  config: unknown,
  states: RawHomeAssistantState[],
  registryEntries: HomeAssistantEntityRegistryDisplayEntry[] = [],
  stale = false,
): HomeAssistantDashboardEntitySummary {
  const stateByEntityId = new Map(states.map((state) => [state.entity_id, state]));
  const registryByEntityId = new Map(registryEntries.map((entry) => [entry.entity_id, entry]));
  const entities = extractEntityIdsFromDashboardConfig(config)
    .map((entityId) => {
      const state = stateByEntityId.get(entityId);
      if (!state) return null;
      return normalizeHomeAssistantEntity(state, registryByEntityId.get(entityId));
    })
    .filter((entity): entity is HomeAssistantEntitySummary => entity !== null);

  return {
    dashboard,
    entities,
    stale,
  };
}
