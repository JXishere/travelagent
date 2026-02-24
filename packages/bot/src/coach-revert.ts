// Auto-revert failsafe — runs after a day of traffic on a new prompt
// If scores dropped ≥ 0.3 vs the pre-change baseline, restores the previous prompt.
//
// Triggered by GitHub Action at 9am UTC (5pm MYT) — after a full day of traffic.
//
// Flow:
//   1. Find the most recent coach_run where change_applied=true AND reverted=false
//   2. If none → exit (nothing deployed to check)
//   3. Fetch conversations that happened AFTER that run's run_at
//   4. Evaluate them and compute avg scores
//   5. Compare to prev_avg_scores (baseline before the change):
//      - Drop ≥ 0.3 → restore system_prompt_before, commit+push, mark reverted, Slack alert
//      - Otherwise → log confirmation, exit

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { chat, loadPrompt, SONNET } from "./llm.js";
import {
  fetchRecentConversations,
  fetchRecentFeedback,
  fetchRecommendationEvents,
  evaluateConversation,
  type ConversationEval,
} from "./coach.js";
import {
  getLatestUnrevertedChange,
  markCoachRunReverted,
} from "./database.js";

const SYSTEM_PROMPT_PATH = join(__dirname, "prompts", "system.txt");
const REVERT_THRESHOLD = 0.3;
const MIN_CONVOS_FOR_REVERT = 3;

async function sendSlackAlert(msg: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: msg }),
  }).catch(() => {});
}

function computeOverallAvg(avgScores: Record<string, number>): number {
  const vals = Object.values(avgScores);
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function commitAndPush(message: string): void {
  execSync("git config user.name 'Sam Self-Coach'", { stdio: "pipe" });
  execSync("git config user.email 'noreply@samiseverywhere.com'", { stdio: "pipe" });
  execSync("git add packages/bot/src/prompts/system.txt", { stdio: "pipe" });
  execSync(`git commit -m "${message.replace(/"/g, "'")}"`, { stdio: "pipe" });
  execSync("git push origin main", { stdio: "pipe" });
}

async function main() {
  console.log("=== Sam Revert Check ===\n");

  // Step 1: Find the most recent unreverted change
  const run = await getLatestUnrevertedChange();
  if (!run) {
    console.log("No unreverted change found. Nothing to check.");
    process.exit(0);
  }

  console.log(`Found coach run from ${run.run_at} (id: ${run.id})`);
  console.log(`  prev_avg_scores: ${JSON.stringify(run.prev_avg_scores ?? {})}`);

  if (!run.prev_avg_scores || !run.system_prompt_before) {
    console.log("Missing prev_avg_scores or system_prompt_before — cannot compare. Skipping.");
    process.exit(0);
  }

  // Step 2: Fetch conversations that happened after the coaching run
  const conversations = await fetchRecentConversations(30, { since: run.run_at });
  console.log(`\n${conversations.length} conversations since the change was deployed.`);

  if (conversations.length < MIN_CONVOS_FOR_REVERT) {
    console.log(`Not enough post-change traffic (need ${MIN_CONVOS_FOR_REVERT}). Skipping revert check.`);
    process.exit(0);
  }

  // Step 3: Evaluate post-change conversations
  // Use system_prompt_after (the changed prompt) for evaluation context
  const systemPrompt = run.system_prompt_after ?? loadPrompt("system").replaceAll("{{CITY}}", "Kuala Lumpur");
  const coachPrompt = loadPrompt("coach");

  const evals: ConversationEval[] = [];
  console.log("Evaluating post-change conversations...");
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

  if (evals.length === 0) {
    console.log("All evaluations failed. Skipping revert check.");
    process.exit(0);
  }

  // Step 4: Compute current avg scores
  const criteria = ["brevity", "personality", "operational_detail", "helpfulness", "tone_matching", "honesty"] as const;
  const currentAvgScores: Record<string, number> = {};
  for (const c of criteria) {
    const scores = evals.map((e) => e.scores[c]);
    currentAvgScores[c] = scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  const prevOverall = computeOverallAvg(run.prev_avg_scores as Record<string, number>);
  const currentOverall = computeOverallAvg(currentAvgScores);
  const drop = prevOverall - currentOverall;

  console.log(`\nBaseline (pre-change): ${prevOverall.toFixed(2)}/5`);
  console.log(`Current (post-change): ${currentOverall.toFixed(2)}/5`);
  console.log(`Drop: ${drop.toFixed(2)}`);

  // Step 5: Revert if scores dropped ≥ threshold
  if (drop >= REVERT_THRESHOLD) {
    console.log(`\nDrop ≥ ${REVERT_THRESHOLD} — reverting!`);

    writeFileSync(SYSTEM_PROMPT_PATH, run.system_prompt_before);

    try {
      commitAndPush("coach(revert): scores dropped after auto-patch, reverting");
    } catch (err) {
      console.error("Git push failed during revert:", err);
      process.exit(1);
    }

    await markCoachRunReverted(run.id).catch((e) => console.error("Failed to mark reverted:", e));

    const alertMsg = `⚠️ Sam self-reverted — today's fix dropped scores ${prevOverall.toFixed(1)}→${currentOverall.toFixed(1)}/5. Restored previous prompt.`;
    await sendSlackAlert(alertMsg);

    console.log("Reverted and pushed to main. Slack alerted.");
  } else {
    console.log(`\nScores held or improved (drop ${drop.toFixed(2)} < ${REVERT_THRESHOLD}). No revert needed.`);
  }
}

main().catch((err) => {
  console.error("Revert check failed:", err);
  process.exit(1);
});
