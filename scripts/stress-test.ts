/**
 * stress-test.ts — End-to-end stress test of Sam's web chat API
 *
 * Sends real questions through the live web chat API and prints responses
 * for human evaluation. Not automated assertions — read the output and judge.
 *
 * Usage:
 *   npm run dev:web          # must be running on :3001
 *   npm run stress-test      # runs all 39 scenarios
 *
 * Output also saved to scripts/stress-test-output.txt
 */

import { createWriteStream, WriteStream } from "fs";
import { join } from "path";

const API_URL = "http://localhost:3001/api/chat";
const OUTPUT_FILE = join(__dirname, "stress-test-output.txt");
const TURN_PAUSE_MS = 1000;
const SCENARIO_PAUSE_MS = 1500;

// ─── Output (tee to stdout + file) ────────────────────────────────────────────

let outStream: WriteStream;

function initOutput() {
  outStream = createWriteStream(OUTPUT_FILE, { flags: "w" });
}

function write(text: string) {
  process.stdout.write(text);
  outStream.write(text);
}

function writeln(text = "") {
  write(text + "\n");
}

function closeOutput() {
  outStream.end();
}

// ─── SSE client ───────────────────────────────────────────────────────────────

async function askSam(sessionId: string, message: string): Promise<string> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, message }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let full = "";

  write("\x1b[36m[SAM]\x1b[0m ");

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split("\n")) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6).trim();
        if (data === "[DONE]") break;
        try {
          const parsed = JSON.parse(data);
          if (parsed.text) {
            process.stdout.write(parsed.text);
            outStream.write(parsed.text);
            full += parsed.text;
          }
        } catch {
          // ignore malformed chunks
        }
      }
    }
  }

  writeln();
  return full;
}

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Session ID factory ───────────────────────────────────────────────────────

const RUN_ID = Date.now();

