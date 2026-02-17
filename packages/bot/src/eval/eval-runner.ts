// Eval runner — runs prompt scenarios through the LLM and scores responses
// Usage: npm run eval -w @sam/bot -- <prompt-name> [scenario-file]
//   e.g. npm run eval -w @sam/bot -- system
//   e.g. npm run eval -w @sam/bot -- extraction scenarios/extraction.jsonl

import { readFileSync } from "fs";
import { join } from "path";
import { chat, loadPrompt, HAIKU } from "../llm.js";

interface Scenario {
  /** Description of what this scenario tests */
  name: string;
  /** User message to send */
  input: string;
  /** Additional system context (appended to prompt) */
  context?: string;
  /** Strings that MUST appear in the response */
  must_contain?: string[];
  /** Strings that must NOT appear in the response */
  must_not_contain?: string[];
  /** Regex patterns the response must match */
  must_match?: string[];
  /** If true, response must be valid JSON */
  expect_json?: boolean;
  /** Max acceptable response length (characters) */
  max_length?: number;
}

interface Result {
  scenario: string;
  passed: boolean;
  failures: string[];
  response: string;
  latency_ms: number;
}

async function runScenario(
  systemPrompt: string,
  scenario: Scenario
): Promise<Result> {
  const failures: string[] = [];
  const start = Date.now();

  const response = await chat(
    systemPrompt + (scenario.context ? `\n\n${scenario.context}` : ""),
    [{ role: "user", content: scenario.input }],
    { model: HAIKU }
  );

  const latency = Date.now() - start;

  // Check must_contain
  for (const str of scenario.must_contain ?? []) {
    if (!response.toLowerCase().includes(str.toLowerCase())) {
      failures.push(`missing "${str}"`);
    }
  }

  // Check must_not_contain
  for (const str of scenario.must_not_contain ?? []) {
    if (response.toLowerCase().includes(str.toLowerCase())) {
      failures.push(`unexpected "${str}"`);
    }
  }

  // Check must_match
  for (const pattern of scenario.must_match ?? []) {
    if (!new RegExp(pattern, "i").test(response)) {
      failures.push(`no match for /${pattern}/`);
    }
  }

  // Check JSON validity
  if (scenario.expect_json) {
    try {
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : response.trim();
      JSON.parse(jsonStr);
    } catch {
      failures.push("invalid JSON");
    }
  }

  // Check max length
  if (scenario.max_length && response.length > scenario.max_length) {
    failures.push(`too long: ${response.length} > ${scenario.max_length}`);
  }

  return {
    scenario: scenario.name,
    passed: failures.length === 0,
    failures,
    response,
    latency_ms: latency,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: eval-runner <prompt-name> [scenario-file]");
    console.error("  e.g. eval-runner system");
    console.error("  e.g. eval-runner extraction scenarios/extraction.jsonl");
    process.exit(1);
  }

  const promptName = args[0];
  const scenarioFile =
    args[1] ?? join(__dirname, "scenarios", `${promptName}.jsonl`);

  console.log(`Loading prompt: ${promptName}`);
  const systemPrompt = loadPrompt(promptName);

  console.log(`Loading scenarios: ${scenarioFile}`);
  const lines = readFileSync(scenarioFile, "utf-8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("//"));
  const scenarios: Scenario[] = lines.map((l) => JSON.parse(l));

  console.log(`Running ${scenarios.length} scenarios...\n`);

  const results: Result[] = [];
  for (const scenario of scenarios) {
    const result = await runScenario(systemPrompt, scenario);
    results.push(result);

    const icon = result.passed ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
    console.log(`${icon} ${result.scenario} (${result.latency_ms}ms)`);
    if (!result.passed) {
      for (const f of result.failures) {
        console.log(`    → ${f}`);
      }
      console.log(`    Response: ${result.response.slice(0, 200)}...`);
    }
  }

  // Summary
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const avgLatency = Math.round(
    results.reduce((s, r) => s + r.latency_ms, 0) / total
  );

  console.log(`\n${"─".repeat(40)}`);
  console.log(`Results: ${passed}/${total} passed (avg ${avgLatency}ms)`);

  if (passed < total) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Eval failed:", err);
  process.exit(1);
});
