// Contribution flow — conversational accumulation of spot knowledge
// Two stages: collecting → confirming

import { extractJSON, classifyConfirmation, webSearchSpot, samSays } from "../llm.js";
import {
  insertSpot,
  updateSpot,
  getSpotById,
  findDuplicateSpot,
  getOrCreateContributor,
  incrementContributorCount,
  updateConversation,
  trackEvent,
  type Conversation,
  type Spot,
} from "../database.js";
import { getDefaultCity } from "../utils/city-defaults.js";

/** Only these fields may be filled from web search — everything else must come from the contributor */
const WEB_ALLOWED_FIELDS = new Set([
  "name", "category", "city",
  "price_range", "payment_methods",
]);

interface ExtractedSpot {
  name?: string;
  category?: string;
  neighborhood?: string;
  city?: string;
  address?: string;
  price_range?: string;
  payment_methods?: string[];
  what_to_order?: string[];
  what_to_skip?: string[];
  pro_tips?: string[];
  vibe?: string;
  best_time_of_day?: string;
  indoor_outdoor?: string;
  weather_dependent?: boolean;
  tier?: number;
  missing_fields?: string[];
}

interface ContributionState {
  stage: "collecting" | "confirming" | "update_existing";
  extracted: Partial<ExtractedSpot>;
  source: "voice" | "text";
  messagesReceived: number;
  duplicateSpotId?: string;
  webSourcedFields?: string[];
}



