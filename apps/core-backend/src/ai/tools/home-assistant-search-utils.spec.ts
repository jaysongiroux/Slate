import {
  homeAssistantSearchMatches,
  homeAssistantSearchTokenScore,
  tokenMatchesInHaystack,
  tokenizeHomeAssistantSearchQuery,
} from "./home-assistant-search-utils";

describe("tokenMatchesInHaystack", () => {
  it("matches case-insensitive substring", () => {
    expect(tokenMatchesInHaystack("kitchen", "Kitchen Light")).toBe(true);
    expect(tokenMatchesInHaystack("KITCHEN", "my kitchen lamp")).toBe(true);
  });

  it("matches common typos in a single word", () => {
    expect(tokenMatchesInHaystack("thermost", "Living Room Thermostat")).toBe(true);
    expect(tokenMatchesInHaystack("livng", "Living Room")).toBe(true);
  });

  it("does not match on very short tokens without exact substring", () => {
    expect(tokenMatchesInHaystack("ab", "ab cd")).toBe(true);
    expect(tokenMatchesInHaystack("xy", "ab cd")).toBe(false);
  });
});

describe("homeAssistantSearchMatches with fuzzy words", () => {
  it("matches when all tokens fuzzy-match device-style names", () => {
    const parts = ["Living Room Thermostat", "climate.lr"];
    const tokens = tokenizeHomeAssistantSearchQuery("thermost livng room");
    expect(homeAssistantSearchMatches(parts, tokens)).toBe(true);
  });
});

describe("homeAssistantSearchTokenScore", () => {
  it("counts fuzzy token hits", () => {
    const parts = ["Thermostat T6"];
    const tokens = ["thermost", "t6"].map((t) => t.toLowerCase());
    expect(homeAssistantSearchTokenScore(parts, tokens)).toBe(2);
  });
});
