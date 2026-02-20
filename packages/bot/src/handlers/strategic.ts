// Strategic decisions generation — profile + knowledge graph → pre-trip guide

import { chat, loadPrompt, SONNET } from "../llm.js";
import {
  getOrCreateTraveler,
  querySpots,
  updateConversation,
} from "../database.js";
import { getCurrentWeather } from "../weather.js";
import { formatSpotsForLLM } from "./query.js";
import { getDefaultCity } from "../utils/city-defaults.js";

let _strategicPrompt: string | null = null;
function getStrategicPrompt(): string {
  if (!_strategicPrompt) _strategicPrompt = loadPrompt("strategic");
  return _strategicPrompt;
}

export async function handleStrategic(phoneNumber: string): Promise<string> {
  const traveler = await getOrCreateTraveler(phoneNumber);
  const city = traveler.current_city ?? getDefaultCity();

  if (traveler.user_type === "local") {
    await updateConversation(phoneNumber, { current_flow: "general", flow_state: {} });
    return `You're all set! Just text me whenever you want to find something new in ${city}.`;
  }
  const prefs = traveler.preferences ?? {};

  // Query spots matching their profile
  const allSpots = await querySpots({
    city,
    limit: 20,
  });

  // Split by category for strategic organization
  const foodSpots = allSpots.filter((s) =>
    (s.categories ?? []).some((c) => ["breakfast", "lunch", "dinner", "cafe"].includes(c))
  );
  const activitySpots = allSpots.filter((s) =>
    (s.categories ?? []).some((c) => ["activity", "market", "nightlife"].includes(c))
  );
  const topSpots = allSpots.filter((s) => s.must_go);

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
- First time in ${city}: ${traveler.first_time_visitor ? "Yes" : "No"}
${prefs.specific_requests?.length ? `- Specific requests: ${prefs.specific_requests.join(", ")}` : ""}
  `.trim();

  const prompt = `${profileSummary}

Available spots in the knowledge graph (${allSpots.length} total, ${topSpots.length} must-go spots flagged by contributors):

${spotsContext}

Generate the strategic decisions message. Pick the best 3-5 anchor spots based on their profile.`;

  const filledPrompt = getStrategicPrompt().replace("{{CITY}}", city.toUpperCase());
  const strategicMessage = await chat(
    filledPrompt,
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
