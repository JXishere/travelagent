# MVP Execution Plan
**Travel Intelligence Service - 6-Week Build**

---

## MVP Scope

### What We're Building
A WhatsApp-based travel intelligence service that delivers:
1. **Pre-trip** (80% focus): Conversational profile learning → personalized tiered dossier
2. **On-trip** (20% focus): Weather-aware replanning + basic context adaptation
3. **Post-trip**: Feedback loop for knowledge validation

### What Success Looks Like
- 100-200 spots with operational depth for one city
- Contribution flow easy enough to use daily
- Dossier quality noticeably better than Google/Layla
- 70%+ of test travelers would pay for this
- Knowledge stays fresh through feedback loop

---

## Technical Stack

### Core Infrastructure
| Component | Technology | Why |
|-----------|-----------|-----|
| **Messaging Interface** | WhatsApp Business API (Twilio or Meta Cloud API) | Zero friction, 2B+ users, rich media support |
| **Database** | Supabase (Postgres + APIs) | Managed Postgres, real-time subscriptions, easy setup |
| **LLM Layer** | Claude 3.5 Sonnet via API | Strong conversation, personality, reasoning |
| **Voice Transcription** | OpenAI Whisper API | Best-in-class speech-to-text |
| **Weather Data** | OpenWeather API (free tier) | Simple, reliable, covers all cities |
| **Hosting** | Vercel or Railway | Serverless, auto-scaling, easy deploys |

### Architecture Overview
```
┌─────────────┐
│  WhatsApp   │ ← User sends message
└──────┬──────┘
       │
       ↓
┌─────────────────────────────────┐
│  Message Handler (Webhook)      │
│  - Routes to appropriate flow   │
│  - Manages conversation state   │
└──────┬──────────────────────────┘
       │
       ↓
┌─────────────────────────────────┐
│  Core Flows                     │
│  1. Contribution Flow           │
│  2. Query Flow                  │
│  3. Profile Learning Flow       │
│  4. Dossier Generation Flow     │
│  5. On-Trip Adaptation Flow     │
└──────┬──────────────────────────┘
       │
       ↓
┌──────────────────┬──────────────┐
│  Knowledge Graph │   LLM API    │
│  (Supabase)      │   (Claude)   │
└──────────────────┴──────────────┘
```

---

## Week-by-Week Build Plan

### **Week 1-2: Foundation + Contribution/Query Flows**

#### Goals
- Set up infrastructure
- Build contribution flow (voice note → structured data)
- Build query flow (question → retrieve + respond)
- Dogfood it: Add 20-30 spots ourselves

#### Deliverables

**Day 1-2: Infrastructure Setup**
- [ ] Set up Supabase project
- [ ] Set up WhatsApp Business API (choose Twilio or Meta)
- [ ] Create webhook endpoint (Node.js/Python)
- [ ] Test: Can receive/send WhatsApp messages

**Day 3-4: Database Schema**

**Tables**:

1. **`spots`** - The knowledge graph
```sql
CREATE TABLE spots (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  neighborhood TEXT,
  category TEXT, -- breakfast, lunch, dinner, activity, etc
  tier INTEGER, -- 1 (must-do), 2 (should-do), 3 (nice-to-have)

  -- Operational Intelligence
  address TEXT,
  correct_lat DECIMAL,
  correct_lng DECIMAL,
  google_pin_accurate BOOLEAN,
  payment_methods TEXT[], -- cash, card, etc
  opening_hours JSONB,

  -- Ordering/Experience Intelligence
  what_to_order TEXT[],
  what_to_skip TEXT[],
  pro_tips TEXT[],
  vibe TEXT, -- casual, upscale, chaotic, chill, etc

  -- Metadata
  created_at TIMESTAMP,
  last_verified TIMESTAMP,
  confidence_score DECIMAL, -- 0-1
  contributor_id UUID,
  use_count INTEGER DEFAULT 0,

  -- Context flags
  weather_dependent BOOLEAN,
  best_time_of_day TEXT,
  indoor_outdoor TEXT
);
```

2. **`contributors`** - Who added knowledge
```sql
CREATE TABLE contributors (
  id UUID PRIMARY KEY,
  whatsapp_number TEXT UNIQUE,
  name TEXT,
  cities_contributed TEXT[],
  spots_contributed INTEGER DEFAULT 0,
  created_at TIMESTAMP
);
```

