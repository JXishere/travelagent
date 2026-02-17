# Next Improvements to Revisit

## 1. Better Retrieval (Semantic Search)

**Problem**: SQL filters + `ORDER BY confidence_score` works at 27 spots but breaks down as the graph grows. A user saying "somewhere chill for a rainy afternoon" won't match if no spot has `vibe = 'chill'` and `indoor_outdoor = 'indoor'` exactly.

**When to act**: 200+ spots, or when users regularly get "I don't have intel on that" despite relevant spots existing in the DB.

**Approach**:
- Embed each spot as a single text blob (name + vibe + tips + what_to_order + neighborhood) using an embedding model
- Store vectors in Supabase pgvector (already supported, just needs the extension enabled)
- On query: embed the user message, vector search for top-N candidates, then pass those to Claude for final ranking and response
- Keep the existing SQL path as a fast filter for explicit queries ("breakfast in Bangsar") — use semantic search as a fallback or supplement when filters return few results

**What to figure out**:
- Embedding model choice (OpenAI `text-embedding-3-small` is cheap and good enough)
- Hybrid ranking: how to blend vector similarity with confidence_score and tier
- When to re-embed (on spot update? nightly?)
- Cost per query — embedding calls add latency and spend

## 2. Prompt Tuning

**Problem**: Paul's quality ceiling is set by prompts. Right now they're written from intuition. Real conversation logs will reveal gaps — where Paul sounds generic, misreads intent, over-explains, or misses the vibe.

**When to act**: Now. This is free and compounds with every iteration.

**Approach**:
- Pull real conversation logs from the `conversations` table
- Identify failure patterns:
  - Paul recommended the right spot but buried the key detail
  - Paul sounded the same for a backpacker and a business traveler
  - Paul gave a wall of text when a one-liner would do
  - Paul's tone didn't match the trust stack label
- Iterate on `system.txt` and handler-specific prompts with concrete before/after examples
- Use the `tune-prompt` skill to test changes against real scenarios before shipping

**What to focus on first**:
- `system.txt` — personality baseline, biggest leverage
- `query.ts` prompt construction — how spot data is framed affects Claude's output more than the system prompt
- `strategic.txt` — trip planning is the highest-effort response Paul gives, most room for improvement

**Metrics to watch**:
- Response length (shorter is usually better on WhatsApp)
- Did the user follow the recommendation? (feedback table)
- Did the user ask a clarifying question right after? (sign Paul wasn't clear enough)
