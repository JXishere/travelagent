// Self-coaching pipeline — reviews real conversations and suggests prompt improvements
// Run with: npm run coach (default 20 conversations) or npm run coach -- 50

import { createClient } from "@supabase/supabase-js";
import { chat, loadPrompt, SONNET } from "./llm.js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

// ── Types ──

export interface ConversationRow {
  id: string;
  whatsapp_number: string;
  current_flow: string;
  messages: Array<{ role: string; content: string }>;
  updated_at: string;
}

interface FeedbackRow {
  spot_id: string;
  rating: number;
  visited: boolean;
  user_tips: string[];
}

interface RecommendationEvent {
  event_data: { spot_ids?: string[]; spot_names?: string[] };
}

export interface ConversationScores {
  brevity: number;
  personality: number;
  operational_detail: number;
  helpfulness: number;
  tone_matching: number;
  honesty: number;
}

export interface ConversationEval {
  scores: ConversationScores;
  issues: string[];
  bright_spots: string[];
  summary: string;
}

// ── Data Fetching (exported for coach-auto) ──

export async function fetchRecentConversations(
  limit: number,
  options?: { onlyNew?: boolean; since?: string }
): Promise<ConversationRow[]> {
  let q = supabase
    .from("conversations")
    .select("id, whatsapp_number, current_flow, messages, updated_at")
    .order("updated_at", { ascending: false });

  if (options?.onlyNew) {
    q = q.is("coached_at", null);
  }
  if (options?.since) {
    q = q.gt("updated_at", options.since);
  }

  const { data, error } = await q.limit(limit * 2); // fetch extra, then filter for 4+ messages

  if (error) throw new Error(`Failed to fetch conversations: ${error.message}`);
  return (data ?? [])
    .filter((c: ConversationRow) => c.messages && c.messages.length >= 4)
    .slice(0, limit);
}

export async function fetchRecentFeedback(): Promise<FeedbackRow[]> {
  const { data, error } = await supabase
    .from("feedback")
    .select("spot_id, rating, visited, user_tips")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw new Error(`Failed to fetch feedback: ${error.message}`);
  return data ?? [];
}

export async function fetchRecommendationEvents(): Promise<RecommendationEvent[]> {
  const { data, error } = await supabase
    .from("events")
    .select("event_data")
    .eq("event_type", "recommendation")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw new Error(`Failed to fetch events: ${error.message}`);
  return data ?? [];
}

// ── Phase 1: Per-Conversation Evaluation (exported for coach-auto) ──

export function formatConversation(messages: Array<{ role: string; content: string }>): string {
  return messages
    .map((m) => `${m.role === "user" ? "User" : "Sam"}: ${m.content}`)
    .join("\n\n");
}

export async function evaluateConversation(
  systemPrompt: string,
  coachPrompt: string,
  convo: ConversationRow
): Promise<ConversationEval> {
  const transcript = formatConversation(convo.messages);
  const userContent = `## Sam's System Prompt\n${systemPrompt}\n\n## Conversation Transcript\n${transcript}`;

  const response = await chat(coachPrompt, [{ role: "user", content: userContent }], {
    model: SONNET,
    maxTokens: 1024,
    temperature: 0.3,
  });

  const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : response.trim();
  return JSON.parse(jsonStr) as ConversationEval;
}

// ── Phase 2: Aggregation & Synthesis ──

export function buildAggregationPrompt(
  evals: ConversationEval[],
  feedback: FeedbackRow[],
  recEvents: RecommendationEvent[],
  systemPrompt: string
): string {
  // Average scores
  const criteria = ["brevity", "personality", "operational_detail", "helpfulness", "tone_matching", "honesty"] as const;
  const avgs: Record<string, string> = {};
  for (const c of criteria) {
    const scores = evals.map((e) => e.scores[c]);
    avgs[c] = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
  }

  // Collect all issues and bright spots
  const allIssues = evals.flatMap((e) => e.issues);
  const allBrightSpots = evals.flatMap((e) => e.bright_spots);

  // Feedback summary
  const feedbackSummary = feedback.length > 0
    ? `${feedback.length} feedback entries. Average rating: ${(feedback.reduce((s, f) => s + f.rating, 0) / feedback.length).toFixed(1)}/5. Visited: ${feedback.filter((f) => f.visited).length}/${feedback.length}.`
    : "No feedback data available.";

  // Recommendation diversity
  const spotCounts: Record<string, number> = {};
  for (const ev of recEvents) {
    for (const name of ev.event_data?.spot_names ?? []) {
      spotCounts[name] = (spotCounts[name] ?? 0) + 1;
    }
  }
  const sortedSpots = Object.entries(spotCounts).sort((a, b) => b[1] - a[1]);
  const totalRecs = recEvents.length;
  const uniqueSpots = sortedSpots.length;
  const top5 = sortedSpots.slice(0, 5).map(([name, count]) => `${name} (${count}x)`).join(", ");

  return `You are a coaching analyst for Sam, a travel assistant. Synthesize these evaluation results and generate specific improvement suggestions for Sam's system prompt.

## Current System Prompt
${systemPrompt}

## Score Averages (across ${evals.length} conversations)
${criteria.map((c) => `- ${c}: ${avgs[c]}/5`).join("\n")}

## All Issues Found
${allIssues.map((i) => `- ${i}`).join("\n") || "- None"}

## All Bright Spots
${allBrightSpots.map((b) => `- ${b}`).join("\n") || "- None"}

## Feedback Insights
${feedbackSummary}

## Recommendation Diversity
${totalRecs} recommendation events, ${uniqueSpots} unique spots.
Most recommended: ${top5 || "N/A"}

## Your Task

1. Identify the top 3-5 failure PATTERNS (not individual issues — group similar ones)
2. For each pattern, provide a SPECIFIC prompt change: what to add, modify, or remove in the system prompt, with exact suggested text
3. Note any feedback or diversity concerns
4. Keep suggestions actionable — each one should be a concrete edit to system.txt

Respond in this format:

## Top Failure Patterns

### 1. [Pattern Name]
**Evidence:** [quoted issues that show this pattern]
**Suggested change:** [exact text to add/modify/remove in system.txt]

### 2. ...

## Feedback Insights
[Are recommended spots rated well? Any concern?]

## Recommendation Diversity
[Is Sam recommending the same spots to everyone? Suggestions?]

## Summary
[One paragraph: overall health and top priority change]`;
}

