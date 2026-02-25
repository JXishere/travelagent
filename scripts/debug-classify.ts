import { classifyIntent } from "../packages/bot/src/llm.js";

async function main() {
  const tests = [
    "I just want to eat all day in KL, plan it out",
    "plan me a full day in KL",
    "planning a day out with kids in KL, what should we do?",
    "something cultural in the morning and then a good lunch after in KL",
    "I'm coming to KL for 3 days and I only care about food. Can you plan my whole trip around eating?",
    "where to eat dinner in Bangsar?",
    "cheap makan near Chow Kit",
  ];

  for (const msg of tests) {
    const result = await classifyIntent(msg);
    console.log(`"${msg.substring(0, 60)}..."`);
    console.log(`  → intent: ${result.intent}, details: ${JSON.stringify(result.details)}`);
    console.log();
  }
}

main().catch(console.error);
