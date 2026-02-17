import { describe, it, expect, vi } from "vitest";

// Mock modules with side effects at import time
vi.mock("../llm.js", () => ({}));
vi.mock("../database.js", () => ({}));
vi.mock("../weather.js", () => ({}));

import { buildPrefContext } from "./ontrip.js";

describe("buildPrefContext", () => {
  it("includes all fields when present", () => {
    const result = buildPrefContext({
      dietary_restrictions: ["halal", "no pork"],
      preferences: {
        budget: "mid-range",
        interests: ["street food", "nightlife"],
        cuisine_preferences: ["Malay", "Indian"],
      },
    });
    expect(result).toContain("Dietary restrictions: halal, no pork");
    expect(result).toContain("Budget: mid-range");
    expect(result).toContain("Interests: street food, nightlife");
    expect(result).toContain("Cuisine preferences: Malay, Indian");
  });

  it("returns empty string when no fields", () => {
    expect(buildPrefContext({})).toBe("");
    expect(buildPrefContext({ preferences: {} })).toBe("");
  });

  it("includes only dietary when only dietary provided", () => {
    const result = buildPrefContext({
      dietary_restrictions: ["vegetarian"],
    });
    expect(result).toBe("Dietary restrictions: vegetarian");
  });

  it("includes only budget when only budget provided", () => {
    const result = buildPrefContext({
      preferences: { budget: "budget" },
    });
    expect(result).toBe("Budget: budget");
  });

  it("includes only interests when only interests provided", () => {
    const result = buildPrefContext({
      preferences: { interests: ["temples", "markets"] },
    });
    expect(result).toBe("Interests: temples, markets");
  });

  it("includes only cuisine_preferences when only that provided", () => {
    const result = buildPrefContext({
      preferences: { cuisine_preferences: ["Thai"] },
    });
    expect(result).toBe("Cuisine preferences: Thai");
  });

  it("skips empty arrays", () => {
    const result = buildPrefContext({
      dietary_restrictions: [],
      preferences: { interests: [], cuisine_preferences: [] },
    });
    expect(result).toBe("");
  });
});