// ── Output Formatting ──

function scoreBar(score: number): string {
  const filled = "█".repeat(Math.round(score));
  const empty = "░".repeat(5 - Math.round(score));
  return `${filled}${empty} ${score.toFixed(1)}`;
}

// ── Main ──

async function main() {
  const limit = parseInt(process.argv[2] || "20", 10);
  console.log(`\n🔍 Sam Self-Coach — analyzing ${limit} recent conversations\n`);

  // Fetch data
  console.log("Fetching data from Supabase...");
  const [conversations, feedback, recEvents] = await Promise.all([
    fetchRecentConversations(limit),
    fetchRecentFeedback(),
    fetchRecommendationEvents(),
  ]);

  console.log(`  ${conversations.length} conversations (4+ messages)`);
  console.log(`  ${feedback.length} feedback entries`);
  console.log(`  ${recEvents.length} recommendation events\n`);

  if (conversations.length === 0) {
    console.log("No conversations with 4+ messages found. Nothing to coach on.");
    return;
  }

  // Load prompts
  const systemPrompt = loadPrompt("system").replaceAll("{{CITY}}", "Kuala Lumpur");
  const coachPrompt = loadPrompt("coach");

  // Phase 1: Evaluate each conversation
  console.log("Phase 1: Evaluating individual conversations...\n");
  const evals: ConversationEval[] = [];

  for (let i = 0; i < conversations.length; i++) {
    const convo = conversations[i];
    const msgCount = convo.messages.length;
    process.stdout.write(`  [${i + 1}/${conversations.length}] ${msgCount} messages... `);

    try {
      const evaluation = await evaluateConversation(systemPrompt, coachPrompt, convo);
      evals.push(evaluation);
      const avg = Object.values(evaluation.scores).reduce((a, b) => a + b, 0) / 6;
      console.log(`${avg.toFixed(1)}/5 — ${evaluation.summary}`);
    } catch (err) {
      console.log(`FAILED — ${err instanceof Error ? err.message : err}`);
    }
  }

  if (evals.length === 0) {
    console.log("\nAll evaluations failed. Check API key and try again.");
    return;
  }

  // Score summary
  const criteria = ["brevity", "personality", "operational_detail", "helpfulness", "tone_matching", "honesty"] as const;
  console.log(`\n${"─".repeat(50)}`);
  console.log("Score Averages\n");
  for (const c of criteria) {
    const scores = evals.map((e) => e.scores[c]);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    console.log(`  ${c.padEnd(20)} ${scoreBar(avg)}`);
  }

  // Phase 2: Synthesize and suggest
  console.log(`\n${"─".repeat(50)}`);
  console.log("Phase 2: Synthesizing patterns & generating suggestions...\n");

  const aggregationPrompt = buildAggregationPrompt(evals, feedback, recEvents, systemPrompt);
  const synthesis = await chat(
    "You are a coaching analyst. Be specific and actionable.",
    [{ role: "user", content: aggregationPrompt }],
    { model: SONNET, maxTokens: 2048, temperature: 0.4 }
  );

  console.log(synthesis);
  console.log(`\n${"─".repeat(50)}`);
  console.log(`Done. Evaluated ${evals.length} conversations using Sonnet.`);
  console.log("To validate prompt changes: npm run eval -- system\n");
}

main().catch((err) => {
  console.error("Coach failed:", err);
  process.exit(1);
});
