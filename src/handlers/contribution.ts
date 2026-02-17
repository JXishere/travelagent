// Contribution flow — conversational accumulation of spot knowledge
// Two stages: collecting → confirming

import { transcribeVoiceNote } from "../transcription.js";
import { extractJSON } from "../llm.js";
import {
  insertSpot,
  getOrCreateContributor,
  incrementContributorCount,
  updateConversation,
  type Conversation,
} from "../database.js";
import { sendMessage } from "../whatsapp.js";

interface ExtractedSpot {
  name?: string;
  category?: string;
  neighborhood?: string;
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
  stage: "collecting" | "confirming";
  extracted: Partial<ExtractedSpot>;
  source: "voice" | "text";
  messagesReceived: number;
}

const SAVE_PATTERNS = /^(save|yes|done|looks good|looks right|perfect|yep|👍|lgtm)$/i;

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

  // Confirming stage
  if (state.stage === "confirming") {
    // Check for save confirmation (text only — voice is treated as more info)
    if (!audioId && SAVE_PATTERNS.test(message.trim())) {
      return await saveSpot(phoneNumber, state.extracted ?? {}, state.source ?? "text");
    }

    // Treat as more info — merge and re-show summary
    const input = await resolveInput(phoneNumber, message, audioId);
    const newData = await extractWithContext(input, state.extracted ?? {});
    const merged = smartMerge(state.extracted ?? {}, newData);

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
    await sendMessage(phoneNumber, "Got your voice note — let me listen...");
    return await transcribeVoiceNote(audioId);
  }
  return message;
}

/** Extract structured data from user input, with context of what we already know */
async function extractWithContext(
  input: string,
  existing: Partial<ExtractedSpot>
): Promise<Partial<ExtractedSpot>> {
  const hasExisting = Object.keys(existing).length > 0;
  const context = hasExisting
    ? `We already know about this spot: ${JSON.stringify(existing)}. The user is providing more details. Extract ONLY the new information from their message.`
    : undefined;

  try {
    return await extractJSON<ExtractedSpot>("extraction", input, context);
  } catch {
    return {};
  }
}

/** Process a message during the collecting stage */
async function collectInfo(
  phoneNumber: string,
  input: string,
  state: ContributionState
): Promise<string> {
  const previous = state.extracted;
  const newData = await extractWithContext(input, previous);
  const merged = smartMerge(previous, newData);
  const messagesReceived = state.messagesReceived + 1;

  // Check if we have enough to show a summary
  if (isReady(merged)) {
    await updateConversation(phoneNumber, {
      flow_state: {
        stage: "confirming",
        extracted: merged,
        source: state.source,
        messagesReceived,
      },
    });
    return formatSummary(merged);
  }

  // Not ready — save progress and ask a follow-up
  await updateConversation(phoneNumber, {
    flow_state: {
      stage: "collecting",
      extracted: merged,
      source: state.source,
      messagesReceived,
    },
  });

  return buildFollowUp(merged, previous);
}

/** Merge new extracted data into existing, preserving non-empty values */
function smartMerge(
  existing: Partial<ExtractedSpot>,
  incoming: Partial<ExtractedSpot>
): Partial<ExtractedSpot> {
  const merged = { ...existing };

  for (const [key, value] of Object.entries(incoming)) {
    if (key === "missing_fields") continue;
    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) continue;

    // For arrays, merge unique items rather than replace
    if (Array.isArray(value) && Array.isArray((merged as any)[key])) {
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
function isReady(data: Partial<ExtractedSpot>): boolean {
  const hasCritical = Boolean(data.name && data.category && data.neighborhood);
  const hasOperational = Boolean(
    (data.what_to_order && data.what_to_order.length > 0) ||
    (data.pro_tips && data.pro_tips.length > 0) ||
    (data.payment_methods && data.payment_methods.length > 0)
  );
  return hasCritical && hasOperational;
}

/** Build a natural follow-up question with a warm prefix */
function buildFollowUp(merged: Partial<ExtractedSpot>, previous: Partial<ExtractedSpot>): string {
  // If extraction yielded nothing, give a warm opening prompt
  const meaningfulKeys = Object.keys(merged).filter((k) => k !== "missing_fields");
  if (meaningfulKeys.length === 0) {
    return "Nice! What's the spot? Just tell me about it — I'll piece it together.";
  }

  const prefix = buildWarmPrefix(merged, previous);

  if (!merged.name) return `${prefix}What's it called?`;
  if (!merged.neighborhood) return `${prefix}What area of KL is it in?`;
  if (!merged.category) return `${prefix}What kind of spot? (breakfast, lunch, dinner, cafe, activity, nightlife, market)`;
  if (!merged.what_to_order?.length) return `${prefix}What should people order there?`;
  return `${prefix}Any tips? Like payment, hours, or insider tricks?`;
}

/** Acknowledge what Paul just learned */
function buildWarmPrefix(merged: Partial<ExtractedSpot>, previous: Partial<ExtractedSpot>): string {
  const learnedName = merged.name && !previous.name;
  const learnedNeighborhood = merged.neighborhood && !previous.neighborhood;

  if (learnedName && learnedNeighborhood) return `*${merged.name}* in ${merged.neighborhood}, nice! `;
  if (learnedName) return `Got it — *${merged.name}*. `;
  if (learnedNeighborhood) return `${merged.neighborhood}, nice! `;
  return "Got it. ";
}

/** Format a summary of the accumulated spot data */
function formatSummary(data: Partial<ExtractedSpot>): string {
  const lines: string[] = ["Here's what I've got:", ""];

  lines.push(`*${data.name}* — ${data.neighborhood}`);

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
    const hours = Object.values(data.opening_hours)[0];
    lines.push(`🕐 ${hours}`);
  }

  if (data.vibe) {
    lines.push(`✨ Vibe: ${data.vibe}`);
  }

  lines.push("");
  lines.push(`Anything to add or fix? Say "save" when it looks right.`);

  return lines.join("\n");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function saveSpot(
  phoneNumber: string,
  data: Partial<ExtractedSpot>,
  source: "voice" | "text"
): Promise<string> {
  const contributor = await getOrCreateContributor(phoneNumber);

  const { missing_fields, ...spotData } = data as any;
  await insertSpot({
    ...spotData,
    contributor_id: contributor.id,
    source,
  });

  await incrementContributorCount(phoneNumber);
  const updated = await getOrCreateContributor(phoneNumber);

  await updateConversation(phoneNumber, {
    current_flow: "general",
    flow_state: {},
  });

  return `Added *${data.name}* to the KL knowledge graph! 🎉\n\nYou've contributed ${updated.spots_contributed} spot${updated.spots_contributed === 1 ? "" : "s"} total. The more you share, the better Paul gets for everyone.`;
}
