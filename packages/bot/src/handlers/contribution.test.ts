import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock modules that have side effects at import time
vi.mock("../database.js", () => ({
  updateConversation: vi.fn().mockResolvedValue(undefined),
  insertSpot: vi.fn().mockResolvedValue(undefined),
  updateSpot: vi.fn().mockResolvedValue(undefined),
  findDuplicateSpot: vi.fn().mockResolvedValue(null),
  getOrCreateContributor: vi.fn().mockResolvedValue({ id: "c1", spots_contributed: 1 }),
  incrementContributorCount: vi.fn().mockResolvedValue(undefined),
  getSpotById: vi.fn().mockResolvedValue(null),
  trackEvent: vi.fn(),
}));
vi.mock("../transcription.js", () => ({}));
vi.mock("../whatsapp.js", () => ({}));
vi.mock("../llm.js", () => ({
  webSearchSpot: vi.fn().mockResolvedValue({}),
  classifyConfirmation: vi.fn().mockResolvedValue("confirm"),
  extractJSON: vi.fn().mockResolvedValue({}),
  samSays: vi.fn().mockImplementation((instruction: string) => Promise.resolve(`[sam: ${instruction.slice(0, 60)}]`)),
}));

import {
  smartMerge,
  isReady,
  smartMergeForUpdate,
  formatSummary,
  describeNewInfo,
  enrichFromWeb,
  handleContribution,
} from "./contribution.js";
import { webSearchSpot, classifyConfirmation, samSays } from "../llm.js";
import type { Spot, Conversation } from "../database.js";

describe("smartMerge", () => {
  it("merges new fields into empty object", () => {
    const result = smartMerge({}, { name: "Fatty Crab", category: "dinner" });
    expect(result.name).toBe("Fatty Crab");
    expect(result.category).toBe("dinner");
  });

  it("preserves existing fields when incoming is empty", () => {
    const result = smartMerge({ name: "Fatty Crab" }, {});
    expect(result.name).toBe("Fatty Crab");
  });

  it("overwrites scalar fields", () => {
    const result = smartMerge(
      { name: "Fatty Crab", category: "lunch" },
      { category: "dinner" }
    );
    expect(result.category).toBe("dinner");
  });

  it("appends to arrays without duplicates by default", () => {
    const result = smartMerge(
      { what_to_order: ["nasi lemak"] },
      { what_to_order: ["nasi lemak", "roti canai"] }
    );
    expect(result.what_to_order).toEqual(["nasi lemak", "roti canai"]);
  });

  it("replaces arrays when replaceArrays is true", () => {
    const result = smartMerge(
      { what_to_order: ["nasi lemak", "teh tarik"] },
      { what_to_order: ["roti canai"] },
      true
    );
    expect(result.what_to_order).toEqual(["roti canai"]);
  });

  it("ignores null, undefined, empty strings, empty arrays, and empty objects", () => {
    const result = smartMerge(
      { name: "Fatty Crab", vibe: "casual" },
      { name: null as any, vibe: "", what_to_order: [], opening_hours: {} }
    );
    expect(result.name).toBe("Fatty Crab");
    expect(result.vibe).toBe("casual");
    expect(result.what_to_order).toBeUndefined();
  });

  it("skips missing_fields key", () => {
    const result = smartMerge(
      {},
      { name: "test", missing_fields: ["category"] } as any
    );
    expect(result.missing_fields).toBeUndefined();
  });
});

describe("isReady", () => {
  it("returns false when missing critical fields", () => {
    expect(isReady({})).toBe(false);
    expect(isReady({ name: "Test" })).toBe(false);
    expect(isReady({ name: "Test", category: "dinner" })).toBe(false);
  });

  it("returns false when has critical but no operational data", () => {
    expect(isReady({ name: "Test", category: "dinner", neighborhood: "Bangsar" })).toBe(false);
  });

  it("returns true when has critical + what_to_order", () => {
    expect(
      isReady({
        name: "Test",
        category: "dinner",
        neighborhood: "Bangsar",
        what_to_order: ["nasi lemak"],
      })
    ).toBe(true);
  });

  it("returns false when has critical + pro_tips but no what_to_order", () => {
    expect(
      isReady({
        name: "Test",
        category: "dinner",
        neighborhood: "Bangsar",
        pro_tips: ["go early"],
      })
    ).toBe(false);
  });

  it("returns false when has critical + payment_methods but no what_to_order", () => {
    expect(
      isReady({
        name: "Test",
        category: "dinner",
        neighborhood: "Bangsar",
        payment_methods: ["cash"],
      })
    ).toBe(false);
  });
});

