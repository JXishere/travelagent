import { buildDayPlanPrompt } from "../packages/bot/src/handlers/ontrip.js";

async function main() {
  const sessionId = `debug-dayplan-${Date.now()}`;
  const message = "I just want to eat all day in KL, plan it out";
  const details = { area: "KL" }; // what the classifier likely returns

  console.log("Testing buildDayPlanPrompt with sessionId:", sessionId);
  const payload = await buildDayPlanPrompt(sessionId, message, details, undefined, { channel: "web" });

  console.log("spotIds count:", payload.spotIds.length);
  console.log("spotIds:", payload.spotIds);
  console.log("\nFirst 500 chars of userPrompt:");
  console.log(payload.userPrompt.substring(0, 500));
}

main().catch(console.error);
