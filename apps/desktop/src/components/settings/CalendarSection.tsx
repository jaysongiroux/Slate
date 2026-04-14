import type { CalendarReminderSettings } from "../../lib/api";
import { Select } from "../ui/select";

export interface CalendarSectionProps {
  baseId: string;
  calendarReminderSettings: CalendarReminderSettings;
  calendarReminderSources: { id: string; name: string; color: string }[];
  onCalendarReminderSettingsChange: (value: CalendarReminderSettings) => void;
}

export function CalendarSection({
  baseId,
  calendarReminderSettings,
  calendarReminderSources,
  onCalendarReminderSettingsChange,
}: CalendarSectionProps) {
  return (
    <>
      <label className="flex items-start gap-3 rounded-[12px] border border-white/[0.06] bg-white/[0.03] px-3 py-3 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-white"
          checked={calendarReminderSettings.enabled}
          onChange={(event) =>
            onCalendarReminderSettingsChange({
              ...calendarReminderSettings,
              enabled: event.target.checked,
            })
          }
        />
        <span className="grid gap-1">
          <span className="text-[0.9rem] font-medium text-foreground">Remind me before events</span>
          <span className="text-[0.8rem] leading-snug text-faint">
            Show a desktop notification before an event starts.
          </span>
        </span>
      </label>

      <div className="grid gap-1.5">
        <label
          className="text-[0.84rem] text-muted"
          htmlFor={`${baseId}-calendar-reminder-minutes`}
        >
          Minutes before start
        </label>
        <Select
          id={`${baseId}-calendar-reminder-minutes`}
          value={String(calendarReminderSettings.minutesBeforeStart)}
          disabled={!calendarReminderSettings.enabled}
          onChange={(event) =>
            onCalendarReminderSettingsChange({
              ...calendarReminderSettings,
              minutesBeforeStart: Number(event.target.value),
            })
          }
        >
          {[1, 5, 10, 15, 30].map((minutes) => (
            <option key={minutes} value={minutes}>
              {minutes}
            </option>
          ))}
        </Select>
      </div>

      <label className="flex items-start gap-3 rounded-[12px] border border-white/[0.06] bg-white/[0.03] px-3 py-3 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-white"
          checked={calendarReminderSettings.playSound}
          disabled={!calendarReminderSettings.enabled}
          onChange={(event) =>
            onCalendarReminderSettingsChange({
              ...calendarReminderSettings,
              playSound: event.target.checked,
            })
          }
        />
        <span className="grid gap-1">
          <span className="text-[0.9rem] font-medium text-foreground">Play sound</span>
          <span className="text-[0.8rem] leading-snug text-faint">
            Use the system notification sound when a reminder fires.
          </span>
        </span>
      </label>

      {calendarReminderSources.length > 0 ? (
        <div className="grid gap-2 rounded-[12px] border border-white/[0.06] bg-white/[0.03] px-3 py-3">
          <div className="text-[0.84rem] font-medium text-foreground">Calendars</div>
          <div className="grid gap-2">
            {calendarReminderSources.map((source) => {
              const enabledIds = calendarReminderSettings.enabledCalendarIds;
              const checked = !enabledIds || enabledIds.includes(source.id);
              return (
                <label
                  key={source.id}
                  className="flex items-center gap-2.5 text-[0.84rem] text-muted"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-white"
                    checked={checked}
                    disabled={!calendarReminderSettings.enabled}
                    onChange={(event) => {
                      const currentIds =
                        calendarReminderSettings.enabledCalendarIds ??
                        calendarReminderSources.map((entry) => entry.id);
                      const nextIds = event.target.checked
                        ? [...currentIds, source.id]
                        : currentIds.filter((id) => id !== source.id);
                      onCalendarReminderSettingsChange({
                        ...calendarReminderSettings,
                        enabledCalendarIds:
                          nextIds.length === calendarReminderSources.length ? null : nextIds,
                      });
                    }}
                  />
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: source.color }}
                  />
                  <span className="truncate">{source.name}</span>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}
    </>
  );
}