describe("smartMergeForUpdate", () => {
  it("extracts scalar updates", () => {
    const result = smartMergeForUpdate({ vibe: "chaotic", price_range: "$$" });
    expect(result.vibe).toBe("chaotic");
    expect(result.price_range).toBe("$$");
  });

  it("ignores missing_fields", () => {
    const result = smartMergeForUpdate({ vibe: "chill", missing_fields: ["name"] } as any);
    expect(result).not.toHaveProperty("missing_fields");
  });

  it("ignores null values", () => {
    const result = smartMergeForUpdate({ vibe: null as any });
    expect(result).not.toHaveProperty("vibe");
  });
});

const baseSpot: Spot = {
  id: "spot-1",
  name: "Fatty Crab",
  city: "Kuala Lumpur",
};

describe("formatSummary", () => {
  it("formats full data", () => {
    const result = formatSummary({
      name: "Fatty Crab",
      neighborhood: "Taman Megah",
      category: "dinner",
      price_range: "$$",
      payment_methods: ["cash"],
      what_to_order: ["chilli crab"],
      pro_tips: ["go early"],
      vibe: "chaotic",
    });
    expect(result).toContain("*Fatty Crab* — Taman Megah, Kuala Lumpur");
    expect(result).toContain("Dinner");
    expect(result).toContain("$$");
    expect(result).toContain("cash");
    expect(result).toContain("🍽 Order: chilli crab");
    expect(result).toContain("💡 go early");
    expect(result).not.toContain("🕐");
    expect(result).toContain("✨ Vibe: chaotic");
  });

  it("formats minimal data", () => {
    const result = formatSummary({ name: "Test Spot", neighborhood: "KLCC" });
    expect(result).toContain("*Test Spot* — KLCC, Kuala Lumpur");
    expect(result).not.toContain("🍽");
    expect(result).not.toContain("💡");
    expect(result).not.toContain("🕐");
    expect(result).not.toContain("✨");
  });

  it("uses custom city when provided", () => {
    const result = formatSummary({
      name: "Test",
      neighborhood: "Shibuya",
      city: "Tokyo",
    });
    expect(result).toContain("*Test* — Shibuya, Tokyo");
  });

  it("joins multiple what_to_order items", () => {
    const result = formatSummary({
      name: "Test",
      neighborhood: "X",
      what_to_order: ["nasi lemak", "roti canai"],
    });
    expect(result).toContain("🍽 Order: nasi lemak, roti canai");
  });

  it("joins multiple pro_tips with periods", () => {
    const result = formatSummary({
      name: "Test",
      neighborhood: "X",
      pro_tips: ["go early", "sit outside"],
    });
    expect(result).toContain("💡 go early. sit outside");
  });

  it("does not render opening_hours even if present in data", () => {
    const result = formatSummary({
      name: "Test",
      neighborhood: "X",
      opening_hours: { monday: "9am-5pm", tuesday: "10am-6pm" },
    });
    expect(result).not.toContain("🕐");
  });
});

