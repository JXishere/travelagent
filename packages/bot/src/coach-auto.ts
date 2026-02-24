// Automated self-coaching — runs coach, applies top suggestion to system.txt, validates with eval,
// then commits directly to main (Railway auto-redeploys). Records every run in coach_runs.
//
// Flow:
//   1. Fetch only uncoached conversations (coached_at IS NULL)
//   2. Evaluate and synthesize issues
//   3. Apply surgical edit to system.txt
//   4. Validate with eval
//   5. If eval passes: git commit + push to main, record run in DB, mark convos coached
//   6. If eval fails or no change needed: record skipped/failed run in DB, exit 0
//
// Skip conditions (exit 0, still records a run):
//   - Fewer than COACH_MIN_CONVOS uncoached conversations (default 3)
//   - Overall avg > 4.2 AND zero issues detected

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
  type ConversationRow,
} from "./coach.js";
import {
  insertCoachRun,
  getLatestCoachRun,
  markConversationsCoached,
} from "./database.js";

const SYSTEM_PROMPT_PATH = join(__dirname, "prompts", "system.txt");
const COACH_MIN_CONVOS = parseInt(process.env.COACH_MIN_CONVOS ?? "3", 10);
const HEALTH_THRESHOLD = 4.2;

// ── Phase 1 & 2: Analysis ──

interface AnalysisResult {
  conversations: ConversationRow[];
  evals: ConversationEval[];
  overallAvg: number;
  avgScores: Record<string, number>;
  synthesis: string;
}

async function runCoachAnalysis(): Promise<AnalysisResult | null> {
  console.log(`Fetching uncoached conversations (min: ${COACH_MIN_CONVOS})...\n`);

  const [conversations, feedback, recEvents] = await Promise.all([
    fetchRecentConversations(20, { onlyNew: true }),
    fetchRecentFeedback(),
    fetchRecommendationEvents(),
  ]);

  console.log(`  ${conversations.length} uncoached convos, ${feedback.length} feedback, ${recEvents.length} rec events`);

  if (conversations.length < COACH_MIN_CONVOS) {
    console.log(`Skip: only ${conversations.length} uncoached conversations (need ${COACH_MIN_CONVOS}).`);
    return null;
  }

  const systemPrompt = loadPrompt("system").replaceAll("{{CITY}}", "Kuala Lumpur");
  const coachPrompt = loadPrompt("coach");

  const evals: ConversationEval[] = [];
  for (let i = 0; i < conversations.length; i++) {
    process.stdout.write(`  [${i + 1}/${conversations.length}] `);
    try {
      const evaluation = await evaluateConversation(systemPrompt, coachPrompt, conversations[i]);
      evals.push(evaluation);
      const avg = Object.values(evaluation.scores).reduce((a, b) => a + b, 0) / 6;
      console.log(`${avg.toFixed(1)}/5`);
    } catch {
      console.log(`FAILED`);
    }
  }

  if (evals.length === 0) return null;

  // Compute average scores
  const criteria = ["brevity", "personality", "operational_detail", "helpfulness", "tone_matching", "honesty"] as const;
  const avgScores: Record<string, number> = {};
  for (const c of criteria) {
    const scores = evals.map((e) => e.scores[c]);
    avgScores[c] = scores.reduce((a, b) => a + b, 0) / scores.length;
  }
  const overallAvg = Object.values(avgScores).reduce((a, b) => a + b, 0) / criteria.length;
  console.log(`\nOverall average: ${overallAvg.toFixed(2)}/5`);

  const allIssues = evals.flatMap((e) => e.issues);
  if (overallAvg > HEALTH_THRESHOLD && allIssues.length === 0) {
    console.log(`Healthy (>${HEALTH_THRESHOLD}, no issues). No changes needed.`);
    return { conversations, evals, overallAvg, avgScores, synthesis: "" };
  }

  console.log("Synthesizing patterns...");
  const aggregationPrompt = buildAggregationPrompt(evals, feedback, recEvents, systemPrompt);
  const synthesis = await chat(
    "You are a coaching analyst. Be specific and actionable.",
    [{ role: "user", content: aggregationPrompt }],
    { model: SONNET, maxTokens: 2048, temperature: 0.4 }
  );

  return { conversations, evals, overallAvg, avgScores, synthesis };
}

// ── Phase 3: Apply changes ──

async function applyChanges(synthesis: string): Promise<string> {
  const currentPrompt = readFileSync(SYSTEM_PROMPT_PATH, "utf-8");
  const charLimit = currentPrompt.length + 200;

  const rewriteInstruction = `You are making a SURGICAL edit to Sam's system prompt. Not a rewrite — a targeted fix.

## Current system.txt (${currentPrompt.length} characters)
${currentPrompt}

## Coaching Report (read this, then apply ONE fix)
${synthesis}

## STRICT RULES
1. Pick the SINGLE most impactful issue from the report
2. Make the SMALLEST possible edit that addresses it — change 1-3 lines
3. Your output MUST be under ${charLimit} characters. The current prompt is ${currentPrompt.length} chars. You have room for ~200 extra characters at most.
4. Do NOT rewrite sections that aren't related to your fix
5. Do NOT add examples, lists, or explanatory paragraphs
6. Keep {{CITY}} exactly as-is
7. Output ONLY the updated system.txt — no explanation, no fences`;

  return await chat(
    "You are a careful prompt editor. Output only the revised prompt text.",
    [{ role: "user", content: rewriteInstruction }],
    { model: SONNET, maxTokens: 2048, temperature: 0.2 }
  );
}

