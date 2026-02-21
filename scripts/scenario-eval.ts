/**
 * scenario-eval.ts — Live scenario evaluation with LLM-as-judge
 *
 * For each scenario: sends messages to web API → collects Sam's response →
 * asks Claude Sonnet to score routing, quality, and hallucination.
 *
 * Requirements:
 *   npm run dev:web   # :3001 must be running
 *
 * Usage:
 *   npm run eval                              # run all 50 scenarios
 *   npm run eval -- --intent hungry          # run only hungry scenarios
 *   npm run eval -- --scenario birthday_dinner  # run one scenario
 *   npm run eval -- --fast                   # skip judge, just show responses
 */

import Anthropic from "@anthropic-ai/sdk";
import { scenarios, ConversationScenario } from "./conversation-scenarios";

const WEB_URL = "http://localhost:3001/api/chat";
const JUDGE_MODEL = "claude-sonnet-4-6";
const REQUEST_DELAY_MS = 1500; // avoid hammering the API

// ─── Output helpers ────────────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  grey: "\x1b[90m",
  magenta: "\x1b[35m",
};

function pass(label: string) {
  return `${C.green}✓ ${label}${C.reset}`;
}
function fail(label: string) {
  return `${C.red}✗ ${label}${C.reset}`;
}
function warn(label: string) {
  return `${C.yellow}⚠ ${label}${C.reset}`;
}

// ─── Web API call ─────────────────────────────────────────────────────────────

