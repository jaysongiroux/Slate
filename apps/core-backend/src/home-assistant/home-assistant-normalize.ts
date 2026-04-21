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

function addDeviceId(value: unknown, deviceIds: string[]): void {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (!trimmed) return;
  if (!deviceIds.includes(trimmed)) {
    deviceIds.push(trimmed);
  }
}

function visitDashboardNodeForDeviceIds(value: unknown, deviceIds: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      visitDashboardNodeForDeviceIds(item, deviceIds);
    }
    return;
  }

  if (typeof value !== "object" || value === null) {
    return;
  }

  const record = value as Record<string, unknown>;
  // Common Lovelace keys that reference a device.
  addDeviceId(record.device_id, deviceIds);
  addDeviceId(record.deviceId, deviceIds);
  // Some cards use `device` (rare), but keep it lightweight and safe.
  addDeviceId(record.device, deviceIds);

  for (const nestedValue of Object.values(record)) {
    visitDashboardNodeForDeviceIds(nestedValue, deviceIds);
  }
}

export function extractDeviceIdsFromDashboardConfig(config: unknown): string[] {
  const deviceIds: string[] = [];
  visitDashboardNodeForDeviceIds(config, deviceIds);
  return deviceIds;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function extractAreaStrategy(config: unknown): { order: string[]; hidden: Set<string> } | null {
  const strategy = asRecord(asRecord(config).strategy);
  if (strategy.type !== "original-states") {
    return null;
  }
  const areas = asRecord(strategy.areas);
  const hidden = new Set(
    Array.isArray(areas.hidden)
      ? areas.hidden.filter((v): v is string => typeof v === "string")
      : [],
  );
  const order = Array.isArray(areas.order)
    ? areas.order.filter((v): v is string => typeof v === "string")
    : [];
  return { order, hidden };
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
  const entityIdsFromConfig = extractEntityIdsFromDashboardConfig(config);
  const deviceIds =
    entityIdsFromConfig.length === 0 ? extractDeviceIdsFromDashboardConfig(config) : [];
  const entityIdsFromDevices =
    entityIdsFromConfig.length === 0 && deviceIds.length > 0
      ? registryEntries
          .filter((entry) => Boolean(entry.device_id) && deviceIds.includes(entry.device_id!))
          .map((entry) => entry.entity_id)
      : [];

  // Strategy-based dashboards (e.g. HA "Overview" using original-states) don't contain explicit
  // entity references in the config. In that case, build from states/registry and sort by area order.
  const areaStrategy =
    entityIdsFromConfig.length === 0 && deviceIds.length === 0 ? extractAreaStrategy(config) : null;
  const entityIdsFromStrategy = areaStrategy
    ? registryEntries
        .filter((entry) => {
          const areaId = entry.area_id ?? null;
          if (!areaId) return false;
          return !areaStrategy.hidden.has(areaId);
        })
        .sort((a, b) => {
          const aArea = a.area_id ?? "";
          const bArea = b.area_id ?? "";
          const aIdx = areaStrategy.order.indexOf(aArea);
          const bIdx = areaStrategy.order.indexOf(bArea);
          const aRank = aIdx === -1 ? Number.MAX_SAFE_INTEGER : aIdx;
          const bRank = bIdx === -1 ? Number.MAX_SAFE_INTEGER : bIdx;
          if (aRank !== bRank) return aRank - bRank;
          return a.entity_id.localeCompare(b.entity_id);
        })
        .map((entry) => entry.entity_id)
    : [];

  const entities = [...entityIdsFromConfig, ...entityIdsFromDevices, ...entityIdsFromStrategy]
    .filter((id, idx, arr) => arr.indexOf(id) === idx)
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