3. **`travelers`** - User profiles
```sql
CREATE TABLE travelers (
  id UUID PRIMARY KEY,
  whatsapp_number TEXT UNIQUE,
  name TEXT,

  -- Preferences (learned over time)
  preferences JSONB, -- {budget: 'mid', pace: 'moderate', interests: ['food', 'culture']}
  dietary_restrictions TEXT[],

  -- Trip history
  trips_taken INTEGER DEFAULT 0,
  created_at TIMESTAMP
);
```

4. **`conversations`** - State management
```sql
CREATE TABLE conversations (
  id UUID PRIMARY KEY,
  whatsapp_number TEXT,
  current_flow TEXT, -- contribution, query, profile_learning, etc
  state JSONB, -- store conversation context
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

5. **`feedback`** - Post-trip validation
```sql
CREATE TABLE feedback (
  id UUID PRIMARY KEY,
  spot_id UUID REFERENCES spots(id),
  traveler_id UUID REFERENCES travelers(id),
  rating INTEGER, -- 1-5
  did_they_go BOOLEAN,
  comments TEXT,
  created_at TIMESTAMP
);
```

**Day 5-7: Contribution Flow**

```
User → "I want to add a spot"
Bot → "Great! Send me a voice note describing it"
User → [Voice note about Bangkok cafe]
Bot → Transcribes via Whisper
Bot → Sends to Claude with prompt:
      "Extract structured data from this description.
       Return JSON with: name, category, address, payment_methods,
       what_to_order, pro_tips, vibe, etc."
Bot → Asks clarifying questions for missing fields
Bot → Saves to `spots` table
Bot → "Added! You've contributed X spots to Bangkok"
```

**Implementation**:
- [ ] Voice message webhook handler
- [ ] Whisper API integration
- [ ] Claude prompt for data extraction
- [ ] Clarifying question logic
- [ ] Save to database

**Day 8-10: Query Flow**

```
User → "I'm hungry in Bangkok, Chinatown area"
Bot → Parses intent (meal type, location, time of day)
Bot → Queries database:
      SELECT * FROM spots
      WHERE city = 'Bangkok'
      AND neighborhood = 'Chinatown'
      AND category IN ('breakfast', 'lunch', 'brunch')
      ORDER BY tier ASC, confidence_score DESC
      LIMIT 3
Bot → Formats results with operational intel
Bot → Sends to user with correct pins, tips
```

**Implementation**:
- [ ] Intent parsing (use Claude to extract: city, neighborhood, meal type, vibe)
- [ ] Database query builder
- [ ] Response formatter (include all operational details)
- [ ] Send map pin, photos if available

**Day 11-14: Dogfooding**
- [ ] Each founder adds 10-15 spots for a city they know
- [ ] Test contribution flow: Is it easy? What's missing?
- [ ] Test query flow: Are responses useful?
- [ ] Refine schema based on what data matters most
- [ ] Target: 20-30 spots with real operational depth

**Week 1-2 Success Criteria**:
- ✅ Can contribute spots via voice note in <2 minutes
- ✅ Structured data captures operational intelligence
- ✅ Query flow returns relevant spots with full details
- ✅ 20-30 real spots in database

---

### **Week 3-4: Profile Learning + Dossier Generation**

#### Goals
- Build conversational profile learning (infer preferences)
- Generate personalized tiered dossier from knowledge graph
- Expand knowledge graph to 50-100 spots via 10-20 friends

#### Deliverables

**Day 15-17: Profile Learning Flow**

```
User → "I'm planning a trip to Bangkok"
Bot → Starts conversational interview:
      "Nice! When are you going?"
      "Who's traveling with you?"
      "Tell me what you care about most - food, culture, nightlife?"
      "How would you describe your pace - packed schedule or chill?"

      [Natural back-and-forth, Claude infers preferences]

Bot → Extracts profile:
      {
        city: 'Bangkok',
        dates: '2026-03-15 to 2026-03-19',
        travelers: 2 (couple),
        interests: ['food', 'culture'],
        budget: 'mid',
        pace: 'moderate',
        dietary: [],
        first_time: true
      }
