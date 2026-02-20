/**
 * chat-test.ts — Real dual-channel test: web chat + WhatsApp bot
 *
 * Sends actual messages to both channels and prints Sam's responses side-by-side.
 * Not simulated, not mocked — hits live servers.
 *
 * Requirements:
 *   npm run dev:web   # :3001 — web chat API
 *   npm run dev       # :3000 — WhatsApp bot webhook
 *
 * Usage:
 *   npm run chat-test                              # default multi-turn conversation
 *   npm run chat-test "what to do in pj"           # single custom message
 *   npm run chat-test list                         # list all named scenarios
 *   npm run chat-test scenario birthday_dinner     # run a named scenario
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { scenarios } from "./conversation-scenarios";

const WEB_URL = "http://localhost:3001/api/chat";
const BOT_URL = "http://localhost:3000/webhook";
const WA_TEST_NUMBER = "60109999999";
const WA_POLL_INTERVAL_MS = 500;
const WA_POLL_TIMEOUT_MS = 15_000;

// ─── Supabase ─────────────────────────────────────────────────────────────────

let supabase: SupabaseClient;

function initSupabase() {
  supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!
  );
}

// ─── Web channel ─────────────────────────────────────────────────────────────

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
          // ignore malformed chunks
        }
      }
    }
  }

  return full;
}

// ─── WhatsApp channel ────────────────────────────────────────────────────────

/** Get the last assistant message timestamp before we send, for change detection */
async function getLastAssistantTs(): Promise<number | null> {
  const { data } = await supabase
    .from("conversations")
    .select("messages")
    .eq("whatsapp_number", WA_TEST_NUMBER)
    .maybeSingle();

  if (!data?.messages?.length) return null;
  const msgs: { role: string; content: string; timestamp?: number }[] = data.messages;
  const assistantMsgs = msgs.filter((m) => m.role === "assistant");
  return assistantMsgs.length ? assistantMsgs.length : null;
}

/** Poll conversations table until a new assistant message appears */
async function pollForWaReply(prevAssistantCount: number | null): Promise<string> {
  const deadline = Date.now() + WA_POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, WA_POLL_INTERVAL_MS));

    const { data } = await supabase
      .from("conversations")
      .select("messages")
      .eq("whatsapp_number", WA_TEST_NUMBER)
      .maybeSingle();

    if (!data?.messages?.length) continue;

    const msgs: { role: string; content: string }[] = data.messages;
    const assistantMsgs = msgs.filter((m) => m.role === "assistant");

    if (assistantMsgs.length > (prevAssistantCount ?? 0)) {
      return assistantMsgs[assistantMsgs.length - 1].content;
    }
  }

  throw new Error(`WhatsApp reply timeout (${WA_POLL_TIMEOUT_MS / 1000}s) — is bot running on :3000?`);
}

/** Build a fake WhatsApp Cloud API webhook payload */
function buildWebhookPayload(from: string, messageId: string, text: string) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  from,
                  id: messageId,
                  type: "text",
                  text: { body: text },
                  timestamp: String(Math.floor(Date.now() / 1000)),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

