import { useEffect, useMemo, useRef, useState } from "react";
import type { CalendarInfo } from "@slate/shared";
import { useWorkspaceStore } from "../stores/workspace-store";
import { filtersEqual, reconcileCalendarVisibilityFilters } from "../lib/app-helpers";
import {
  getCalendarStatus,
  getCalendarReminderSettings,
  getCalendarVisibilityFilters,
  setCalendarReminderSettings,
  setCalendarVisibilityFilters,
  type CalendarReminderSettings,
  type CalendarStatusResponse,
  type CalendarVisibilityFilters,
} from "../lib/api";
import { SLATE_DAILY_NOTE_SOURCE } from "../lib/calendar-daily-notes";
import { slateDiagLog } from "../lib/slate-diag-log";

const CREATE_EVENT_DISABLED_REASON = "Enable or connect a writable calendar to create events.";
const DEFAULT_CALENDAR_REMINDER_SETTINGS: CalendarReminderSettings = {
  enabled: false,
  minutesBeforeStart: 10,
  playSound: true,
  enabledCalendarIds: null,
};

export { CREATE_EVENT_DISABLED_REASON, DEFAULT_CALENDAR_REMINDER_SETTINGS };

export function useCalendarState() {
  const backend = useWorkspaceStore((s) => s.snapshot.backend);

  const [calendarStatus, setCalendarStatus] = useState<CalendarStatusResponse | null>(null);
  const [calendarVisibilityFilters, setCalendarVisibilityFiltersState] =
    useState<CalendarVisibilityFilters | null>(null);
  const [calendarReminderSettings, setCalendarReminderSettingsState] =
    useState<CalendarReminderSettings>(DEFAULT_CALENDAR_REMINDER_SETTINGS);
  const [calendarSidebarRefreshSignal, setCalendarSidebarRefreshSignal] = useState(0);
  const [calendarViewRefreshSignal, setCalendarViewRefreshSignal] = useState(0);
  const createEventClosedAt = useRef(0);

  // Fetch calendar status on auth/reachable change
  useEffect(() => {
    if (backend.authStatus !== "authenticated" || !backend.backendReachable) {
      setCalendarStatus(null);
      return;
    }

    let cancelled = false;
    getCalendarStatus()
      .then((status) => {
        if (cancelled) return;
        slateDiagLog("renderer.calendar", "get_calendar_status_ok", {
          connectionCount: status.connections?.length ?? 0,
        });
        setCalendarStatus(status);
      })
      .catch((err) => {
        slateDiagLog("renderer.calendar", "get_calendar_status_failed", {
          message: err instanceof Error ? err.message : String(err),
        });
        if (!cancelled) setCalendarStatus(null);
      });

    return () => {
      cancelled = true;
    };
  }, [backend.authStatus, backend.backendReachable]);

  // Reconcile visibility filters when calendar status changes
  useEffect(() => {
    if (!calendarStatus) return;

    const reconciled = reconcileCalendarVisibilityFilters(
      calendarStatus,
      calendarVisibilityFilters,
    );
    if (!filtersEqual(calendarVisibilityFilters, reconciled)) {
      setCalendarVisibilityFiltersState(reconciled);
      void setCalendarVisibilityFilters(reconciled);
    }
  }, [calendarStatus, calendarVisibilityFilters]);

  // --- Memoized derivations ---

  const selectedCalendarIds = useMemo(
    () =>
      calendarVisibilityFilters?.selectedCalendarIds ??
      (calendarStatus
        ? calendarStatus.connections.flatMap((connection) =>
            connection.calendars
              .filter((calendar) => calendar.enabled)
              .map((calendar) => calendar.subscriptionId),
          )
        : []),
    [calendarStatus, calendarVisibilityFilters],
  );

  const selectedIcsIds = useMemo(
    () =>
      calendarVisibilityFilters?.selectedIcsIds ??
      (calendarStatus
        ? calendarStatus.icsSubscriptions
            .filter((subscription) => subscription.enabled)
            .map((subscription) => subscription.id)
        : []),
    [calendarStatus, calendarVisibilityFilters],
  );

  const selectedProviderCalendarIds = useMemo(
    () =>
      calendarStatus
        ? calendarStatus.connections.flatMap((connection) =>
            connection.calendars
              .filter(
                (calendar) =>
                  calendar.enabled && selectedCalendarIds.includes(calendar.subscriptionId),
              )
              .map((calendar) => calendar.calendarId),
          )
        : [],
    [calendarStatus, selectedCalendarIds],
  );

  const calendarNameBySourceId = useMemo(() => {
    const base: Record<string, string> = {
      [SLATE_DAILY_NOTE_SOURCE]: "Daily notes",
    };
    if (!calendarStatus) return base;

    return {
      ...base,
      ...Object.fromEntries(
        calendarStatus.connections.flatMap((connection) =>
          connection.calendars
            .filter((calendar) => calendar.enabled)
            .flatMap((calendar) => [
              [calendar.subscriptionId, calendar.name],
              [calendar.calendarId, calendar.name],
            ]),
        ),
      ),
      ...Object.fromEntries(
        calendarStatus.icsSubscriptions
          .filter((subscription) => subscription.enabled)
          .flatMap((subscription) => [[subscription.id, subscription.name]]),
      ),
    };
  }, [calendarStatus]);

  const selectedCalendarIdSet = new Set(selectedCalendarIds);
  const selectedIcsIdSet = new Set(selectedIcsIds);

  const writableCalendars: CalendarInfo[] = useMemo(
    () =>
      calendarStatus
        ? calendarStatus.connections.flatMap((connection) =>
            connection.calendars.filter((calendar) => calendar.enabled),
          )
        : [],
    [calendarStatus],
  );

  const calendarReminderSources = useMemo(
    () =>
      calendarStatus
        ? [
            ...calendarStatus.connections.flatMap((connection) =>
              connection.calendars
                .filter((calendar) => calendar.enabled)
                .map((calendar) => ({
                  id: calendar.subscriptionId,
                  name: calendar.name,
                  color: calendar.color,
                })),
            ),
            ...calendarStatus.icsSubscriptions
              .filter((subscription) => subscription.enabled)
              .map((subscription) => ({
                id: subscription.id,
                name: subscription.name,
                color: subscription.color,
              })),
          ]
        : [],
    [calendarStatus],
  );

  const canCreateEvent =
    backend.authStatus === "authenticated" &&
    backend.backendReachable &&
    writableCalendars.length > 0;

  // --- Handlers ---

  function updateCalendarReminderSettings(
    update:
      | CalendarReminderSettings
      | ((current: CalendarReminderSettings) => CalendarReminderSettings),
  ) {
    setCalendarReminderSettingsState((current) => {
      const next = typeof update === "function" ? update(current) : update;
      void setCalendarReminderSettings(next);
      return next;
    });
  }

  function updateCalendarVisibilityFilters(next: CalendarVisibilityFilters) {
    setCalendarVisibilityFiltersState(next);
    void setCalendarVisibilityFilters(next);
  }

  const persistedShowDailyNotes = calendarVisibilityFilters?.showDailyNotes !== false;

  function handleToggleCalendarVisibility(subscriptionId: string) {
    const nextSelectedCalendarIds = selectedCalendarIds.includes(subscriptionId)
      ? selectedCalendarIds.filter((id) => id !== subscriptionId)
      : [...selectedCalendarIds, subscriptionId];
    updateCalendarVisibilityFilters({
      selectedCalendarIds: nextSelectedCalendarIds,
      selectedIcsIds,
      knownCalendarIds:
        calendarVisibilityFilters?.knownCalendarIds ??
        writableCalendars.map((calendar) => calendar.subscriptionId),
      knownIcsIds:
        calendarVisibilityFilters?.knownIcsIds ??
        (calendarStatus?.icsSubscriptions ?? [])
          .filter((subscription) => subscription.enabled)
          .map((subscription) => subscription.id),
      showDailyNotes: persistedShowDailyNotes,
    });
  }

  function handleToggleIcsVisibility(id: string) {
    const nextSelectedIcsIds = selectedIcsIds.includes(id)
      ? selectedIcsIds.filter((entryId) => entryId !== id)
      : [...selectedIcsIds, id];
    updateCalendarVisibilityFilters({
      selectedCalendarIds,
      selectedIcsIds: nextSelectedIcsIds,
      knownCalendarIds:
        calendarVisibilityFilters?.knownCalendarIds ??
        writableCalendars.map((calendar) => calendar.subscriptionId),
      knownIcsIds:
        calendarVisibilityFilters?.knownIcsIds ??
        (calendarStatus?.icsSubscriptions ?? [])
          .filter((subscription) => subscription.enabled)
          .map((subscription) => subscription.id),
      showDailyNotes: persistedShowDailyNotes,
    });
  }

  function handleToggleDailyNotesVisibility() {
    updateCalendarVisibilityFilters({
      selectedCalendarIds,
      selectedIcsIds,
      knownCalendarIds:
        calendarVisibilityFilters?.knownCalendarIds ??
        writableCalendars.map((calendar) => calendar.subscriptionId),
      knownIcsIds:
        calendarVisibilityFilters?.knownIcsIds ??
        (calendarStatus?.icsSubscriptions ?? [])
          .filter((subscription) => subscription.enabled)
          .map((subscription) => subscription.id),
      showDailyNotes: !persistedShowDailyNotes,
    });
  }

  return {
    calendarStatus,
    setCalendarStatus,
    calendarVisibilityFilters,
    calendarReminderSettings,
    calendarSidebarRefreshSignal,
    setCalendarSidebarRefreshSignal,
    calendarViewRefreshSignal,
    setCalendarViewRefreshSignal,
    createEventClosedAt,
    selectedCalendarIds,
    selectedIcsIds,
    selectedProviderCalendarIds,
    calendarNameBySourceId,
    selectedCalendarIdSet,
    selectedIcsIdSet,
    writableCalendars,
    calendarReminderSources,
    canCreateEvent,
    updateCalendarReminderSettings,
    handleToggleCalendarVisibility,
    handleToggleIcsVisibility,
    handleToggleDailyNotesVisibility,
    showDailyNotesOnCalendar: persistedShowDailyNotes,
    // Expose for initializeApp
    setCalendarVisibilityFiltersState,
    setCalendarReminderSettingsState,
    DEFAULT_CALENDAR_REMINDER_SETTINGS,
  };
}