Bot → Saves to `travelers` table
Bot → "Got it. Let me put together your Bangkok guide..."
```

**Implementation**:
- [ ] Conversational interview prompt (Claude-powered)
- [ ] Profile extraction logic (Claude returns structured JSON)
- [ ] Save profile to database
- [ ] Handle edge cases (group travel, returning visitors)

**Day 18-21: Dossier Generation**

**Algorithm**:
1. Load traveler profile
2. Query knowledge graph with filters:
   - City = their city
   - Category matches interests
   - Budget tier matches budget level
   - Indoor/outdoor based on trip dates (weather)
3. Organize by tier (must/should/nice-to-have)
4. Within each tier, organize by: meal type, neighborhood, activity type
5. Format as text-based dossier with rich operational details

**Dossier Template**:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BANGKOK - YOUR PERSONAL GUIDE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Based on your profile:
• 4 days in Bangkok (Mar 15-19)
• Traveling as a couple
• Love: Food & culture
• Budget: Moderate
• Pace: Not rushed, not slow

━━━ TIER 1: CAN'T MISS ━━━

🍜 Jay Fai - The Michelin Street Food Legend
   📍 Correct pin: [link] (Google Maps shows wrong location!)
   💰 $$$ (~800-1200 THB per person)
   🕐 9am-2pm daily (closed Sundays)
   💳 Cash only - ATM 50m away on Maha Chai Rd
   🎯 Order: Crab omelet (signature, 30min wait, absolutely worth it)
   ⚠️  Tip: Go at 9am opening or after 1pm to avoid peak crowds
   🌦  Indoor seating (safe if raining)

[4-5 more Tier 1 spots with same depth]

━━━ TIER 2: SHOULD DO ━━━

🍳 BREAKFAST (organized by area)
• [3-4 spots with operational intel]

🍛 LUNCH & DINNER
• [5-6 spots organized by neighborhood]

🏛 ACTIVITIES & CULTURE
• [3-4 spots with timing/weather notes]

━━━ TIER 3: GOOD TO KNOW ━━━

🔄 WEATHER BACKUPS (if it rains)
• [Indoor options]

🕐 TIME FILLERS (got 2 hours to kill?)
• [Quick activities by area]

💎 HIDDEN GEMS (off the beaten path)
• [Local favorites, less touristy]

━━━ SUGGESTED FLOW ━━━

Day 1 (Mar 15): Chinatown Immersion
Morning: Arrive, settle in, breakfast at [spot]
Afternoon: Walk Yaowarat Road, Wat Traimit
Evening: Dinner at Jay Fai or [backup]

Day 2: Riverside & Temples
[Suggested flow based on knowledge graph]

Day 3-4: [Continue...]

━━━ IMPORTANT NOTES ━━━

🌦 Weather: March is hot (35°C), occasional rain
💰 Cash: Keep 2000-3000 THB on hand
🚕 Getting around: Grab is cheap and reliable
📱 Let me know on-trip if you need adjustments!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Implementation**:
- [ ] Dossier generation logic (filter + organize spots)
- [ ] Text formatter (clean, scannable, rich details)
- [ ] Send as WhatsApp message (might be multiple messages if long)
- [ ] Include map pins as separate messages

**Day 22-28: Knowledge Graph Expansion**
- [ ] Recruit 10-20 travel-loving friends
- [ ] Each contributes 3-5 spots for cities they know
- [ ] Founders manually verify quality
- [ ] Target: 50-100 spots total across 1-2 cities

**Week 3-4 Success Criteria**:
- ✅ Profile learning feels natural (not interrogation)
- ✅ Dossier has 20-40 curated spots with operational depth
- ✅ Organized clearly (tier + type + neighborhood)
- ✅ Knowledge quality noticeably better than what Google/Layla would give
- ✅ 50-100 spots in knowledge graph from multiple contributors

---

### **Week 5-6: On-Trip Adaptation + Feedback Loop**

#### Goals
- Add weather awareness (context-aware recommendations)
- Simple replanning based on user state (tired, nearby, etc)
- Post-trip feedback collection
- Polish for external testing

#### Deliverables

**Day 29-31: Weather Integration**

```
User (on-trip) → "It's raining, what should we do?"
Bot → Checks weather API for Bangkok
Bot → Filters knowledge graph:
      WHERE city = 'Bangkok'
      AND (indoor_outdoor = 'indoor' OR weather_dependent = false)
      ORDER BY distance_from_user ASC
