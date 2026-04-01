import { useCallback, useEffect, useState } from "react";
import type {
  AvailableCalendar,
  CalendarConnectionInfo,
  CalendarStatusResponse,
  IcsSubscriptionInfo,
} from "@slate/shared";
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  Link2,
  Loader2,
  LogIn,
  Plus,
  Trash2,
  WifiOff,
} from "lucide-react";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import {
  disconnectCalendar,
  getCalendarStatus,
  listCalendars,
  removeIcsSubscription,
  showContextMenu,
  startCalendarOAuth,
  subscribeCalendar,
  updateCalendarSubscription,
} from "../lib/api";

interface CalendarSidebarProps {
  backendReachable: boolean;
  backendAuthenticated: boolean;
  selectedCalendarIds: Set<string>;
  selectedIcsIds: Set<string>;
  onToggleCalendarVisibility: (subscriptionId: string) => void;
  onToggleIcsVisibility: (id: string) => void;
  onStatusChange?: (status: CalendarStatusResponse | null) => void;
  onOpenSettings: () => void;
  onOpenAddIcs: () => void;
}

export function CalendarSidebar({
  backendReachable,
  backendAuthenticated,
  selectedCalendarIds,
  selectedIcsIds,
  onToggleCalendarVisibility,
  onToggleIcsVisibility,
  onStatusChange,
  onOpenSettings,
  onOpenAddIcs,
}: CalendarSidebarProps) {
  const [status, setStatus] = useState<CalendarStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedConnections, setExpandedConnections] = useState<Set<string>>(new Set());
  const [availableCalendars, setAvailableCalendars] = useState<Record<string, AvailableCalendar[]>>(
    {},
  );
  const [loadingCalendars, setLoadingCalendars] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    if (!backendAuthenticated) {
      setStatus(null);
      onStatusChange?.(null);
      setLoading(false);
      return;
    }

    try {
      const result = await getCalendarStatus();
      setStatus(result);
      onStatusChange?.(result);
    } catch {
      setStatus(null);
      onStatusChange?.(null);
    } finally {
      setLoading(false);
    }
  }, [backendAuthenticated, onStatusChange]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!backendAuthenticated) return;
    const id = window.setInterval(() => {
      void refresh();
    }, 15_000);
    return () => window.clearInterval(id);
  }, [backendAuthenticated, refresh]);

  async function handleConnectProvider(providerId: string) {
    await startCalendarOAuth({ providerId });
  }

  async function handleDisconnect(connectionId: string) {
    await disconnectCalendar({ connectionId });
    await refresh();
  }

  async function toggleExpanded(connectionId: string) {
    const next = new Set(expandedConnections);
    if (next.has(connectionId)) {
      next.delete(connectionId);
      setExpandedConnections(next);
      return;
    }

    next.add(connectionId);
    setExpandedConnections(next);

    if (availableCalendars[connectionId]) return;

    setLoadingCalendars((current) => new Set([...current, connectionId]));
    try {
      const result = await listCalendars({ connectionId });
      setAvailableCalendars((current) => ({ ...current, [connectionId]: result.calendars ?? [] }));
    } finally {
      setLoadingCalendars((current) => {
        const nextLoading = new Set(current);
        nextLoading.delete(connectionId);
        return nextLoading;
      });
    }
  }

  async function handleToggleCalendar(
    connection: CalendarConnectionInfo,
    calendar: AvailableCalendar,
  ) {
    const existing = connection.calendars.find((entry) => entry.calendarId === calendar.calendarId);
    if (existing) {
      await updateCalendarSubscription({
        subscriptionId: existing.subscriptionId,
        enabled: !existing.enabled,
      });
    } else {
      await subscribeCalendar({
        connectionId: connection.id,
        calendarId: calendar.calendarId,
        name: calendar.name,
        color: calendar.color,
      });
    }
    await refresh();
  }

  async function handleRemoveIcs(id: string) {
    await removeIcsSubscription({ id });
    await refresh();
  }

  async function handleIcsContextMenu(event: React.MouseEvent, subscription: IcsSubscriptionInfo) {
    event.preventDefault();
    const selected = await showContextMenu([{ id: "remove", label: "Remove ICS Feed" }]);
    if (selected === "remove") {
      await handleRemoveIcs(subscription.id);
    }
  }

  if (!backendReachable || !backendAuthenticated) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <div className="flex size-10 items-center justify-center rounded-full bg-white/[0.06]">
          {!backendReachable ? (
            <WifiOff size={18} className="text-faint" />
          ) : (
            <LogIn size={18} className="text-faint" />
          )}
        </div>
        <p className="m-0 text-[0.85rem] leading-snug text-muted">
          {!backendReachable
            ? "Calendar requires a backend connection."
            : "Sign in to your backend to use calendars."}
        </p>
        <Button size="sm" variant="secondary" onClick={onOpenSettings}>
          {!backendReachable ? "Connect backend" : "Sign in"}
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 size={18} className="animate-spin text-faint" />
      </div>
    );
  }

  const subscribedCalendars = (status?.connections ?? []).flatMap((connection) =>
    connection.calendars
      .filter((calendar) => calendar.enabled)
      .map((calendar) => ({
        connectionId: connection.id,
        connectionEmail: connection.email,
        subscriptionId: calendar.subscriptionId,
        name: calendar.name,
        color: calendar.color,
      })),
  );
  const enabledIcsSubscriptions = (status?.icsSubscriptions ?? []).filter(
    (subscription) => subscription.enabled,
  );

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-1.5 flex w-full items-center justify-between text-[0.88rem] text-muted">
        <span
          className="text-[0.9rem] font-normal tracking-wide text-foreground"
          style={{ userSelect: "none" }}
        >
          Calendars
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="inline-flex size-[22px] cursor-pointer items-center justify-center rounded-full bg-transparent text-faint hover:bg-white/[0.08] hover:text-foreground"
              onClick={onOpenAddIcs}
              aria-label="Add ICS feed"
            >
              <Link2 size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Add ICS feed</TooltipContent>
        </Tooltip>
      </div>

      <ScrollArea className="flex min-h-0 flex-1 flex-col [&_.ui-scroll-area__viewport]:overflow-x-hidden! [&_.ui-scroll-area__scrollbar--horizontal]:hidden">
        <div className="flex flex-col gap-3 pr-2 pb-3">
          {subscribedCalendars.length > 0 || enabledIcsSubscriptions.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2 px-1.5 py-1 text-[0.8rem] uppercase tracking-wider text-faint">
                <Calendar size={12} />
                Calendars
              </div>
              {subscribedCalendars.map((calendar) => (
                <label
                  key={calendar.subscriptionId}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[0.8rem] text-muted hover:bg-white/[0.06] hover:text-foreground"
                >
                  <input
                    type="checkbox"
                    className="accent-[var(--accent-strong)]"
                    checked={selectedCalendarIds.has(calendar.subscriptionId)}
                    onChange={() => onToggleCalendarVisibility(calendar.subscriptionId)}
                  />
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: calendar.color }}
                  />
                  <span className="min-w-0 flex-1 truncate">{calendar.name}</span>
                </label>
              ))}
              {enabledIcsSubscriptions.map((subscription) => (
                <label
                  key={subscription.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[0.8rem] text-muted hover:bg-white/[0.06] hover:text-foreground"
                  onContextMenu={(event) => void handleIcsContextMenu(event, subscription)}
                >
                  <input
                    type="checkbox"
                    className="accent-[var(--accent-strong)]"
                    checked={selectedIcsIds.has(subscription.id)}
                    onChange={() => onToggleIcsVisibility(subscription.id)}
                  />
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: subscription.color }}
                  />
                  <span className="min-w-0 flex-1 truncate">{subscription.name}</span>
                </label>
              ))}
            </div>
          ) : null}

          {(status?.connections ?? []).map((connection) => (
            <div key={connection.id} className="flex flex-col gap-0.5">
              <button
                type="button"
                className="flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-1.5 py-1 text-left text-[0.82rem] text-foreground hover:bg-white/[0.06]"
                onClick={() => void toggleExpanded(connection.id)}
              >
                {expandedConnections.has(connection.id) ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
                <Calendar size={13} className="text-muted" />
                <span className="min-w-0 flex-1 truncate">{connection.email}</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className="flex size-5 shrink-0 items-center justify-center rounded text-faint hover:bg-white/[0.08] hover:text-danger"
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDisconnect(connection.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                          void handleDisconnect(connection.id);
                        }
                      }}
                      aria-label="Disconnect account"
                    >
                      <Trash2 size={12} />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="right">Disconnect account</TooltipContent>
                </Tooltip>
              </button>

              {expandedConnections.has(connection.id) ? (
                <div className="ml-5 flex flex-col gap-0.5">
                  {loadingCalendars.has(connection.id) ? (
                    <div className="flex items-center gap-2 px-1.5 py-1 text-[0.8rem] text-faint">
                      <Loader2 size={12} className="animate-spin" />
                      Loading calendars...
                    </div>
                  ) : (
                    (availableCalendars[connection.id] ?? []).map((calendar) => {
                      const subscription = connection.calendars.find(
                        (entry) => entry.calendarId === calendar.calendarId,
                      );
                      return (
                        <label
                          key={calendar.calendarId}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[0.8rem] text-muted hover:bg-white/[0.06] hover:text-foreground"
                        >
                          <input
                            type="checkbox"
                            className="accent-[var(--accent-strong)]"
                            checked={subscription?.enabled ?? false}
                            onChange={() => void handleToggleCalendar(connection, calendar)}
                          />
                          <span
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: subscription?.color ?? calendar.color }}
                          />
                          <span className="min-w-0 flex-1 truncate">{calendar.name}</span>
                        </label>
                      );
                    })
                  )}
                </div>
              ) : null}
            </div>
          ))}

          {(status?.providers ?? [])
            .filter((provider) => provider.configured)
            .map((provider) => (
              <button
                key={provider.providerId}
                type="button"
                className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-dashed border-white/[0.08] bg-transparent px-2.5 py-2 text-[0.82rem] text-faint transition-colors hover:border-white/[0.14] hover:text-muted"
                onClick={() => void handleConnectProvider(provider.providerId)}
              >
                <Plus size={14} />
                Connect {provider.label} Calendar
              </button>
            ))}

          {(status?.providers ?? []).every((provider) => !provider.configured) &&
          (status?.connections ?? []).length === 0 ? (
            <div className="px-1.5 py-2 text-[0.8rem] leading-snug text-faint">
              No calendar providers are configured on this server yet. Ask your admin to add Google
              Calendar OAuth credentials.
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
