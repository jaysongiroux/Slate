import { desktopApi } from "./ipc-core";
import type { CalendarAttendeeInput } from "@slate/shared";

export function getCalendarStatus() {
  return desktopApi().getCalendarStatus();
}

export function startCalendarOAuth(payload: { providerId: string }) {
  return desktopApi().startCalendarOAuth(payload);
}

export function disconnectCalendar(payload: { connectionId: string }) {
  return desktopApi().disconnectCalendar(payload);
}

export function listCalendars(payload: { connectionId: string }) {
  return desktopApi().listCalendars(payload);
}

export function subscribeCalendar(payload: {
  connectionId: string;
  calendarId: string;
  name: string;
  color?: string;
}) {
  return desktopApi().subscribeCalendar(payload);
}

export function unsubscribeCalendar(payload: { subscriptionId: string }) {
  return desktopApi().unsubscribeCalendar(payload);
}

export function updateCalendarSubscription(payload: {
  subscriptionId: string;
  color?: string;
  enabled?: boolean;
}) {
  return desktopApi().updateCalendarSubscription(payload);
}

export function addIcsSubscription(payload: { url: string; name: string; color?: string }) {
  return desktopApi().addIcsSubscription(payload);
}

export function removeIcsSubscription(payload: { id: string }) {
  return desktopApi().removeIcsSubscription(payload);
}

export function updateIcsSubscription(payload: {
  id: string;
  name?: string;
  color?: string;
  enabled?: boolean;
}) {
  return desktopApi().updateIcsSubscription(payload);
}

export function fetchCalendarEvents(payload: { timeMin: string; timeMax: string }) {
  return desktopApi().fetchCalendarEvents(payload);
}

export function searchCalendarAttendees(payload: { subscriptionId: string; query: string }) {
  return desktopApi().searchCalendarAttendees(payload);
}

export function createCalendarEvent(payload: {
  subscriptionId: string;
  title: string;
  description?: string;
  location?: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  attendees?: CalendarAttendeeInput[];
}) {
  return desktopApi().createCalendarEvent(payload);
}

export function updateCalendarEvent(payload: {
  subscriptionId: string;
  eventId: string;
  title?: string;
  description?: string;
  location?: string;
  startTime?: string;
  endTime?: string;
  allDay?: boolean;
  attendees?: CalendarAttendeeInput[];
}) {
  return desktopApi().updateCalendarEvent(payload);
}

export function deleteCalendarEvent(payload: { subscriptionId: string; eventId: string }) {
  return desktopApi().deleteCalendarEvent(payload);
}

export function rsvpCalendarEvent(payload: {
  subscriptionId: string;
  eventId: string;
  response: string;
}) {
  return desktopApi().rsvpCalendarEvent(payload);
}