export async function handleContribution(
  phoneNumber: string,
  message: string,
  audioId: string | undefined,
  conversation: Conversation,
  options?: { channel?: "whatsapp" | "web" }
): Promise<string> {
  const channel = options?.channel ?? "whatsapp";
  const state = conversation.flow_state as Partial<ContributionState>;

  // First message — initialize collecting stage
  if (!state.stage) {
    const initialState: ContributionState = {
      stage: "collecting",
      extracted: {},
      source: audioId ? "voice" : "text",
      messagesReceived: 0,
    };

    await updateConversation(phoneNumber, {
      current_flow: "contribution",
      flow_state: initialState,
    });

    // Try to extract info from the triggering message
    const input = await resolveInput(phoneNumber, message, audioId);
    if (input && input.trim()) {
      return await collectInfo(phoneNumber, input, initialState);
    }

    return samSays("A contributor wants to add a spot to your knowledge graph. Ask them about it warmly. One sentence.");
  }

  // Collecting stage
  if (state.stage === "collecting") {
    const input = await resolveInput(phoneNumber, message, audioId);
    const currentState: ContributionState = {
      stage: "collecting",
      extracted: state.extracted ?? {},
      source: audioId ? "voice" : (state.source ?? "text"),
      messagesReceived: state.messagesReceived ?? 0,
    };
    return await collectInfo(phoneNumber, input, currentState);
  }

  // Confirming stage — classify response with LLM instead of regex
  if (state.stage === "confirming") {
    const input = await resolveInput(phoneNumber, message, audioId);
    const summary = formatSummary(state.extracted ?? {});
    const intent = await classifyConfirmation(input, summary);

    if (intent === "question") {
      // Backwards compat: old conversation states used webEnriched boolean
      const webFields = state.webSourcedFields ?? ((state as any).webEnriched ? ["address", "price_range"] : []);
      const dataSource = webFields.length > 0
        ? `You filled in some operational gaps (${webFields.join(", ").replace(/_/g, " ")}) from the web — their opinions on what to order and tips are theirs.`
        : "All the data came from what they told you — you just organized it.";
      const instruction = `A contributor is reviewing their spot summary and said: "${input}". ${dataSource} The spot data is: ${JSON.stringify(state.extracted)}. Answer their specific question helpfully. If they're asking you to verify something, be honest about your confidence. End by asking if they want to save or tweak. Two sentences max.`;
      return samSays(instruction);
    }

    if (intent === "confirm" || intent === "unrelated") {
      const webFields = state.webSourcedFields ?? [];
      const saveResponse = await saveSpot(phoneNumber, state.extracted ?? {}, state.source ?? "text", channel, webFields);
      if (intent === "unrelated") {
        return `${saveResponse}\n\nNow — what's up?`;
      }
      return saveResponse;
    }

    // "correct" — replace-merge corrections and re-show summary
    const newData = await extractWithContext(input, state.extracted ?? {}, true);
    // Belt-and-suspenders: strip opening_hours from correction extraction
    delete (newData as any).opening_hours;
    const merged = smartMerge(state.extracted ?? {}, newData, true);

    // Corrected fields are now contributor-verified — remove from webSourcedFields
    const correctedKeys = Object.keys(newData);
    const prevWebFields = state.webSourcedFields ?? ((state as any).webEnriched ? [] : []);
    const updatedWebFields = prevWebFields.filter((f: string) => !correctedKeys.includes(f));

    await updateConversation(phoneNumber, {
      flow_state: {
        stage: "confirming",
        extracted: merged,
        source: audioId ? "voice" : (state.source ?? "text"),
        messagesReceived: (state.messagesReceived ?? 0) + 1,
        webSourcedFields: updatedWebFields,
      },
    });

    return formatSummary(merged, updatedWebFields);
  }

  // Update existing stage — user confirmed or declined updating a duplicate spot
  if (state.stage === "update_existing") {
    const input = await resolveInput(phoneNumber, message, audioId);
    const intent = await classifyConfirmation(input, "update this spot");

    if (intent === "confirm" || intent === "unrelated") {
      const spotId = state.duplicateSpotId!;
      const existing = await getSpotById(spotId);
      // Strip web-sourced fields before updating
      const webFields = state.webSourcedFields ?? [];
      const cleanedData = { ...(state.extracted ?? {}) };
      for (const field of webFields) {
        delete (cleanedData as any)[field];
      }
      delete (cleanedData as any).opening_hours;
      const updates = smartMergeForUpdate(cleanedData);
      // Merge array fields: append new items to existing arrays
      if (existing) {
        const arrayFields = ["what_to_order", "what_to_skip", "pro_tips", "payment_methods"] as const;
        for (const field of arrayFields) {
          const incomingArr: string[] = (cleanedData as any)?.[field] ?? [];
          if (incomingArr.length > 0) {
            const existingArr: string[] = (existing as any)[field] ?? [];
            const existingLower = new Set(existingArr.map(s => s.toLowerCase()));
            const merged = [...existingArr, ...incomingArr.filter(s => !existingLower.has(s.toLowerCase()))];
            (updates as any)[field] = merged;
          }
        }
      }
      await updateSpot(spotId, updates);
      await updateConversation(phoneNumber, {
        current_flow: "general",
        flow_state: {},
      });
      const response = await samSays(`You just updated "${state.extracted?.name}" with new contributor intel. Thank them warmly, one sentence.`);
      if (intent === "unrelated") {
        return `${response}\n\nNow — what's up?`;
      }
      return response;
    }

    // Declined — go back to general
    await updateConversation(phoneNumber, {
      current_flow: "general",
      flow_state: {},
    });
    return samSays("A contributor decided not to update an existing spot. Let them know it's all good and ask what else you can help with. One sentence.");
  }

  // Fallback
  await updateConversation(phoneNumber, {
    current_flow: "general",
    flow_state: {},
  });
  return "Something went wrong with the contribution. Want to try again? Just say 'add a spot'.";
}

/** Resolve input text — transcribe voice notes, return text otherwise */
async function resolveInput(
  phoneNumber: string,
  message: string,
  audioId: string | undefined
): Promise<string> {
  if (audioId) {
    // Dynamic imports — only loaded when voice notes are present (keeps
    // this module importable in contexts without WhatsApp deps, e.g. web)
    const { sendMessage } = await import("../whatsapp.js");
    await sendMessage(phoneNumber, "Got your voice note — let me listen...");
    try {
      const { transcribeVoiceNote } = await import("../transcription.js");
      return await transcribeVoiceNote(audioId);
    } catch (error) {
      console.error("Voice note transcription failed:", error, "audioId:", audioId);
      return message || "";
    }
  }
  return message;
}

