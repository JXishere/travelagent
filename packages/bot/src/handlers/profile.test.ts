import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock modules
vi.mock("../database.js", () => ({
  getOrCreateTraveler: vi.fn(),
  updateTraveler: vi.fn(),
  updateConversation: vi.fn(),
  trackEvent: vi.fn(),
}));
vi.mock("../llm.js", () => ({
  chat: vi.fn(),
  chatAsSam: vi.fn(),
  extractJSON: vi.fn(),
  loadPrompt: vi.fn().mockReturnValue("profile prompt"),
  HAIKU: "claude-haiku-4-5-20251001",
}));

import { handleProfile, startProfileLearning } from "./profile.js";
import {
  getOrCreateTraveler,
  updateTraveler,
  updateConversation,
} from "../database.js";
import { chat, chatAsSam, extractJSON } from "../llm.js";
import type { Conversation } from "../database.js";

const mockChat = chat as ReturnType<typeof vi.fn>;
const mockChatAsSam = chatAsSam as ReturnType<typeof vi.fn>;
const mockExtractJSON = extractJSON as ReturnType<typeof vi.fn>;
const mockGetOrCreateTraveler = getOrCreateTraveler as ReturnType<typeof vi.fn>;
const mockUpdateTraveler = updateTraveler as ReturnType<typeof vi.fn>;
const mockUpdateConversation = updateConversation as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

const baseConvo: Conversation = {
  id: "c1",
  whatsapp_number: "+1234",
  current_flow: "profile_learning",
  flow_state: { stage: "interviewing" },
  messages: [
    { role: "assistant", content: "Hey! Are you visiting or local?" },
  ],
  updated_at: new Date().toISOString(),
};

describe("handleProfile", () => {
  it("detects [PROFILE_COMPLETE] marker and extracts profile", async () => {
    mockChat.mockResolvedValue(
      "Great, I've got everything I need! [PROFILE_COMPLETE]"
    );
    mockExtractJSON.mockResolvedValue({
      name: "Alex",
      user_type: "traveler",
      trip_dates: { start: "2026-03-01", end: "2026-03-05" },
      travel_party: "couple",
      interests: ["food", "nightlife"],
    });
    mockGetOrCreateTraveler.mockResolvedValue({
      id: "t1",
      whatsapp_number: "+1234",
      preferences: {},
    });

    const result = await handleProfile("+1234", "we arrive march 1 for 5 days", baseConvo);

    expect(result).toBe("Great, I've got everything I need!");
    expect(result).not.toContain("[PROFILE_COMPLETE]");
    expect(mockUpdateTraveler).toHaveBeenCalledWith(
      "+1234",
      expect.objectContaining({
        name: "Alex",
        user_type: "traveler",
        trip_dates: { start: "2026-03-01", end: "2026-03-05" },
        travel_party: "couple",
      })
    );
  });

  it("handles [PROFILE COMPLETE] variant (with space)", async () => {
    mockChat.mockResolvedValue("All set! [PROFILE COMPLETE]");
    mockExtractJSON.mockResolvedValue({ user_type: "traveler" });
    mockGetOrCreateTraveler.mockResolvedValue({
      id: "t1",
      whatsapp_number: "+1234",
      preferences: {},
    });

    const result = await handleProfile("+1234", "test", baseConvo);

    expect(result).toBe("All set!");
    expect(mockExtractJSON).toHaveBeenCalled();
  });

  it("handles case-insensitive [profile_complete]", async () => {
    mockChat.mockResolvedValue("Done! [profile_complete]");
    mockExtractJSON.mockResolvedValue({ user_type: "traveler" });
    mockGetOrCreateTraveler.mockResolvedValue({
      id: "t1",
      whatsapp_number: "+1234",
      preferences: {},
    });

    const result = await handleProfile("+1234", "test", baseConvo);

    expect(result).toBe("Done!");
  });

  it("routes local users to general flow", async () => {
    mockChat.mockResolvedValue("Cool, local! [PROFILE_COMPLETE]");
    mockExtractJSON.mockResolvedValue({
      user_type: "local",
      home_neighborhoods: ["Bangsar"],
    });
    mockGetOrCreateTraveler.mockResolvedValue({
      id: "t1",
      whatsapp_number: "+1234",
      preferences: {},
    });

    await handleProfile("+1234", "I live in Bangsar", baseConvo);

    expect(mockUpdateConversation).toHaveBeenCalledWith("+1234", {
      current_flow: "general",
      flow_state: {},
    });
  });

  it("routes travelers to strategic flow", async () => {
    mockChat.mockResolvedValue("Got it! [PROFILE_COMPLETE]");
    mockExtractJSON.mockResolvedValue({ user_type: "traveler" });
    mockGetOrCreateTraveler.mockResolvedValue({
      id: "t1",
      whatsapp_number: "+1234",
      preferences: {},
    });

    await handleProfile("+1234", "visiting next week", baseConvo);

    expect(mockUpdateConversation).toHaveBeenCalledWith("+1234", {
      current_flow: "strategic",
      flow_state: { profile_just_completed: true },
    });
  });

  it("continues conversation when no PROFILE_COMPLETE marker", async () => {
    mockChat.mockResolvedValue("When are you arriving?");

    const result = await handleProfile("+1234", "I'm visiting KL", baseConvo);

    expect(result).toBe("When are you arriving?");
    expect(mockExtractJSON).not.toHaveBeenCalled();
    expect(mockUpdateTraveler).not.toHaveBeenCalled();
  });

  it("saves local-specific fields for locals", async () => {
    mockChat.mockResolvedValue("Nice! [PROFILE_COMPLETE]");
    mockExtractJSON.mockResolvedValue({
      user_type: "local",
      home_neighborhoods: ["Bangsar", "TTDI"],
      cuisine_preferences: ["Japanese", "Thai"],
    });
    mockGetOrCreateTraveler.mockResolvedValue({
      id: "t1",
      whatsapp_number: "+1234",
      preferences: {},
    });

    await handleProfile("+1234", "I live in Bangsar", baseConvo);

    expect(mockUpdateTraveler).toHaveBeenCalledWith(
      "+1234",
      expect.objectContaining({
        home_neighborhoods: ["Bangsar", "TTDI"],
      })
    );
  });
});