Bot → "It's pouring! Here are great indoor options nearby:
       1. [Covered market with operational intel]
       2. [Mall with food court - specific stalls to try]
       3. [Indoor temple with details]"
```

**Implementation**:
- [ ] OpenWeather API integration
- [ ] Add weather check to query logic
- [ ] Filter spots by indoor/outdoor
- [ ] Proactive weather warnings ("Rain in 2 hours, plan accordingly")

**Day 32-34: Simple Replanning**

**Scenarios to handle**:

1. **"We're tired, need something nearby and chill"**
   - Filter by: distance < 1km, vibe = 'chill', lower energy activities

2. **"We're in Chinatown, what's close?"**
   - Filter by: neighborhood = detected from user's GPS or stated location

3. **"That place was too touristy, give us something more local"**
   - Filter by: tier 3 (hidden gems), update traveler preferences

4. **"We loved that hawker center, more like that?"**
   - Semantic similarity search (vibe, category, price point)
   - Learn preference: increase weight for similar spots

**Implementation**:
- [ ] Intent detection (tired, nearby, similar to X, etc)
- [ ] Dynamic filtering based on intent
- [ ] Simple preference learning (save "loved hawker centers" to profile)
- [ ] Location awareness (ask user or infer from conversation)

**Day 35-37: Feedback Loop**

```
Bot (proactively after 1 day) → "Hey! Did you make it to Jay Fai?"
User → "Yes! It was amazing"
Bot → "Awesome! Quick rating 1-5?"
User → "5"
Bot → "Any tips for future travelers?"
User → "Go early, the line gets crazy"

[Bot saves feedback]
- Updates spot confidence_score (used feedback → higher confidence)
- Adds user's tip to spot's pro_tips array
- Marks last_verified = today
```

**Implementation**:
- [ ] Proactive follow-up logic (after trip day 1, before they leave)
- [ ] Feedback collection flow
- [ ] Update spot confidence_score based on ratings
- [ ] Append user tips to knowledge graph

**Day 38-42: Polish + Edge Cases**
- [ ] Handle "I don't know" responses gracefully
- [ ] Add help command ("What can you do?")
- [ ] Error handling (API failures, database issues)
- [ ] Rate limiting (avoid spam)
- [ ] Personality refinement (conversational tone, not robotic)
- [ ] Test all flows end-to-end

**Week 5-6 Success Criteria**:
- ✅ Weather-aware recommendations work
- ✅ Simple replanning feels useful (not gimmicky)
- ✅ Feedback loop captures quality + freshness
- ✅ System handles edge cases gracefully
- ✅ Ready for external testing

---

## Week 7-10: External Testing

### Test Group
- 20-30 friends planning trips
- Mix of: solo travelers, couples, different interests
- Cities where we have knowledge graph coverage

### What We Give Them
1. **Pre-trip**: Conversational profile learning → personalized dossier
2. **On-trip**: "Text me if you need help adjusting the plan"
3. **Post-trip**: "How was it?" feedback collection

### What We Measure

| Metric | Target | What It Tells Us |
|--------|--------|------------------|
| Dossier quality | 70%+ say "noticeably better than Google/Layla" | Is quality differentiated enough? |
| On-trip engagement | 50%+ text during trip | Is on-trip value real or just nice-to-have? |
| Follow-through | 60%+ visited recommended spots | Do they trust our recommendations? |
| Willingness to pay | 50%+ would pay ~$7 for this | Is this valuable enough to monetize? |
| Contribution willingness | 30%+ share spots back | Does post-trip contribution loop work? |

### What We Learn
- Which knowledge depth matters most? (payment methods? ordering tips? vibe?)
- What's missing from the dossier?
- When do travelers engage on-trip? (weather changes? need help? or proactive check-ins?)
- What kills the experience? (wrong info? overwhelming? confusing?)
- Would they use this again for next trip?

---

## Post-MVP: What's Next?

### If MVP Validates (70%+ metrics hit)

**Phase 2 Priorities**:
1. **Expand cities** (2-3 more cities, test replication)
2. **Deeper behavioral learning** (track patterns, infer taste over multiple trips)
3. **Group travel features** (leader coordination tools)
4. **Monetization** (payment flow, subscription model)
5. **Proactive orchestration** (Grab deep-links, flight tracking, calendar)

### If MVP Fails (<50% metrics)

**Pivot considerations**:
- Is the knowledge quality not differentiated enough? (Fix: higher contributor bar, more depth)
- Is the dossier format wrong? (Fix: iterate on format, maybe more visual)
- Is pre-trip too early in journey? (Pivot: focus pure on-trip with no planning)
- Are we solving the wrong problem? (Re-interview travelers, find real pain point)

**The goal of MVP is to learn fast and fail fast if needed. Better to know now than after building for 6 months.**

---

## Technical Implementation Notes

### Environment Setup
```bash
# Required accounts
- Supabase account (free tier)
- Twilio account (WhatsApp Business API) OR Meta Cloud API
- OpenAI account (Whisper API)
- Anthropic account (Claude API)
- OpenWeather account (free tier)