describe("describeNewInfo", () => {
  it("detects new array items", () => {
    const existing: Spot = {
      ...baseSpot,
      what_to_order: ["nasi lemak"],
    };
    const result = describeNewInfo(existing, {
      what_to_order: ["nasi lemak", "roti canai"],
    });
    expect(result).toEqual(["• New what to order: roti canai"]);
  });

  it("filters duplicates case-insensitively", () => {
    const existing: Spot = {
      ...baseSpot,
      what_to_order: ["Nasi Lemak"],
    };
    const result = describeNewInfo(existing, {
      what_to_order: ["nasi lemak"],
    });
    expect(result).toEqual([]);
  });

  it("detects new vibe", () => {
    const existing: Spot = { ...baseSpot, vibe: "casual" };
    const result = describeNewInfo(existing, { vibe: "chaotic" });
    expect(result).toContain("• Vibe: chaotic (was: casual)");
  });

  it("skips same vibe", () => {
    const existing: Spot = { ...baseSpot, vibe: "casual" };
    const result = describeNewInfo(existing, { vibe: "casual" });
    expect(result.find((l) => l.includes("Vibe"))).toBeUndefined();
  });

  it("detects new price_range", () => {
    const existing: Spot = { ...baseSpot, price_range: "$" };
    const result = describeNewInfo(existing, { price_range: "$$" });
    expect(result).toContain("• Price: $$ (was: $)");
  });

  it("returns empty array when no differences", () => {
    const existing: Spot = {
      ...baseSpot,
      what_to_order: ["nasi lemak"],
      vibe: "casual",
      price_range: "$$",
    };
    const result = describeNewInfo(existing, {
      what_to_order: ["nasi lemak"],
      vibe: "casual",
      price_range: "$$",
    });
    expect(result).toEqual([]);
  });
});


describe("enrichFromWeb", () => {
  const mockedWebSearch = vi.mocked(webSearchSpot);

  beforeEach(() => {
    mockedWebSearch.mockReset().mockResolvedValue({});
  });

  it("returns data unchanged when name is missing", async () => {
    const data = { category: "dinner" };
    const result = await enrichFromWeb(data);
    expect(result.enriched).toEqual(data);
    expect(result.didEnrich).toBe(false);
    expect(mockedWebSearch).not.toHaveBeenCalled();
  });

  it("returns data unchanged when already isReady", async () => {
    const data = {
      name: "Fatty Crab",
      category: "dinner",
      neighborhood: "Taman Megah",
      what_to_order: ["chilli crab"],
    };
    const result = await enrichFromWeb(data);
    expect(result.enriched).toEqual(data);
    expect(result.didEnrich).toBe(false);
    expect(mockedWebSearch).not.toHaveBeenCalled();
  });

  it("merges web data and contributor data wins on conflicts", async () => {
    mockedWebSearch.mockResolvedValue({
      neighborhood: "Bangsar South",
      category: "cafe",
      price_range: "$$",
    });

    const data = {
      name: "Ka'ia",
      category: "dinner", // contributor says dinner, web says cafe — contributor wins
    };

    const result = await enrichFromWeb(data);
    expect(result.enriched.name).toBe("Ka'ia");
    expect(result.enriched.category).toBe("dinner"); // contributor wins
    expect(result.enriched.neighborhood).toBe("Bangsar South"); // filled from web
    expect(result.enriched.price_range).toBe("$$"); // filled from web
    expect(result.didEnrich).toBe(true);
  });

  it("strips opinion fields from web data", async () => {
    mockedWebSearch.mockResolvedValue({
      neighborhood: "Bangsar South",
      price_range: "$$",
      what_to_order: ["flat white"],
      what_to_skip: ["the pastries"],
      pro_tips: ["sit upstairs"],
      vibe: "chill",
      tier: 2,
      best_time_of_day: "morning",
    });

    const data = { name: "Ka'ia" };
    const result = await enrichFromWeb(data);

    // Operational fields filled
    expect(result.enriched.neighborhood).toBe("Bangsar South");
    expect(result.enriched.price_range).toBe("$$");

    // Opinion fields stripped — not present from web
    expect(result.enriched.what_to_order).toBeUndefined();
    expect(result.enriched.what_to_skip).toBeUndefined();
    expect(result.enriched.pro_tips).toBeUndefined();
    expect(result.enriched.vibe).toBeUndefined();
    expect(result.enriched.tier).toBeUndefined();
    expect(result.enriched.best_time_of_day).toBeUndefined();
    expect(result.didEnrich).toBe(true);
  });

  it("returns didEnrich false when web returns only opinion fields", async () => {
    mockedWebSearch.mockResolvedValue({
      what_to_order: ["flat white"],
      vibe: "chill",
      pro_tips: ["go early"],
    });

    const data = { name: "Ka'ia" };
    const result = await enrichFromWeb(data);
    expect(result.enriched).toEqual(data);
    expect(result.didEnrich).toBe(false);
  });

  it("returns didEnrich false when web returns empty", async () => {
    mockedWebSearch.mockResolvedValue({});
    const data = { name: "Unknown Spot" };
    const result = await enrichFromWeb(data);
    expect(result.enriched).toEqual(data);
    expect(result.didEnrich).toBe(false);
  });
});

