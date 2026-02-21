// Feedback flow — post-trip validation and tip collection

import { chat, loadPrompt, samSays, HAIKU } from "../llm.js";
import {
  getSpotsNeedingFeedback,
  markFeedbackAsked,
  insertFeedback,
  getOrCreateTraveler,
  updateTraveler,
  updateConversation,
  trackEvent,
  type Conversation,
  type Spot,
} from "../database.js";

let _feedbackPrompt: string | null = null;
function getFeedbackPrompt(): string {
  if (!_feedbackPrompt) _feedbackPrompt = loadPrompt("feedback");
  return _feedbackPrompt;
}

export async function handleFeedback(
  phoneNumber: string,
  message: string,
  conversation: Conversation,
  options?: { channel?: "whatsapp" | "web" }
): Promise<string> {
  const channel = options?.channel ?? "whatsapp";
  const state = conversation.flow_state;

  // Step 1: Ask about a specific spot
  if (state.stage === "asking" && state.spot_id) {
    // Parse their response — extract rating and comments
    const parsed = await chat(
      getFeedbackPrompt(),
      [{ role: "user", content: message }],
      { temperature: 0.2, model: HAIKU }
    );

    try {
      const jsonMatch = parsed.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : parsed.trim();
      const fb = JSON.parse(jsonStr);

      const traveler = await getOrCreateTraveler(phoneNumber);
      await insertFeedback({
        spot_id: state.spot_id,
        traveler_id: traveler.id,
        rating: fb.rating,
        did_they_go: fb.did_they_go ?? true,
        comments: fb.comments,
        user_tips: fb.tips,
      });

      // Write liked/disliked based on rating
      if (fb.rating != null && fb.did_they_go !== false) {
        if (fb.rating >= 4) {
          const liked = [...(traveler.spots_liked ?? []), state.spot_id];
          await updateTraveler(phoneNumber, { spots_liked: liked });
        } else if (fb.rating <= 2) {
          const disliked = [...(traveler.spots_disliked ?? []), state.spot_id];
          await updateTraveler(phoneNumber, { spots_disliked: disliked });
        }
      }

      // Check if there are more spots to ask about
      const remainingSpots = (state.pending_spots ?? []) as string[];
      if (remainingSpots.length > 0) {
        const nextSpotId = remainingSpots[0];
        const rest = remainingSpots.slice(1);

        await updateConversation(phoneNumber, {
          flow_state: {
            stage: "asking",
            spot_id: nextSpotId,
            spot_name: state.pending_names?.[0] ?? "that spot",
            pending_spots: rest,
            pending_names: (state.pending_names ?? []).slice(1),
          },
        });

        const nextName = state.pending_names?.[0] ?? "the next spot";
        return `Thanks for the feedback! That helps a lot. 🙏\n\nWhat about *${nextName}* — did you make it there? How was it?`;
      }

      // All done
      await updateConversation(phoneNumber, {
        current_flow: "general",
        flow_state: {},
      });

      trackEvent(phoneNumber, channel, "flow_complete", {
        flow: "feedback",
        spot_id: state.spot_id,
        rating: fb.rating,
      });

      return "Thanks for all the feedback! This keeps the knowledge fresh for everyone.\n\nAnytime you want to share more or add new spots you discovered, just say the word.";
    } catch {
      return "Got it, thanks! If you want to share more details, feel free. Otherwise, I'm here whenever you need me. 😊";
    }
  }

  // Default: start feedback collection
  return await startFeedbackCollection(phoneNumber);
}

/** Proactively ask about recently recommended spots, or capture spontaneous feedback from a message */
export async function startFeedbackCollection(
  phoneNumber: string,
  userMessage?: string
): Promise<string> {
  const spots = await getSpotsNeedingFeedback(phoneNumber);

  if (spots.length === 0) {
    // If user sent a spontaneous feedback message, acknowledge it warmly
    if (userMessage) {
      await updateConversation(phoneNumber, {
        current_flow: "general",
        flow_state: {},
      });
      return samSays(
        `Respond warmly: the user said "${userMessage}" — they're sharing feedback about a spot. Acknowledge their experience enthusiastically, thank them for sharing, and encourage them to keep sending spots or tips. Two sentences max.`
      );
    }
    await updateConversation(phoneNumber, {
      current_flow: "general",
      flow_state: {},
    });
    return "I don't have any spots to check on for you yet — once you've visited a few I recommend, I'll follow up to see how they were.";
  }

  const firstSpot = spots[0];
  const remaining = spots.slice(1);

  await updateConversation(phoneNumber, {
    current_flow: "feedback",
    flow_state: {
      stage: "asking",
      spot_id: firstSpot.id,
      spot_name: firstSpot.name,
      pending_spots: remaining.map((s) => s.id),
      pending_names: remaining.map((s) => s.name),
    },
  });

  // Mark these spots as asked so we don't re-ask
  await markFeedbackAsked(phoneNumber, spots.map((s) => s.id));

  return `Hey! Quick check — did you make it to *${firstSpot.name}*? How was it? (A rating 1-5 helps, plus any tips!)`;
}
