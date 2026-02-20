/**
 * stress-test-adapt.ts — Adaptability stress test for Sam's conversational AI layer
 *
 * The knowledge is fixed and human-curated. Sam's conversational layer — adapting
 * to who the user is, what they've said earlier, how they write, when they change
 * their mind — is the AI. This test stress tests that layer specifically.
 *
 * Usage:
 *   npm run dev:web           # must be running on :3001
 *   npm run stress-test:adapt # runs all 23 scenarios
 *
 * Output also saved to scripts/stress-test-adapt-output.txt
 */

import { createWriteStream, WriteStream } from "fs";
import { join } from "path";

const API_URL = "http://localhost:3001/api/chat";
const OUTPUT_FILE = join(__dirname, "stress-test-adapt-output.txt");
const TURN_PAUSE_MS = 1200;
const SCENARIO_PAUSE_MS = 1800;

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
  return `stress-adapt-${slug}-${RUN_ID}`;
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
  category: string,
  sessionKey: string,
  turns: { you: string }[],
  num: string,
  label: string
) {
  scenarioHeader(num, label);
  const sid = sessionId(category, sessionKey);
  for (const turn of turns) {
    writeln(`\x1b[32m[YOU]\x1b[0m ${turn.you}`);
    await askSam(sid, turn.you);
    await pause(TURN_PAUSE_MS);
  }
  await pause(SCENARIO_PAUSE_MS);
}

// ─── Scenarios ─────────────────────────────────────────────────────────────────

async function runConstraintRevelation() {
  sectionHeader("1. MID-CONVERSATION CONSTRAINT REVELATION");
  writeln(
    "Watch: does the constraint revealed in turn 2 filter turn 3's recommendations?"
  );

  // Session A — vegan reveal after meat recs
  await multiTurn(
    "constraint",
    "vegan",
    [
      { you: "where should i eat for dinner near klcc" },
      { you: "actually im vegan, sorry should have mentioned" },
      { you: "ok so given that, where would you send me?" },
    ],
    "1",
    "Session A — vegan reveal after initial recs"
  );

  // Session B — halal constraint injected mid-conversation
  await multiTurn(
    "constraint",
    "halal",
    [
      { you: "what's a good dinner spot in kl?" },
      { you: "my friend is joining, she only eats halal" },
      { you: "where should the two of us go?" },
    ],
    "2",
    "Session B — halal constraint added mid-conversation"
  );

  // Session C — budget constraint after premium recs
  await multiTurn(
    "constraint",
    "budget",
    [
      { you: "recommend somewhere for a nice dinner tonight" },
      { you: "wait i only have rm25 for dinner" },
      { you: "ok what works with that budget?" },
    ],
    "3",
    "Session C — budget constraint after upscale recs"
  );
}

async function runToneMirroring() {
  sectionHeader("2. TONE & LANGUAGE MIRRORING");
  writeln(
    "Watch: does Sam's register match the user's formality, energy, and language?"
  );

  await singleTurn(
    4,
    "Formal business register",
    sessionId("tone", "formal"),
    "I would appreciate a recommendation for a refined dining establishment suitable for a business dinner this evening"
  );

  await singleTurn(
    5,
    "Very casual/slang",
    sessionId("tone", "casual"),
    "yo bro what's good for lunch rn"
  );

  await singleTurn(
    6,
    "Terse / urgent",
    sessionId("tone", "terse"),
    "hungry. klcc area. now."
  );

  await singleTurn(
    7,
    "Malay — standard",
    sessionId("tone", "malay"),
    "nak makan apa best kat kl ni?"
  );

  await singleTurn(
    8,
    "Malay — family framing",
    sessionId("tone", "malay-fam"),
    "ada tempat makan sedap tak, nak bawak family"
  );

  await singleTurn(
    9,
    "Exhausted / brain-fried",
    sessionId("tone", "tired"),
    "long day, brain's fried, just tell me where to eat, somewhere near the city centre"
  );
}

async function runCollaborativeRefinement() {
  sectionHeader("3. COLLABORATIVE REFINEMENT (5-turn session)");
  writeln(
    "Watch: does Sam accumulate constraints across turns and narrow recommendations each time?"
  );
  writeln(
    "Key check on turn 4: Sam should still respect the Bangsar proximity from turn 2."
  );

  await multiTurn(
    "refine",
    "collab",
    [
      { you: "dinner for two in kl tonight" },
      {
        you: "that's too far from where we are, anything closer to bangsar?",
      },
      { you: "not in the mood for heavy food tonight" },
      { you: "something that's open after 9pm?" },
      {
        you: "last question — which of these would you pick for a first date?",
      },
    ],
    "10",
    "Session — progressive constraint accumulation"
  );
}

async function runFlowPivot() {
  sectionHeader("4. MID-SESSION FLOW PIVOT");
  writeln(
    "Watch: does Sam switch between recommendation and contribution flows without losing character?"
  );

  // Session A — recommendation → contribution
  await multiTurn(
    "pivot",
    "rec-to-contrib",
    [
      { you: "what's good to eat in ttdi?" },
      {
        you: "actually, i know a spot there better than those — Crave Burger in TTDI",
      },
      {
        you: "great little western spot, beef burger is the move, tier 1, cash only",
      },
    ],
    "11",
    "Session A — recommendation → contribution"
  );

  // Session B — contribution discovers duplicate → recommendation
  await multiTurn(
    "pivot",
    "contrib-to-rec",
    [
      {
        you: "i want to add a place — Village Park Restaurant in Damansara Utama",
      },
      { you: "oh ok, cool. so it's already in your list?" },
      { you: "alright then what else is good near village park?" },
    ],
    "12",
    "Session B — contribution discovers duplicate → recommendation pivot"
  );
}

