// Spot correction handler — user reports a spot is closed, moved, or has wrong info
// Flow: extract delta → show confirmation summary → apply on confirm

import { chat, classifyConfirmation, samSays, HAIKU } from "../llm.js";
import { sendMessage } from "../whatsapp.js";
import {
  findSpotByName,
  applySpotCorrection,
  updateConversation,
  trackEvent,
  type CorrectionDelta,
  type Conversation,
} from "../database.js";

interface CorrectionIntentDetails {
  spot_name?: string;
  correction?: string;
}

interface CorrectionFlowState {
  stage: "awaiting_confirmation";
  spot_id: string;
  spot_name: string;
  spot_area?: string;
  delta: CorrectionDelta;
}

/**
 * Handle spot correction — two-stage flow:
 * 1. Fresh intent: extract structured delta, show summary, await confirmation
 * 2. Mid-flow (stage: awaiting_confirmation): classify response, apply or cancel
 */
export async function handleSpotCorrection(
  phoneNumber: string,
  message: string,
  details: CorrectionIntentDetails,
  options?: { channel?: "whatsapp" | "web"; conversation?: Conversation }
): Promise<string> {
  const channel = options?.channel ?? "whatsapp";
  const flowState = options?.conversation?.flow_state as Partial<CorrectionFlowState> | undefined;

  // ── Stage 2: mid-flow confirmation ──
  if (flowState?.stage === "awaiting_confirmation") {
    return handleConfirmation(phoneNumber, message, flowState as CorrectionFlowState, channel);
  }

  // ── Stage 1: fresh correction intent ──
  const spotName = details.spot_name;

  if (!spotName) {
    return samSays(
      `The user says: "${message}". They seem to be reporting a problem with one of your spots but didn't name it. Ask which place they're referring to. One sentence.`
    );
  }

  const spot = await findSpotByName(spotName);

  if (!spot) {
    trackEvent(phoneNumber, channel, "spot_correction", {
      spot_name: spotName,
      correction: details.correction ?? "unspecified",
      found_in_db: false,
    });
    return samSays(
      `Respond: thank the user for the heads up about ${spotName}. Say it's not in your knowledge graph yet but you've noted it. One sentence.`
    );
  }

  // Extract structured delta from the user's correction text
  const correctionText = details.correction ?? message;
  const delta = await extractCorrectionDelta(correctionText, spot.name);

  // Build a human-readable confirmation summary
  const summary = buildCorrectionSummary(spot.name, delta);

  // Store state and ask for confirmation
  await updateConversation(phoneNumber, {
    current_flow: "spot_correction",
    flow_state: {
      stage: "awaiting_confirmation",
      spot_id: spot.id,
      spot_name: spot.name,
      spot_area: spot.area,
      delta,
    } satisfies CorrectionFlowState,
  });

  trackEvent(phoneNumber, channel, "spot_correction_started", {
    spot_id: spot.id,
    spot_name: spot.name,
    correction_type: delta.correction_type,
  });

  return samSays(
    `Respond to the user. Say: "${summary} — can you confirm?" Keep it brief and casual.`
  );
}

