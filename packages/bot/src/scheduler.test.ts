import { describe, it, expect, vi } from "vitest";

// Mock all external modules
vi.mock("./database.js", () => ({}));
vi.mock("./llm.js", () => ({}));
vi.mock("./whatsapp.js", () => ({}));
vi.mock("./weather.js", () => ({}));
vi.mock("./handlers/feedback.js", () => ({}));

import {
  evaluateCandidate,
  calculateTripDay,
  calculateTotalDays,
  buildProactiveContext,
  type ProactiveResult,
} from "./scheduler.js";

/** Helper: create a KL time on a given date/hour (KL = UTC+8) */
function klTime(dateStr: string, klHour: number): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  const utcHour = (klHour - 8 + 24) % 24;
  // If KL hour < 8, we're in the next UTC day
  const dayOffset = klHour < 8 ? -1 : 0;
  return new Date(Date.UTC(year, month - 1, day + dayOffset, utcHour, 0, 0));
}

const baseCandidate = {
  name: "Alice",
  trip_dates: { start: "2026-03-15", end: "2026-03-19" },
  last_proactive_at: undefined as string | undefined,
  last_user_message_at: undefined as string | undefined,
  current_flow: "general",
  spots_recommended: [] as string[],
  spots_feedback_asked: [] as string[],
  dietary_restrictions: [] as string[],
  travel_party: "solo",
  current_city: "Kuala Lumpur",
};

describe("evaluateCandidate", () => {
  it("returns null when no last_user_message_at", () => {
    const now = klTime("2026-03-15", 9);
    const result = evaluateCandidate({ ...baseCandidate, last_user_message_at: undefined }, now);
    expect(result).toBeNull();
  });

  it("returns null when last message > 23h ago", () => {
    const now = klTime("2026-03-15", 9);
    const oldMessage = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const result = evaluateCandidate({ ...baseCandidate, last_user_message_at: oldMessage }, now);
    expect(result).toBeNull();
  });

  it("returns null when cooldown is active (< 8h since last proactive)", () => {
    const now = klTime("2026-03-16", 9);
    const recentMsg = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString();
    const recentProactive = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();
    const result = evaluateCandidate({
      ...baseCandidate,
      last_user_message_at: recentMsg,
      last_proactive_at: recentProactive,
    }, now);
    expect(result).toBeNull();
  });

  it("returns null when mid-flow (not general)", () => {
    const now = klTime("2026-03-15", 9);
    const recentMsg = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString();
    const result = evaluateCandidate({
      ...baseCandidate,
      last_user_message_at: recentMsg,
      current_flow: "contribution",
    }, now);
    expect(result).toBeNull();
  });

  it("returns null when trip has not started yet", () => {
    const now = klTime("2026-03-14", 9); // day before trip
    const recentMsg = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString();
    const result = evaluateCandidate({ ...baseCandidate, last_user_message_at: recentMsg }, now);
    expect(result).toBeNull();
  });

  it("returns null when trip has ended", () => {
    const now = klTime("2026-03-20", 9); // day after trip ends
    const recentMsg = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString();
    const result = evaluateCandidate({ ...baseCandidate, last_user_message_at: recentMsg }, now);
    expect(result).toBeNull();
  });

  it("returns null outside daytime hours (before 8am)", () => {
    const now = klTime("2026-03-15", 6);
    const recentMsg = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString();
    const result = evaluateCandidate({ ...baseCandidate, last_user_message_at: recentMsg }, now);
    expect(result).toBeNull();
  });

  it("returns null outside daytime hours (after 10pm)", () => {
    const now = klTime("2026-03-15", 23);
    const recentMsg = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString();
    const result = evaluateCandidate({ ...baseCandidate, last_user_message_at: recentMsg }, now);
    expect(result).toBeNull();
  });

  it("returns TRIP_WELCOME on day 1 with no prior proactive", () => {
    const now = klTime("2026-03-15", 9);
    const recentMsg = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString();
    const result = evaluateCandidate({
      ...baseCandidate,
      last_user_message_at: recentMsg,
      last_proactive_at: undefined,
    }, now);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("TRIP_WELCOME");
  });

  it("returns FEEDBACK_CHECK when unasked spots exist in 10-12am window", () => {
    const now = klTime("2026-03-16", 11);
    const recentMsg = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString();
    const oldProactive = new Date(now.getTime() - 10 * 60 * 60 * 1000).toISOString();
    const result = evaluateCandidate({
      ...baseCandidate,
      last_user_message_at: recentMsg,
      last_proactive_at: oldProactive,
      spots_recommended: ["spot-1", "spot-2"],
      spots_feedback_asked: ["spot-1"],
    }, now);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("FEEDBACK_CHECK");
  });

  it("returns FEEDBACK_CHECK when unasked spots exist in 7-9pm window", () => {
    const now = klTime("2026-03-16", 20);
    const recentMsg = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString();
    const oldProactive = new Date(now.getTime() - 10 * 60 * 60 * 1000).toISOString();
    const result = evaluateCandidate({
      ...baseCandidate,
      last_user_message_at: recentMsg,
      last_proactive_at: oldProactive,
      spots_recommended: ["spot-1"],
      spots_feedback_asked: [],
    }, now);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("FEEDBACK_CHECK");
  });

  it("returns MORNING_NUDGE on day 2+ at 8-10am", () => {
    const now = klTime("2026-03-16", 9);
    const recentMsg = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString();
    const oldProactive = new Date(now.getTime() - 10 * 60 * 60 * 1000).toISOString();
    const result = evaluateCandidate({
      ...baseCandidate,
      last_user_message_at: recentMsg,
      last_proactive_at: oldProactive,
    }, now);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("MORNING_NUDGE");
  });

  it("returns DINNER_NUDGE on day 2+ at 5-7pm", () => {
    const now = klTime("2026-03-16", 18);
    const recentMsg = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString();
    const oldProactive = new Date(now.getTime() - 10 * 60 * 60 * 1000).toISOString();
    const result = evaluateCandidate({
      ...baseCandidate,
      last_user_message_at: recentMsg,
      last_proactive_at: oldProactive,
    }, now);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("DINNER_NUDGE");
  });

  it("TRIP_WELCOME takes priority over MORNING_NUDGE on day 1", () => {
    // Day 1 at 9am — both TRIP_WELCOME and MORNING_NUDGE could fire,
    // but TRIP_WELCOME can only fire on day 1 so its priority check comes first
    const now = klTime("2026-03-15", 9);
    const recentMsg = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString();
    const result = evaluateCandidate({
      ...baseCandidate,
      last_user_message_at: recentMsg,
      last_proactive_at: undefined,
    }, now);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("TRIP_WELCOME");
  });

  it("returns null on day 1 afternoon with no matching type (after welcome sent)", () => {
    const now = klTime("2026-03-15", 14); // 2pm, no nudge windows
    const recentMsg = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString();
    const recentProactive = new Date(now.getTime() - 10 * 60 * 60 * 1000).toISOString();
    const result = evaluateCandidate({
      ...baseCandidate,
      last_user_message_at: recentMsg,
      last_proactive_at: recentProactive, // welcome already sent
    }, now);
    expect(result).toBeNull();
  });
});

