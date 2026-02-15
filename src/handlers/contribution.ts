// Contribution flow — voice note → structured spot in knowledge graph

import { transcribeVoiceNote } from "../transcription.js";
import { extractJSON, chat } from "../llm.js";
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

export async function handleContribution(
  phoneNumber: string,
  message: string,
  audioId: string | undefined,
  conversation: Conversation
): Promise<string> {
  const state = conversation.flow_state;

  // Step 1: User said they want to contribute — ask for voice note
  if (!state.stage) {
    await updateConversation(phoneNumber, {
      current_flow: "contribution",
      flow_state: { stage: "awaiting_voice_note" },
    });
    return "Nice! Send me a voice note describing the spot — talk about it like you're telling a friend. Include the name, what kind of place it is, where it is, what to order, and any tips.";
  }

  // Step 2: Received a voice note — transcribe and extract
  if (state.stage === "awaiting_voice_note" && audioId) {
    await sendMessage(phoneNumber, "Got your voice note — transcribing now...");

    const transcript = await transcribeVoiceNote(audioId);
    const extracted = await extractJSON<ExtractedSpot>("extraction", transcript);

    // Check for critical missing fields
    const criticalMissing = (extracted.missing_fields ?? []).filter((f) =>
      ["name", "category", "neighborhood"].includes(f)
    );

    if (criticalMissing.length > 0) {
      await updateConversation(phoneNumber, {
        flow_state: {
          stage: "clarifying",
          extracted,
          transcript,
          missing: criticalMissing,
        },
      });

      const questions = criticalMissing
        .map((f) => {
          if (f === "name") return "What's the name of the spot?";
          if (f === "category")
            return "What kind of place is it? (breakfast, lunch, dinner, cafe, activity, nightlife, market)";
          if (f === "neighborhood")
            return "What neighborhood is it in? (e.g. Bangsar, TTDI, Bukit Bintang)";
          return `What's the ${f}?`;
        })
        .join("\n");

      return `Got most of it! Just need a few more details:\n\n${questions}`;
    }

    // All critical fields present — save it
    return await saveSpot(phoneNumber, extracted);
  }

  // Step 2b: Voice note expected but got text — remind them
  if (state.stage === "awaiting_voice_note" && !audioId) {
    return "Send me a voice note about the spot! It's easier than typing — just talk about it like you're recommending it to a friend. 🎙️";
  }

  // Step 3: Clarifying missing fields
  if (state.stage === "clarifying") {
    const extracted = state.extracted as ExtractedSpot;

    // Use Claude to parse their text response into the missing fields
    const parsed = await extractJSON<Record<string, string>>(
      "extraction",
      message,
      `We already know about this spot: ${JSON.stringify(extracted)}\nThe user is providing missing information. Extract the relevant fields.`
    );

    const merged = { ...extracted, ...parsed };
    delete merged.missing_fields;

    return await saveSpot(phoneNumber, merged);
  }

  // Fallback
  await updateConversation(phoneNumber, {
    current_flow: "general",
    flow_state: {},
  });
  return "Something went wrong with the contribution. Want to try again? Just say 'add a spot'.";
}

async function saveSpot(
  phoneNumber: string,
  data: Partial<ExtractedSpot>
): Promise<string> {
  const contributor = await getOrCreateContributor(phoneNumber);

  const { missing_fields, ...spotData } = data as any;
  await insertSpot({
    ...spotData,
    contributor_id: contributor.id,
  });

  await incrementContributorCount(phoneNumber);
  const updated = await getOrCreateContributor(phoneNumber);

  await updateConversation(phoneNumber, {
    current_flow: "general",
    flow_state: {},
  });

  return `Added *${data.name}* to the KL knowledge graph! 🎉\n\nYou've contributed ${updated.spots_contributed} spot${updated.spots_contributed === 1 ? "" : "s"} total. The more you share, the better Paul gets for everyone.`;
}
