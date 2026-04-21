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

function searchHaystackFromParts(parts: unknown[]): string {
  return parts
    .filter((part) => part !== null && part !== undefined)
    .map((part) => String(part).toLowerCase().replaceAll("_", " "))
    .join(" ");
}

/** Levenshtein distance (short strings only — device/entity words). */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) {
    return n;
  }
  if (n === 0) {
    return m;
  }
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) {
    dp[i][0] = i;
  }
  for (let j = 0; j <= n; j++) {
    dp[0][j] = j;
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function maxEditDistanceForToken(tokenLen: number): number {
  if (tokenLen < 3) {
    return 0;
  }
  if (tokenLen <= 5) {
    return 1;
  }
  return 2;
}

/**
 * Case-insensitive match: substring first, then fuzzy match against individual
 * words (typo-tolerant for device/entity names from the LLM).
 */
export function tokenMatchesInHaystack(token: string, haystack: string): boolean {
  const t = token.toLowerCase();
  const h = haystack.toLowerCase();
  if (h.includes(t)) {
    return true;
  }
  if (t.length < 3) {
    return false;
  }
  const maxDist = maxEditDistanceForToken(t.length);
  const words = h.split(/[^a-z0-9]+/).filter((w) => w.length > 0);
  for (const w of words) {
    if (w.includes(t)) {
      return true;
    }
    if (Math.abs(w.length - t.length) > maxDist + 2) {
      continue;
    }
    if (levenshtein(w, t) <= maxDist) {
      return true;
    }
  }
  return false;
}

export function homeAssistantSearchMatches(parts: unknown[], tokens: string[]): boolean {
  if (tokens.length === 0) {
    return true;
  }

  const haystack = searchHaystackFromParts(parts);
  return tokens.every((token) => tokenMatchesInHaystack(token, haystack));
}

/** How many query tokens match the haystack (substring or fuzzy word match). */
export function homeAssistantSearchTokenScore(parts: unknown[], tokens: string[]): number {
  if (tokens.length === 0) {
    return 0;
  }
  const haystack = searchHaystackFromParts(parts);
  return tokens.filter((t) => tokenMatchesInHaystack(t, haystack)).length;
}

/**
 * Prefer strict all-token matches; if none, rank by token overlap (helps when
 * the user says "living room corner light" but the entity name is only "Corner lamp").
 */
export function rankBySearchTokens<T>(
  items: T[],
  tokens: string[],
  buildParts: (item: T) => unknown[],
): T[] {
  if (tokens.length === 0) {
    return [...items];
  }
  const strict = items.filter((item) => homeAssistantSearchMatches(buildParts(item), tokens));
  if (strict.length > 0) {
    return strict;
  }
  const scored = items
    .map((item) => ({
      item,
      score: homeAssistantSearchTokenScore(buildParts(item), tokens),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.map((x) => x.item);
}