/** Extract structured data from user input, with context of what we already know */
async function extractWithContext(
  input: string,
  existing: Partial<ExtractedSpot>,
  isCorrection = false
): Promise<Partial<ExtractedSpot>> {
  const hasExisting = Object.keys(existing).length > 0;
  const context = hasExisting
    ? isCorrection
      ? `We already know about this spot: ${JSON.stringify(existing)}. The user is CORRECTING or adding to this data. For any field they mention, return the COMPLETE corrected value (not just the new part). For example, if they say "actually it's nasi lemak not nasi campur", return what_to_order: ["nasi lemak"]. Only include fields the user mentioned.`
      : `We already know about this spot: ${JSON.stringify(existing)}. The user is providing more details. Extract ONLY the new information from their message.`
    : undefined;

  try {
    return await extractJSON<ExtractedSpot>("extraction", input, context, {
      templateVars: { CITY: getDefaultCity() },
    });
  } catch (error) {
    console.error("Spot extraction failed:", error, "input:", input.slice(0, 200));
    return {};
  }
}

/** Enrich extracted spot data with web search results */
export async function enrichFromWeb(
  data: Partial<ExtractedSpot>
): Promise<{ enriched: Partial<ExtractedSpot>; webSourcedFields: string[] }> {
  if (!data.name || isReady(data)) {
    return { enriched: data, webSourcedFields: [] };
  }

  const city = data.city || getDefaultCity();
  const webData = await webSearchSpot(data.name, city, data.category);

  // Belt-and-suspenders: never let opening_hours through from web
  delete (webData as any).opening_hours;

  // Allowlist: only keep fields we trust from web search
  for (const key of Object.keys(webData)) {
    if (!WEB_ALLOWED_FIELDS.has(key)) {
      delete webData[key];
    }
  }

  if (Object.keys(webData).length === 0) {
    return { enriched: data, webSourcedFields: [] };
  }

  // Track which fields are genuinely new from web (not already in contributor data)
  const webSourcedFields: string[] = [];
  for (const key of Object.keys(webData)) {
    if ((data as any)[key] == null || (data as any)[key] === "") {
      webSourcedFields.push(key);
    }
  }

  // Contributor data wins — pass it as "incoming" so it overwrites web data
  const merged = smartMerge(webData, data);
  return { enriched: merged, webSourcedFields };
}

/** Process a message during the collecting stage */
async function collectInfo(
  phoneNumber: string,
  input: string,
  state: ContributionState
): Promise<string> {
  const previous = state.extracted;
  const newData = await extractWithContext(input, previous);
  // Belt-and-suspenders: strip opening_hours from extraction
  delete (newData as any).opening_hours;
  let merged = smartMerge(previous, newData);
  const messagesReceived = state.messagesReceived + 1;

  // When the spot name changed (or was first provided), enrich from web
  const nameChanged = merged.name && merged.name !== previous.name;
  let webSourcedFields = state.webSourcedFields ?? [];
  if (nameChanged) {
    if (previous.name) {
      // Name changed mid-flow — reset to just current extraction to avoid stale data
      merged = { ...newData };
    }
    webSourcedFields = [];
    const result = await enrichFromWeb(merged);
    merged = result.enriched;
    webSourcedFields = result.webSourcedFields;
  }

  // Check if we have enough to show a summary
  if (isReady(merged)) {
    await updateConversation(phoneNumber, {
      flow_state: {
        stage: "confirming",
        extracted: merged,
        source: state.source,
        messagesReceived,
        webSourcedFields,
      },
    });
    const summary = formatSummary(merged, webSourcedFields);
    if (webSourcedFields.length > 0) {
      const fieldNames = webSourcedFields.join(", ").replace(/_/g, " ");
      const intro = await samSays(`You looked up a spot online and filled in some operational details (${fieldNames}) for a contributor. Write a one-sentence intro before showing them the data. Mention the specific fields you filled from the web and they should double-check.`);
      return `${intro}\n\n${summary}`;
    }
    return summary;
  }

  // Not ready — save progress and ask a follow-up
  await updateConversation(phoneNumber, {
    flow_state: {
      stage: "collecting",
      extracted: merged,
      source: state.source,
      messagesReceived,
      webSourcedFields,
    },
  });

  return generateFollowUp(merged, previous);
}

