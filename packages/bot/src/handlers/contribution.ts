// Contribution flow — conversational accumulation of spot knowledge
// Two stages: collecting → confirming

import { extractJSON, classifyConfirmation, webSearchSpot } from "../llm.js";
import {
  insertSpot,
  updateSpot,
  getSpotById,
  findDuplicateSpot,
  getOrCreateContributor,
  incrementContributorCount,
  updateConversation,
  type Conversation,
  type Spot,
} from "../database.js";
import { getDefaultCity } from "../utils/city-defaults.js";

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
  opening_hours?: Record<string, string>;
  tier?: number;
  missing_fields?: string[];
}

interface ContributionState {
  stage: "collecting" | "confirming" | "update_existing";
  extracted: Partial<ExtractedSpot>;
  source: "voice" | "text";
  messagesReceived: number;
  duplicateSpotId?: string;
  webEnriched?: boolean;
}



export async function handleContribution(
  phoneNumber: string,
  message: string,
  audioId: string | undefined,
  conversation: Conversation
): Promise<string> {
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

    return "Nice! What's the spot? Just tell me about it — I'll piece it together.";
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

    if (intent === "confirm" || intent === "unrelated") {
      const saveResponse = await saveSpot(phoneNumber, state.extracted ?? {}, state.source ?? "text");
      if (intent === "unrelated") {
        return `${saveResponse}\n\nNow — what's up?`;
      }
      return saveResponse;
    }

    // "correct" — replace-merge corrections and re-show summary
    const newData = await extractWithContext(input, state.extracted ?? {}, true);
    const merged = smartMerge(state.extracted ?? {}, newData, true);

    await updateConversation(phoneNumber, {
      flow_state: {
        stage: "confirming",
        extracted: merged,
        source: audioId ? "voice" : (state.source ?? "text"),
        messagesReceived: (state.messagesReceived ?? 0) + 1,
      },
    });

    return formatSummary(merged);
  }

  // Update existing stage — user confirmed or declined updating a duplicate spot
  if (state.stage === "update_existing") {
    const input = await resolveInput(phoneNumber, message, audioId);
    const intent = await classifyConfirmation(input, "update this spot");

    if (intent === "confirm" || intent === "unrelated") {
      const spotId = state.duplicateSpotId!;
      const existing = await getSpotById(spotId);
      const updates = smartMergeForUpdate(state.extracted ?? {});
      // Merge array fields: append new items to existing arrays
      if (existing) {
        const arrayFields = ["what_to_order", "what_to_skip", "pro_tips", "payment_methods"] as const;
        for (const field of arrayFields) {
          const incomingArr: string[] = (state.extracted as any)?.[field] ?? [];
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
      const response = `Updated *${state.extracted?.name}* with your new intel! 🙏`;
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
    return "No worries, keeping it as is! What else can I help with?";
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
    return await extractJSON<ExtractedSpot>("extraction", input, context);
  } catch (error) {
    console.error("Spot extraction failed:", error, "input:", input.slice(0, 200));
    return {};
  }
}

/** Enrich extracted spot data with web search results */
export async function enrichFromWeb(
  data: Partial<ExtractedSpot>
): Promise<{ enriched: Partial<ExtractedSpot>; didEnrich: boolean }> {
  if (!data.name || isReady(data)) {
    return { enriched: data, didEnrich: false };
  }

  const city = data.city || getDefaultCity();
  const webData = await webSearchSpot(data.name, city, data.category);
  if (Object.keys(webData).length === 0) {
    return { enriched: data, didEnrich: false };
  }

  // Contributor data wins — pass it as "incoming" so it overwrites web data
  const merged = smartMerge(webData, data);
  const didEnrich = Object.keys(merged).length > Object.keys(data).length;
  return { enriched: merged, didEnrich };
}

/** Process a message during the collecting stage */
async function collectInfo(
  phoneNumber: string,
  input: string,
  state: ContributionState
): Promise<string> {
  const previous = state.extracted;
  const newData = await extractWithContext(input, previous);
  let merged = smartMerge(previous, newData);
  const messagesReceived = state.messagesReceived + 1;

  // When we just learned the spot name, try to enrich from web search
  const justLearnedName = merged.name && !previous.name;
  let webEnriched = state.webEnriched ?? false;
  if (justLearnedName && !webEnriched) {
    const result = await enrichFromWeb(merged);
    merged = result.enriched;
    webEnriched = result.didEnrich;
  }

  // Check if we have enough to show a summary
  if (isReady(merged)) {
    await updateConversation(phoneNumber, {
      flow_state: {
        stage: "confirming",
        extracted: merged,
        source: state.source,
        messagesReceived,
        webEnriched,
      },
    });
    const summary = formatSummary(merged);
    if (webEnriched) {
      return `I looked this up and filled in some gaps. Double-check the details:\n\n${summary}`;
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
      webEnriched,
    },
  });

  return buildFollowUp(merged, previous);
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
  const hasOperational = Boolean(
    (data.what_to_order && data.what_to_order.length > 0) ||
    (data.pro_tips && data.pro_tips.length > 0) ||
    (data.payment_methods && data.payment_methods.length > 0)
  );
  return hasCritical && hasOperational;
}

/** Build a natural follow-up question with a warm prefix */
export function buildFollowUp(merged: Partial<ExtractedSpot>, previous: Partial<ExtractedSpot>): string {
  // If extraction yielded nothing, give a warm opening prompt
  const meaningfulKeys = Object.keys(merged).filter((k) => k !== "missing_fields");
  if (meaningfulKeys.length === 0) {
    return "Nice! What's the spot? Just tell me about it — I'll piece it together.";
  }

  const prefix = buildWarmPrefix(merged, previous);

  if (!merged.name) return `${prefix}What's it called?`;
  if (!merged.neighborhood) return `${prefix}What area is it in? And what city if it's not KL?`;
  if (!merged.category) return `${prefix}What kind of spot? (breakfast, lunch, dinner, cafe, activity, nightlife, market)`;
  if (!merged.what_to_order?.length) return `${prefix}What should people order there?`;
  return `${prefix}Any tips? Like payment, hours, or insider tricks?`;
}

/** Acknowledge what Sam just learned */
export function buildWarmPrefix(merged: Partial<ExtractedSpot>, previous: Partial<ExtractedSpot>): string {
  const learnedName = merged.name && !previous.name;
  const learnedNeighborhood = merged.neighborhood && !previous.neighborhood;

  if (learnedName && learnedNeighborhood) return `*${merged.name}* in ${merged.neighborhood}, nice! `;
  if (learnedName) return `Got it — *${merged.name}*. `;
  if (learnedNeighborhood) return `${merged.neighborhood}, nice! `;
  return "Got it. ";
}

/** Format a summary of the accumulated spot data */
export function formatSummary(data: Partial<ExtractedSpot>): string {
  const lines: string[] = ["Here's what I've got:", ""];

  lines.push(`*${data.name}* — ${data.neighborhood}, ${data.city || getDefaultCity()}`);

  const meta: string[] = [];
  if (data.category) meta.push(capitalize(data.category));
  if (data.price_range) meta.push(data.price_range);
  if (data.payment_methods?.length) meta.push(data.payment_methods.join(", "));
  if (meta.length) lines.push(meta.join(" | "));

  if (data.what_to_order?.length) {
    lines.push(`🍽 Order: ${data.what_to_order.join(", ")}`);
  }

  if (data.pro_tips?.length) {
    lines.push(`💡 ${data.pro_tips.join(". ")}`);
  }

  if (data.opening_hours && Object.keys(data.opening_hours).length > 0) {
    const parts = Object.entries(data.opening_hours).map(([day, hrs]) => `${capitalize(day)}: ${hrs}`);
    lines.push(`🕐 ${parts.join(", ")}`);
  }

  if (data.vibe) {
    lines.push(`✨ Vibe: ${data.vibe}`);
  }

  lines.push("");
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
  const scalarFields = ["vibe", "price_range", "address", "best_time_of_day", "indoor_outdoor", "weather_dependent", "tier", "opening_hours"] as const;
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
  source: "voice" | "text"
): Promise<string> {
  const contributor = await getOrCreateContributor(phoneNumber);

  const { missing_fields, ...spotData } = data as any;

  // Check for duplicate — offer to update instead of silently discarding
  const duplicate = await findDuplicateSpot(spotData.name, spotData.neighborhood);
  if (duplicate) {
    const newInfo = describeNewInfo(duplicate, data);
    if (newInfo.length === 0) {
      await updateConversation(phoneNumber, {
        current_flow: "general",
        flow_state: {},
      });
      return `*${duplicate.name}* (${duplicate.neighborhood}) is already in the knowledge graph and your info matches what we have!`;
    }

    await updateConversation(phoneNumber, {
      current_flow: "contribution",
      flow_state: {
        stage: "update_existing",
        extracted: data,
        source,
        messagesReceived: 0,
        duplicateSpotId: duplicate.id,
      },
    });
    return `*${duplicate.name}* is already in the graph, but you've got new intel:\n\n${newInfo.join("\n")}\n\nWant me to update it?`;
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

  return `Added *${data.name}* to the knowledge graph! 🎉\n\nYou've contributed ${updated.spots_contributed} spot${updated.spots_contributed === 1 ? "" : "s"} total. The more you share, the better Sam gets for everyone.`;
}
