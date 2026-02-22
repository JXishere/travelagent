import { describe, it, expect, vi } from "vitest";

// Mock modules with side effects at import time
vi.mock("../llm.js", () => ({}));
vi.mock("../database.js", () => ({}));
vi.mock("../weather.js", () => ({}));

import {
  sourceLabel,
  formatOpeningHours,
  formatSpotsForLLM,
} from "./query.js";
import type { Spot } from "../database.js";

const baseSpot: Spot = {
  id: "spot-1",
  name: "Fatty Crab",
  city: "Kuala Lumpur",
};


describe("formatOpeningHours", () => {
  it("formats a single entry", () => {
    expect(formatOpeningHours({ monday: "9am-5pm" })).toBe("Monday: 9am-5pm");
  });

  it("formats multiple entries", () => {
    const result = formatOpeningHours({
      monday: "9am-5pm",
      tuesday: "10am-6pm",
    });
    expect(result).toBe("Monday: 9am-5pm, Tuesday: 10am-6pm");
  });

  it("returns empty string for empty object", () => {
    expect(formatOpeningHours({})).toBe("");
  });

  it("capitalizes day keys", () => {
    expect(formatOpeningHours({ wednesday: "8am-3pm" })).toBe(
      "Wednesday: 8am-3pm"
    );
  });
});

describe("formatSpotsForLLM", () => {
  it("formats a full spot with all fields", () => {
    const spot: Spot = {
      ...baseSpot,
      area: "Taman Megah",
      categories: ["dinner"],
      address: "123 Main St",
      price_range: "$$",
      payment_methods: ["cash", "card"],
      opening_hours: { monday: "6pm-11pm" },
      what_to_order: ["chilli crab"],
      what_to_skip: ["fish head"],
      pro_tips: ["go early"],
      vibe: "chaotic",
      indoor_outdoor: "indoor",
      best_time_of_day: "evening",
      must_go: true,
      verified: true,
    };
    const result = formatSpotsForLLM([spot]);
    expect(result).toContain("1. Fatty Crab");
    expect(result).toContain("Neighborhood: Taman Megah");
    expect(result).toContain("Category: dinner");
    expect(result).toContain("Address: 123 Main St");
    expect(result).toContain("Price: $$");
    expect(result).toContain("Payment: cash, card");
    expect(result).toContain("Hours: Monday: 6pm-11pm");
    expect(result).toContain("Order: chilli crab");
    expect(result).toContain("Skip: fish head");
    expect(result).toContain("Tips: go early");
    expect(result).toContain("Vibe: chaotic");
    expect(result).toContain("Setting: indoor");
    expect(result).toContain("Best time: evening");
    expect(result).toContain("must-go");
  });

  it("formats a minimal spot", () => {
    const result = formatSpotsForLLM([baseSpot]);
    expect(result).toContain("1. Fatty Crab");
    expect(result).toContain("Sam's take: unverified");
    expect(result).not.toContain("Neighborhood:");
    expect(result).not.toContain("Category:");
  });

  it("numbers spots correctly with 3 spots", () => {
    const spots = [
      { ...baseSpot, id: "s1", name: "Spot A" },
      { ...baseSpot, id: "s2", name: "Spot B" },
      { ...baseSpot, id: "s3", name: "Spot C" },
    ];
    const result = formatSpotsForLLM(spots);
    expect(result).toContain("1. Spot A");
    expect(result).toContain("2. Spot B");
    expect(result).toContain("3. Spot C");
  });

  it("returns empty string for empty array", () => {
    expect(formatSpotsForLLM([])).toBe("");
  });

  it("renders opening_hours via formatOpeningHours", () => {
    const spot: Spot = {
      ...baseSpot,
      opening_hours: { monday: "9am-5pm", tuesday: "10am-6pm" },
    };
    const result = formatSpotsForLLM([spot]);
    expect(result).toContain("Hours: Monday: 9am-5pm, Tuesday: 10am-6pm");
  });

  it("shows 'must-go' for must_go spots", () => {
    const spot: Spot = { ...baseSpot, must_go: true, verified: true };
    const result = formatSpotsForLLM([spot]);
    expect(result).toContain("must-go");
  });

  it("includes source in Sam's take line for verified spots", () => {
    const spot: Spot = { ...baseSpot, input_method: "voice", verified: true };
    const result = formatSpotsForLLM([spot]);
    expect(result).toContain("Sam's take: verified (local contributor (voice note))");
  });

  it("shows unverified for spots with no must_go/verified", () => {
    const result = formatSpotsForLLM([baseSpot]);
    expect(result).toContain("Sam's take: unverified, treat as a lead, not a guarantee");
  });
});

describe("sourceLabel", () => {
  it("returns 'local contributor (voice note)' for voice", () => {
    expect(sourceLabel("voice")).toBe("local contributor (voice note)");
  });

  it("returns 'local contributor' for text", () => {
    expect(sourceLabel("text")).toBe("local contributor");
  });

  it("returns 'curated by Sam' for seed", () => {
    expect(sourceLabel("seed")).toBe("curated by Sam");
  });

  it("returns 'curated by Sam' for manual", () => {
    expect(sourceLabel("manual")).toBe("curated by Sam");
  });

  it("returns 'curated by Sam' for undefined", () => {
    expect(sourceLabel(undefined)).toBe("curated by Sam");
  });
});
