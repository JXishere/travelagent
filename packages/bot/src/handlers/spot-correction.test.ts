import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../database.js", () => ({
  findSpotByName: vi.fn(),
  applySpotCorrection: vi.fn().mockResolvedValue(undefined),
  updateConversation: vi.fn().mockResolvedValue(undefined),
  trackEvent: vi.fn(),
}));
vi.mock("../llm.js", () => ({
  chat: vi.fn(),
  classifyConfirmation: vi.fn(),
  samSays: vi.fn().mockImplementation((instruction: string) =>
    Promise.resolve(`[sam: ${instruction.slice(0, 80)}]`)
  ),
  HAIKU: "claude-haiku-4-5-20251001",
}));

import { handleSpotCorrection } from "./spot-correction.js";
import {
  findSpotByName,
  applySpotCorrection,
  updateConversation,
  trackEvent,
} from "../database.js";
import { chat, classifyConfirmation, samSays } from "../llm.js";
import type { Conversation } from "../database.js";

const mockFindSpot = findSpotByName as ReturnType<typeof vi.fn>;
const mockApplyCorrection = applySpotCorrection as ReturnType<typeof vi.fn>;
const mockUpdateConversation = updateConversation as ReturnType<typeof vi.fn>;
const mockTrackEvent = trackEvent as ReturnType<typeof vi.fn>;
const mockChat = chat as ReturnType<typeof vi.fn>;
const mockClassifyConfirmation = classifyConfirmation as ReturnType<typeof vi.fn>;
const mockSamSays = samSays as ReturnType<typeof vi.fn>;

const baseConvo: Conversation = {
  id: "c1",
  whatsapp_number: "+601234",
  current_flow: "general",
  flow_state: {},
  messages: [],
  updated_at: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSamSays.mockImplementation((instruction: string) =>
    Promise.resolve(`[sam: ${instruction.slice(0, 80)}]`)
  );
});

describe("handleSpotCorrection — fresh intent", () => {
  it("asks which place when no spot_name is provided", async () => {
    const response = await handleSpotCorrection(
      "+601234",
      "that place you recommended is closed",
      {},
      { channel: "whatsapp", conversation: baseConvo }
    );
    expect(response).toContain("[sam:");
    expect(mockFindSpot).not.toHaveBeenCalled();
  });

  it("acknowledges when spot is not in DB", async () => {
    mockFindSpot.mockResolvedValue(null);
    const response = await handleSpotCorrection(
      "+601234",
      "Fatty Crab closed down",
      { spot_name: "Fatty Crab", correction: "closed down" },
      { channel: "whatsapp", conversation: baseConvo }
    );
    expect(response).toContain("[sam:");
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "+601234",
      "whatsapp",
      "spot_correction",
      expect.objectContaining({ found_in_db: false })
    );
    expect(mockUpdateConversation).not.toHaveBeenCalled();
  });

  it("extracts correction, sets flow_state, and asks for confirmation when spot is found", async () => {
    mockFindSpot.mockResolvedValue({ id: "spot-1", name: "Fatty Crab", area: "Taman Megah" });
    mockChat.mockResolvedValue(
      JSON.stringify({
        correction_type: "closed",
        is_closed: true,
        correction_summary: "Fatty Crab has permanently closed",
      })
    );

    const response = await handleSpotCorrection(
      "+601234",
      "Fatty Crab closed down",
      { spot_name: "Fatty Crab", correction: "closed down" },
      { channel: "whatsapp", conversation: baseConvo }
    );

    expect(response).toContain("[sam:");
    expect(mockUpdateConversation).toHaveBeenCalledWith(
      "+601234",
      expect.objectContaining({
        current_flow: "spot_correction",
        flow_state: expect.objectContaining({
          stage: "awaiting_confirmation",
          spot_id: "spot-1",
          spot_name: "Fatty Crab",
        }),
      })
    );
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "+601234",
      "whatsapp",
      "spot_correction_started",
      expect.objectContaining({ correction_type: "closed" })
    );
  });
});

describe("handleSpotCorrection — mid-flow confirmation", () => {
  const correctionConvo: Conversation = {
    ...baseConvo,
    current_flow: "spot_correction",
    flow_state: {
      stage: "awaiting_confirmation",
      spot_id: "spot-1",
      spot_name: "Fatty Crab",
      delta: {
        correction_type: "closed",
        is_closed: true,
        correction_summary: "Fatty Crab has permanently closed",
      },
    },
  };

  it("applies correction and resets flow on confirm", async () => {
    mockClassifyConfirmation.mockResolvedValue("confirm");

    const response = await handleSpotCorrection(
      "+601234",
      "yes confirmed",
      {},
      { channel: "whatsapp", conversation: correctionConvo }
    );

    expect(mockApplyCorrection).toHaveBeenCalledWith(
      "spot-1",
      "+601234",
      expect.objectContaining({ correction_type: "closed", is_closed: true })
    );
    expect(mockUpdateConversation).toHaveBeenCalledWith(
      "+601234",
      { current_flow: "general", flow_state: {} }
    );
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "+601234",
      "whatsapp",
      "spot_correction_applied",
      expect.objectContaining({ spot_id: "spot-1" })
    );
    expect(response).toContain("[sam:");
  });

  it("cancels and resets flow on unrelated response", async () => {
    mockClassifyConfirmation.mockResolvedValue("unrelated");

    await handleSpotCorrection(
      "+601234",
      "never mind, I want food",
      {},
      { channel: "whatsapp", conversation: correctionConvo }
    );

    expect(mockApplyCorrection).not.toHaveBeenCalled();
    expect(mockUpdateConversation).toHaveBeenCalledWith(
      "+601234",
      { current_flow: "general", flow_state: {} }
    );
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "+601234",
      "whatsapp",
      "spot_correction_cancelled",
      expect.any(Object)
    );
  });

  it("cancels and resets flow on correct response (user wants to refine — treat as cancel for now)", async () => {
    mockClassifyConfirmation.mockResolvedValue("correct");

    await handleSpotCorrection(
      "+601234",
      "actually it moved, not closed",
      {},
      { channel: "whatsapp", conversation: correctionConvo }
    );

    expect(mockApplyCorrection).not.toHaveBeenCalled();
    expect(mockUpdateConversation).toHaveBeenCalledWith(
      "+601234",
      { current_flow: "general", flow_state: {} }
    );
  });
});
