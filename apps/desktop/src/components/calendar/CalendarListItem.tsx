interface CalendarListItemProps {
  checked: boolean;
  onChange: () => void;
  color: string;
  name: string;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export function CalendarListItem({
  checked,
  onChange,
  color,
  name,
  onContextMenu,
}: CalendarListItemProps) {
  return (
    <label
      className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[0.8rem] text-muted hover:bg-white/[0.06] hover:text-foreground"
      onContextMenu={onContextMenu}
    >
      <input
        type="checkbox"
        className="accent-[var(--accent-strong)]"
        checked={checked}
        onChange={onChange}
      />
      <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="min-w-0 flex-1 truncate select-none">{name}</span>
    </label>
  );
}