async function runImplicitInference() {
  sectionHeader("5. IMPLICIT PREFERENCE INFERENCE");
  writeln(
    "Watch: does Sam read between the lines and adjust without being told explicitly?"
  );

  await singleTurn(
    13,
    "Tourist-fatigue signal",
    sessionId("implicit", "tourist-fatigue"),
    "i've been eating at tourist spots all week, need something real"
  );

  await singleTurn(
    14,
    "Post-heavy-meal lighter option",
    sessionId("implicit", "post-heavy"),
    "we've been eating heavy all day, lunch was a massive nasi lemak, need something lighter"
  );

  await singleTurn(
    15,
    "Anniversary — occasion signalling",
    sessionId("implicit", "anniversary"),
    "it's my anniversary dinner tonight, want somewhere special"
  );

  await singleTurn(
    16,
    "First meal in KL — high stakes",
    sessionId("implicit", "first-meal"),
    "just landed in kl, first meal here, make it count"
  );

  await singleTurn(
    17,
    "Local tired of tourist circuit",
    sessionId("implicit", "local-tired"),
    "i'm local, i'm tired of taking visitors to the same five places — what are you actually good for?"
  );
}

async function runContradictionNavigation() {
  sectionHeader("6. CONTRADICTION NAVIGATION");
  writeln(
    "Watch: does Sam handle conflicting signals gracefully without getting confused or refusing?"
  );

  await singleTurn(
    18,
    "Authentic local + comfortable for overseas guests",
    sessionId("contra", "authentic-comfortable"),
    "i want authentic local food but somewhere comfortable for my overseas guests"
  );

  await singleTurn(
    19,
    "Special + cheap (rm30 pp)",
    sessionId("contra", "special-cheap"),
    "i want something special but i can't spend more than rm30 per person"
  );

  await singleTurn(
    20,
    "Not hungry + nice to sit",
    sessionId("contra", "not-hungry-nice"),
    "i'm not that hungry but want somewhere nice to sit for a while"
  );

  await singleTurn(
    21,
    "Doesn't eat rice + craving nasi lemak",
    sessionId("contra", "rice-nasi"),
    "i don't usually eat rice but i'm craving nasi lemak today"
  );
}

async function runContextContinuity() {
  sectionHeader("7. CONTEXT CONTINUITY (4-turn session)");
  writeln(
    "Watch: does Sam reference earlier stated facts when answering follow-up questions?"
  );
  writeln(
    "Key check on turn 4: user lifted budget constraint — Sam should recommend differently than turn 1."
  );

  await multiTurn(
    "continuity",
    "memory",
    [
      { you: "suggest dinner for 2 in bangsar, budget is rm100 for both" },
      { you: "which of those takes reservations?" },
      {
        you: "actually drop the budget, we're celebrating something big",
      },
      { you: "ok now give me the best you've got regardless of price" },
    ],
    "22",
    "Session — budget set, lifted, then premium recs requested"
  );
}

async function runPreferenceCorrection() {
  sectionHeader("8. GRACEFUL PREFERENCE CORRECTION (3-turn session)");
  writeln(
    "Watch: does Sam recover cleanly when the user corrects his interpretation?"
  );

  await multiTurn(
    "correction",
    "pivot-off-pref",
    [
      {
        you: "dinner for 4, semi-formal, thinking chinese food",
      },
      {
        you: "actually my colleague doesn't eat chinese, can we do something else?",
      },
      { you: "yeah, something more neutral but still upscale" },
    ],
    "23",
    "Session — pivot away from stated preference mid-conversation"
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  initOutput();

  const start = Date.now();
  const timestamp = new Date().toISOString();

  writeln(`\x1b[1mSam Adaptability Stress Test — ${timestamp}\x1b[0m`);
  writeln(`API: ${API_URL}`);
  writeln(`Output: ${OUTPUT_FILE}`);
  writeln();
  writeln(
    'Sam is AI. The knowledge is not. This test stress tests the AI layer.'
  );
  writeln(
    "Read the multi-turn arcs carefully — adaptability is visible across turns."
  );
  writeln();

  try {
    await runConstraintRevelation();
    await runToneMirroring();
    await runCollaborativeRefinement();
    await runFlowPivot();
    await runImplicitInference();
    await runContradictionNavigation();
    await runContextContinuity();
    await runPreferenceCorrection();
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
  writeln(`Done. 23 scenarios in ${elapsed}s.`);
  writeln(`Full output saved to: ${OUTPUT_FILE}`);
  writeln();
  writeln("Evaluation checklist:");
  writeln(
    "  □ Constraint propagation: vegan/halal/budget respected in NEXT turn?"
  );
  writeln(
    "  □ Tone mirroring: does formal query get formal reply? casual get casual?"
  );
  writeln(
    "  □ Context memory: does Sam reference what was said earlier?"
  );
  writeln(
    "  □ Flow pivots: recommendation ↔ contribution without losing character?"
  );
  writeln(
    "  □ Implicit inference: 'tourist spots all week' → off-the-beaten-path recs?"
  );
  writeln(
    "  □ Contradiction grace: 'fancy but cheap' handled without getting stuck?"
  );
  writeln(
    "  □ Budget lift: turn 4 of context test recommends differently than turn 1?"
  );
  writeln(
    "  □ Preference correction: Sam pivots cleanly off stated Chinese preference?"
  );

  closeOutput();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