# Environment variables
WHATSAPP_API_KEY=...
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
CLAUDE_API_KEY=...
OPENAI_API_KEY=...
OPENWEATHER_API_KEY=...
```

### Code Structure (Suggested)
```
/travel-intel-bot
├── /src
│   ├── /handlers
│   │   ├── webhook.js          # WhatsApp webhook entry
│   │   ├── contribution.js     # Contribution flow logic
│   │   ├── query.js            # Query flow logic
│   │   ├── profile.js          # Profile learning logic
│   │   └── dossier.js          # Dossier generation logic
│   ├── /services
│   │   ├── whatsapp.js         # WhatsApp API wrapper
│   │   ├── database.js         # Supabase queries
│   │   ├── llm.js              # Claude API wrapper
│   │   ├── transcription.js    # Whisper API wrapper
│   │   └── weather.js          # OpenWeather API wrapper
│   ├── /prompts
│   │   ├── extraction.txt      # Prompt for data extraction
│   │   ├── profile.txt         # Prompt for profile learning
│   │   └── dossier.txt         # Prompt for dossier formatting
│   └── /utils
│       ├── formatting.js       # Text formatting helpers
│       └── distance.js         # Geographic distance calc
├── package.json
├── .env
└── README.md
```

### Key Technical Decisions

**Why Supabase over raw Postgres?**
- Built-in APIs (no need to write CRUD endpoints)
- Real-time subscriptions (useful for multi-user later)
- Auth built-in (for dashboard later)
- Generous free tier

**Why Claude over GPT-4?**
- Better at following instructions for structured output
- Longer context window (useful for dossier generation)
- More natural conversation tone

**Why WhatsApp over Telegram/SMS?**
- 2B+ users, dominant in SEA/Europe
- Rich media support (voice notes, location pins, images)
- Business API is mature

**Why voice notes over forms?**
- Friction matters: 90-second voice note vs 10-minute form
- Captures nuance (tone, enthusiasm, caveats)
- Matches existing behavior (people already voice note friends about travel)

---

## Cost Estimates (MVP Phase)

| Service | Cost | Notes |
|---------|------|-------|
| Supabase | $0 | Free tier (500MB database, 2GB bandwidth) |
| Twilio WhatsApp API | ~$50-100 | Pay per message (~$0.005/message) |
| Claude API | ~$20-50 | Pay per token (~$3/million tokens) |
| Whisper API | ~$10-20 | $0.006/minute of audio |
| OpenWeather API | $0 | Free tier (60 calls/min) |
| Hosting (Vercel) | $0 | Free tier |
| **Total MVP cost** | **~$80-170** | For 6-week build + 30 testers |

**Incredibly capital-efficient compared to original docs ($5-8K estimate).**

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Voice transcription errors | Add manual correction step, let contributors edit |
| LLM hallucination | Use structured prompts, validate outputs, never generate recommendations (only format what's in DB) |
| WhatsApp API downtime | Build on both Twilio AND Meta (can switch) |
| Knowledge graph too small | Start with just 1-2 cities, don't spread thin |
| Contributors don't share | Make it RIDICULOUSLY easy (voice note, done) |
| Travelers don't engage on-trip | Make pre-trip value strong enough that on-trip is bonus |

---

## Success Definition

**By end of Week 10, we should know**:
1. Can we build a knowledge graph with real operational depth via contributions?
2. Is the quality noticeably better than Google/Layla?
3. Do travelers engage pre-trip AND on-trip?
4. Would they pay for this?
5. What's the next most important thing to build?

**If we can answer YES to #1-4, we have product-market fit for MVP. Then we scale.**

---

*Last updated: February 2026*