/** Merge new extracted data into existing, preserving non-empty values */
export function smartMerge(
  existing: Partial<ExtractedSpot>,
  incoming: Partial<ExtractedSpot>,
  replaceArrays = false
): Partial<ExtractedSpot> {
  const merged = { ...existing };

  for (const [key, value] of Object.entries(incoming)) {
    if (key === "missing_fields") continue;
    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) continue;

    // For corrections, replace arrays outright (LLM returns the complete corrected value)
    // For collecting, merge unique items to accumulate across messages
    if (Array.isArray(value) && Array.isArray((merged as any)[key]) && !replaceArrays) {
      const existingArr = (merged as any)[key] as string[];
      const newItems = value.filter((v: string) => !existingArr.includes(v));
      (merged as any)[key] = [...existingArr, ...newItems];
    } else {
      (merged as any)[key] = value;
    }
  }

  return merged;
}

/** Check if we have enough data to show a confirmation summary */
export function isReady(data: Partial<ExtractedSpot>): boolean {
  const hasCritical = Boolean(data.name && data.category && data.neighborhood);
  const hasContributorOpinion = Boolean(
    data.what_to_order && data.what_to_order.length > 0
  );
  return hasCritical && hasContributorOpinion;
}

/** Generate a Sam-voiced follow-up question based on what's known and what's missing */
async function generateFollowUp(merged: Partial<ExtractedSpot>, previous: Partial<ExtractedSpot>): Promise<string> {
  const meaningfulKeys = Object.keys(merged).filter((k) => k !== "missing_fields");
  if (meaningfulKeys.length === 0) {
    return samSays("A contributor wants to add a spot to your knowledge graph. Ask them about it warmly. One sentence.");
  }

  const missing = !merged.name
    ? "the name of the spot"
    : !merged.neighborhood
    ? "what area/neighborhood it's in"
    : !merged.category
    ? "what kind of spot it is (breakfast, lunch, dinner, cafe, activity, nightlife, market)"
    : !merged.what_to_order?.length
    ? "what people should order there"
    : "any tips like payment, hours, or insider tricks";

  const newName = merged.name && merged.name !== previous.name;
  const newNeighborhood = merged.neighborhood && merged.neighborhood !== previous.neighborhood;
  let ack = "";
  if (newName) ack += `You just learned the spot is called "${merged.name}". `;
  if (newNeighborhood) ack += `You just learned it's in ${merged.neighborhood}. `;

  const instruction = `${ack}A contributor is adding a spot to your knowledge graph. You know so far: ${JSON.stringify(merged)}. Acknowledge what's new briefly and ask for ${missing}. One sentence, keep it natural.`;
  return samSays(instruction);
}

