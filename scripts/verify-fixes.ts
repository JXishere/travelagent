/**
 * verify-fixes.ts — Automated assertion-based tests for Sam's key fixes
 *
 * Hits the live web chat API and the real DB. No human eval required —
 * each test either PASS or FAIL with a clear reason.
 *
 * Requires: npm run dev:web on :3001
 *
 * Usage:
 *   npm run dev:web    # terminal 1
 *   npm run verify     # terminal 2
 */

const API_URL = "http://localhost:3001/api/chat";
const RUN_ID = `verify-${Date.now()}`;

// ─── Supabase (service role — direct DB access) ────────────────────────────

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Initialized lazily in main() after env is loaded
let supabase: SupabaseClient;

// ─── SSE client ───────────────────────────────────────────────────────────

async function askSam(
  sessionId: string,
  message: string,
  extraHeaders?: Record<string, string>
): Promise<{ text: string; res: Response }> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify({ sessionId, message }),
  });

  if (res.status === 429) {
    return { text: "", res };
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let full = "";

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
          if (parsed.text) full += parsed.text;
        } catch {
          // ignore malformed chunks
        }
      }
    }
  }

  return { text: full, res };
}

// ─── DB helpers ───────────────────────────────────────────────────────────

async function setConversation(
  sessionId: string,
  flow: string,
  flowState: Record<string, unknown>
) {
  await supabase.from("conversations").upsert(
    { whatsapp_number: sessionId, current_flow: flow, flow_state: flowState, messages: [] },
    { onConflict: "whatsapp_number" }
  );
}

async function setTravelerCity(sessionId: string, city: string) {
  await supabase.from("travelers").upsert(
    { whatsapp_number: sessionId, current_city: city, user_type: "traveler" },
    { onConflict: "whatsapp_number" }
  );
}

async function cleanup(sessionId: string, spotName?: string) {
  await supabase.from("conversations").delete().eq("whatsapp_number", sessionId);
  await supabase.from("travelers").delete().eq("whatsapp_number", sessionId);
  if (spotName) {
    await supabase.from("spots").delete().eq("name", spotName);
  }
}

// ─── Test runner ──────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const TOTAL = 5;

