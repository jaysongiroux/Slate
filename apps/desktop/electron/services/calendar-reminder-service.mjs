import { format } from "date-fns";

const DEFAULT_POLL_INTERVAL_MS = 60_000;

export class CalendarReminderService {
  constructor({
    backendClient,
    metadataStore,
    Notification,
    icon = undefined,
    soundPlayer = null,
    now = () => new Date(),
    setIntervalFn = globalThis.setInterval,
    clearIntervalFn = globalThis.clearInterval,
  }) {
    this.backendClient = backendClient;
    this.metadataStore = metadataStore;
    this.Notification = Notification;
    this.icon = icon;
    this.soundPlayer = soundPlayer;
    this.now = now;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.intervalHandle = null;
    this.refreshInFlight = null;
  }

  start() {
    if (this.intervalHandle) return;
    this.intervalHandle = this.setIntervalFn(() => {
      void this.refreshNow();
    }, DEFAULT_POLL_INTERVAL_MS);
    void this.refreshNow();
  }

  stop() {
    if (!this.intervalHandle) return;
    this.clearIntervalFn(this.intervalHandle);
    this.intervalHandle = null;
  }

  handleWake() {
    return this.refreshNow();
  }

  async refreshNow() {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this.#refreshNowImpl().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  async #refreshNowImpl() {
    const settings = this.metadataStore.getCalendarReminderSettings();
    if (!settings?.enabled) return;

    const now = this.now();
    const minutesBeforeStart = Math.max(1, Number(settings.minutesBeforeStart) || 10);
    const rangeEnd = new Date(now.getTime() + Math.max(minutesBeforeStart, 60) * 60_000);

    let result;
    try {
      result = await this.backendClient.fetchCalendarEvents({
        timeMin: now.toISOString(),
        timeMax: rangeEnd.toISOString(),
      });
    } catch {
      return;
    }

    const eligibleSourceIds = Array.isArray(settings.enabledCalendarIds)
      ? new Set(settings.enabledCalendarIds)
      : null;
    const fired = this.metadataStore.getCalendarReminderFired(now.getTime());

    for (const event of result?.events ?? []) {
      const sourceId = event.subscriptionId || event.calendarId;
      if (eligibleSourceIds && !eligibleSourceIds.has(sourceId)) continue;
      // Skip events the user has explicitly declined (RSVP "no").
      if (this.#isDeclinedByUser(event)) continue;

      const startTimeMs = Date.parse(event.startTime);
      if (!Number.isFinite(startTimeMs)) continue;

      const msUntilStart = startTimeMs - now.getTime();
      if (msUntilStart < 0 || msUntilStart > minutesBeforeStart * 60_000) continue;

      const reminderKey = `${event.id}:${event.startTime}:${minutesBeforeStart}`;
      if (fired[reminderKey]) continue;

      const notification = new this.Notification({
        title: event.title || "Upcoming event",
        body: `${event.calendarName || event.source?.toUpperCase?.() || "Calendar"} • ${this.#formatEventTime(event)}`,
        icon: this.icon,
        silent: !settings.playSound,
      });
      notification.show?.();

      if (settings.playSound) {
        this.soundPlayer?.beep?.();
      }

      const firedAt = now.toISOString();
      fired[reminderKey] = { firedAt };
      this.metadataStore.markCalendarReminderFired(reminderKey, firedAt, now.getTime());
    }
  }

  #isDeclinedByUser(event) {
    const selfAttendee = event?.attendees?.find((attendee) => attendee?.self);
    return selfAttendee?.responseStatus === "declined";
  }

  #formatEventTime(event) {
    if (event.allDay) return "All day";
    const start = new Date(event.startTime);
    return format(start, "p");
  }
}
