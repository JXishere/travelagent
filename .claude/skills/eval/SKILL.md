---
description: Run scenario evaluation suite against Sam's live web endpoint
argument: Optional filter (e.g. "--intent hungry", "--scenario birthday_dinner", "--fast")
allowed-tools: Bash
---

# /eval — Run Scenario Evaluations

Run Sam's scenario eval suite to catch regressions in intent routing, response quality, and hallucination.

## Requirements

`npm run dev:web` must be running on :3001. The eval sends real messages to the live endpoint.

## Input

Arguments: `$ARGUMENTS`

## Process

### 1. Health Check

Verify the web server is up before running:
```bash
curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:3001
```

If the response is not 2xx or 3xx, stop and tell the user to run `npm run dev:web` first.

### 2. Run Eval

```bash
npm run eval -- $ARGUMENTS
```

This runs `scripts/scenario-eval.ts` which:
- Loops through scenarios defined in `scripts/conversation-scenarios.ts`
- Sends messages to `http://localhost:3001/api/chat`
- Uses Claude Sonnet as an LLM judge to score routing, quality, and hallucination (unless `--fast`)
- Prints pass/fail/warn per scenario with reasoning

### 3. Parse Results

After the run, summarize in a table:
- Group by intent
- Total pass / fail / warn per intent and overall

```
Intent         Scenarios   Pass   Fail   Warn
─────────────────────────────────────────────
hungry         8           7      1      0
profile        5           5      0      0
contribute     6           5      0      1
strategic      4           4      0      0
─────────────────────────────────────────────
Total          23          21     1      1
```

For `--fast` mode: just show the raw Sam responses with the scenario name.

### 4. On Failures

If failures are found:
- List each failing scenario with the judge's reasoning
- Identify the intent bucket (hungry / profile / contribute / strategic / ontrip)
- Offer to open the relevant file for fixing:

**Handler files (routing + logic issues):**
- `hungry` / `nearby` → `packages/bot/src/handlers/query.ts`
- `day_plan` → `packages/bot/src/handlers/ontrip.ts`
- `profile` → `packages/bot/src/handlers/profile.ts`
- `contribute` → `packages/bot/src/handlers/contribution.ts`
- `strategic` → `packages/bot/src/handlers/strategic.ts`
- `feedback` → `packages/bot/src/handlers/feedback.ts`

**Prompt files (quality / tone / format issues):**
- `packages/bot/src/prompts/system.txt` — personality, format, core rules
- `packages/bot/src/prompts/strategic.txt` — planning format
- `packages/bot/src/prompts/proactive.txt` — proactive message tone
- `packages/bot/src/prompts/generate.txt` — spot content generation

Suggest using `/tune-prompt <name>` for iterative prompt fixes.

## Scenario Source

Scenarios live in `scripts/conversation-scenarios.ts`. Each has:
- `id` — unique slug
- `intent` — expected routing target
- `messages` — conversation turns to send
- `expect` — what the judge checks (e.g. "mentions at least one spot name", "no hallucinated details")

To add a new scenario for a failing edge case, edit that file directly.