/** Format a summary of the accumulated spot data */
export function formatSummary(data: Partial<ExtractedSpot>, webSourcedFields: string[] = []): string {
  const webSet = new Set(webSourcedFields);
  const tag = (field: string, value: string) =>
    webSet.has(field) ? `${value} _(from web)_` : value;

  const lines: string[] = ["Here's what I've got:", ""];

  lines.push(`*${data.name}* — ${data.neighborhood}, ${data.city || getDefaultCity()}`);

  if (data.address) {
    lines.push(`📍 ${tag("address", data.address)}`);
  }

  const meta: string[] = [];
  if (data.category) meta.push(capitalize(data.category));
  if (data.price_range) meta.push(tag("price_range", data.price_range));
  if (data.payment_methods?.length) meta.push(tag("payment_methods", data.payment_methods.join(", ")));
  if (meta.length) lines.push(meta.join(" | "));

  if (data.what_to_order?.length) {
    lines.push(`🍽 Order: ${data.what_to_order.join(", ")}`);
  }

  if (data.pro_tips?.length) {
    lines.push(`💡 ${data.pro_tips.join(". ")}`);
  }

  if (data.vibe) {
    lines.push(`✨ Vibe: ${data.vibe}`);
  }

  lines.push("");
  if (webSet.size > 0) {
    lines.push("Fields marked _(from web)_ are unverified — double-check before saving.");
  }
  lines.push(`Looks solid — I'll add this unless you want to tweak anything.`);

  return lines.join("\n");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Describe what's new in the contributed data vs the existing spot */
export function describeNewInfo(existing: Spot, incoming: Partial<ExtractedSpot>): string[] {
  const lines: string[] = [];
  const arrayFields = ["what_to_order", "what_to_skip", "pro_tips", "payment_methods"] as const;

  for (const field of arrayFields) {
    const existingArr = (existing as any)[field] ?? [];
    const incomingArr = (incoming as any)[field] ?? [];
    const newItems = incomingArr.filter((item: string) =>
      !existingArr.some((e: string) => e.toLowerCase() === item.toLowerCase())
    );
    if (newItems.length > 0) {
      const label = field.replace(/_/g, " ");
      lines.push(`• New ${label}: ${newItems.join(", ")}`);
    }
  }

  if (incoming.vibe && incoming.vibe !== existing.vibe) {
    lines.push(`• Vibe: ${incoming.vibe} (was: ${existing.vibe ?? "unset"})`);
  }
  if (incoming.price_range && incoming.price_range !== existing.price_range) {
    lines.push(`• Price: ${incoming.price_range} (was: ${existing.price_range ?? "unset"})`);
  }

  return lines;
}

/** Build a partial Spot update from contributed data — appends to arrays, overwrites scalars */
export function smartMergeForUpdate(incoming: Partial<ExtractedSpot>): Partial<Spot> {
  const updates: Partial<Spot> = {};
  const { missing_fields, ...data } = incoming as any;

  // Scalar fields — overwrite if present
  const scalarFields = ["vibe", "price_range", "address", "best_time_of_day", "indoor_outdoor", "weather_dependent", "tier"] as const;
  for (const field of scalarFields) {
    if (data[field] != null) {
      (updates as any)[field] = data[field];
    }
  }

  return updates;
}

async function saveSpot(
  phoneNumber: string,
  data: Partial<ExtractedSpot>,
  source: "voice" | "text",
  channel: "whatsapp" | "web" = "whatsapp",
  webSourcedFields: string[] = []
): Promise<string> {
  const contributor = await getOrCreateContributor(phoneNumber);

  const { missing_fields, ...spotData } = data as any;

  // Strip web-sourced fields — only contributor-verified data goes to DB
  for (const field of webSourcedFields) {
    delete spotData[field];
  }
  // Belt-and-suspenders: never persist opening_hours
  delete spotData.opening_hours;

  // Check for duplicate — offer to update instead of silently discarding
  const duplicate = await findDuplicateSpot(spotData.name, spotData.neighborhood);
  if (duplicate) {
    const newInfo = describeNewInfo(duplicate, data);
    if (newInfo.length === 0) {
      await updateConversation(phoneNumber, {
        current_flow: "general",
        flow_state: {},
      });
      return samSays(`A contributor tried to add "${duplicate.name}" in ${duplicate.neighborhood}, but it's already in your knowledge graph with the same info. Let them know warmly. One sentence.`);
    }

    await updateConversation(phoneNumber, {
      current_flow: "contribution",
      flow_state: {
        stage: "update_existing",
        extracted: data,
        source,
        messagesReceived: 0,
        duplicateSpotId: duplicate.id,
        webSourcedFields,
      },
    });
    return samSays(`A contributor added "${duplicate.name}" which already exists, but they have new intel:\n${newInfo.join("\n")}\nAsk if they want to update the existing entry. Keep it brief.`);
  }

  await insertSpot({
    ...spotData,
    contributor_id: contributor.id,
    source,
  });

  await incrementContributorCount(phoneNumber, data.city || getDefaultCity());
  const updated = await getOrCreateContributor(phoneNumber);

  await updateConversation(phoneNumber, {
    current_flow: "general",
    flow_state: {},
  });

  trackEvent(phoneNumber, channel, "flow_complete", {
    flow: "contribution",
    spot_name: data.name,
    source,
  });

  return samSays(`You just saved "${data.name}" to your knowledge graph from a contributor. They've contributed ${updated.spots_contributed} spot(s) total. Thank them warmly, mention the spot name. One sentence.`);
}
