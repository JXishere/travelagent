import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock modules
vi.mock("../database.js", () => ({
  insertSpot: vi.fn(),
  findDuplicateSpot: vi.fn(),
  updateConversation: vi.fn(),
  getOrCreateTraveler: vi.fn(),
}));
vi.mock("../llm.js", () => ({
  extractJSON: vi.fn(),
}));

import {
  startGenerate,
  handleGenerate,
  formatCandidate,
} from "./generate.js";
import {
  insertSpot,
  findDuplicateSpot,
  updateConversation,
  getOrCreateTraveler,
} from "../database.js";
import { extractJSON } from "../llm.js";
import type { Conversation } from "../database.js";

const mockExtractJSON = extractJSON as ReturnType<typeof vi.fn>;
const mockInsertSpot = insertSpot as ReturnType<typeof vi.fn>;
const mockFindDuplicateSpot = findDuplicateSpot as ReturnType<typeof vi.fn>;
const mockUpdateConversation = updateConversation as ReturnType<typeof vi.fn>;
const mockGetOrCreateTraveler = getOrCreateTraveler as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockFindDuplicateSpot.mockResolvedValue(null);
  mockGetOrCreateTraveler.mockResolvedValue({
    id: "t1",
    whatsapp_number: "+1234",
    current_city: "Kuala Lumpur",
  });
});

describe("startGenerate", () => {
  it("parses 'bangsar dinner' into area + category", async () => {
    mockExtractJSON.mockResolvedValue({
      candidates: [{ name: "Test Spot", area: "Bangsar", category: "dinner" }],
    });

    await startGenerate("+1234", "bangsar dinner");

    expect(mockExtractJSON).toHaveBeenCalledWith(
      "generate",
      "Neighborhood: bangsar\nCategory: dinner",
      undefined,
      expect.objectContaining({ templateVars: { CITY: "Kuala Lumpur" } })
    );
  });

  it("handles single arg (area only)", async () => {
    mockExtractJSON.mockResolvedValue({
      candidates: [{ name: "Test Spot" }],
    });

    await startGenerate("+1234", "ttdi");

    expect(mockExtractJSON).toHaveBeenCalledWith(
      "generate",
      "Neighborhood: ttdi",
      undefined,
      expect.objectContaining({ templateVars: { CITY: "Kuala Lumpur" } })
    );
  });

  it("handles no args", async () => {
    mockExtractJSON.mockResolvedValue({
      candidates: [{ name: "Test Spot" }],
    });

    await startGenerate("+1234", "");

    expect(mockExtractJSON).toHaveBeenCalledWith(
      "generate",
      "Suggest a diverse mix of popular Kuala Lumpur spots",
      undefined,
      expect.objectContaining({ templateVars: { CITY: "Kuala Lumpur" } })
    );
  });

  it("returns error message when no candidates generated", async () => {
    mockExtractJSON.mockResolvedValue({ candidates: [] });

    const result = await startGenerate("+1234", "nowhere");

    expect(result).toContain("Couldn't generate candidates");
    expect(mockUpdateConversation).not.toHaveBeenCalled();
  });

  it("stores candidates in flow state and presents first", async () => {
    mockExtractJSON.mockResolvedValue({
      candidates: [
        { name: "Spot A", area: "Bangsar" },
        { name: "Spot B", area: "TTDI" },
      ],
    });

    const result = await startGenerate("+1234", "kl");

    expect(mockUpdateConversation).toHaveBeenCalledWith("+1234", {
      current_flow: "generate",
      flow_state: {
        stage: "reviewing",
        candidates: expect.any(Array),
        currentIndex: 0,
      },
    });
    expect(result).toContain("Spot A");
    expect(result).toContain("1/2");
  });
});

describe("handleGenerate", () => {
  const candidates = [
    { name: "Spot A", area: "Bangsar", category: "dinner" },
    { name: "Spot B", area: "TTDI", category: "cafe" },
    { name: "Spot C", area: "KLCC", category: "lunch" },
  ];

  const makeConvo = (idx: number): Conversation => ({
    id: "c1",
    whatsapp_number: "+1234",
    current_flow: "generate",
    flow_state: { stage: "reviewing", candidates, currentIndex: idx },
    messages: [],
    updated_at: new Date().toISOString(),
  });

  it("'skip' advances to next candidate", async () => {
    const result = await handleGenerate("+1234", "skip", makeConvo(0));

    expect(result).toContain("Spot B");
    expect(result).toContain("2/3");
  });

  it("'next' advances to next candidate", async () => {
    const result = await handleGenerate("+1234", "next", makeConvo(0));

    expect(result).toContain("Spot B");
  });

  it("'done' ends the generate session", async () => {
    const result = await handleGenerate("+1234", "done", makeConvo(1));

    expect(result).toContain("session ended");
    expect(mockUpdateConversation).toHaveBeenCalledWith("+1234", {
      current_flow: "general",
      flow_state: {},
    });
  });

  it("'stop' ends the generate session", async () => {
    const result = await handleGenerate("+1234", "stop", makeConvo(0));

    expect(result).toContain("session ended");
  });

  it("enrichment merges extracted data and inserts spot", async () => {
    mockExtractJSON.mockResolvedValue({
      price_range: "$$",
      vibe: "casual",
    });

    const result = await handleGenerate(
      "+1234",
      "it's $$ and very casual",
      makeConvo(0)
    );

    expect(mockInsertSpot).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Spot A",
        area: "Bangsar",
        category: "dinner",
        price_range: "$$",
        vibe: "casual",
        source: "llm_verified",
      })
    );
    expect(result).toContain("Saved");
  });

  it("skips duplicate spots", async () => {
    mockExtractJSON.mockResolvedValue({ vibe: "chill" });
    mockFindDuplicateSpot.mockResolvedValue({ id: "existing-id", name: "Spot A" });

    const result = await handleGenerate("+1234", "looks good", makeConvo(0));

    expect(result).toContain("already exists");
    expect(mockInsertSpot).not.toHaveBeenCalled();
  });

  it("ends session when advancing past last candidate", async () => {
    const result = await handleGenerate("+1234", "skip", makeConvo(2));

    expect(result).toContain("all the candidates");
  });

  it("exits when stage is not 'reviewing'", async () => {
    const convo: Conversation = {
      ...makeConvo(0),
      flow_state: { stage: "done" },
    };

    const result = await handleGenerate("+1234", "hello", convo);

    expect(result).toContain("session ended");
  });
});

describe("formatCandidate", () => {
  it("formats a full candidate", () => {
    const result = formatCandidate(
      {
        name: "Fatty Crab",
        area: "Taman Megah",
        category: "dinner",
        address: "123 Main St",
        price_range: "$$",
        what_to_order: ["chilli crab", "butter prawns"],
        vibe: "chaotic",
        notes: "Always packed on weekends",
      },
      1,
      5
    );

    expect(result).toContain("*Candidate 1/5: Fatty Crab*");
    expect(result).toContain("Taman Megah");
    expect(result).toContain("dinner");
    expect(result).toContain("123 Main St");
    expect(result).toContain("$$");
    expect(result).toContain("chilli crab, butter prawns");
    expect(result).toContain("chaotic");
    expect(result).toContain("Always packed on weekends");
    expect(result).toContain("skip");
  });

  it("formats a minimal candidate", () => {
    const result = formatCandidate({ name: "Test Spot" }, 2, 3);

    expect(result).toContain("*Candidate 2/3: Test Spot*");
    expect(result).not.toContain("Neighborhood:");
    expect(result).not.toContain("Category:");
  });
});