// ── Phase 4: Validate with eval ──

function runEval(): boolean {
  try {
    console.log("Running eval...");
    execSync("npx tsx src/eval/eval-runner.ts system", {
      cwd: join(__dirname, ".."),
      stdio: "pipe",
      timeout: 120_000,
      env: { ...process.env },
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

// ── Phase 5: Auto-commit to main ──

function commitAndPush(issueDescription: string): void {
  const msg = `coach(auto): ${issueDescription}`;
  execSync("git config user.name 'Sam Self-Coach'", { stdio: "pipe" });
  execSync("git config user.email 'noreply@samiseverywhere.com'", { stdio: "pipe" });
  execSync("git add packages/bot/src/prompts/system.txt", { stdio: "pipe" });
  execSync(`git commit -m "${msg.replace(/"/g, "'")}"`, { stdio: "pipe" });
  execSync("git push origin main", { stdio: "pipe" });
  console.log(`Committed and pushed: ${msg}`);
}

// ── Extract brief description from synthesis ──

function extractIssueDescription(synthesis: string): string {
  const match = synthesis.match(/###\s+\d+\.\s+(.+)/);
  return match ? match[1].trim().slice(0, 60) : "improve system prompt";
}

// ── Main ──

async function main() {
  console.log("=== Sam Self-Coach (Auto) ===\n");

  // Fetch previous run's avg_scores for trend tracking
  const prevRun = await getLatestCoachRun().catch(() => null);
  const prevAvgScores = prevRun?.avg_scores ?? undefined;

  // Phase 1-2: Analyze
  const result = await runCoachAnalysis();

  if (!result) {
    // Skip: not enough conversations
    await insertCoachRun({
      conversations_analyzed: 0,
      change_applied: false,
      reverted: false,
      prev_avg_scores: prevAvgScores,
    }).catch((e) => console.error("Failed to record skip run:", e));
    console.log("\nSkipped — recorded in coach_runs.");
    process.exit(0);
  }

  // Healthy: no issues found
  if (!result.synthesis) {
    await insertCoachRun({
      conversations_analyzed: result.conversations.length,
      avg_scores: result.avgScores,
      prev_avg_scores: prevAvgScores,
      change_applied: false,
      reverted: false,
      synthesis: "Healthy — no changes needed.",
    }).catch((e) => console.error("Failed to record healthy run:", e));
    await markConversationsCoached(result.conversations.map((c) => c.id)).catch(() => {});
    console.log("\nHealthy — recorded in coach_runs, conversations marked coached.");
    process.exit(0);
  }

  // Save original for DB record + safety revert
  const systemBefore = readFileSync(SYSTEM_PROMPT_PATH, "utf-8");

  // Phase 3: Apply
  console.log("\nApplying top suggestion to system.txt...");
  const revised = await applyChanges(result.synthesis);

  // Sanity check
  if (revised.length < 200 || revised.length > systemBefore.length * 1.3) {
    console.log(`Revised prompt looks wrong (${revised.length} chars vs ${systemBefore.length} original). Skipping.`);
    await insertCoachRun({
      conversations_analyzed: result.conversations.length,
      avg_scores: result.avgScores,
      prev_avg_scores: prevAvgScores,
      change_applied: false,
      reverted: false,
      synthesis: result.synthesis,
    }).catch((e) => console.error("Failed to record run:", e));
    process.exit(0);
  }

  writeFileSync(SYSTEM_PROMPT_PATH, revised);
  console.log(`Written revised system.txt (${systemBefore.length} → ${revised.length} chars)`);

  // Phase 4: Validate
  const evalPassed = runEval();

  if (!evalPassed) {
    console.log("\nEval failed — reverting system.txt");
    writeFileSync(SYSTEM_PROMPT_PATH, systemBefore);
    await insertCoachRun({
      conversations_analyzed: result.conversations.length,
      avg_scores: result.avgScores,
      prev_avg_scores: prevAvgScores,
      change_applied: false,
      reverted: false,
      synthesis: result.synthesis,
    }).catch((e) => console.error("Failed to record run:", e));
    console.log("System prompt unchanged.");
    process.exit(0);
  }

  // Phase 5: Commit + push to main
  const issueDescription = extractIssueDescription(result.synthesis);
  try {
    commitAndPush(issueDescription);
  } catch (err) {
    console.error("Git push failed:", err);
    writeFileSync(SYSTEM_PROMPT_PATH, systemBefore);
    process.exit(1);
  }

  // Phase 6: Record run in DB
  await insertCoachRun({
    conversations_analyzed: result.conversations.length,
    avg_scores: result.avgScores,
    prev_avg_scores: prevAvgScores,
    change_applied: true,
    reverted: false,
    system_prompt_before: systemBefore,
    system_prompt_after: revised,
    synthesis: result.synthesis,
  }).catch((e) => console.error("Failed to record coach run:", e));

  await markConversationsCoached(result.conversations.map((c) => c.id)).catch(() => {});

  console.log("\nDone. system.txt updated, eval passed, committed to main, recorded in DB.");
}

main().catch((err) => {
  console.error("Coach auto failed:", err);
  process.exit(1);
});