describe("startProfileLearning", () => {
  it("skips interview for returning user with preferences", async () => {
    mockGetOrCreateTraveler.mockResolvedValue({
      id: "t1",
      whatsapp_number: "+1234",
      preferences: { budget: "moderate" },
      user_type: "traveler",
    });
    mockChatAsSam.mockResolvedValue("Hey! What are you hungry for?");

    const result = await startProfileLearning("+1234", "I'm hungry");

    expect(result).toBe("Hey! What are you hungry for?");
    expect(mockUpdateConversation).not.toHaveBeenCalled();
  });

  it("returns welcome back for returning traveler without message", async () => {
    mockGetOrCreateTraveler.mockResolvedValue({
      id: "t1",
      whatsapp_number: "+1234",
      preferences: { budget: "moderate" },
      user_type: "traveler",
    });

    const result = await startProfileLearning("+1234");

    expect(result).toContain("Welcome back");
  });

  it("returns welcome back for returning local without message", async () => {
    mockGetOrCreateTraveler.mockResolvedValue({
      id: "t1",
      whatsapp_number: "+1234",
      preferences: { budget: "moderate" },
      user_type: "local",
    });

    const result = await startProfileLearning("+1234");

    expect(result).toContain("welcome back");
  });

  it("starts interview for new user", async () => {
    mockGetOrCreateTraveler.mockResolvedValue({
      id: "t1",
      whatsapp_number: "+1234",
      preferences: {},
    });

    const result = await startProfileLearning("+1234");

    expect(result).toContain("Sam");
    expect(mockUpdateConversation).toHaveBeenCalledWith("+1234", {
      current_flow: "profile_learning",
      flow_state: { stage: "interviewing" },
    });
  });

  it("sends initial message through profile prompt for new user with message", async () => {
    mockGetOrCreateTraveler.mockResolvedValue({
      id: "t1",
      whatsapp_number: "+1234",
      preferences: {},
    });
    mockChat.mockResolvedValue("Welcome! Are you visiting KL?");

    const result = await startProfileLearning("+1234", "hey I'm planning a trip");

    expect(result).toBe("Welcome! Are you visiting KL?");
    expect(mockChat).toHaveBeenCalledWith(
      "profile prompt",
      [{ role: "user", content: "hey I'm planning a trip" }],
      expect.any(Object)
    );
  });
});