async function test(name: string, fn: () => Promise<void>) {
  const num = passed + failed + 1;
  try {
    await fn();
    console.log(`✅ PASS  [${num}/${TOTAL}] ${name}`);
    passed++;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.log(`❌ FAIL  [${num}/${TOTAL}] ${name}`);
    console.log(`         ${reason}`);
    failed++;
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// ─── Test 1 — Contribution: unrelated message doesn't save incomplete spot ──

async function test1() {
  const sid = `${RUN_ID}-t1`;
  const spotName = `VerifySpot_${RUN_ID}`;

  // Contribution flow in confirming stage but deliberately incomplete (no category, no area)
  await setConversation(sid, "contribution", {
    stage: "confirming",
    extracted: { name: spotName },
    source: "text",
    messagesReceived: 1,
  });

  const { text } = await askSam(sid, "what time is it?");

  // Assert A: response guards the flow — Sam stayed in the contribution lane,
  // not answering "what time is it?" directly. Covers a range of phrasings
  // ("didn't catch the area", "still need", "drop it", etc.)
  const lower = text.toLowerCase();
  const guardPhrases = [
    "still need", "missing", "finish", "complete", "before saving",
    "haven't saved", "catch", "drop", "save", "area", "spot",
    "what's the", "tell me more", "need a bit more",
  ];
  assert(
    guardPhrases.some((p) => lower.includes(p)),
    `Expected contribution-flow guard language in response.\nActual: "${text.slice(0, 300)}"`
  );

  // Assert B: spot was NOT inserted into the DB
  const { data } = await supabase.from("spots").select("id").eq("name", spotName);
  assert(
    (data?.length ?? 0) === 0,
    `Spot "${spotName}" was inserted despite incomplete data — ${data?.length} row(s) found`
  );

  await cleanup(sid, spotName);
}

// ─── Test 2 — Unsupported city: Bangkok returns no-coverage, not KL spots ───

async function test2() {
  const sid = `${RUN_ID}-t2`;

  await setTravelerCity(sid, "Bangkok");
  await setConversation(sid, "general", {});

  const { text } = await askSam(sid, "I'm hungry");

  // Assert A: acknowledges Bangkok
  assert(
    text.toLowerCase().includes("bangkok"),
    `Expected "Bangkok" mentioned in response.\nActual: "${text.slice(0, 300)}"`
  );

  // Assert B: no KL-specific neighbourhood names leaked into the response.
  // Deliberately excludes "Petaling Jaya" (a supported city Sam mentions as alternative)
  // and "Damansara" (also appears in PJ city context). Pattern targets KL-only areas.
  const klPattern = /\b(Bangsar|KLCC|Bukit Bintang|Chow Kit|Petaling Street|Mont Kiara)\b/i;
  assert(
    !klPattern.test(text),
    `KL neighbourhood names found in Bangkok response — KL spots were recommended.\nActual: "${text.slice(0, 400)}"`
  );

  // Assert C: coverage-gap language
  const coveragePhrases = ["coverage", "don't have", "not in", "yet", "can help with"];
  assert(
    coveragePhrases.some((p) => text.toLowerCase().includes(p)),
    `Expected coverage-gap language in response.\nActual: "${text.slice(0, 300)}"`
  );

  await cleanup(sid);
}

// ─── Test 3 — Profile flow: food signal escapes interview ────────────────────

async function test3() {
  const sid = `${RUN_ID}-t3`;

  await setConversation(sid, "profile_learning", { stage: "interviewing" });

  const { text } = await askSam(sid, "I'm absolutely starving, what can I eat?");

  // Assert A: profile interview question suppressed
  assert(
    !text.toLowerCase().includes("local or just visiting"),
    `Profile interview question leaked.\nActual: "${text.slice(0, 300)}"`
  );

  // Assert B: not talking about profiles
  assert(
    !text.toLowerCase().includes("profile"),
    `Response mentions "profile" unexpectedly.\nActual: "${text.slice(0, 300)}"`
  );

  // Assert C: real recommendation (not a one-liner deflection)
  assert(
    text.length > 100,
    `Response too short (${text.length} chars) — likely a deflection, not a real recommendation.\nActual: "${text}"`
  );

  await cleanup(sid);
}

// ─── Test 4 — Clarifying flow: reply captures fresh meal_type + area ─────────

async function test4() {
  const sid = `${RUN_ID}-t4`;

  // Turn 1: single vague word → should trigger clarifying question
  const { text: turn1 } = await askSam(sid, "food");
  assert(
    turn1.includes("?"),
    `Turn 1: expected a clarifying question (should contain "?").\nActual: "${turn1.slice(0, 300)}"`
  );

  // Turn 2: clarifying answer with fresh area + meal_type signals
  const { text: turn2 } = await askSam(sid, "breakfast near Bangsar");

  assert(
    turn2.toLowerCase().includes("bangsar"),
    `Turn 2: "Bangsar" not found — fresh area signal wasn't used.\nActual: "${turn2.slice(0, 300)}"`
  );

  assert(
    !turn2.toLowerCase().includes("what are you feeling"),
    `Turn 2: same clarifying question asked again.\nActual: "${turn2.slice(0, 300)}"`
  );

  await cleanup(sid);
}

// ─── Test 5 — Rate limit: non-localhost IP hits the limiter ─────────────────

async function test5() {
  const sid = `${RUN_ID}-t5`;

  // 203.0.113.x is RFC 5737 documentation range — never a real client
  const { res } = await askSam(sid, "hello", { "x-forwarded-for": "203.0.113.42" });

  // Assert A: first request allowed (200, not 429)
  assert(res.status === 200, `Expected HTTP 200, got ${res.status}`);

  // Assert B: rate-limit header present and is a real bucket count (not the localhost bypass value)
  const remaining = res.headers.get("X-RateLimit-Remaining");
  assert(remaining !== null, `X-RateLimit-Remaining header missing — rate limit may have been bypassed`);

  const remainingNum = Number(remaining);
  assert(
    !isNaN(remainingNum) && remainingNum < 9999,
    `X-RateLimit-Remaining is "${remaining}" — expected a finite bucket count, not the localhost bypass (9999)`
  );

  // No DB cleanup — rate limit store is in-memory, resets on server restart
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!
  );

  console.log(`\nRunning ${TOTAL} fix verification tests against ${API_URL}\n`);

  await test("Contribution: unrelated message doesn't save incomplete spot", test1);
  await test("Unsupported city: Bangkok returns no-coverage", test2);
  await test("Profile flow: food signal escapes interview", test3);
  await test("Clarifying flow: reply captures fresh details", test4);
  await test("Rate limit: non-localhost IP hits the limiter", test5);

  console.log();
  if (failed === 0) {
    console.log(`${TOTAL}/${TOTAL} passed ✓`);
    process.exit(0);
  } else {
    console.log(`${passed}/${TOTAL} passed, ${failed} failed ✗`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[verify-fixes] Fatal error:", err);
  process.exit(1);
});
