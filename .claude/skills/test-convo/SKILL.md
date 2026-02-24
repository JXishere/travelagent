---
description: Send real messages to Sam via the web chat API, analyze responses, and fix issues
argument: Test scenario or message (e.g. "hungry near Bangsar", "birthday dinner japanese food", "multi-turn profile then food request")
context: fork
agent: general-purpose
allowed-tools: Read, Grep, Glob, Bash, Edit, Write
---

# /test-convo — Live Conversation Testing with Sam

You test Sam by sending real messages to the web chat API, analyzing his responses, and fixing any issues you find.

## Input

Test scenario: `$ARGUMENTS`

## Prerequisites

The Next.js dev server must be running on port 3001. Check first:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001 2>/dev/null
```

If it's not running (non-200), tell the user to run `npm run dev:web` in another terminal and stop.

## How to Talk to Sam

Send messages using curl. Each conversation needs a unique `sessionId`.

```bash
# Generate a session ID
SESSION_ID="test-$(date +%s)"

# Send a message and parse the SSE response
curl -s -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\": \"$SESSION_ID\", \"message\": \"your message here\"}" | \
  sed -n 's/^data: //p' | \
  grep -v '^\[DONE\]' | \
  python3 -c "import sys,json; [print(json.loads(l).get('text',''),end='') for l in sys.stdin if l.strip()]"
```

For multi-turn conversations, reuse the same `SESSION_ID` across messages.

## Process

### 1. Design Test Messages

Based on the scenario `$ARGUMENTS`, design 2-5 test messages that probe Sam's behavior. Include:
- The primary scenario the user described
- An edge case variant (e.g. ambiguous intent, follow-up question)
- A regression check (e.g. pure profile message should still work)

If no specific scenario is given, run these default tests:

**Group A — Basic routing (regression)**
1. "i need a place to go for my birthday. thinking some place chill. i wanna grab some japanese food with my close friend"
2. (follow-up in same session) "maybe around PJ or KL"
3. (new session) "I'm planning a trip to KL next week" — should start profile, not food recs
4. (new session) "where's good for ramen near bangsar?"
5. (new session) "I know a great spot in TTDI" — should start contribution flow

**Group B — Flow escape hatches (multi-turn)**

Test B1 — contribution confirming escape (2-turn, same session):
- Turn 1: "I want to add a spot — Guan Heong in Pudu, amazing bak kut teh, cash only, opens at 7am" → Sam should enter contribution collecting/confirming stage
- Turn 2 (same session): "Actually, what's good for dinner in Bangsar?" → **must NOT treat this as a spot correction**; Sam should escape the contribution flow and return dinner recommendations

Test B2 — query_clarifying pivot (2-turn, same session):
- Turn 1: "food" (vague, should trigger clarifying question)
- Turn 2 (same session): "actually what's on this weekend?" → **must NOT call handleHungry**; Sam should route to happenings/events

Test B3 — contribution flow stays intact for legit follow-ups (2-turn, same session):
- Turn 1: "I want to add a spot — Fatty Crab in Taman Megah, best crab curry, dinner only" → Sam enters contribution flow
- Turn 2 (same session): "It's cash only and closes at midnight" → **must stay in contribution flow** and accept this as additional spot detail, not escape

For Group B tests, in your analysis note the **flow state behavior** specifically:
- Did the flow escape when it should? (B1, B2)
- Did the flow stay when it should? (B3)
- Was the response appropriate for the new intent after escaping?

### 2. Send Messages and Collect Responses

For each test message:
1. Send it to Sam via the API
2. Capture Sam's full response
3. Note the response time

### 3. Analyze Each Response

For each response, evaluate:

**Intent correctness**: Did Sam understand what the user wanted?
- Food request → got food recommendations (not profile questions)?
- Profile info → started profile learning (not food recs)?
- Contribution → started collecting spot info?

**Data quality**: Did Sam use real database data?
- Are spot names real (from the DB)?
- Are operational details included (what to order, tips, area)?
- Did Sam fabricate any spots?

**Conversation quality**:
- Is the response concise and natural?
- Does Sam sound like a friend, not a search engine?
- For WhatsApp: would this fit on a phone screen?

**Flow continuity**: For multi-turn conversations:
- Does Sam remember context from previous messages?
- Do follow-up answers (like area preferences) get handled correctly?

**Flow escape** (Group B tests only):
- When the user pivots mid-flow, does Sam break out correctly?
- Is `current_flow` reset? (verify by checking if the *next* message routes cleanly to general)
- For B3: does Sam correctly stay in the flow for a legit follow-up?

### 4. Report Findings

Output a clear report for each message:

```
## Test: [message]
Session: [session_id]

### Sam's Response
[full response text]

### Analysis
- Intent: [correct/incorrect — what was expected vs what happened]
- Data: [real spots / fabricated / no data]
- Quality: [good / issues noted]
- Flow: [correct routing / wrong handler]

### Verdict: PASS / FAIL / WARN
[one-line summary of why]
```

### 5. Fix Issues

If any tests FAIL:
1. Read the relevant code files to understand the root cause
2. Identify the specific file and function that needs fixing
3. Make the fix (edit the code)
4. Re-run the failing test to verify the fix
5. Run `npm test` to check for regressions

Common issues and where to fix them:
- **Wrong intent**: `packages/bot/src/llm.ts` → `classifyIntent()` prompt
- **Missing spots**: `packages/bot/src/handlers/ontrip.ts` → query logic, or `packages/bot/src/database.ts` → `querySpots()`
- **Bad response tone**: `packages/bot/src/prompts/system.txt`
- **Profile trap**: `packages/bot/src/handlers/profile.ts` → `startProfileLearning()` guard
- **Wrong city mapping**: `packages/bot/src/prompts/extraction.txt` → area-to-city mapping
- **Flow not escaping** (B1/B2 fail): `packages/bot/src/index.ts` → `routeToCurrentFlow()` escape hatch for the relevant case
- **Flow escaping when it shouldn't** (B3 fail): `packages/bot/src/index.ts` → check `escapeIntents` list or stage guard logic for `contribution` case

After fixing, re-run the full test suite to confirm no regressions:
```bash
npm test
```

### 6. Summary

End with an overall summary:
```
## Summary
- Tests run: X
- Passed: X
- Failed: X
- Fixed: X

### Changes Made
- [file]: [what was changed and why]
```
