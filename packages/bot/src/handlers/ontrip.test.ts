import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock modules with side effects at import time
vi.mock("../llm.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../llm.js")>();
  return {
    ...actual,
    loadPrompt: vi.fn().mockReturnValue("system prompt"),
    buildSystemPrompt: vi.fn().mockReturnValue("system prompt"),
    langInstruction: vi.fn().mockReturnValue(""),
    langUserNote: vi.fn().mockReturnValue(""),
  };
});
vi.mock("../database.js", () => ({
  querySpots: vi.fn().mockResolvedValue([]),
  semanticSearchSpots: vi.fn().mockResolvedValue([]),
  getOrCreateTraveler: vi.fn().mockResolvedValue({
    current_city: "Kuala Lumpur",
    user_type: "traveler",
    preferences: {},
  }),
  incrementRecommendationCount: vi.fn(),
  markSpotsRecommended: vi.fn().mockResolvedValue(undefined),
  getDistinctAreas: vi.fn().mockResolvedValue([]),
  getAreaCentroid: vi.fn().mockResolvedValue(undefined),
  trackEvent: vi.fn(),
}));
vi.mock("../weather.js", () => ({
  getCurrentWeather: vi.fn().mockResolvedValue(null),
}));
vi.mock("../embeddings.js", () => ({
  generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}));

import { buildPrefContext, buildHungryPrompt } from "./ontrip.js";
import { querySpots, semanticSearchSpots } from "../database.js";
import type { Spot } from "../database.js";

const mockedQuerySpots = vi.mocked(querySpots);
const mockedSemanticSearch = vi.mocked(semanticSearchSpots);

const mamakSpot: Spot = {
  id: "spot-mamak",
  name: "Nasi Kandar Pelita",
  city: "Kuala Lumpur",
  area: "KLCC",
  categories: ["dinner"],
  what_to_order: ["roti canai", "nasi kandar"],
};

const dinnerSpot: Spot = {
  id: "spot-dinner",
  name: "Fatty Crab",
  city: "Kuala Lumpur",
  area: "Taman Megah",
  categories: ["dinner"],
  what_to_order: ["chilli crab"],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedQuerySpots.mockResolvedValue([]);
  mockedSemanticSearch.mockResolvedValue([]);
});

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

describe("buildHungryPrompt — dish query routing", () => {
  it("uses semantic search first for dish queries (meal_type: 'roti')", async () => {
    mockedSemanticSearch.mockResolvedValue([mamakSpot]);

    const result = await buildHungryPrompt("+60123", "im thinking some roti", {
      meal_type: "roti",
    });

    // Semantic search should be called (no category filter)
    expect(mockedSemanticSearch).toHaveBeenCalledWith(
      expect.any(Array),
      { city: "Kuala Lumpur" }
    );
    // Structured query should NOT be called (semantic search found results)
    expect(mockedQuerySpots).not.toHaveBeenCalled();
    // Should return the mamak spot
    expect(result.spotIds).toContain("spot-mamak");
  });

  it("falls back to broad categories when semantic search returns nothing for dish query", async () => {
    mockedSemanticSearch.mockResolvedValue([]);
    mockedQuerySpots.mockResolvedValue([dinnerSpot]);

    const result = await buildHungryPrompt("+60123", "im thinking some laksa", {
      meal_type: "laksa",
    });

    // Semantic search tried first
    expect(mockedSemanticSearch).toHaveBeenCalled();
    // Falls back to broad food categories
    expect(mockedQuerySpots).toHaveBeenCalledWith(
      expect.objectContaining({
        categories: ["breakfast", "lunch", "dinner", "cafe"],
      })
    );
    expect(result.spotIds).toContain("spot-dinner");
  });

  it("uses structured query first for category queries (meal_type: 'dinner')", async () => {
    mockedQuerySpots.mockResolvedValue([dinnerSpot]);

    const result = await buildHungryPrompt("+60123", "I want dinner", {
      meal_type: "dinner",
    });

    // Structured query should be called with dinner category
    expect(mockedQuerySpots).toHaveBeenCalledWith(
      expect.objectContaining({
        categories: ["dinner"],
      })
    );
    // Semantic search should NOT be called (structured query found results)
    expect(mockedSemanticSearch).not.toHaveBeenCalled();
    expect(result.spotIds).toContain("spot-dinner");
  });

  it("falls back to semantic search when structured category query returns nothing", async () => {
    mockedQuerySpots.mockResolvedValue([]);
    mockedSemanticSearch.mockResolvedValue([dinnerSpot]);

    const result = await buildHungryPrompt("+60123", "I want dinner near KLCC", {
      meal_type: "dinner",
      area: "KLCC",
    });

    // Structured query tried first
    expect(mockedQuerySpots).toHaveBeenCalledWith(
      expect.objectContaining({ categories: ["dinner"] })
    );
    // Falls back to semantic search without category filter
    expect(mockedSemanticSearch).toHaveBeenCalledWith(
      expect.any(Array),
      { city: "Kuala Lumpur" }
    );
    expect(result.spotIds).toContain("spot-dinner");
  });

  it("returns empty prompt when both searches fail for dish query", async () => {
    mockedSemanticSearch.mockResolvedValue([]);
    mockedQuerySpots.mockResolvedValue([]);

    const result = await buildHungryPrompt("+60123", "im thinking some sushi", {
      meal_type: "sushi",
    });

    expect(result.spotIds).toEqual([]);
    expect(result.userPrompt).toContain("NO spots");
  });
});
