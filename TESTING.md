# TESTING.md — Testing Guide

Sam has three testing layers: **unit tests** (Vitest), **eval scenarios** (LLM judge), and **coach analysis** (conversation review). This guide covers all three.

---

## 1. Unit Tests (Vitest)

```bash
npm test                          # Run once
npm run test:watch -w @sam/bot    # Watch mode
```

Tests live in `packages/bot/src/` alongside source files, named `*.test.ts`. Current coverage includes utility functions and intent classification edge cases.

**Writing a unit test**:

```typescript
// packages/bot/src/utils/geo.test.ts
import { describe, it, expect } from "vitest";
import { haversineDistance } from "./geo.js";

describe("haversineDistance", () => {
  it("returns 0 for same point", () => {
    expect(haversineDistance(3.139, 101.687, 3.139, 101.687)).toBe(0);
  });
});
```

Unit tests run in CI and should pass before every deploy.

---

## 2. Eval Scenarios

The eval suite tests Sam end-to-end by sending real messages to the live web API and scoring responses with an LLM judge.

### Running evals

```bash
# Start web server first (required)
npm run dev:web

# Run all scenarios
npm run eval

# Filter by intent
npm run eval -- --intent hungry

# Run a specific scenario by ID
npm run eval -- --scenario birthday_dinner

# Fast mode: skip LLM judge, show raw responses
npm run eval -- --fast
```

Or use the `/eval` skill for a formatted summary table.

### How it works

1. **Scenarios** are defined in `scripts/conversation-scenarios.ts`. Each scenario has:
   - `id` — unique slug
   - `intent` — expected routing target
   - `messages` — one or more conversation turns
   - `expect` — natural language description of what the judge checks

2. **Runner** (`scripts/scenario-eval.ts`) sends messages to `POST http://localhost:3001/api/chat` with a test session ID and collects Sam's responses.

3. **Judge** (Claude Sonnet) evaluates each response against the `expect` criteria and returns `pass` / `fail` / `warn` with reasoning.

### Adding a scenario

Edit `scripts/conversation-scenarios.ts`:

```typescript
{
  id: "ramen_bangsar",
  intent: "hungry",
  messages: [
    { role: "user", content: "where's good for ramen near Bangsar?" }
  ],
  expect: "mentions at least one specific ramen spot by name, includes what to order or a pro tip, no fabricated details",
},
```

**Scenario writing tips:**
- `expect` should be specific enough to catch real failures — avoid "gives a good response"
- Multi-turn scenarios: chain multiple `messages` to test context retention
- Add a scenario for every bug that reaches production (regression coverage)

### Prompt-level eval (Vitest-based)

The bot also has a lighter Vitest-based eval runner for testing individual prompts:

```bash
npm run eval -w @sam/bot -- system
npm run eval -w @sam/bot -- extraction
```

This runs `packages/bot/src/eval/eval-runner.ts` against scenarios in `packages/bot/src/eval/scenarios/<prompt-name>.jsonl`.

**JSONL scenario format**:
```json
{"name": "hungry_simple", "input": "I need food", "must_contain": ["spot", "area"], "max_length": 800}
{"name": "no_fabrication", "input": "Is there a ramen place in KL?", "must_not_contain": ["I recommend", "great ramen at"]}
```

**Fields**:
| Field | Type | What it checks |
|---|---|---|
| `name` | string | Scenario identifier |
| `input` | string | User message |
| `context` | string? | Additional system context appended to prompt |
| `must_contain` | string[]? | Strings that must appear in the response |
| `must_not_contain` | string[]? | Strings that must NOT appear |
| `must_match` | string[]? | Regex patterns the response must match |
| `expect_json` | boolean? | Response must be valid JSON |
| `max_length` | number? | Max character count |

---

## 3. Coach Analysis

The coach reviews real conversations and scores them on 6 dimensions. This is the primary feedback loop for prompt improvements.

### Running coach

```bash
npm run coach           # Review last 20 conversations
npm run coach -- 50     # Review last 50 conversations
npm run coach:auto      # Automated: analyze → apply → validate → commit
```

### Coach scores

Each conversation is scored 1–5 on:

| Dimension | What it measures |
|---|---|
| `brevity` | Are responses concise enough for WhatsApp? No walls of text? |
| `personality` | Does Sam sound like a friend, not a search engine? |
| `operational_detail` | Are what_to_order, tips, hours, payment included? |
| `helpfulness` | Did Sam actually solve the user's problem? |
| `tone_matching` | Did Sam match the user's register (casual → casual, etc.)? |
| `honesty` | Did Sam admit when it didn't know vs hallucinating? |

**Score interpretation**:
- 4.5+ — No action needed
- 3.5–4.4 — Review issues; minor prompt tweaks may help
- < 3.5 — Meaningful prompt problem; use `/tune-prompt` to iterate

### Automated coaching (`npm run coach:auto`)

`coach-auto.ts` runs the full loop:
1. Fetch recent conversations
2. Score with `coach.txt` prompt
3. Identify the lowest-scoring prompt
4. Apply improvements (Sonnet writes the new prompt text)
5. Validate: run eval scenarios; if pass rate drops, revert
6. Commit the improved prompt if validation passes

Use with care — this modifies prompt files. Review the diff before accepting.

---

## 4. Live conversation testing

For ad-hoc debugging of a specific flow, use `/test-convo`:

```
/test-convo hungry near Bangsar
/test-convo multi-turn: trip planning then food request
```

Or send directly via curl:

```bash
SESSION_ID="test-$(date +%s)"

curl -s -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\": \"$SESSION_ID\", \"message\": \"hungry near Bangsar\"}" | \
  sed -n 's/^data: //p' | \
  grep -v '^\[DONE\]' | \
  python3 -c "import sys,json; [print(json.loads(l).get('text',''),end='') for l in sys.stdin if l.strip()]"
```

For multi-turn, reuse the same `$SESSION_ID` in subsequent requests.

---

## Testing checklist before a deploy

- [ ] `npm test` passes (unit tests)
- [ ] `npx tsc --noEmit` — no type errors
- [ ] `npm run eval` — pass rate same or better than baseline
- [ ] If prompts changed: `/tune-prompt <name>` to verify the change is an improvement
- [ ] If new intent added: add an eval scenario for it

---

## Common failure modes

| Symptom | Likely cause | Where to fix |
|---|---|---|
| Wrong intent classified | Ambiguous `classifyIntent()` prompt | `packages/bot/src/llm.ts` → `classifyIntent()` |
| Sam fabricates a spot | Prompt doesn't enforce DB-only rule | `packages/bot/src/prompts/system.txt` |
| Response too long | No length constraint in handler | Handler's `maxTokens` + `system.txt` brevity rules |
| Profile trap (always asks profile questions) | `startProfileLearning()` triggering too broadly | `packages/bot/src/handlers/profile.ts` |
| Follow-up context lost | Conversation history not passed to handler | Handler's `recentContext` window |
| Contribution flow stuck | `flow_state` not advancing stage | `packages/bot/src/handlers/contribution.ts` |
