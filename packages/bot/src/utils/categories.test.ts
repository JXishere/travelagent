import { describe, it, expect } from "vitest";
import { resolveCategories, MEAL_TYPE_CATEGORIES, TIME_OF_DAY_CATEGORIES } from "./categories.js";

describe("resolveCategories", () => {
  it("maps breakfast to breakfast + cafe", () => {
    expect(resolveCategories("breakfast")).toEqual(["breakfast", "cafe"]);
  });

  it("maps dinner to dinner only (no nightlife)", () => {
    expect(resolveCategories("dinner")).toEqual(["dinner"]);
  });

  it("maps drinks to nightlife", () => {
    expect(resolveCategories("drinks")).toEqual(["nightlife"]);
  });

  it("maps supper to nightlife + dinner", () => {
    expect(resolveCategories("supper")).toEqual(["nightlife", "dinner"]);
  });

  it("is case-insensitive for meal type", () => {
    expect(resolveCategories("BREAKFAST")).toEqual(["breakfast", "cafe"]);
    expect(resolveCategories("Dinner")).toEqual(["dinner"]);
  });

  it("falls back to meal type as category for unknown types", () => {
    expect(resolveCategories("sushi")).toEqual(["sushi"]);
  });

  it("uses time of day when no meal type", () => {
    expect(resolveCategories(undefined, "morning")).toEqual(["breakfast", "cafe"]);
    expect(resolveCategories(undefined, "evening")).toEqual(["dinner", "nightlife", "activity"]);
  });

  it("prefers meal type over time of day", () => {
    expect(resolveCategories("coffee", "evening")).toEqual(["cafe"]);
  });

  it("returns defaults when neither is provided", () => {
    expect(resolveCategories()).toEqual(["breakfast", "lunch", "dinner", "cafe"]);
  });

  it("returns empty array for unknown time of day", () => {
    expect(resolveCategories(undefined, "midnight")).toEqual([]);
  });
});

describe("MEAL_TYPE_CATEGORIES", () => {
  it("includes all expected meal types", () => {
    const expected = ["breakfast", "brunch", "lunch", "dinner", "coffee", "cafe", "dessert", "drinks", "bar", "supper", "late night"];
    for (const key of expected) {
      expect(MEAL_TYPE_CATEGORIES).toHaveProperty(key);
    }
  });
});

describe("TIME_OF_DAY_CATEGORIES", () => {
  it("includes all expected time slots", () => {
    const expected = ["morning", "afternoon", "evening", "late-night"];
    for (const key of expected) {
      expect(TIME_OF_DAY_CATEGORIES).toHaveProperty(key);
    }
  });
});