// --- handleContribution integration tests ---

import {
  updateConversation,
  insertSpot,
  findDuplicateSpot,
  getOrCreateContributor,
  incrementContributorCount,
  getSpotById,
  updateSpot,
  trackEvent,
} from "../database.js";
import { extractJSON } from "../llm.js";

const mockedSamSays = vi.mocked(samSays);
const mockedClassify = vi.mocked(classifyConfirmation);
const mockedExtract = vi.mocked(extractJSON);
const mockedWebSearch = vi.mocked(webSearchSpot);
const mockedUpdateConv = vi.mocked(updateConversation);
const mockedInsertSpot = vi.mocked(insertSpot);
const mockedFindDuplicate = vi.mocked(findDuplicateSpot);
const mockedGetContributor = vi.mocked(getOrCreateContributor);
const mockedIncrementCount = vi.mocked(incrementContributorCount);
const mockedGetSpotById = vi.mocked(getSpotById);
const mockedUpdateSpot = vi.mocked(updateSpot);
const mockedTrackEvent = vi.mocked(trackEvent);

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "conv-1",
    whatsapp_number: "+60123",
    current_flow: "contribution",
    flow_state: {},
    messages: [],
    updated_at: new Date().toISOString(),
    ...overrides,
  } as Conversation;
}

const readySpot = {
  name: "Fatty Crab",
  category: "dinner",
  neighborhood: "Taman Megah",
  what_to_order: ["chilli crab"],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedSamSays.mockImplementation((instruction: string) =>
    Promise.resolve(`[sam: ${instruction.slice(0, 60)}]`)
  );
  mockedExtract.mockResolvedValue({});
  mockedWebSearch.mockResolvedValue({});
  mockedClassify.mockResolvedValue("confirm");
  mockedFindDuplicate.mockResolvedValue(null);
  mockedGetContributor.mockResolvedValue({ id: "c1", spots_contributed: 1 } as any);
  mockedGetSpotById.mockResolvedValue(null);
});

describe("handleContribution — first message (no stage)", () => {
  it("initializes collecting stage and calls samSays when extraction yields nothing", async () => {
    const conv = makeConversation({ flow_state: {} });
    const result = await handleContribution("+60123", "I want to add a spot", undefined, conv);

    expect(mockedUpdateConv).toHaveBeenCalledWith("+60123", expect.objectContaining({
      current_flow: "contribution",
      flow_state: expect.objectContaining({ stage: "collecting" }),
    }));
    expect(mockedSamSays).toHaveBeenCalled();
    expect(typeof result).toBe("string");
  });

  it("extracts data from trigger message and shows summary if ready", async () => {
    mockedExtract.mockResolvedValue(readySpot);

    const conv = makeConversation({ flow_state: {} });
    const result = await handleContribution("+60123", "Fatty Crab in Taman Megah, dinner, order chilli crab", undefined, conv);

    // Should transition to confirming
    expect(mockedUpdateConv).toHaveBeenCalledWith("+60123", expect.objectContaining({
      flow_state: expect.objectContaining({ stage: "confirming" }),
    }));
    expect(result).toContain("*Fatty Crab*");
    expect(result).toContain("Taman Megah");
  });

  it("asks follow-up via samSays when extraction is partial", async () => {
    mockedExtract.mockResolvedValue({ name: "Fatty Crab" });

    const conv = makeConversation({ flow_state: {} });
    await handleContribution("+60123", "Fatty Crab is amazing", undefined, conv);

    // Should stay in collecting
    expect(mockedUpdateConv).toHaveBeenCalledWith("+60123", expect.objectContaining({
      flow_state: expect.objectContaining({ stage: "collecting" }),
    }));
    // samSays called for follow-up (generateFollowUp) — should mention the spot name
    expect(mockedSamSays).toHaveBeenCalledWith(
      expect.stringContaining("Fatty Crab")
    );
  });
});

