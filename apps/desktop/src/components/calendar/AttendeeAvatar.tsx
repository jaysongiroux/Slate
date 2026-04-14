import { cn } from "../../lib/utils";

interface AttendeeAvatarProps {
  name?: string;
  email: string;
  photoUrl?: string;
  className?: string;
}

function initialsForAttendee(name?: string, email?: string): string {
  const label = name?.trim() || email?.trim() || "?";
  const words = label
    .replace(/<.*?>/g, " ")
    .split(/[\s@._-]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();

  return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
}

export function AttendeeAvatar({ name, email, photoUrl, className }: AttendeeAvatarProps) {
  const initials = initialsForAttendee(name, email);

  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt=""
        className={cn("size-6 shrink-0 rounded-full object-cover", className)}
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-[0.5rem] leading-[1] font-medium uppercase text-muted-foreground",
        className,
      )}
    >
      {initials}
    </span>
  );
}
