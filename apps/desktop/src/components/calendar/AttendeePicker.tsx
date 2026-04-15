import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import type { CalendarAttendeeInput, CalendarAttendeeSuggestion } from "@slate/shared";
import { Input } from "../ui/input";
import { searchCalendarAttendees } from "../../lib/api/calendar-api";
import { AttendeeAvatar } from "./AttendeeAvatar";

interface AttendeePickerProps {
  value: CalendarAttendeeInput[];
  onChange: (next: CalendarAttendeeInput[]) => void;
  subscriptionId?: string;
  provider?: string;
  disabled?: boolean;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

function isValidEmail(value: string): boolean {
  return EMAIL_REGEX.test(value.trim());
}

export function AttendeePicker({
  value,
  onChange,
  subscriptionId,
  provider,
  disabled = false,
}: AttendeePickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CalendarAttendeeSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const isGoogle = provider === "google";

  const normalizedQuery = query.trim();
  const normalizedEmails = useMemo(
    () => new Set(value.map((attendee) => attendee.email.trim().toLowerCase())),
    [value],
  );
  const canAddManualEmail =
    normalizedQuery.length > 0 &&
    isValidEmail(normalizedQuery) &&
    !normalizedEmails.has(normalizedQuery.toLowerCase());

  useEffect(() => {
    if (!isGoogle || !subscriptionId || normalizedQuery.length < 2) {
      setResults([]);
      setLoading(false);
      if (!normalizedQuery) setErrorMessage("");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setErrorMessage("");

    const timer = window.setTimeout(() => {
      void searchCalendarAttendees({ subscriptionId, query: normalizedQuery })
        .then((response) => {
          if (cancelled) return;
          setResults(
            (response.attendees ?? []).filter(
              (attendee) => !normalizedEmails.has(attendee.email.trim().toLowerCase()),
            ),
          );
        })
        .catch((error) => {
          if (cancelled) return;
          setResults([]);
          if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "needs_reauth"
          ) {
            setErrorMessage(
              "Reconnect Google to enable attendee search. You can still add emails manually.",
            );
            return;
          }
          setErrorMessage(error instanceof Error ? error.message : "Failed to search attendees.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isGoogle, normalizedEmails, normalizedQuery, subscriptionId]);

  function addAttendee(attendee: CalendarAttendeeInput) {
    const email = attendee.email.trim();
    if (!email) return;
    const deduped = value.filter(
      (entry) => entry.email.trim().toLowerCase() !== email.toLowerCase(),
    );
    onChange([
      ...deduped,
      {
        email,
        displayName: attendee.displayName?.trim() || undefined,
        photoUrl: attendee.photoUrl,
      },
    ]);
    setQuery("");
    setResults([]);
    setErrorMessage("");
  }

  function removeAttendee(email: string) {
    onChange(value.filter((attendee) => attendee.email !== email));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" && event.key !== ",") return;
    event.preventDefault();
    if (canAddManualEmail) {
      addAttendee({ email: normalizedQuery });
      return;
    }
    if (results.length > 0) {
      addAttendee(results[0]);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-[0.8rem] text-muted" htmlFor="event-attendees-input">
        Attendees
      </label>

      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((attendee) => (
            <span
              key={attendee.email}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white/[0.05] px-1.5 py-1 text-[0.72rem] text-foreground"
              title={attendee.displayName ? attendee.email : undefined}
            >
              <AttendeeAvatar
                name={attendee.displayName}
                email={attendee.email}
                photoUrl={attendee.photoUrl}
                className="size-5"
              />
              <span className="max-w-[220px] truncate">
                {attendee.displayName || attendee.email}
              </span>
              {!disabled ? (
                <button
                  type="button"
                  className="cursor-pointer text-faint transition-colors hover:text-foreground"
                  onClick={() => removeAttendee(attendee.email)}
                  aria-label={`Remove ${attendee.email}`}
                >
                  <X size={12} />
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}

      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-faint">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
        </div>
        <Input
          id="event-attendees-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            isGoogle ? "Search by name or email, or type an email" : "Type an email and press Enter"
          }
          variant="bordered"
          className="pl-9 pr-20"
          disabled={disabled}
        />
        {canAddManualEmail ? (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-md bg-white/[0.07] px-2 py-1 text-[0.68rem] text-muted-foreground transition-colors hover:bg-white/[0.12] hover:text-foreground"
            onClick={() => addAttendee({ email: normalizedQuery })}
          >
            Add email
          </button>
        ) : null}

        {isGoogle && normalizedQuery.length >= 2 && (results.length > 0 || errorMessage) ? (
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-[10px] border border-border bg-panel-elevated shadow-xl">
            {results.length > 0 ? (
              <div className="max-h-56 overflow-y-auto py-1">
                {results.map((attendee) => (
                  <button
                    key={`${attendee.source}:${attendee.email}`}
                    type="button"
                    className="flex w-full cursor-pointer items-start gap-3 px-3 py-2 text-left transition-colors hover:bg-white/[0.06]"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => addAttendee(attendee)}
                  >
                    <AttendeeAvatar
                      name={attendee.displayName}
                      email={attendee.email}
                      photoUrl={attendee.photoUrl}
                      className="mt-0.5"
                    />
                    <div className="min-w-0">
                      <div className="truncate text-[0.78rem] text-foreground">
                        {attendee.displayName || attendee.email}
                      </div>
                      {attendee.displayName ? (
                        <div className="truncate text-[0.7rem] text-muted-foreground">
                          {attendee.email}
                        </div>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
            {errorMessage ? (
              <div className="border-t border-border px-3 py-2 text-[0.72rem] text-muted-foreground">
                {errorMessage}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="text-[0.72rem] text-faint">
        {isGoogle
          ? "Google calendars can search contacts and workspace directory when available."
          : "Non-Google calendars use manual email entry only."}
      </div>
    </div>
  );
}
