import test from "node:test";
import assert from "node:assert/strict";

import { CalendarReminderService } from "./calendar-reminder-service.mjs";

function makeService({
  now = new Date("2026-04-02T12:00:00.000Z"),
  settings = {
    enabled: true,
    minutesBeforeStart: 10,
    playSound: true,
    enabledCalendarIds: null,
  },
  fired = {},
  events = [],
  fetchError = null,
} = {}) {
  const notifications = [];
  const beeps = [];
  const intervals = [];
  const metadataStore = {
    getCalendarReminderSettings: () => settings,
    getCalendarReminderFired: (currentNow = Date.now()) => {
      const cutoff = currentNow - 14 * 24 * 60 * 60 * 1000;
      fired = Object.fromEntries(
        Object.entries(fired).filter(([, entry]) => Date.parse(entry.firedAt) >= cutoff),
      );
      return fired;
    },
    setCalendarReminderFired: (value) => {
      fired = value;
    },
    markCalendarReminderFired: (key, firedAt) => {
      fired[key] = { firedAt };
    },
  };
  const backendClient = {
    fetchCalendarEvents: async () => {
      if (fetchError) throw fetchError;
      return { events };
    },
  };
  class NotificationMock {
    constructor(payload) {
      this.payload = payload;
      notifications.push(payload);
    }
    show() {}
  }

  const service = new CalendarReminderService({
    backendClient,
    metadataStore,
    Notification: NotificationMock,
    soundPlayer: { beep: () => beeps.push(true) },
    now: () => new Date(now),
    setIntervalFn: (fn, ms) => {
      intervals.push({ fn, ms });
      return { ms };
    },
    clearIntervalFn: () => {},
  });

  return {
    service,
    notifications,
    beeps,
    intervals,
    getFired: () => fired,
  };
}

test("calendar reminder service fires one due reminder once", async () => {
  const eventStart = "2026-04-02T12:08:00.000Z";
  const { service, notifications, beeps, getFired } = makeService({
    events: [
      {
        id: "evt-1",
        subscriptionId: "sub-1",
        calendarId: "primary",
        calendarName: "Personal",
        title: "Planning",
        startTime: eventStart,
      },
    ],
  });

  await service.refreshNow();
  await service.refreshNow();

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].title, "Planning");
  assert.match(notifications[0].body, /Personal/);
  assert.equal(beeps.length, 1);
  assert.deepEqual(Object.keys(getFired()), [`evt-1:${eventStart}:10`]);
});

test("calendar reminder service skips reminders when disabled", async () => {
  const { service, notifications } = makeService({
    settings: {
      enabled: false,
      minutesBeforeStart: 10,
      playSound: true,
      enabledCalendarIds: null,
    },
    events: [
      {
        id: "evt-1",
        subscriptionId: "sub-1",
        calendarId: "primary",
        title: "Planning",
        startTime: "2026-04-02T12:08:00.000Z",
      },
    ],
  });

  await service.refreshNow();

  assert.equal(notifications.length, 0);
});

test("calendar reminder service prunes stale fired reminders and ignores old entries", async () => {
  const { service, notifications, getFired } = makeService({
    fired: {
      stale: { firedAt: "2000-01-01T00:00:00.000Z" },
    },
    events: [
      {
        id: "evt-1",
        subscriptionId: "sub-1",
        calendarId: "primary",
        title: "Planning",
        startTime: "2026-04-02T12:08:00.000Z",
      },
    ],
  });

  await service.refreshNow();

  assert.equal(notifications.length, 1);
  assert.deepEqual(Object.keys(getFired()), ["evt-1:2026-04-02T12:08:00.000Z:10"]);
});

test("calendar reminder service filters by enabled calendar ids", async () => {
  const { service, notifications } = makeService({
    settings: {
      enabled: true,
      minutesBeforeStart: 10,
      playSound: false,
      enabledCalendarIds: ["sub-2"],
    },
    events: [
      {
        id: "evt-1",
        subscriptionId: "sub-1",
        calendarId: "primary",
        title: "Planning",
        startTime: "2026-04-02T12:08:00.000Z",
      },
    ],
  });

  await service.refreshNow();

  assert.equal(notifications.length, 0);
});

test("calendar reminder service swallows backend fetch failures", async () => {
  const { service, notifications } = makeService({
    fetchError: new Error("boom"),
  });

  await assert.doesNotReject(async () => {
    await service.refreshNow();
  });
  assert.equal(notifications.length, 0);
});

test("calendar reminder service starts polling every 60 seconds", () => {
  const { service, intervals } = makeService();
  service.start();
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].ms, 60_000);
});

test("calendar reminder service skips events the user declined", async () => {
  const { service, notifications, beeps, getFired } = makeService({
    events: [
      {
        id: "evt-declined",
        subscriptionId: "sub-1",
        calendarId: "primary",
        calendarName: "Personal",
        title: "Standup I skipped",
        startTime: "2026-04-02T12:08:00.000Z",
        attendees: [
          { email: "jason@example.com", self: true, responseStatus: "declined" },
          { email: "other@example.com", responseStatus: "accepted" },
        ],
      },
    ],
  });

  await service.refreshNow();

  assert.equal(notifications.length, 0);
  assert.equal(beeps.length, 0);
  assert.deepEqual(Object.keys(getFired()), []);
});

test("calendar reminder service still notifies for accepted tentative and needsAction", async () => {
  const base = {
    subscriptionId: "sub-1",
    calendarId: "primary",
    calendarName: "Personal",
    startTime: "2026-04-02T12:08:00.000Z",
  };
  const { service, notifications } = makeService({
    events: [
      {
        ...base,
        id: "evt-accepted",
        title: "Accepted",
        attendees: [{ email: "jason@example.com", self: true, responseStatus: "accepted" }],
      },
      {
        ...base,
        id: "evt-tentative",
        title: "Tentative",
        attendees: [{ email: "jason@example.com", self: true, responseStatus: "tentative" }],
      },
      {
        ...base,
        id: "evt-needs",
        title: "Needs action",
        attendees: [{ email: "jason@example.com", self: true, responseStatus: "needsAction" }],
      },
      {
        ...base,
        id: "evt-no-self",
        title: "No self attendee",
        attendees: [{ email: "other@example.com", responseStatus: "declined" }],
      },
      {
        ...base,
        id: "evt-no-attendees",
        title: "Solo event",
      },
    ],
  });

  await service.refreshNow();

  assert.equal(notifications.length, 5);
  assert.deepEqual(
    notifications.map((n) => n.title),
    ["Accepted", "Tentative", "Needs action", "No self attendee", "Solo event"],
  );
});
