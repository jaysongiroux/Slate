import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type {
  AvailableCalendar,
  CalendarConnectionInfo,
  CalendarStatusResponse,
  IcsSubscriptionInfo,
} from "@slate/shared";
import { Calendar, ChevronDown, ChevronRight, Loader2, LogIn, Plus, WifiOff } from "lucide-react";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  disconnectCalendar,
  getCalendarStatus,
  listCalendars,
  removeIcsSubscription,
  showContextMenu,
  startCalendarOAuth,
  subscribeCalendar,
  updateCalendarSubscription,
  updateIcsSubscription,
} from "../lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";

interface CalendarSidebarProps {
  backendReachable: boolean;
  backendAuthenticated: boolean;
  selectedCalendarIds: Set<string>;
  selectedIcsIds: Set<string>;
  refreshSignal?: number;
  onToggleCalendarVisibility: (subscriptionId: string) => void;
  onToggleIcsVisibility: (id: string) => void;
  onStatusChange?: (status: CalendarStatusResponse | null) => void;
  onOpenSettings: () => void;
  onOpenAddIcs: () => void;
  onOpenRenameIcs: (subscription: IcsSubscriptionInfo) => void;
}

export function CalendarSidebar({
  backendReachable,
  backendAuthenticated,
  selectedCalendarIds,
  selectedIcsIds,
  refreshSignal = 0,
  onToggleCalendarVisibility,
  onToggleIcsVisibility,
  onStatusChange,
  onOpenSettings,
  onOpenAddIcs,
  onOpenRenameIcs,
}: CalendarSidebarProps) {
  const [status, setStatus] = useState<CalendarStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedConnections, setExpandedConnections] = useState<Set<string>>(new Set());
  const [availableCalendars, setAvailableCalendars] = useState<Record<string, AvailableCalendar[]>>(
    {},
  );
  const [loadingCalendars, setLoadingCalendars] = useState<Set<string>>(new Set());
  const [colorPicker, setColorPicker] = useState<{
    type: "subscription" | "ics";
    id: string;
    currentColor: string;
    pendingColor: string;
  } | null>(null);

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
    setLoading(true);
    void refresh();
  }, [backendAuthenticated, refresh, refreshSignal]);

  useEffect(() => {
    if (!backendAuthenticated) return;
    const id = window.setInterval(() => {
      void refresh();
    }, 15_000);
    return () => window.clearInterval(id);
  }, [backendAuthenticated, refresh]);

  async function handleConnectProvider(providerId: string) {
    await startCalendarOAuth({ providerId });
    await refresh();
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
    const selected = await showContextMenu([
      { id: "rename", label: "Rename ICS Feed" },
      { id: "color", label: "Change Color" },
      { id: "remove", label: "Remove ICS Feed" },
    ]);
    if (selected === "rename") {
      onOpenRenameIcs(subscription);
    } else if (selected === "remove") {
      await handleRemoveIcs(subscription.id);
    } else if (selected === "color") {
      setColorPicker({
        type: "ics",
        id: subscription.id,
        currentColor: subscription.color,
        pendingColor: subscription.color,
      });
    }
  }

  async function handleConnectionContextMenu(event: React.MouseEvent, connectionId: string) {
    event.preventDefault();
    const selected = await showContextMenu([{ id: "disconnect", label: "Disconnect Account" }]);
    if (selected === "disconnect") {
      await handleDisconnect(connectionId);
    }
  }

  async function handleCalendarSubscriptionContextMenu(
    event: React.MouseEvent,
    connection: CalendarConnectionInfo,
    subscriptionId: string,
  ) {
    event.preventDefault();
    const sub = connection.calendars.find((entry) => entry.subscriptionId === subscriptionId);
    const selected = await showContextMenu([
      { id: "color", label: "Change Color" },
      { id: "hide", label: "Hide Calendar" },
      { id: "disconnect", label: "Disconnect Account" },
    ]);
    if (selected === "color" && sub) {
      setColorPicker({
        type: "subscription",
        id: subscriptionId,
        currentColor: sub.color,
        pendingColor: sub.color,
      });
    } else if (selected === "hide") {
      if (sub) {
        await updateCalendarSubscription({ subscriptionId, enabled: false });
        await refresh();
      }
    } else if (selected === "disconnect") {
      await handleDisconnect(connection.id);
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
        connection,
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex size-[22px] cursor-pointer items-center justify-center rounded-full bg-transparent text-faint hover:bg-white/[0.08] hover:text-foreground"
              aria-label="Add calendar"
            >
              <Plus size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[180px]">
            {(status?.providers ?? [])
              .filter((provider) => provider.configured)
              .map((provider) => (
                <DropdownMenuItem
                  key={provider.providerId}
                  onSelect={() => void handleConnectProvider(provider.providerId)}
                >
                  {provider.label} Calendar
                </DropdownMenuItem>
              ))}
            <DropdownMenuItem onSelect={onOpenAddIcs}>ICS Feed</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ScrollArea className="flex min-h-0 flex-1 flex-col [&_.ui-scroll-area__viewport]:overflow-x-hidden! [&_.ui-scroll-area__scrollbar--horizontal]:hidden">
        <div className="flex flex-col gap-1 pr-2 pb-3">
          {subscribedCalendars.length > 0 || enabledIcsSubscriptions.length > 0 ? (
            <>
              {subscribedCalendars.map((calendar) => (
                <label
                  key={calendar.subscriptionId}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[0.8rem] text-muted hover:bg-white/[0.06] hover:text-foreground"
                  onContextMenu={(event) =>
                    void handleCalendarSubscriptionContextMenu(
                      event,
                      calendar.connection,
                      calendar.subscriptionId,
                    )
                  }
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
                  <span className="min-w-0 flex-1 truncate select-none">{calendar.name}</span>
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
                  <span className="min-w-0 flex-1 truncate select-none">{subscription.name}</span>
                </label>
              ))}
            </>
          ) : null}

          {(status?.connections ?? []).map((connection) => (
            <div key={connection.id} className="flex flex-col gap-0.5">
              <button
                type="button"
                className="flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-1.5 py-1 text-left text-[0.82rem] text-foreground hover:bg-white/[0.06]"
                onClick={() => void toggleExpanded(connection.id)}
                onContextMenu={(event) => void handleConnectionContextMenu(event, connection.id)}
              >
                {expandedConnections.has(connection.id) ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
                <Calendar size={13} className="text-muted" />
                <span className="min-w-0 flex-1 truncate select-none">{connection.email}</span>
              </button>

              <AnimatePresence initial={false}>
                {expandedConnections.has(connection.id) && (
                  <motion.div
                    key="calendar-list"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className="ml-2 flex flex-col gap-0.5 overflow-hidden select-none"
                  >
                    {loadingCalendars.has(connection.id) ? (
                      <div className="flex items-center gap-2 px-1.5 py-1 text-[0.8rem] text-faint select-none">
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
                            <span className="min-w-0 flex-1 truncate select-none">
                              {calendar.name}
                            </span>
                          </label>
                        );
                      })
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}

          {(status?.providers ?? []).every((provider) => !provider.configured) &&
          (status?.connections ?? []).length === 0 ? (
            <div className="px-1.5 py-2 text-[0.8rem] leading-snug text-faint select-none">
              No calendar providers are configured on this server yet. Ask your admin to add Google
              Calendar OAuth credentials.
            </div>
          ) : null}
        </div>
      </ScrollArea>

      <Dialog
        open={colorPicker !== null}
        onOpenChange={(open) => {
          if (!open) setColorPicker(null);
        }}
      >
        <DialogContent className="w-[min(420px,calc(100vw-32px))]">
          <DialogHeader className="mb-0">
            <DialogTitle>Change Color</DialogTitle>
          </DialogHeader>
          <div className="flex flex-wrap gap-2 pt-2">
            {CALENDAR_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className="size-8 cursor-pointer rounded-full border-2 transition-transform hover:scale-110"
                style={{
                  backgroundColor: color,
                  borderColor: colorPicker?.pendingColor === color ? "#fff" : "transparent",
                }}
                onClick={() => {
                  if (!colorPicker) return;
                  setColorPicker((current) =>
                    current ? { ...current, pendingColor: color } : current,
                  );
                }}
              />
            ))}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" type="button" onClick={() => setColorPicker(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="button"
              disabled={!colorPicker || colorPicker.pendingColor === colorPicker.currentColor}
              onClick={async () => {
                if (!colorPicker) return;
                if (colorPicker.type === "subscription") {
                  await updateCalendarSubscription({
                    subscriptionId: colorPicker.id,
                    color: colorPicker.pendingColor,
                  });
                } else {
                  await updateIcsSubscription({
                    id: colorPicker.id,
                    color: colorPicker.pendingColor,
                  });
                }
                setColorPicker(null);
                await refresh();
              }}
            >
              Save color
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const CALENDAR_COLORS = [
  "#7c5cdc",
  "#5b7ff5",
  "#36a3f7",
  "#4cc9f0",
  "#2ec4a9",
  "#4caf50",
  "#8bc34a",
  "#ffca28",
  "#ffa726",
  "#f57c00",
  "#ef5350",
  "#ec407a",
  "#ab47bc",
  "#8d6e63",
  "#78909c",
  "#546e7a",
];
