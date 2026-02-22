// Spot verification flow — handles contributor responses to stale spot re-verification pings
// Triggered by scheduler when a spot hasn't been verified in 180+ days.
// Single state: awaiting_response. "yes" → refresh last_verified. Anything else → flag for correction.

import { classifyConfirmation } from "../llm.js";
import {
  markSpotVerified,
  applySpotCorrection,
  updateConversation,
  type Conversation,
} from "../database.js";

interface SpotVerificationState {
  stage: "awaiting_response";
  spotId: string;
  spotName: string;
}

export async function handleSpotVerification(
  phoneNumber: string,
  message: string,
  conversation: Conversation
): Promise<string> {
  const state = conversation.flow_state as Partial<SpotVerificationState>;

  // Sanity check — should always have spotId/spotName from scheduler
  if (!state.spotId || !state.spotName) {
    await updateConversation(phoneNumber, { current_flow: "general", flow_state: {} });
    return "Something went sideways — what's up?";
  }

  const intent = await classifyConfirmation(message, `Is ${state.spotName} still accurate?`);

  await updateConversation(phoneNumber, { current_flow: "general", flow_state: {} });

  if (intent === "confirm") {
    await markSpotVerified(state.spotId);
    return `Brilliant — ${state.spotName} is still on the map 🗺 Thanks for confirming!`;
  }

  // Any other response (deny, correct, question) — treat as a change signal
  const isExplicitlyClosed = /clos|shut down|no longer|gone|moved|pindah/i.test(message);
  await applySpotCorrection(state.spotId, phoneNumber, {
    correction_type: isExplicitlyClosed ? "closed" : "wrong_info",
    correction_summary: message.slice(0, 200),
    ...(isExplicitlyClosed ? { is_closed: true } : {}),
  });

  return `Got it — flagged ${state.spotName} for review. Thanks for keeping the map honest 🙏`;
}
