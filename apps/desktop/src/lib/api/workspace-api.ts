import type { SidebarMode } from "../../components/IconRail";
import type {
  CalendarVisibilityFilters,
  CalendarReminderSettings,
  ContextMenuItem,
} from "./ipc-core";
import { desktopApi } from "./ipc-core";

export function importFolder() {
  return desktopApi().importFolder();
}

export function importFiles() {
  return desktopApi().importFiles();
}

export function showContextMenu(items: ContextMenuItem[]) {
  return desktopApi().showContextMenu(items);
}

export function getLastOpenNoteId() {
  return desktopApi().getLastOpenNoteId();
}

export function setLastOpenNoteId(noteId: string) {
  return desktopApi().setLastOpenNoteId(noteId);
}

export function getLastSidebarMode() {
  return desktopApi().getLastSidebarMode();
}

export function setLastSidebarMode(mode: SidebarMode) {
  return desktopApi().setLastSidebarMode(mode);
}

export function getCalendarVisibilityFilters() {
  return desktopApi().getCalendarVisibilityFilters();
}

export function setCalendarVisibilityFilters(payload: CalendarVisibilityFilters) {
  return desktopApi().setCalendarVisibilityFilters(payload);
}

export function getCalendarReminderSettings() {
  return desktopApi().getCalendarReminderSettings();
}

export function setCalendarReminderSettings(payload: CalendarReminderSettings) {
  return desktopApi().setCalendarReminderSettings(payload);
}

export function getLastCalendarView() {
  return desktopApi().getLastCalendarView();
}

export function setLastCalendarView(view: string) {
  return desktopApi().setLastCalendarView(view);
}

export function getLastCalendarDate() {
  return desktopApi().getLastCalendarDate();
}

export function setLastCalendarDate(date: string) {
  return desktopApi().setLastCalendarDate(date);
}

export function getKeyboardShortcuts() {
  return desktopApi().getKeyboardShortcuts();
}

export function setKeyboardShortcut(action: string, shortcut: string) {
  return desktopApi().setKeyboardShortcut(action, shortcut);
}

export function openExternal(url: string) {
  return desktopApi().openExternal(url);
}