describe("handleContribution — collecting stage", () => {
  it("accumulates data across messages and transitions to confirming when ready", async () => {
    mockedExtract.mockResolvedValue({ category: "dinner", what_to_order: ["chilli crab"] });

    const conv = makeConversation({
      flow_state: {
        stage: "collecting",
        extracted: { name: "Fatty Crab", neighborhood: "Taman Megah" },
        source: "text",
        messagesReceived: 1,
      },
    });

    const result = await handleContribution("+60123", "it's a dinner spot, must order the chilli crab", undefined, conv);

    expect(mockedUpdateConv).toHaveBeenCalledWith("+60123", expect.objectContaining({
      flow_state: expect.objectContaining({ stage: "confirming" }),
    }));
    expect(result).toContain("*Fatty Crab*");
  });

  it("generates Sam-voiced follow-up mentioning missing fields", async () => {
    mockedExtract.mockResolvedValue({ neighborhood: "Bangsar" });

    const conv = makeConversation({
      flow_state: {
        stage: "collecting",
        extracted: { name: "Secret Spot" },
        source: "text",
        messagesReceived: 1,
      },
    });

    await handleContribution("+60123", "it's in Bangsar", undefined, conv);

    // Should ask for category (name + neighborhood known, category missing)
    expect(mockedSamSays).toHaveBeenCalledWith(
      expect.stringContaining("what kind of spot")
    );
  });

  it("triggers web enrichment when name is first provided", async () => {
    mockedExtract.mockResolvedValue({ name: "Ka'ia" });
    mockedWebSearch.mockResolvedValue({ neighborhood: "Bangsar South", price_range: "$$" });

    const conv = makeConversation({
      flow_state: {
        stage: "collecting",
        extracted: {},
        source: "text",
        messagesReceived: 0,
      },
    });

    await handleContribution("+60123", "Ka'ia is great", undefined, conv);

    expect(mockedWebSearch).toHaveBeenCalledWith("Ka'ia", "Kuala Lumpur", undefined);
    // Enriched data should be saved in flow state
    expect(mockedUpdateConv).toHaveBeenCalledWith("+60123", expect.objectContaining({
      flow_state: expect.objectContaining({
        extracted: expect.objectContaining({ name: "Ka'ia", neighborhood: "Bangsar South" }),
        webEnriched: true,
      }),
    }));
  });

  it("shows web-enriched intro via samSays when summary is ready after enrichment", async () => {
    // Extraction returns partial data (missing category) — not yet ready
    mockedExtract.mockResolvedValue({ name: "Ka'ia", neighborhood: "Bangsar", what_to_order: ["flat white"] });
    // Web search fills in the missing category — making it ready
    mockedWebSearch.mockResolvedValue({ category: "cafe", price_range: "$$" });

    const conv = makeConversation({
      flow_state: { stage: "collecting", extracted: {}, source: "text", messagesReceived: 0 },
    });

    const result = await handleContribution("+60123", "Ka'ia in Bangsar, order the flat white", undefined, conv);

    // samSays generates the web-enriched intro
    expect(mockedSamSays).toHaveBeenCalledWith(
      expect.stringContaining("filled in some")
    );
    // Summary data is still present
    expect(result).toContain("*Ka'ia*");
  });
});

