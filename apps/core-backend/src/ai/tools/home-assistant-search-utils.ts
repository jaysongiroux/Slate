const ACTION_STOPWORDS = new Set([
  "a",
  "all",
  "an",
  "for",
  "in",
  "of",
  "off",
  "on",
  "please",
  "set",
  "the",
  "to",
  "toggle",
  "turn",
]);

export function clampHomeAssistantSearchLimit(value: unknown, fallback = 10, max = 25): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.min(max, Math.trunc(value)));
}

function normalizeToken(token: string): string {
  const normalized = token.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (normalized.length > 3 && normalized.endsWith("s")) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

export function tokenizeHomeAssistantSearchQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map(normalizeToken)
    .filter((token) => token.length > 0 && !ACTION_STOPWORDS.has(token));
}

export function homeAssistantSearchMatches(parts: unknown[], tokens: string[]): boolean {
  if (tokens.length === 0) {
    return true;
  }

  const haystack = parts
    .filter((part) => part !== null && part !== undefined)
    .map((part) => String(part).toLowerCase().replaceAll("_", " "))
    .join(" ");

  return tokens.every((token) => haystack.includes(token));
}
