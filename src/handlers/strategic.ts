// Strategic decisions generation — profile + knowledge graph → pre-trip guide

import { chat, SONNET } from "../llm.js";
import {
  getOrCreateTraveler,
  querySpots,
  updateConversation,
} from "../database.js";
import { getCurrentWeather } from "../weather.js";
import { formatSpotsForLLM } from "./query.js";
import { getDefaultCity } from "../utils/city-defaults.js";
import { readFileSync } from "fs";
import { join } from "path";

const strategicPrompt = readFileSync(
  join(__dirname, "..", "prompts", "strategic.txt"),
  "utf-8"
);

export async function handleStrategic(phoneNumber: string): Promise<string> {
  const traveler = await getOrCreateTraveler(phoneNumber);
  if (traveler.user_type === "local") {
    await updateConversation(phoneNumber, { current_flow: "general", flow_state: {} });
    return "You're all set! Just text me whenever you want to find something new in KL.";
  }
  const prefs = traveler.preferences ?? {};

  // Query spots matching their profile
  const allSpots = await querySpots({
    city: traveler.current_city ?? getDefaultCity(),
    limit: 20,
  });

  // Split by category for strategic organization
  const foodSpots = allSpots.filter((s) =>
    ["breakfast", "lunch", "dinner", "cafe"].includes(s.category ?? "")
  );
  const activitySpots = allSpots.filter((s) =>
    ["activity", "market", "nightlife"].includes(s.category ?? "")
  );
  const topSpots = allSpots.filter((s) => s.tier === 1);

  const spotsContext = formatSpotsForLLM(allSpots);

  const profileSummary = `
Profile:
- Name: ${traveler.name ?? "Unknown"}
- Dates: ${traveler.trip_dates ? `${(traveler.trip_dates as any).start} to ${(traveler.trip_dates as any).end}` : "Not specified"}
- Party: ${traveler.travel_party ?? "Not specified"}
- Interests: ${(prefs.interests ?? []).join(", ") || "Not specified"}
- Budget: ${prefs.budget ?? "moderate"}
- Pace: ${prefs.pace ?? "moderate"}
- Dietary: ${(traveler.dietary_restrictions ?? []).join(", ") || "None"}
- First time in KL: ${traveler.first_time_visitor ? "Yes" : "No"}
${prefs.specific_requests?.length ? `- Specific requests: ${prefs.specific_requests.join(", ")}` : ""}
  `.trim();

  const prompt = `${profileSummary}

Available spots in the knowledge graph (${allSpots.length} total, ${topSpots.length} tier-1 must-dos):

${spotsContext}

Generate the strategic decisions message. Pick the best 3-5 anchor spots based on their profile.`;

  const strategicMessage = await chat(
    strategicPrompt,
    [{ role: "user", content: prompt }],
    { maxTokens: 2048, model: SONNET }
  );

  // Send agreement plan after strategic decisions
  const agreementPlan = `
━━━ WHAT YOU CAN COUNT ON ━━━

✅ I'm available 24/7 while you're here
   Text anytime, response in minutes

✅ If you don't like a spot, I'll fix it immediately
   No questions asked — your time, your call

✅ No rigid schedules, zero pressure
   Use what works, ignore what doesn't

✅ Knowledge stays fresh
   Every spot verified recently by locals

✅ Your data is private
   Conversations never shared, no spam
  `.trim();

  // Transition to general/ontrip flow
  await updateConversation(phoneNumber, {
    current_flow: "general",
    flow_state: { has_strategic_plan: true },
  });

  return `${strategicMessage}\n\n${agreementPlan}`;
}