describe("handleContribution — confirming stage", () => {
  const confirmingConv = (overrides = {}) => makeConversation({
    flow_state: {
      stage: "confirming",
      extracted: readySpot,
      source: "text",
      messagesReceived: 2,
      webEnriched: false,
      ...overrides,
    },
  });

  it("saves spot on confirm and calls samSays for thank-you", async () => {
    mockedClassify.mockResolvedValue("confirm");

    const result = await handleContribution("+60123", "looks good", undefined, confirmingConv());

    expect(mockedInsertSpot).toHaveBeenCalledWith(expect.objectContaining({
      name: "Fatty Crab",
      contributor_id: "c1",
      source: "text",
    }));
    expect(mockedIncrementCount).toHaveBeenCalled();
    expect(mockedSamSays).toHaveBeenCalledWith(
      expect.stringContaining('saved "Fatty Crab"')
    );
    expect(typeof result).toBe("string");
  });

  it("saves spot on unrelated and appends transition", async () => {
    mockedClassify.mockResolvedValue("unrelated");

    const result = await handleContribution("+60123", "I'm hungry", undefined, confirmingConv());

    expect(mockedInsertSpot).toHaveBeenCalled();
    expect(result).toContain("Now — what's up?");
  });

  it("re-shows summary on correction with updated data", async () => {
    mockedClassify.mockResolvedValue("correct");
    mockedExtract.mockResolvedValue({ neighborhood: "Bangsar" });

    const result = await handleContribution("+60123", "actually it's in Bangsar", undefined, confirmingConv());

    // Should re-save with confirming stage and updated data
    expect(mockedUpdateConv).toHaveBeenCalledWith("+60123", expect.objectContaining({
      flow_state: expect.objectContaining({
        stage: "confirming",
        extracted: expect.objectContaining({ neighborhood: "Bangsar" }),
      }),
    }));
    expect(result).toContain("*Fatty Crab*");
    expect(result).toContain("Bangsar");
  });

  it("calls samSays with web-enriched context and user's question for question intent", async () => {
    mockedClassify.mockResolvedValue("question");

    await handleContribution("+60123", "where did you get the hours?", undefined, confirmingConv({ webEnriched: true }));

    expect(mockedSamSays).toHaveBeenCalledWith(
      expect.stringContaining("filled in some operational gaps")
    );
    // User's actual question is included
    expect(mockedSamSays).toHaveBeenCalledWith(
      expect.stringContaining("where did you get the hours?")
    );
  });

  it("calls samSays with non-enriched context and user's question for question intent", async () => {
    mockedClassify.mockResolvedValue("question");

    await handleContribution("+60123", "double check the opening time", undefined, confirmingConv({ webEnriched: false }));

    expect(mockedSamSays).toHaveBeenCalledWith(
      expect.stringContaining("All the data came from what they told you")
    );
    // User's actual question is included
    expect(mockedSamSays).toHaveBeenCalledWith(
      expect.stringContaining("double check the opening time")
    );
  });
});

describe("handleContribution — duplicate detection", () => {
  const confirmingConv = () => makeConversation({
    flow_state: {
      stage: "confirming",
      extracted: { ...readySpot, vibe: "chaotic" },
      source: "text",
      messagesReceived: 2,
    },
  });

  it("handles duplicate with same info — resets flow and notifies via samSays", async () => {
    mockedClassify.mockResolvedValue("confirm");
    mockedFindDuplicate.mockResolvedValue({
      id: "dup-1",
      name: "Fatty Crab",
      neighborhood: "Taman Megah",
      city: "Kuala Lumpur",
      what_to_order: ["chilli crab"],
      vibe: "chaotic",
    } as Spot);

    const result = await handleContribution("+60123", "save it", undefined, confirmingConv());

    expect(mockedInsertSpot).not.toHaveBeenCalled();
    expect(mockedUpdateConv).toHaveBeenCalledWith("+60123", expect.objectContaining({
      current_flow: "general",
      flow_state: {},
    }));
    expect(mockedSamSays).toHaveBeenCalledWith(
      expect.stringContaining("already in your knowledge graph")
    );
    expect(typeof result).toBe("string");
  });

  it("handles duplicate with new info — transitions to update_existing via samSays", async () => {
    mockedClassify.mockResolvedValue("confirm");
    mockedFindDuplicate.mockResolvedValue({
      id: "dup-1",
      name: "Fatty Crab",
      neighborhood: "Taman Megah",
      city: "Kuala Lumpur",
      what_to_order: ["chilli crab"],
      vibe: "casual", // different from incoming "chaotic"
    } as Spot);

    const result = await handleContribution("+60123", "save it", undefined, confirmingConv());

    expect(mockedInsertSpot).not.toHaveBeenCalled();
    expect(mockedUpdateConv).toHaveBeenCalledWith("+60123", expect.objectContaining({
      flow_state: expect.objectContaining({
        stage: "update_existing",
        duplicateSpotId: "dup-1",
      }),
    }));
    expect(mockedSamSays).toHaveBeenCalledWith(
      expect.stringContaining("already exists")
    );
    expect(typeof result).toBe("string");
  });
});