describe("calculateTripDay", () => {
  it("returns 1 on the start date", () => {
    const tripDates = { start: "2026-03-15", end: "2026-03-19" };
    const now = klTime("2026-03-15", 12);
    expect(calculateTripDay(tripDates, now)).toBe(1);
  });

  it("returns 3 on the third day", () => {
    const tripDates = { start: "2026-03-15", end: "2026-03-19" };
    const now = klTime("2026-03-17", 12);
    expect(calculateTripDay(tripDates, now)).toBe(3);
  });

  it("returns correct day regardless of hour", () => {
    const tripDates = { start: "2026-03-15", end: "2026-03-19" };
    const morning = klTime("2026-03-16", 8);
    const evening = klTime("2026-03-16", 21);
    expect(calculateTripDay(tripDates, morning)).toBe(2);
    expect(calculateTripDay(tripDates, evening)).toBe(2);
  });
});

describe("calculateTotalDays", () => {
  it("calculates multi-day trip", () => {
    expect(calculateTotalDays({ start: "2026-03-15", end: "2026-03-19" })).toBe(5);
  });

  it("returns 1 for same-day trip", () => {
    expect(calculateTotalDays({ start: "2026-03-15", end: "2026-03-15" })).toBe(1);
  });
});

describe("buildProactiveContext", () => {
  it("includes all fields when provided", () => {
    const ctx = buildProactiveContext({
      name: "Alice",
      tripDay: 2,
      totalDays: 5,
      travelParty: "couple",
      dietaryRestrictions: ["vegetarian", "no pork"],
      city: "Kuala Lumpur",
      klHour: 9,
    });
    expect(ctx).toContain("Name: Alice");
    expect(ctx).toContain("City: Kuala Lumpur");
    expect(ctx).toContain("Trip day: 2 of 5");
    expect(ctx).toContain("Local time: ~9:00");
    expect(ctx).toContain("Travel party: couple");
    expect(ctx).toContain("Dietary restrictions: vegetarian, no pork");
  });

  it("omits dietary when empty", () => {
    const ctx = buildProactiveContext({
      name: "Bob",
      tripDay: 1,
      totalDays: 3,
      travelParty: undefined,
      dietaryRestrictions: [],
      city: "Kuala Lumpur",
      klHour: 10,
    });
    expect(ctx).toContain("Name: Bob");
    expect(ctx).not.toContain("Dietary");
    expect(ctx).not.toContain("Travel party");
  });
});