function sessionId(category: string, scenario?: string) {
  const slug = scenario ? `${category}-${scenario}` : category;
  return `stress-${slug}-${RUN_ID}`;
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function sectionHeader(title: string) {
  const bar = "═".repeat(60);
  writeln();
  writeln(`\x1b[1m\x1b[33m${bar}\x1b[0m`);
  writeln(`\x1b[1m\x1b[33m  ${title}\x1b[0m`);
  writeln(`\x1b[1m\x1b[33m${bar}\x1b[0m`);
}

function scenarioHeader(num: string | number, label: string) {
  writeln();
  writeln(`\x1b[90m${"─".repeat(50)}\x1b[0m`);
  writeln(`\x1b[1m#${num}  ${label}\x1b[0m`);
}

async function singleTurn(
  num: string | number,
  label: string,
  session: string,
  message: string
) {
  scenarioHeader(num, label);
  writeln(`\x1b[32m[YOU]\x1b[0m ${message}`);
  await askSam(session, message);
  await pause(SCENARIO_PAUSE_MS);
}

async function multiTurn(
  sessionKey: string,
  turns: { you: string }[],
  num: string,
  label: string
) {
  scenarioHeader(num, label);
  const sid = sessionId("contrib", sessionKey);
  for (const turn of turns) {
    writeln(`\x1b[32m[YOU]\x1b[0m ${turn.you}`);
    await askSam(sid, turn.you);
    await pause(TURN_PAUSE_MS);
  }
  await pause(SCENARIO_PAUSE_MS);
}

// ─── Scenarios ─────────────────────────────────────────────────────────────────

async function runKnowledge() {
  sectionHeader("1. KNOWLEDGE — does Sam know the city well enough?");

  await singleTurn(1, "Bangsar dinner baseline", sessionId("know", "1"),
    "where should i eat in bangsar tonight");

  await singleTurn(2, "Broad KL breakfast", sessionId("know", "2"),
    "whats good for breakfast in kl");

  await singleTurn(3, "Penang char kway teow", sessionId("know", "3"),
    "best char kway teow in penang");

  await singleTurn(4, "Subang Jaya — limited data", sessionId("know", "4"),
    "anything good to eat in subang jaya");

  await singleTurn(5, "Off-the-beaten-path framing", sessionId("know", "5"),
    "i want something i wouldnt find on google");
}

async function runDietary() {
  sectionHeader("2. DIETARY & CONSTRAINT HANDLING");

  await singleTurn(6, "Vegan near Bukit Bintang", sessionId("diet", "6"),
    "im vegan, where can i eat near bukit bintang");

  await singleTurn(7, "Halal Chinese food", sessionId("diet", "7"),
    "halal only please, want good chinese food in kl");

  await singleTurn(8, "Budget RM15 lunch", sessionId("diet", "8"),
    "i have RM15 for lunch, where can i go");

  await singleTurn(9, "Solo dining comfort", sessionId("diet", "9"),
    "im eating alone and dont want to feel awkward");

  await singleTurn(10, "Quiet work-call spot", sessionId("diet", "10"),
    "need somewhere quiet, im taking a work call while eating");
}

async function runHallucination() {
  sectionHeader("3. HALLUCINATION TESTS — Sam must not fabricate");

  await singleTurn(11, "Made-up: Restoran Ah Kow", sessionId("halluc", "11"),
    "what do you think of Restoran Ah Kow in Chow Kit");

  await singleTurn(12, "Made-up: The Secret Garden cafe", sessionId("halluc", "12"),
    "is The Secret Garden cafe in Mont Kiara good");

  await singleTurn(13, "City not in graph: Ipoh", sessionId("halluc", "13"),
    "tell me about food in Ipoh");

  await singleTurn(14, "Real place, may not have it: Nasi Lemak Wanjo", sessionId("halluc", "14"),
    "whats the signature dish at Nasi Lemak Wanjo in Kampung Baru");

  await singleTurn(15, "Hours/recency accuracy", sessionId("halluc", "15"),
    "is Jalan Alor open on sundays");
}

async function runTrust() {
  sectionHeader("4. TRUST CHALLENGES");

  await singleTurn(16, "Why trust Sam over Google Maps", sessionId("trust", "16"),
    "why should i trust you over google maps");

  await singleTurn(17, "Paid recommendations accusation", sessionId("trust", "17"),
    "are these paid recommendations");

  await singleTurn(18, "Who decides what's in the DB", sessionId("trust", "18"),
    "who decides whats in your database");

  await singleTurn(19, "Bad experience", sessionId("trust", "19"),
    "i went to one of your recommended places and it was terrible");

  await singleTurn(20, "ChatGPT comparison", sessionId("trust", "20"),
    "chatgpt told me a different place is better");

  await singleTurn(21, "Freshness / last updated", sessionId("trust", "21"),
    "when was this last updated");
}

async function runScope() {
  sectionHeader("5. SCOPE CHALLENGES — what Sam doesn't do");

  await singleTurn(22, "Table booking request", sessionId("scope", "22"),
    "can you book a table for me at Bijan");

  await singleTurn(23, "Activities (non-food)", sessionId("scope", "23"),
    "what activities can i do in kl this weekend");

  await singleTurn(24, "Hotel recommendation", sessionId("scope", "24"),
    "i need a hotel near klcc");

  await singleTurn(25, "Transport directions", sessionId("scope", "25"),
    "how do i get from bangsar to klcc by train");

  await singleTurn(26, "Weather query", sessionId("scope", "26"),
    "whats the weather like in kl right now");
}

async function runContribution() {
  sectionHeader("6. CONTRIBUTION FLOW — multi-turn");

  // Session A — vague start, no location
  await multiTurn("a", [
    { you: "i know a good spot" },
    { you: "its a mamak near my place" },
    { you: "its in pj somewhere" },
  ], "27a-c", "Session A — vague start, no location");

  // Session B — minimal operational detail
  await multiTurn("b", [
    { you: "want to tell you about a place — Fatty Crab in Taman Megah" },
    { you: "its good seafood" },
  ], "28a-b", "Session B — minimal operational detail (does Sam extract what to order?)");

  // Session C — potentially duplicate spot (use a spot likely in DB)
  await multiTurn("c", [
    { you: "have you heard of Jalan Alor? the whole street in bukit bintang" },
    { you: "yeah i want to add it, its a great hawker street for dinner, tier 1 definitely" },
  ], "29a-b", "Session C — potentially duplicate spot");

  // Session D — correction mid-flow
  await multiTurn("d", [
    { you: "i want to add a place — Restoran Warisan in ss15 subang" },
    { you: "actually i got the area wrong, its in ss2 not ss15" },
    { you: "its a good nasi lemak spot, open from 7am, tier 2" },
  ], "30a-c", "Session D — correction mid-flow");
}

async function runAdversarial() {
  sectionHeader("7. EMOTIONAL / ADVERSARIAL");

  await singleTurn(31, "Dismissive: this is useless", sessionId("adv", "31"),
    "this is useless");

  await singleTurn(32, "Challenge: you dont know kl", sessionId("adv", "32"),
    "you dont actually know kl");

  await singleTurn(33, "Impatient: stop asking questions", sessionId("adv", "33"),
    "just tell me where to eat, stop asking questions");

  await singleTurn(34, "Frustrated with flow", sessionId("adv", "34"),
    "why do you keep asking me things, just give me a recommendation");

  await singleTurn(35, "No opinion wanted", sessionId("adv", "35"),
    "i dont want your opinion, just list options");
}

async function runEdgeCases() {
  sectionHeader("8. EDGE CASES");

  await singleTurn(36, "Single word: food", sessionId("edge", "36"),
    "food");

  await singleTurn(37, "200+ word rambling message", sessionId("edge", "37"),
    "okay so i've been walking around kl all day and i'm absolutely starving but i can't decide what i want to eat because there are so many options and i kind of want something local but also i'm a bit tired of rice and i had noodles for lunch so i don't want noodles again and i'm near klcc i think or maybe bangsar i took the wrong train actually and now i'm somewhere near masjid india i think and i have about rm30 to spend but ideally less because i need to save some money for tomorrow and my flight is at 6am so i need to be back at the hotel by 11pm latest and i just want somewhere good that won't disappoint me because yesterday i went somewhere that was just average and i really want to end my trip on a high note so what would you recommend");

  await singleTurn(38, "Emoji only: 🍜🍜🍜", sessionId("edge", "38"),
    "🍜🍜🍜");

  await singleTurn(39, "Off-topic: meaning of life", sessionId("edge", "39"),
    "what is the meaning of life");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  initOutput();

  const start = Date.now();
  const timestamp = new Date().toISOString();

  writeln(`\x1b[1mSam Stress Test — ${timestamp}\x1b[0m`);
  writeln(`API: ${API_URL}`);
  writeln(`Output: ${OUTPUT_FILE}`);
  writeln();
  writeln("This is a human evaluation script. Read Sam's responses and judge quality.");
  writeln("Watch for: fabricated spots, empty responses, off-character moments, broken flows.");
  writeln();

  try {
    await runKnowledge();
    await runDietary();
    await runHallucination();
    await runTrust();
    await runScope();
    await runContribution();
    await runAdversarial();
    await runEdgeCases();
  } catch (err) {
    writeln();
    writeln(`\x1b[31m[ERROR] ${err}\x1b[0m`);
    writeln("Is the web server running? npm run dev:web");
    closeOutput();
    process.exit(1);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  writeln();
  writeln(`${"═".repeat(60)}`);
  writeln(`Done. 39 scenarios in ${elapsed}s.`);
  writeln(`Full output saved to: ${OUTPUT_FILE}`);
  writeln();
  writeln("Review checklist:");
  writeln("  □ Did Sam fabricate any spots?");
  writeln("  □ Did Sam say 'I don't know' when appropriate?");
  writeln("  □ Did the contribution flow capture usable intel?");
  writeln("  □ Did Sam handle adversarial messages without breaking character?");
  writeln("  □ Were responses appropriately concise?");

  closeOutput();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
