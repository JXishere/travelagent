import { describe, it, expect, vi } from "vitest";

// Mock modules that have side effects at import time
vi.mock("../database.js", () => ({
  getOrCreateTraveler: vi.fn(),
  updateTraveler: vi.fn(),
}));
vi.mock("../llm.js", () => ({}));

import { mergeProfileDelta, mergeArray } from "./continuous-profile.js";
import type { Traveler } from "../database.js";

const baseTraveler: Traveler = {
  id: "test-id",
  whatsapp_number: "+60123456789",
  user_type: "unknown",
  home_areas: [],
  preferences: {},
  dietary_restrictions: [],
  spots_recommended: [],
  spots_liked: [],
  spots_disliked: [],
  spots_feedback_asked: [],
};

describe("mergeArray", () => {
  it("appends new items", () => {
    expect(mergeArray(["a"], ["b"])).toEqual(["a", "b"]);
  });

  it("deduplicates case-insensitively", () => {
    expect(mergeArray(["Halal"], ["halal", "Vegetarian"])).toEqual(["Halal", "Vegetarian"]);
  });

  it("removes items prefixed with !", () => {
    expect(mergeArray(["Halal", "Vegetarian"], ["!halal"])).toEqual(["Vegetarian"]);
  });

  it("handles removal and addition in same merge", () => {
    expect(mergeArray(["Italian", "Thai"], ["!italian", "Japanese"])).toEqual(["Thai", "Japanese"]);
  });

  it("handles empty arrays", () => {
    expect(mergeArray([], ["a"])).toEqual(["a"]);
    expect(mergeArray(["a"], [])).toEqual(["a"]);
  });
});

describe("mergeProfileDelta", () => {
  it("returns empty when no changes", () => {
    const result = mergeProfileDelta(baseTraveler, { _no_changes: true });
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("sets scalar top-level fields", () => {
    const result = mergeProfileDelta(baseTraveler, { name: "Alice", user_type: "traveler" });
    expect(result.name).toBe("Alice");
    expect(result.user_type).toBe("traveler");
  });

  it("sets trip_dates as a unit", () => {
    const result = mergeProfileDelta(baseTraveler, {
      trip_dates: { start: "2026-03-01", end: "2026-03-05" },
    });
    expect(result.trip_dates).toEqual({ start: "2026-03-01", end: "2026-03-05" });
  });

  it("stores budget and pace in preferences", () => {
    const result = mergeProfileDelta(baseTraveler, { budget: "mid-range", pace: "relaxed" });
    expect(result.preferences).toMatchObject({ budget: "mid-range", pace: "relaxed" });
  });

  it("merges array fields into existing arrays", () => {
    const traveler = { ...baseTraveler, dietary_restrictions: ["halal"] };
    const result = mergeProfileDelta(traveler, { dietary_restrictions: ["no pork"] });
    expect(result.dietary_restrictions).toEqual(["halal", "no pork"]);
  });

  it("stores cuisine_preferences in preferences object", () => {
    const result = mergeProfileDelta(baseTraveler, { cuisine_preferences: ["Malay", "Indian"] });
    expect(result.preferences?.cuisine_preferences).toEqual(["Malay", "Indian"]);
  });

  it("merges preferences with existing preferences", () => {
    const traveler = { ...baseTraveler, preferences: { budget: "budget" } };
    const result = mergeProfileDelta(traveler, { pace: "fast" });
    expect(result.preferences).toEqual({ budget: "budget", pace: "fast" });
  });

  it("ignores undefined values", () => {
    const result = mergeProfileDelta(baseTraveler, { name: undefined as any });
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("clears top-level scalar field when null (retraction)", () => {
    const traveler = { ...baseTraveler, current_city: "Bangkok" };
    const result = mergeProfileDelta(traveler, { current_city: null as any });
    expect(result).toHaveProperty("current_city", null);
  });
});