async function askWeb(sessionId: string, message: string): Promise<string> {
  const res = await fetch(WEB_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, message }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Web HTTP ${res.status}: ${body}`);
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
          // ignore malformed SSE chunks
        }
      }
    }
  }

  return full.trim();
}

// ─── Run one scenario through the web API ────────────────────────────────────

interface ScenarioResult {
  scenario: ConversationScenario;
  turns: Array<{ user: string; sam: string }>;
  finalResponse: string;
  durationMs: number;
  error?: string;
}

async function runScenario(
  scenario: ConversationScenario
): Promise<ScenarioResult> {
  const sessionId = `eval-${scenario.name}-${Date.now()}`;
  const turns: Array<{ user: string; sam: string }> = [];
  const start = Date.now();

  try {
    for (const message of scenario.messages) {
      const reply = await askWeb(sessionId, message);
      turns.push({ user: message, sam: reply });
      if (scenario.messages.indexOf(message) < scenario.messages.length - 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    return {
      scenario,
      turns,
      finalResponse: turns[turns.length - 1]?.sam ?? "",
      durationMs: Date.now() - start,
    };
  } catch (e) {
    return {
      scenario,
      turns,
      finalResponse: "",
      durationMs: Date.now() - start,
      error: String(e),
    };
  }
}

// ─── LLM judge ───────────────────────────────────────────────────────────────

interface Judgment {
  routing: { pass: boolean; reason: string };
  quality: { pass: boolean; reason: string };
  hallucination: { pass: boolean; reason: string };
}

async function judge(
  client: Anthropic,
  result: ScenarioResult
): Promise<Judgment> {
  const { scenario, turns, finalResponse } = result;

  const convoText = turns
    .map((t, i) => `Turn ${i + 1}\nUser: ${t.user}\nSam: ${t.sam}`)
    .join("\n\n");

  const prompt = `You are evaluating Sam, a travel intelligence bot. Sam only recommends real places from a database — he must never fabricate spot names, hours, or operational details.

Scenario being tested: "${scenario.description}"
Expected intent: ${scenario.intent}
What to look for: ${scenario.notes}

Full conversation:
${convoText}

Evaluate Sam's final response and return JSON only — no preamble, no markdown fences:
{
  "routing": {
    "pass": true/false,
    "reason": "one sentence — did the response behaviour match the expected intent '${scenario.intent}'?"
  },
  "quality": {
    "pass": true/false,
    "reason": "one sentence — does the response meet the evaluation criteria above?"
  },
  "hallucination": {
    "pass": true/false,
    "reason": "one sentence — does Sam appear to have fabricated spot names, hours, or specific facts? pass=true means NO hallucination detected."
  }
}`;

  const response = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 512,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  try {
    // Strip markdown fences if the model wrapped the JSON
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = fenceMatch ? fenceMatch[1].trim() : text.trim();
    return JSON.parse(jsonStr) as Judgment;
  } catch {
    // Parse failure — return a conservative result
    return {
      routing: {
        pass: false,
        reason: `Judge parse error: ${text.slice(0, 100)}`,
      },
      quality: { pass: false, reason: "Judge parse error" },
      hallucination: { pass: true, reason: "Could not evaluate" },
    };
  }
}

// ─── Report ───────────────────────────────────────────────────────────────────

interface EvalRecord {
  result: ScenarioResult;
  judgment: Judgment | null;
  overallPass: boolean;
}

function printRecord(rec: EvalRecord, index: number, total: number) {
  const { result, judgment } = rec;
  const { scenario } = result;
  const idx = `[${String(index + 1).padStart(2, "0")}/${total}]`;

  if (result.error) {
    console.log(
      `\n${idx} ${C.red}ERROR${C.reset} ${C.bold}${scenario.name}${C.reset}`
    );
    console.log(`       ${C.red}${result.error}${C.reset}`);
    return;
  }

  const statusIcon = rec.overallPass
    ? `${C.green}PASS${C.reset}`
    : `${C.red}FAIL${C.reset}`;

  console.log(
    `\n${idx} ${statusIcon} ${C.bold}${scenario.name}${C.reset}  ${C.grey}[${scenario.intent}]  ${result.durationMs}ms${C.reset}`
  );
  console.log(`       ${C.grey}${scenario.description}${C.reset}`);

  // Show each turn briefly
  for (const t of result.turns) {
    const userShort = t.user.length > 60 ? t.user.slice(0, 57) + "..." : t.user;
    const samShort = t.sam.length > 120 ? t.sam.slice(0, 117) + "..." : t.sam;
    console.log(`       ${C.cyan}You:${C.reset} ${userShort}`);
    console.log(`       ${C.magenta}Sam:${C.reset} ${samShort}`);
  }

  if (judgment) {
    console.log(
      `       ${judgment.routing.pass ? pass("routing") : fail("routing")}  ${C.grey}${judgment.routing.reason}${C.reset}`
    );
    console.log(
      `       ${judgment.quality.pass ? pass("quality") : fail("quality")}  ${C.grey}${judgment.quality.reason}${C.reset}`
    );
    console.log(
      `       ${judgment.hallucination.pass ? pass("no hallucination") : warn("hallucination?")}  ${C.grey}${judgment.hallucination.reason}${C.reset}`
    );
  }
}

function printSummary(records: EvalRecord[]) {
  const bar = "═".repeat(60);
  console.log(`\n${C.bold}${C.cyan}${bar}${C.reset}`);
  console.log(`${C.bold}${C.cyan}  EVALUATION SUMMARY${C.reset}`);
  console.log(`${C.bold}${C.cyan}${bar}${C.reset}\n`);

  const total = records.length;
  const passed = records.filter((r) => r.overallPass).length;
  const errors = records.filter((r) => r.result.error).length;
  const judged = records.filter((r) => r.judgment !== null).length;

  const pctPass = Math.round((passed / total) * 100);
  const passColor = pctPass >= 80 ? C.green : pctPass >= 60 ? C.yellow : C.red;

  console.log(
    `  Overall:   ${passColor}${passed} / ${total} passed (${pctPass}%)${C.reset}`
  );
  if (errors > 0)
    console.log(`  Errors:    ${C.red}${errors} scenarios failed to run${C.reset}`);
  if (judged < total - errors)
    console.log(
      `  ${C.grey}(${total - errors - judged} ran without LLM judge — fast mode)${C.reset}`
    );

  // By intent
  const intents = [...new Set(records.map((r) => r.result.scenario.intent))];
  console.log(`\n  By intent:`);
  for (const intent of intents.sort()) {
    const intentRecords = records.filter(
      (r) => r.result.scenario.intent === intent
    );
    const intentPass = intentRecords.filter((r) => r.overallPass).length;
    const pct = Math.round((intentPass / intentRecords.length) * 100);
    const color = pct >= 80 ? C.green : pct >= 50 ? C.yellow : C.red;
    console.log(
      `    ${intent.padEnd(15)} ${color}${intentPass}/${intentRecords.length} (${pct}%)${C.reset}`
    );
  }

  // Failures
  const failures = records.filter((r) => !r.overallPass);
  if (failures.length > 0) {
    console.log(`\n  ${C.red}Failures:${C.reset}`);
    for (const f of failures) {
      const reason = f.result.error
        ? `ERROR: ${f.result.error.slice(0, 80)}`
        : f.judgment
        ? [
            !f.judgment.routing.pass ? `routing: ${f.judgment.routing.reason}` : "",
            !f.judgment.quality.pass ? `quality: ${f.judgment.quality.reason}` : "",
            !f.judgment.hallucination.pass
              ? `hallucination: ${f.judgment.hallucination.reason}`
              : "",
          ]
            .filter(Boolean)
            .join(" | ")
        : "no judge";
      console.log(
        `    ${C.red}✗${C.reset} ${C.bold}${f.result.scenario.name}${C.reset}  ${C.grey}${reason}${C.reset}`
      );
    }
  }

  // Hallucinations
  const hallucinations = records.filter(
    (r) => r.judgment && !r.judgment.hallucination.pass
  );
  if (hallucinations.length > 0) {
    console.log(`\n  ${C.yellow}Possible hallucinations:${C.reset}`);
    for (const h of hallucinations) {
      console.log(
        `    ${C.yellow}⚠${C.reset} ${C.bold}${h.result.scenario.name}${C.reset}  ${C.grey}${h.judgment!.hallucination.reason}${C.reset}`
      );
    }
  }

  console.log();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const intentFilter = args.includes("--intent")
    ? args[args.indexOf("--intent") + 1]
    : null;
  const scenarioFilter = args.includes("--scenario")
    ? args[args.indexOf("--scenario") + 1]
    : null;
  const fastMode = args.includes("--fast");

  let selected = scenarios;
  if (intentFilter) selected = selected.filter((s) => s.intent === intentFilter);
  if (scenarioFilter)
    selected = selected.filter((s) => s.name === scenarioFilter);

  if (selected.length === 0) {
    console.error(`${C.red}No scenarios matched. Check --intent or --scenario filter.${C.reset}`);
    console.error(
      `${C.grey}Available intents: ${[...new Set(scenarios.map((s) => s.intent))].join(", ")}${C.reset}`
    );
    process.exit(1);
  }

  const client = fastMode ? null : new Anthropic();

  console.log(
    `\n${C.bold}Sam Scenario Eval${C.reset}  ${C.grey}${new Date().toISOString()}${C.reset}`
  );
  console.log(
    `${C.grey}Running ${selected.length} scenario${selected.length !== 1 ? "s" : ""}${intentFilter ? ` (intent: ${intentFilter})` : ""}${scenarioFilter ? ` (scenario: ${scenarioFilter})` : ""}${fastMode ? " [fast — no judge]" : " [with LLM judge]"}${C.reset}`
  );
  console.log(`${C.grey}Web API: ${WEB_URL}${C.reset}`);
  if (!fastMode) console.log(`${C.grey}Judge: ${JUDGE_MODEL}${C.reset}`);

  const records: EvalRecord[] = [];

  for (let i = 0; i < selected.length; i++) {
    const scenario = selected[i];

    process.stdout.write(
      `\n${C.grey}Running ${scenario.name}...${C.reset}`
    );

    const result = await runScenario(scenario);
    let judgment: Judgment | null = null;

    if (!fastMode && !result.error && result.finalResponse && client) {
      process.stdout.write(` ${C.grey}judging...${C.reset}`);
      try {
        judgment = await judge(client, result);
      } catch (e) {
        judgment = {
          routing: { pass: false, reason: `Judge error: ${String(e).slice(0, 80)}` },
          quality: { pass: false, reason: "Judge error" },
          hallucination: { pass: true, reason: "Could not evaluate" },
        };
      }
    }

    const overallPass = result.error
      ? false
      : fastMode
      ? !result.error && result.finalResponse.length > 0
      : judgment
      ? judgment.routing.pass && judgment.quality.pass && judgment.hallucination.pass
      : false;

    records.push({ result, judgment, overallPass });

    printRecord({ result, judgment, overallPass }, i, selected.length);

    // Delay between scenarios to avoid rate limiting
    if (i < selected.length - 1) {
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
    }
  }

  printSummary(records);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
