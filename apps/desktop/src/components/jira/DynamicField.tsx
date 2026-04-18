import type { JiraFieldAllowedValue, JiraFieldMeta } from "@slate/shared";

/**
 * Renders a form input for a Jira field based on its schema and allowed values.
 * Handles: string, number, option (select), array of options (multi-select),
 * and array of strings.
 */
export function DynamicField({
  field,
  value,
  onChange,
}: {
  field: JiraFieldMeta;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const { schema, allowedValues } = field;

  // Option field (object with allowedValues) → select dropdown
  if (allowedValues && allowedValues.length > 0 && schema.type !== "array") {
    return (
      <select
        value={typeof value === "string" ? value : (value as Record<string, string>)?.id ?? ""}
        onChange={(e) => {
          const selected = allowedValues.find((v: JiraFieldAllowedValue) => v.id === e.target.value);
          onChange(selected ? { id: selected.id } : null);
        }}
        className="w-full min-w-0 appearance-none rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[0.85rem] text-foreground outline-none focus:border-white/[0.15]"
      >
        <option value="">Select...</option>
        {allowedValues.map((v: JiraFieldAllowedValue) => (
          <option key={v.id} value={v.id}>
            {v.name ?? v.value ?? v.id}
          </option>
        ))}
      </select>
    );
  }

  // Array of options (multi-select)
  if (schema.type === "array" && allowedValues && allowedValues.length > 0) {
    const rawArr = Array.isArray(value) ? (value as Array<string | { id?: string }>) : [];
    const selected: string[] = rawArr.map((v) => (typeof v === "string" ? v : v?.id ?? ""));

    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        <select
          value=""
          onChange={(e) => {
            if (!e.target.value) return;
            const opt = allowedValues.find((v: JiraFieldAllowedValue) => v.id === e.target.value);
            if (opt && !selected.includes(opt.id)) {
              onChange([...selected.map((id) => ({ id })), { id: opt.id }]);
            }
            e.target.value = "";
          }}
          className="w-full min-w-0 appearance-none rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[0.85rem] text-foreground outline-none focus:border-white/[0.15]"
        >
          <option value="">Add...</option>
          {allowedValues
            .filter((v: JiraFieldAllowedValue) => !selected.includes(v.id))
            .map((v: JiraFieldAllowedValue) => (
              <option key={v.id} value={v.id}>
                {v.name ?? v.value ?? v.id}
              </option>
            ))}
        </select>
        {selected.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {selected.map((id) => {
              const opt = allowedValues.find((v: JiraFieldAllowedValue) => v.id === id);
              return (
                <span
                  key={id}
                  className="flex items-center gap-1 rounded-full bg-white/[0.08] px-2 py-0.5 text-[0.75rem] text-muted"
                >
                  {opt?.name ?? opt?.value ?? id}
                  <button
                    type="button"
                    className="inline-flex cursor-pointer items-center border-0 bg-transparent p-0 text-faint hover:text-foreground"
                    onClick={() => onChange(selected.filter((s) => s !== id).map((s) => ({ id: s })))}
                  >
                    &times;
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Array of strings (no allowedValues)
  if (schema.type === "array") {
    const strVal = Array.isArray(value) ? (value as string[]).join(", ") : (typeof value === "string" ? value : "");
    return (
      <input
        type="text"
        value={strVal}
        onChange={(e) => onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
        placeholder="value1, value2, ..."
        className="w-full min-w-0 rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[0.85rem] text-foreground outline-none placeholder:text-faint focus:border-white/[0.15]"
      />
    );
  }

  // Number
  if (schema.type === "number") {
    return (
      <input
        type="number"
        value={typeof value === "number" ? value : ""}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
        className="w-full min-w-0 rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[0.85rem] text-foreground outline-none placeholder:text-faint focus:border-white/[0.15]"
      />
    );
  }

  // Default: string text input
  return (
    <input
      type="text"
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.name}
      className="w-full min-w-0 rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[0.85rem] text-foreground outline-none placeholder:text-faint focus:border-white/[0.15]"
    />
  );
}
