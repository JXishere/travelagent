// Automated self-coaching — runs coach, applies top suggestion to system.txt, validates with eval
// Used by GitHub Action (weekly) or manually: npm run coach:auto
//
// Flow:
//   1. Run coach analysis (score conversations, find patterns)
//   2. Ask Sonnet to rewrite system.txt based on top suggestion
//   3. Run eval to validate no regressions
//   4. If eval passes: keep changes, exit 0 (GitHub Action creates PR)
//   5. If eval fails: revert, exit 1

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { chat, loadPrompt, SONNET } from "./llm.js";
import {
  fetchRecentConversations,
  fetchRecentFeedback,
  fetchRecommendationEvents,
  evaluateConversation,
  buildAggregationPrompt,
  type ConversationEval,
} from "./coach.js";

const SYSTEM_PROMPT_PATH = join(__dirname, "prompts", "system.txt");

// ── Phase 1 & 2: Reuse coach analysis ──

async function runCoachAnalysis(): Promise<{ evals: ConversationEval[]; synthesis: string } | null> {
  const limit = 20;
  console.log(`Analyzing ${limit} recent conversations...\n`);

  const [conversations, feedback, recEvents] = await Promise.all([
    fetchRecentConversations(limit),
    fetchRecentFeedback(),
    fetchRecommendationEvents(),
  ]);

  console.log(`  ${conversations.length} conversations, ${feedback.length} feedback, ${recEvents.length} rec events`);

  if (conversations.length === 0) {
    console.log("No conversations to analyze. Skipping.");
    return null;
  }

  const systemPrompt = loadPrompt("system").replaceAll("{{CITY}}", "Kuala Lumpur");
  const coachPrompt = loadPrompt("coach");

  // Evaluate conversations
  const evals: ConversationEval[] = [];
  for (let i = 0; i < conversations.length; i++) {
    process.stdout.write(`  [${i + 1}/${conversations.length}] `);
    try {
      const evaluation = await evaluateConversation(systemPrompt, coachPrompt, conversations[i]);
      evals.push(evaluation);
      const avg = Object.values(evaluation.scores).reduce((a, b) => a + b, 0) / 6;
      console.log(`${avg.toFixed(1)}/5`);
    } catch (err) {
      console.log(`FAILED`);
    }
  }

  if (evals.length === 0) return null;

  // Check if scores are already high — skip if average > 4.0
  const allScores = evals.flatMap((e) => Object.values(e.scores));
  const overallAvg = allScores.reduce((a, b) => a + b, 0) / allScores.length;
  console.log(`\nOverall average: ${overallAvg.toFixed(1)}/5`);

  if (overallAvg > 4.0 && evals.flatMap((e) => e.issues).length === 0) {
    console.log("Scores are healthy (>4.0, no issues). No changes needed.");
    return null;
  }

  // Synthesize
  console.log("Synthesizing patterns...");
  const aggregationPrompt = buildAggregationPrompt(evals, feedback, recEvents, systemPrompt);
  const synthesis = await chat(
    "You are a coaching analyst. Be specific and actionable.",
    [{ role: "user", content: aggregationPrompt }],
    { model: SONNET, maxTokens: 2048, temperature: 0.4 }
  );

  return { evals, synthesis };
}

// ── Phase 3: Apply changes ──

async function applyChanges(synthesis: string): Promise<string> {
  const currentPrompt = readFileSync(SYSTEM_PROMPT_PATH, "utf-8");

  const rewriteInstruction = `You are editing Sam's system prompt based on a coaching report. Your job is to produce an improved version of the prompt.

## Current system.txt
${currentPrompt}

## Coaching Report
${synthesis}

## Rules for editing
- Apply ONLY the top 1-2 highest-impact suggestions from the report
- Keep Sam's personality intact — don't make him generic
- Don't add more than 5-6 new lines total
- Don't remove existing rules that aren't mentioned in the report
- Keep the {{CITY}} template variable — don't replace it
- Preserve the overall structure and tone of the prompt
- Output ONLY the new system.txt content, nothing else — no explanation, no markdown fences`;

  const revised = await chat(
    "You are a careful prompt editor. Output only the revised prompt text.",
    [{ role: "user", content: rewriteInstruction }],
    { model: SONNET, maxTokens: 2048, temperature: 0.2 }
  );

  return revised;
}

// ── Phase 4: Validate with eval ──

function runEval(): boolean {
  try {
    console.log("Running eval...");
    execSync("npx tsx src/eval/eval-runner.ts system", {
      cwd: join(__dirname, ".."),
      stdio: "pipe",
      timeout: 120_000,
      env: { ...process.env }, // inherit env vars (works in CI + locally)
    });
    console.log("Eval passed.");
    return true;
  } catch (err) {
    const output = (err as any).stdout?.toString() || "";
    console.log("Eval failed:");
    console.log(output.split("\n").slice(-10).join("\n"));
    return false;
  }
}

// ── Main ──

async function main() {
  console.log("=== Sam Self-Coach (Auto) ===\n");

  // Phase 1-2: Analyze
  const result = await runCoachAnalysis();
  if (!result) {
    console.log("\nNo changes to propose.");
    process.exit(0);
  }

  // Save original
  const original = readFileSync(SYSTEM_PROMPT_PATH, "utf-8");

  // Phase 3: Apply
  console.log("\nApplying top suggestion to system.txt...");
  const revised = await applyChanges(result.synthesis);

  // Sanity check: don't write empty or drastically different prompts
  if (revised.length < 200 || revised.length > original.length * 1.3) {
    console.log(`Revised prompt looks wrong (${revised.length} chars vs ${original.length} original). Skipping.`);
    process.exit(0);
  }

  writeFileSync(SYSTEM_PROMPT_PATH, revised);
  console.log(`Written revised system.txt (${original.length} -> ${revised.length} chars)`);

  // Phase 4: Validate
  const evalPassed = runEval();

  if (!evalPassed) {
    console.log("\nEval failed — reverting system.txt (change was too aggressive)");
    writeFileSync(SYSTEM_PROMPT_PATH, original);
    console.log("No PR will be created. System prompt unchanged.");
    process.exit(0); // not an error — eval rejection is expected sometimes
  }

  // Write report for PR body
  const criteria = ["brevity", "personality", "operational_detail", "helpfulness", "tone_matching", "honesty"] as const;
  const avgs: Record<string, string> = {};
  for (const c of criteria) {
    const scores = result.evals.map((e) => e.scores[c]);
    avgs[c] = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
  }

  const report = `## Self-Coach Report

Analyzed ${result.evals.length} conversations.

| Criterion | Score |
|-----------|-------|
${criteria.map((c) => `| ${c} | ${avgs[c]}/5 |`).join("\n")}

### Changes Applied
${result.synthesis.split("\n").slice(0, 30).join("\n")}

---
*Auto-generated by \`npm run coach:auto\`. Review the system.txt diff carefully before merging.*`;

  writeFileSync(join(__dirname, "..", "coach-report.md"), report);
  console.log("\nDone. system.txt updated, eval passed, report written to coach-report.md");
}

main().catch((err) => {
  console.error("Coach auto failed:", err);
  process.exit(1);
});