async function askWhatsApp(message: string, msgIndex: number): Promise<string> {
  const prevCount = await getLastAssistantTs();

  const messageId = `chat-test-${Date.now()}-${msgIndex}`;
  const payload = buildWebhookPayload(WA_TEST_NUMBER, messageId, message);

  const res = await fetch(BOT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WhatsApp webhook HTTP ${res.status}: ${body}`);
  }

  return pollForWaReply(prevCount);
}

// ─── Output ───────────────────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  grey: "\x1b[90m",
  red: "\x1b[31m",
};

function header(title: string) {
  const bar = "═".repeat(50);
  console.log();
  console.log(`${C.bold}${C.yellow}${bar}${C.reset}`);
  console.log(`${C.bold}${C.yellow}  ${title}${C.reset}`);
  console.log(`${C.bold}${C.yellow}${bar}${C.reset}`);
}

function you(msg: string) {
  console.log(`${C.green}[YOU]${C.reset} ${msg}`);
}

function sam(msg: string) {
  console.log(`${C.cyan}[SAM]${C.reset} ${msg}`);
  console.log();
}

function err(msg: string) {
  console.log(`${C.red}[ERR]${C.reset} ${msg}`);
  console.log();
}

// ─── Conversation runner ──────────────────────────────────────────────────────

async function runWebConversation(messages: string[]) {
  header("WEB CHAT  →  :3001");
  const sessionId = `chat-test-${Date.now()}`;

  for (let i = 0; i < messages.length; i++) {
    you(messages[i]);
    try {
      const reply = await askWeb(sessionId, messages[i]);
      sam(reply);
    } catch (e) {
      err(String(e));
    }
  }
}

async function runWhatsAppConversation(messages: string[]) {
  header("WHATSAPP BOT  →  :3000");

  for (let i = 0; i < messages.length; i++) {
    you(messages[i]);
    try {
      const reply = await askWhatsApp(messages[i], i);
      sam(reply);
    } catch (e) {
      err(String(e));
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // ── list: show all named scenarios ─────────────────────────────────────────
  if (args[0] === "list") {
    console.log(
      `${C.bold}Sam Conversation Scenarios${C.reset}  ${C.grey}(${scenarios.length} total)${C.reset}\n`
    );
    for (const s of scenarios) {
      const intent = `${C.grey}[${s.intent}]${C.reset}`;
      console.log(`  ${C.cyan}${s.name.padEnd(26)}${C.reset}${intent.padEnd(20)} ${s.description}`);
    }
    console.log();
    console.log(`${C.grey}Run a scenario: npm run chat-test scenario <name>${C.reset}`);
    return;
  }

  // ── scenario: run a named scenario ─────────────────────────────────────────
  if (args[0] === "scenario") {
    const scenarioName = args[1];
    if (!scenarioName) {
      console.error(`${C.red}Usage: npm run chat-test scenario <name>${C.reset}`);
      console.error(`${C.grey}Run 'npm run chat-test list' to see available scenarios.${C.reset}`);
      process.exit(1);
    }
    const scenario = scenarios.find((s) => s.name === scenarioName);
    if (!scenario) {
      console.error(`${C.red}Scenario not found: "${scenarioName}"${C.reset}`);
      console.error(`${C.grey}Available: ${scenarios.map((s) => s.name).join(", ")}${C.reset}`);
      process.exit(1);
    }
    initSupabase();
    console.log(`${C.bold}Sam Chat Test${C.reset}  ${C.grey}${new Date().toISOString()}${C.reset}`);
    console.log(`${C.bold}Scenario:${C.reset} ${C.cyan}${scenario.name}${C.reset} — ${scenario.description}`);
    console.log(`${C.grey}Expected intent: ${scenario.intent}${C.reset}`);
    console.log(`${C.grey}Notes: ${scenario.notes}${C.reset}`);
    console.log(`${C.grey}Messages: ${scenario.messages.map((m) => `"${m}"`).join(" → ")}${C.reset}`);
    console.log(`${C.grey}WA test number: ${WA_TEST_NUMBER}${C.reset}`);
    await runWebConversation(scenario.messages);
    await runWhatsAppConversation(scenario.messages);
    console.log(`${C.grey}${"─".repeat(50)}${C.reset}`);
    console.log(`${C.grey}Done.${C.reset}`);
    return;
  }

  // ── default: raw message args or built-in default ──────────────────────────
  initSupabase();
  const messages =
    args.length > 0
      ? args
      : ["what to do in pj", "ok what about food only"];

  console.log(`${C.bold}Sam Chat Test${C.reset}  ${C.grey}${new Date().toISOString()}${C.reset}`);
  console.log(`${C.grey}Messages: ${messages.map((m) => `"${m}"`).join(" → ")}${C.reset}`);
  console.log(`${C.grey}WA test number: ${WA_TEST_NUMBER}${C.reset}`);

  await runWebConversation(messages);
  await runWhatsAppConversation(messages);

  console.log(`${C.grey}${"─".repeat(50)}${C.reset}`);
  console.log(`${C.grey}Done.${C.reset}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