describe("handleContribution — update_existing stage", () => {
  const updateConv = () => makeConversation({
    flow_state: {
      stage: "update_existing",
      extracted: { ...readySpot, vibe: "chaotic" },
      source: "text",
      messagesReceived: 0,
      duplicateSpotId: "spot-99",
    },
  });

  it("updates spot on confirm and thanks via samSays", async () => {
    mockedClassify.mockResolvedValue("confirm");
    mockedGetSpotById.mockResolvedValue({
      id: "spot-99",
      name: "Fatty Crab",
      what_to_order: ["chilli crab"],
    } as Spot);

    const result = await handleContribution("+60123", "yes update it", undefined, updateConv());

    expect(mockedUpdateSpot).toHaveBeenCalledWith("spot-99", expect.objectContaining({
      vibe: "chaotic",
    }));
    expect(mockedUpdateConv).toHaveBeenCalledWith("+60123", expect.objectContaining({
      current_flow: "general",
    }));
    expect(mockedSamSays).toHaveBeenCalledWith(
      expect.stringContaining("updated")
    );
    expect(typeof result).toBe("string");
  });

  it("appends transition suffix on unrelated during update", async () => {
    mockedClassify.mockResolvedValue("unrelated");
    mockedGetSpotById.mockResolvedValue({ id: "spot-99", name: "Fatty Crab" } as Spot);

    const result = await handleContribution("+60123", "I'm hungry", undefined, updateConv());

    expect(mockedUpdateSpot).toHaveBeenCalled();
    expect(result).toContain("Now — what's up?");
  });

  it("declines update gracefully via samSays", async () => {
    mockedClassify.mockResolvedValue("correct"); // not confirm/unrelated

    const result = await handleContribution("+60123", "nah keep it", undefined, updateConv());

    expect(mockedUpdateSpot).not.toHaveBeenCalled();
    expect(mockedUpdateConv).toHaveBeenCalledWith("+60123", expect.objectContaining({
      current_flow: "general",
    }));
    expect(mockedSamSays).toHaveBeenCalledWith(
      expect.stringContaining("decided not to update")
    );
  });
});

describe("handleContribution — channel parameter", () => {
  it("passes channel to trackEvent on save (default whatsapp)", async () => {
    mockedClassify.mockResolvedValue("confirm");
    const conv = makeConversation({
      flow_state: { stage: "confirming", extracted: readySpot, source: "text", messagesReceived: 2 },
    });

    await handleContribution("+60123", "save it", undefined, conv);

    expect(mockedTrackEvent).toHaveBeenCalledWith("+60123", "whatsapp", "flow_complete", expect.any(Object));
  });

  it("passes web channel to trackEvent when specified", async () => {
    mockedClassify.mockResolvedValue("confirm");
    const conv = makeConversation({
      flow_state: { stage: "confirming", extracted: readySpot, source: "text", messagesReceived: 2 },
    });

    await handleContribution("+60123", "save it", undefined, conv, { channel: "web" });

    expect(mockedTrackEvent).toHaveBeenCalledWith("+60123", "web", "flow_complete", expect.any(Object));
  });
});

describe("handleContribution — error fallback", () => {
  it("returns hardcoded error for unknown stage", async () => {
    const conv = makeConversation({
      flow_state: { stage: "some_garbage_state" },
    });

    const result = await handleContribution("+60123", "hello", undefined, conv);

    expect(result).toContain("Something went wrong");
    expect(result).toContain("add a spot");
    expect(mockedUpdateConv).toHaveBeenCalledWith("+60123", expect.objectContaining({
      current_flow: "general",
    }));
  });
});
