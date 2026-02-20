import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock modules
vi.mock("../database.js", () => ({
  getOrCreateTraveler: vi.fn(),
  querySpots: vi.fn(),
  updateConversation: vi.fn(),
}));
vi.mock("../llm.js", () => ({
  chat: vi.fn(),
  loadPrompt: vi.fn().mockReturnValue("strategic prompt for {{CITY}}"),
  SONNET: "claude-sonnet-4-5-20250929",
}));
vi.mock("../weather.js", () => ({
  getCurrentWeather: vi.fn().mockResolvedValue(null),
}));
vi.mock("./query.js", () => ({
  formatSpotsForLLM: vi.fn().mockReturnValue("formatted spots"),
}));

import { handleStrategic } from "./strategic.js";
import {
  getOrCreateTraveler,
  querySpots,
  updateConversation,
} from "../database.js";
import { chat, loadPrompt } from "../llm.js";
import { formatSpotsForLLM } from "./query.js";

const mockGetOrCreateTraveler = getOrCreateTraveler as ReturnType<typeof vi.fn>;
const mockQuerySpots = querySpots as ReturnType<typeof vi.fn>;
const mockUpdateConversation = updateConversation as ReturnType<typeof vi.fn>;
const mockChat = chat as ReturnType<typeof vi.fn>;
const mockFormatSpotsForLLM = formatSpotsForLLM as ReturnType<typeof vi.fn>;
const mockLoadPrompt = loadPrompt as ReturnType<typeof vi.fn>;

const sampleSpots = [
  { id: "s1", name: "Nasi Kandar Pelita", categories: ["dinner"], must_go: true, verified: true },
  { id: "s2", name: "VCR", categories: ["cafe"], must_go: false, verified: true },
  { id: "s3", name: "Batu Caves", categories: ["activity"], must_go: true, verified: true },
  { id: "s4", name: "Jalan Alor", categories: ["dinner"], must_go: true, verified: true },
  { id: "s5", name: "Petaling Street", categories: ["market"], must_go: false, verified: true },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockQuerySpots.mockResolvedValue(sampleSpots);
  mockChat.mockResolvedValue("Here's your strategic guide...");
});

describe("handleStrategic", () => {
  it("redirects locals to general flow", async () => {
    mockGetOrCreateTraveler.mockResolvedValue({
      id: "t1",
      user_type: "local",
    });

    const result = await handleStrategic("+1234");

    expect(result).toContain("all set");
    expect(mockUpdateConversation).toHaveBeenCalledWith("+1234", {
      current_flow: "general",
      flow_state: {},
    });
    expect(mockQuerySpots).not.toHaveBeenCalled();
  });

  it("builds profile summary from traveler data", async () => {
    mockGetOrCreateTraveler.mockResolvedValue({
      id: "t1",
      user_type: "traveler",
      name: "Alex",
      trip_dates: { start: "2026-03-01", end: "2026-03-05" },
      travel_party: "couple",
      preferences: {
        interests: ["food", "nightlife"],
        budget: "moderate",
        pace: "relaxed",
      },
      dietary_restrictions: ["vegetarian"],
      first_time_visitor: true,
      current_city: "Kuala Lumpur",
    });

    await handleStrategic("+1234");

    // Verify the LLM was called with profile context
    const chatCall = mockChat.mock.calls[0];
    const userPrompt = chatCall[1][0].content;
    expect(userPrompt).toContain("Alex");
    expect(userPrompt).toContain("2026-03-01 to 2026-03-05");
    expect(userPrompt).toContain("couple");
    expect(userPrompt).toContain("food, nightlife");
    expect(userPrompt).toContain("moderate");
    expect(userPrompt).toContain("relaxed");
    expect(userPrompt).toContain("vegetarian");
    expect(userPrompt).toContain("Yes"); // first_time_visitor
  });

  it("replaces {{CITY}} in prompt template", async () => {
    mockGetOrCreateTraveler.mockResolvedValue({
      id: "t1",
      user_type: "traveler",
      preferences: {},
      current_city: "Kuala Lumpur",
    });

    await handleStrategic("+1234");

    const systemPrompt = mockChat.mock.calls[0][0];
    expect(systemPrompt).toContain("KUALA LUMPUR");
    expect(systemPrompt).not.toContain("{{CITY}}");
  });

  it("uses default city when traveler has no current_city", async () => {
    mockGetOrCreateTraveler.mockResolvedValue({
      id: "t1",
      user_type: "traveler",
      preferences: {},
    });

    await handleStrategic("+1234");

    expect(mockQuerySpots).toHaveBeenCalledWith(
      expect.objectContaining({ city: "Kuala Lumpur" })
    );
  });

  it("includes agreement plan in response", async () => {
    mockGetOrCreateTraveler.mockResolvedValue({
      id: "t1",
      user_type: "traveler",
      preferences: {},
    });

    const result = await handleStrategic("+1234");

    expect(result).toContain("WHAT YOU CAN COUNT ON");
    expect(result).toContain("24/7");
  });

  it("transitions to general flow with has_strategic_plan flag", async () => {
    mockGetOrCreateTraveler.mockResolvedValue({
      id: "t1",
      user_type: "traveler",
      preferences: {},
    });

    await handleStrategic("+1234");

    expect(mockUpdateConversation).toHaveBeenCalledWith("+1234", {
      current_flow: "general",
      flow_state: { has_strategic_plan: true },
    });
  });

  it("passes formatted spots context to LLM", async () => {
    mockGetOrCreateTraveler.mockResolvedValue({
      id: "t1",
      user_type: "traveler",
      preferences: {},
    });

    await handleStrategic("+1234");

    expect(mockFormatSpotsForLLM).toHaveBeenCalledWith(sampleSpots);
    const userPrompt = mockChat.mock.calls[0][1][0].content;
    expect(userPrompt).toContain("formatted spots");
  });

  it("counts tier-1 must-dos correctly", async () => {
    mockGetOrCreateTraveler.mockResolvedValue({
      id: "t1",
      user_type: "traveler",
      preferences: {},
    });

    await handleStrategic("+1234");

    const userPrompt = mockChat.mock.calls[0][1][0].content;
    // sampleSpots has 3 must_go spots
    expect(userPrompt).toContain("5 total, 3 must-go spots flagged by contributors");
  });

  it("handles missing preferences gracefully", async () => {
    mockGetOrCreateTraveler.mockResolvedValue({
      id: "t1",
      user_type: "traveler",
      preferences: {},
      dietary_restrictions: [],
    });

    await handleStrategic("+1234");

    const userPrompt = mockChat.mock.calls[0][1][0].content;
    expect(userPrompt).toContain("Not specified");
    expect(userPrompt).toContain("None");
  });

  it("uses Sonnet model for strategic generation", async () => {
    mockGetOrCreateTraveler.mockResolvedValue({
      id: "t1",
      user_type: "traveler",
      preferences: {},
    });

    await handleStrategic("+1234");

    const options = mockChat.mock.calls[0][2];
    expect(options.model).toBe("claude-sonnet-4-5-20250929");
  });
});
