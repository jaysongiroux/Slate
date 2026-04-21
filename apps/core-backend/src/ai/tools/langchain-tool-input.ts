/**
 * Some LangChain tool bindings pass the full OpenAI-style tool call object
 * `{ name, args, id, type }` to `invoke` instead of `args` alone. Unwrap so
 * Zod schemas receive the intended payload.
 */
export function unwrapLangChainToolCallInput(raw: unknown): unknown {
  if (raw != null && typeof raw === "object" && !Array.isArray(raw) && "args" in raw) {
    const inner = (raw as { args: unknown }).args;
    if (inner != null && typeof inner === "object" && !Array.isArray(inner)) {
      return inner;
    }
    if (typeof inner === "string") {
      try {
        const parsed: unknown = JSON.parse(inner);
        if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed;
        }
      } catch {
        /* ignore */
      }
    }
  }
  return raw;
}
