import type { DesktopSnapshot } from "@slate/shared";
import type { CalendarStatusResponse, CalendarVisibilityFilters } from "./api";
import type { SidebarMode } from "../components/IconRail";

export function isSidebarMode(value: unknown): value is SidebarMode {
  return (
    value === "notes" ||
    value === "chat" ||
    value === "calendar" ||
    value === "graph" ||
    value === "checklists" ||
    value === "linkwarden" ||
    value === "home-assistant" ||
    value === "jira"
  );
}

export function mainPanelModeForSidebarMode(
  mode: SidebarMode,
): "notes" | "calendar" | "checklists" | "linkwarden" | "home-assistant" | "jira" {
  if (mode === "calendar") return "calendar";
  if (mode === "checklists") return "checklists";
  if (mode === "linkwarden") return "linkwarden";
  if (mode === "home-assistant") return "home-assistant";
  if (mode === "jira") return "jira";
  return "notes";
}

export function arraysEqual(a: string[], b: string[]) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function filtersEqual(
  a: CalendarVisibilityFilters | null,
  b: CalendarVisibilityFilters | null,
) {
  if (a === b) return true;
  if (!a || !b) return false;
  const showA = a.showDailyNotes !== false;
  const showB = b.showDailyNotes !== false;
  return (
    arraysEqual(a.selectedCalendarIds, b.selectedCalendarIds) &&
    arraysEqual(a.selectedIcsIds, b.selectedIcsIds) &&
    arraysEqual(a.knownCalendarIds ?? [], b.knownCalendarIds ?? []) &&
    arraysEqual(a.knownIcsIds ?? [], b.knownIcsIds ?? []) &&
    showA === showB
  );
}

export function reconcileCalendarVisibilityFilters(
  status: CalendarStatusResponse,
  persisted: CalendarVisibilityFilters | null,
): CalendarVisibilityFilters {
  const availableCalendarIds = status.connections.flatMap((connection) =>
    connection.calendars
      .filter((calendar) => calendar.enabled)
      .map((calendar) => calendar.subscriptionId),
  );
  const availableIcsIds = status.icsSubscriptions
    .filter((subscription) => subscription.enabled)
    .map((subscription) => subscription.id);

  const previousKnownCalendarIds = new Set(persisted?.knownCalendarIds ?? []);
  const previousKnownIcsIds = new Set(persisted?.knownIcsIds ?? []);
  const selectedCalendarIds = new Set(persisted?.selectedCalendarIds ?? availableCalendarIds);
  const selectedIcsIds = new Set(persisted?.selectedIcsIds ?? availableIcsIds);

  const reconciledCalendarIds = availableCalendarIds.filter(
    (id) => selectedCalendarIds.has(id) || !previousKnownCalendarIds.has(id),
  );
  const reconciledIcsIds = availableIcsIds.filter(
    (id) => selectedIcsIds.has(id) || !previousKnownIcsIds.has(id),
  );

  return {
    selectedCalendarIds: reconciledCalendarIds,
    selectedIcsIds: reconciledIcsIds,
    knownCalendarIds: availableCalendarIds,
    knownIcsIds: availableIcsIds,
    showDailyNotes: persisted?.showDailyNotes !== false,
  };
}

export function stableBackendFingerprint(b: DesktopSnapshot["backend"]): string {
  return JSON.stringify({
    endpoint: b.endpoint,
    clientId: b.clientId,
    backendReachable: b.backendReachable,
    authStatus: b.authStatus,
    authProviders: b.authProviders,
    authenticatedUserId: b.authenticatedUserId,
    authenticatedEmail: b.authenticatedEmail,
    authenticatedDisplayName: b.authenticatedDisplayName,
    authenticatedIsAdmin: b.authenticatedIsAdmin,
    tokenExpiresAtUnix: b.tokenExpiresAtUnix,
  });
}

export function initialSnapshot(): DesktopSnapshot {
  return {
    backend: {
      endpoint: "localhost:4000",
      clientId: "loading",
      backendReachable: false,
      authStatus: "signed_out",
      authProviders: [],
    },
    notes: [],
    folders: [],
  };
}
