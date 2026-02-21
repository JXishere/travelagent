// Spot correction handler — user reports a spot is closed, moved, or has wrong info

import { samSays } from "../llm.js";
import {
  findSpotByName,
  updateSpot,
  trackEvent,
} from "../database.js";

interface CorrectionDetails {
  spot_name?: string;
  correction?: string;
}

/**
 * Handle "that place closed" / "wrong address" type corrections.
 * Marks the spot as unverified so it surfaces less in recommendations,
 * tracks the correction event, and thanks the user.
 */
export async function handleSpotCorrection(
  phoneNumber: string,
  message: string,
  details: CorrectionDetails,
  options?: { channel?: "whatsapp" | "web" }
): Promise<string> {
  const channel = options?.channel ?? "whatsapp";
  const spotName = details.spot_name;

  if (!spotName) {
    return samSays(
      `The user says: "${message}". They seem to be reporting a problem with one of your spots but didn't name it. Ask which place they're referring to. One sentence.`
    );
  }

  const spot = await findSpotByName(spotName);

  if (spot) {
    // Mark as unverified — de-prioritises it in querySpots() (ordered verified DESC)
    await updateSpot(spot.id, { verified: false });

    trackEvent(phoneNumber, channel, "spot_correction", {
      spot_id: spot.id,
      spot_name: spot.name,
      correction: details.correction ?? "unspecified",
    });

    const correctionNote = details.correction ? ` (${details.correction})` : "";

    return samSays(
      `Respond warmly: thank the user for flagging that ${spot.name}${correctionNote}. Say you've marked it for review and won't be recommending it until you've verified the details. One or two short sentences, casual.`
    );
  }

  // Spot not in DB — still thank them
  trackEvent(phoneNumber, channel, "spot_correction", {
    spot_name: spotName,
    correction: details.correction ?? "unspecified",
    found_in_db: false,
  });

  return samSays(
    `Respond: thank the user for the heads up about ${spotName}. Say it's not in your knowledge graph yet but you've noted it. One sentence.`
  );
}
