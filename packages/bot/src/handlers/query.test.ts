import { describe, it, expect, vi } from "vitest";

// Mock modules with side effects at import time
vi.mock("../llm.js", () => ({}));
vi.mock("../database.js", () => ({}));
vi.mock("../weather.js", () => ({}));

import {
  confidenceLabel,
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

describe("confidenceLabel", () => {
  it("returns 'personal favorite' for >= 0.85", () => {
    expect(confidenceLabel(0.9)).toBe("personal favorite");
    expect(confidenceLabel(0.85)).toBe("personal favorite");
  });

  it("returns 'well-vouched' for >= 0.6", () => {
    expect(confidenceLabel(0.7)).toBe("well-vouched");
    expect(confidenceLabel(0.6)).toBe("well-vouched");
  });

  it("returns 'fresh intel' for < 0.6", () => {
    expect(confidenceLabel(0.3)).toBe("fresh intel");
  });

  it("defaults to 'well-vouched' when undefined", () => {
    expect(confidenceLabel(undefined)).toBe("well-vouched");
  });
});

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
      neighborhood: "Taman Megah",
      category: "dinner",
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
      tier: 1,
      confidence_score: 0.9,
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
    expect(result).toContain("Tier: 1");
    expect(result).toContain("personal favorite");
  });

  it("formats a minimal spot", () => {
    const result = formatSpotsForLLM([baseSpot]);
    expect(result).toContain("1. Fatty Crab");
    expect(result).toContain("Sam's take: well-vouched");
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

  it("shows 'personal favorite' for high confidence", () => {
    const spot: Spot = { ...baseSpot, confidence_score: 0.95 };
    const result = formatSpotsForLLM([spot]);
    expect(result).toContain("personal favorite");
  });

  it("includes source in Sam's take line", () => {
    const spot: Spot = { ...baseSpot, source: "voice", confidence_score: 0.7 };
    const result = formatSpotsForLLM([spot]);
    expect(result).toContain("Sam's take: well-vouched (from local contributor (voice note))");
  });

  it("defaults source to 'curated by Sam' when missing", () => {
    const result = formatSpotsForLLM([baseSpot]);
    expect(result).toContain("Sam's take: well-vouched (from curated by Sam)");
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