/** Handle the user's yes/no response during the confirmation stage */
async function handleConfirmation(
  phoneNumber: string,
  message: string,
  state: CorrectionFlowState,
  channel: "whatsapp" | "web"
): Promise<string> {
  const { spot_id, spot_name, spot_area, delta } = state;

  const confirmation = await classifyConfirmation(
    message,
    `Correction for ${spot_name}: ${delta.correction_summary}`
  );

  if (confirmation === "confirm") {
    const { hardClosed, reportCount } = await applySpotCorrection(spot_id, phoneNumber, delta);
    await updateConversation(phoneNumber, { current_flow: "general", flow_state: {} });
    trackEvent(phoneNumber, channel, "spot_correction_applied", {
      spot_id,
      spot_name,
      correction_type: delta.correction_type,
      hard_closed: hardClosed,
    });

    // Notify admin on first report (soft demotion) so they can approve/reject
    const ADMIN_PHONE = process.env.ADMIN_PHONE_NUMBER;
    if (!hardClosed && ADMIN_PHONE && channel === "whatsapp") {
      const reporterDisplay = phoneNumber.slice(-4);
      const locationStr = spot_area ? ` (${spot_area})` : "";
      const adminMsg = [
        `[Correction flagged]`,
        `Spot: ${spot_name}${locationStr}`,
        `Type: ${delta.correction_type}`,
        `Reporter: ...${reporterDisplay}`,
        `Note: ${delta.correction_summary}`,
        ``,
        `Report ${reportCount} of 2 needed for auto-close.`,
        `Reply /approve ${spot_name} to close now`,
        `Reply /reject ${spot_name} to dismiss`,
        `Reply /corrections for all pending`,
      ].join("\n");
      sendMessage(ADMIN_PHONE, adminMsg).catch(() => {});
    }

    if (hardClosed) {
      return samSays(
        `Respond: ${spot_name} has been marked as closed and removed from recommendations. Thank the user briefly. One sentence, casual.`
      );
    }
    return samSays(
      `Respond: ${spot_name} has been flagged for review and you'll hold off recommending it while you verify. Thank the user briefly. One sentence, casual.`
    );
  }

  // User denied or changed topic — cancel the flow
  await updateConversation(phoneNumber, { current_flow: "general", flow_state: {} });
  trackEvent(phoneNumber, channel, "spot_correction_cancelled", { spot_id, spot_name });

  if (confirmation === "unrelated") {
    // They moved on — don't dwell on it, just help with what they need
    return samSays(
      `Acknowledge you've dropped the correction for ${spot_name}. Ask what else you can help with. One sentence.`
    );
  }

  return samSays(
    `Respond: let the user know you've cancelled the correction for ${spot_name}. One sentence, casual.`
  );
}

/** Use LLM to extract a structured correction delta from free text */
async function extractCorrectionDelta(
  correctionText: string,
  spotName: string
): Promise<CorrectionDelta> {
  const systemPrompt = `You extract structured correction data from user reports about places.

Return ONLY valid JSON with this exact shape (omit optional fields if not present):
{
  "correction_type": "closed" | "moved" | "wrong_info" | "other",
  "is_closed": true | false,
  "area": "new area name if moved or area is wrong — omit otherwise",
  "address": "corrected address if provided — omit otherwise",
  "opening_hours_note": "hours correction if mentioned — omit otherwise",
  "correction_summary": "one specific sentence, e.g. 'Fatty Crab has permanently closed' or 'Village Park moved to Damansara'"
}

Rules:
- is_closed = true ONLY if they say it shut down, closed permanently, or no longer exists
- correction_type = "closed" if is_closed, "moved" if they say it relocated, "wrong_info" for bad hours/address/other details, "other" for anything else
- correction_summary must be a complete sentence naming the place and the issue`;

  try {
    const response = await chat(
      systemPrompt,
      [{ role: "user", content: `Place: "${spotName}"\nUser's message: "${correctionText}"` }],
      { temperature: 0.1, model: HAIKU }
    );
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : response.trim();
    const result = JSON.parse(jsonStr) as Partial<CorrectionDelta>;
    return {
      correction_type: result.correction_type ?? "other",
      is_closed: result.is_closed ?? false,
      area: result.area,
      address: result.address,
      opening_hours_note: result.opening_hours_note,
      correction_summary: result.correction_summary ?? `Update reported for ${spotName}`,
    };
  } catch {
    // Fallback if extraction fails
    return {
      correction_type: "other",
      is_closed: false,
      correction_summary: `Correction reported for ${spotName}: ${correctionText.slice(0, 120)}`,
    };
  }
}

/** Build a readable confirmation message from the correction delta */
function buildCorrectionSummary(spotName: string, delta: CorrectionDelta): string {
  return `Got it — ${delta.correction_summary}`;
}
