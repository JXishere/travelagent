import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock modules
vi.mock("../database.js", () => ({
  getSpotsNeedingFeedback: vi.fn(),
  markFeedbackAsked: vi.fn(),
  insertFeedback: vi.fn(),
  getOrCreateTraveler: vi.fn(),
  updateTraveler: vi.fn(),
  updateConversation: vi.fn(),
  trackEvent: vi.fn(),
}));
vi.mock("../llm.js", () => ({
  chat: vi.fn(),
  loadPrompt: vi.fn().mockReturnValue("feedback prompt"),
  HAIKU: "claude-haiku-4-5-20251001",
}));

import { handleFeedback, startFeedbackCollection } from "./feedback.js";
import {
  getSpotsNeedingFeedback,
  markFeedbackAsked,
  insertFeedback,
  getOrCreateTraveler,
  updateTraveler,
  updateConversation,
} from "../database.js";
import { chat } from "../llm.js";
import type { Conversation } from "../database.js";

const mockChat = chat as ReturnType<typeof vi.fn>;
const mockGetSpotsNeedingFeedback = getSpotsNeedingFeedback as ReturnType<typeof vi.fn>;
const mockInsertFeedback = insertFeedback as ReturnType<typeof vi.fn>;
const mockGetOrCreateTraveler = getOrCreateTraveler as ReturnType<typeof vi.fn>;
const mockUpdateTraveler = updateTraveler as ReturnType<typeof vi.fn>;
const mockUpdateConversation = updateConversation as ReturnType<typeof vi.fn>;
const mockMarkFeedbackAsked = markFeedbackAsked as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrCreateTraveler.mockResolvedValue({
    id: "t1",
    whatsapp_number: "+1234",
    spots_liked: [],
    spots_disliked: [],
  });
});

describe("handleFeedback", () => {
  const baseConvo: Conversation = {
    id: "c1",
    whatsapp_number: "+1234",
    current_flow: "feedback",
    flow_state: {
      stage: "asking",
      spot_id: "spot-1",
      spot_name: "Fatty Crab",
      pending_spots: ["spot-2"],
      pending_names: ["Village Park"],
    },
    messages: [],
    updated_at: new Date().toISOString(),
  };

  it("parses rating feedback and advances to next spot", async () => {
    mockChat.mockResolvedValue('```json\n{"rating": 5, "did_they_go": true, "comments": "amazing"}\n```');

    const result = await handleFeedback("+1234", "loved it, 5 stars", baseConvo);

    expect(mockInsertFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        spot_id: "spot-1",
        traveler_id: "t1",
        rating: 5,
        visited: true,
      })
    );
    expect(result).toContain("Village Park");
    expect(mockUpdateConversation).toHaveBeenCalledWith("+1234", {
      flow_state: expect.objectContaining({
        stage: "asking",
        spot_id: "spot-2",
      }),
    });
  });

  it("adds spot to spots_liked when rating >= 4", async () => {
    mockChat.mockResolvedValue('```json\n{"rating": 4, "did_they_go": true}\n```');

    await handleFeedback("+1234", "pretty good, 4", baseConvo);

    expect(mockUpdateTraveler).toHaveBeenCalledWith(
      "+1234",
      expect.objectContaining({ spots_liked: ["spot-1"] })
    );
  });

  it("adds spot to spots_disliked when rating <= 2", async () => {
    mockChat.mockResolvedValue('```json\n{"rating": 2, "did_they_go": true}\n```');

    await handleFeedback("+1234", "not great, 2", baseConvo);

    expect(mockUpdateTraveler).toHaveBeenCalledWith(
      "+1234",
      expect.objectContaining({ spots_disliked: ["spot-1"] })
    );
  });

  it("does not update liked/disliked for mid-range rating", async () => {
    mockChat.mockResolvedValue('```json\n{"rating": 3, "did_they_go": true}\n```');

    await handleFeedback("+1234", "it was okay, 3", baseConvo);

    expect(mockUpdateTraveler).not.toHaveBeenCalled();
  });

  it("completes flow when no more pending spots", async () => {
    const convoNoPending: Conversation = {
      ...baseConvo,
      flow_state: {
        stage: "asking",
        spot_id: "spot-1",
        spot_name: "Fatty Crab",
        pending_spots: [],
        pending_names: [],
      },
    };
    mockChat.mockResolvedValue('```json\n{"rating": 5, "did_they_go": true}\n```');

    const result = await handleFeedback("+1234", "5 stars!", convoNoPending);

    expect(result).toContain("Thanks for all the feedback");
    expect(mockUpdateConversation).toHaveBeenCalledWith("+1234", {
      current_flow: "general",
      flow_state: {},
    });
  });

  it("handles JSON parse failure gracefully", async () => {
    mockChat.mockResolvedValue("I couldn't understand that");

    const result = await handleFeedback("+1234", "blah", baseConvo);

    expect(result).toContain("Got it, thanks");
  });

  it("does not update liked/disliked when did_they_go is false", async () => {
    mockChat.mockResolvedValue('```json\n{"rating": 5, "did_they_go": false}\n```');

    await handleFeedback("+1234", "didnt go but heard it's great", baseConvo);

    expect(mockUpdateTraveler).not.toHaveBeenCalled();
  });
});

describe("startFeedbackCollection", () => {
  it("returns early message when no spots need feedback", async () => {
    mockGetSpotsNeedingFeedback.mockResolvedValue([]);

    const result = await startFeedbackCollection("+1234");

    expect(result).toContain("don't have any spots to check on");
    expect(mockUpdateConversation).toHaveBeenCalledWith("+1234", {
      current_flow: "general",
      flow_state: {},
    });
  });

  it("sets up feedback flow with first spot", async () => {
    mockGetSpotsNeedingFeedback.mockResolvedValue([
      { id: "spot-1", name: "Fatty Crab" },
      { id: "spot-2", name: "Village Park" },
    ]);

    const result = await startFeedbackCollection("+1234");

    expect(result).toContain("Fatty Crab");
    expect(mockUpdateConversation).toHaveBeenCalledWith("+1234", {
      current_flow: "feedback",
      flow_state: {
        stage: "asking",
        spot_id: "spot-1",
        spot_name: "Fatty Crab",
        pending_spots: ["spot-2"],
        pending_names: ["Village Park"],
      },
    });
    expect(mockMarkFeedbackAsked).toHaveBeenCalledWith("+1234", ["spot-1", "spot-2"]);
  });

  it("handles single spot without pending", async () => {
    mockGetSpotsNeedingFeedback.mockResolvedValue([
      { id: "spot-1", name: "Fatty Crab" },
    ]);

    await startFeedbackCollection("+1234");

    expect(mockUpdateConversation).toHaveBeenCalledWith("+1234", {
      current_flow: "feedback",
      flow_state: {
        stage: "asking",
        spot_id: "spot-1",
        spot_name: "Fatty Crab",
        pending_spots: [],
        pending_names: [],
      },
    });
  });
});
