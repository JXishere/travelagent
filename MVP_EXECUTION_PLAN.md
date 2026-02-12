# MVP Execution Plan
**Travel Intelligence Service - 6-Week Build**

---

## MVP Scope

### What We're Building
A WhatsApp-based travel intelligence service that delivers:
1. **Pre-trip** (40% focus): Conversational profile learning → strategic decisions + 3-5 anchor spots
2. **On-trip** (50% focus): Day-by-day conversational guidance (PRIMARY value delivery)
3. **Post-trip** (10% focus): Feedback loop for knowledge validation

**The Message**: "Don't over-plan. I'll guide you when you're there."

**The Model**: We're not an itinerary generator. We're a guide who walks with you.

### What Success Looks Like
- 100-200 spots with operational depth for one city
- Contribution flow easy enough to use daily
- Strategic decisions prove depth without overwhelming
- On-trip engagement: Travelers actively text us for guidance (not just read pre-trip info)
- 70%+ feel "guided throughout trip" (not just given info upfront)
- 50%+ would pay for this
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
│  4. Strategic Decisions Flow    │
│  5. On-Trip Guidance Flow       │
│  6. Feedback Loop Flow          │
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

### **Week 3-4: Profile Learning + Strategic Decisions Generation**

#### Goals
- Build conversational profile learning (infer preferences)
- Generate strategic decisions message (where to stay, what to book, 3-5 anchor spots)
- Build Process Plan + Agreement Plan messaging templates
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

**Day 18-21: Strategic Decisions Generation**

**Algorithm**:
1. Load traveler profile
2. Query knowledge graph with filters:
   - City = their city
   - Category matches interests
   - Budget tier matches budget level
3. Generate strategic decisions:
   - WHERE TO STAY: Best neighborhood + specific hotel/area recommendation with full reasoning
   - WHAT TO BOOK AHEAD: 2-3 spots that fill up (with timing + reservation guidance)
   - ANCHOR SPOTS (3-5 only): Essential experiences with full operational intel
   - WHAT TO EXPECT: Weather, logistics, cultural context, what to prepare
4. End with clear message: "Everything else? I'll guide you when you're there."

**Strategic Decisions Template**:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BANGKOK - YOUR TRIP GUIDE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Based on your profile:
• 4 days in Bangkok (Mar 15-19)
• Traveling as a couple
• Love: Food & culture
• Budget: Moderate
• Pace: Not rushed, not slow

━━━ 📍 WHERE TO STAY ━━━

Stay in Sukhumvit (Soi 11-15 area)

Book [Hotel X] - here's why:
• Walking distance to BTS Nana station (5 min)
• Surrounded by best street food Bangkok has to offer
• Rooftop bar is where locals actually go (not touristy)
• Quiet at night despite central location
• $$$ (~$80-120/night)

Don't stay in Riverside - you'll waste half your trip in taxis.
Don't stay near Khao San - too backpacker-heavy for your vibe.

━━━ 🍽️ WHAT TO BOOK AHEAD ━━━

These fill up 1-2 weeks out. Book NOW:

1. Jay Fai (Michelin street food)
   • Book: 2 weeks ahead via [phone/website]
   • Best for: Dinner Day 2 or 3
   • Budget: ~800-1200 THB per person

2. Paste (Modern Thai fine dining)
   • Book: 1 week ahead via website
   • Best for: Day 3 dinner
   • Budget: ~1500-2000 THB per person

Everything else is walk-in friendly. I'll guide you day-by-day.

━━━ 🎯 YOUR ANCHOR SPOTS ━━━

These 3 spots are essential for Bangkok:

1. 🍜 Jay Fai - The Michelin Street Food Legend
   📍 Correct pin: [link] (Google Maps wrong by 200m!)
   🕐 9am-2pm daily (closed Sundays)
   💳 Cash only - ATM 50m away on Maha Chai Rd
   🎯 Order: Crab omelet (signature, 30min wait, worth it)
   ⚠️ Go at 9am opening or after 1pm to avoid peak
   🌦 Indoor seating (rain-safe)

2. 🛕 Wat Pho + Thai Massage
   📍 Pin: [link] - enter through main gate, not tourist trap side entrance
   🕐 8am-6:30pm, go before 10am to beat crowds
   💳 100 THB entrance + 300 THB for 1hr massage (cash)
   🎯 After seeing temple, massage school in back (not touristy, locals use it)
   ⚠️ Dress code: shoulders + knees covered
   🌦 Indoor/covered walkways

3. 🍛 Or Tor Kor Market
   📍 Pin: [link] - take BTS to Saphan Kwai, 5min walk
   🕐 Best: 8am-11am (fresh produce, breakfast stalls)
   💳 Cash only, most stalls ~50-150 THB
   🎯 Stall #47 (khao man gai), Stall #89 (mango sticky rice)
   ⚠️ This is where Bangkok locals shop, not Chatuchak (tourist trap)
   🌦 Covered market (rain-safe)

━━━ 💡 WHAT TO EXPECT ━━━

🌦 Weather in March:
• Hot + humid (32-35°C daily)
• Occasional afternoon rain (15-30 min bursts)
• Pack: Light clothes, sunscreen, small umbrella

💰 Money:
• Keep 2000-3000 THB cash on hand
• Most street food = cash only
• 7-Eleven ATMs everywhere (220 THB fee)

🚕 Getting Around:
• Grab is cheap + reliable (50-150 THB most rides)
• BTS Skytrain for longer distances
• Don't use tuk-tuks near tourist spots (overpriced)

🍽️ Food Safety:
• Street food is safe (actually safer than some restaurants)
• Follow the crowds - busy stall = fresh food
• Avoid pre-cut fruit sitting out

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

That's it for now.

Don't over-plan the rest.

When you land, text me:
"I'm checked in" → I'll send you to your first spot
"I'm hungry in [area]" → I'll build your meal
"What should I do today?" → I'll guide you

Everything else? I'll build your days with you in real-time.

See you in Bangkok 🇹🇭

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Implementation**:
- [ ] Strategic decisions generation logic (smart filtering + prioritization)
- [ ] Text formatter (clean, actionable, proves depth without overwhelming)
- [ ] Process Plan messaging template
- [ ] Agreement Plan messaging template
- [ ] Send as WhatsApp message (single cohesive message, map pins follow)

**Day 22-24: Process Plan + Agreement Plan Templates**

**Process Plan Message** (sent before profile learning):
```
Hey! I'm here to guide you through your trip.

Here's how this works:

1️⃣ Tell me your trip (where, when, who)
2️⃣ I'll ask a few questions about your style
3️⃣ I'll give you strategic decisions (where to stay, what to book ahead)
4️⃣ When you land, text me - I'll guide you day-by-day
5️⃣ After your trip, tell me how spots were (keeps knowledge fresh)

You don't need to plan everything now. I've got you from start to finish.
```

**Agreement Plan Message** (sent with strategic decisions):
```
━━━ WHAT YOU CAN COUNT ON ━━━

✅ I'm available 24/7 while you travel
   Text anytime during your trip, response in minutes

✅ If you don't like a spot, I'll fix it immediately
   No questions asked - your trip, your call

✅ No rigid schedules, zero pressure
   Use what works, ignore what doesn't

✅ Knowledge stays fresh
   Every spot verified within last 3 months

✅ Your data is private
   Conversations never shared, no spam
```

**Day 25-28: Knowledge Graph Expansion**
- [ ] Recruit 10-20 travel-loving friends
- [ ] Each contributes 3-5 spots for cities they know
- [ ] Founders manually verify quality
- [ ] Target: 50-100 spots total across 1-2 cities

**Week 3-4 Success Criteria**:
- ✅ Profile learning feels natural (not interrogation)
- ✅ Strategic decisions prove depth (3-5 spots with full operational intel)
- ✅ Messaging is clear: "Don't over-plan, I'll guide you when you're there"
- ✅ Process Plan + Agreement Plan build trust without overwhelming
- ✅ Knowledge quality noticeably better than what Google/Layla would give
- ✅ 50-100 spots in knowledge graph from multiple contributors

---

### **Week 5-6: On-Trip Conversational Guidance + Feedback Loop**

#### Goals
- Build "I'm hungry" → recommend next spot flow (PRIMARY on-trip value)
- Add weather awareness + real-time adaptation
- 24/7 availability pattern (<5 min response time)
- Post-trip feedback collection
- Polish for external testing

#### Deliverables

**Day 29-31: On-Trip Conversational Guidance (Core Feature)**

This is the PRIMARY on-trip value delivery. Build conversational flows for:

**Flow 1: "I'm hungry" → Build the meal**
```
User → "I'm hungry"
Bot → Detects context:
      - Current location (ask or infer from previous messages)
      - Time of day (breakfast, lunch, dinner, late night)
      - Previous preferences (what they've liked so far)
      - Weather (raining? outdoor/indoor)

Bot → Queries knowledge graph:
      WHERE city = Bangkok
      AND category = [detected meal type]
      AND neighborhood = [near user]
      AND (weather conditions match)
      ORDER BY tier ASC, user_preference_match DESC
      LIMIT 3

Bot → "You're in Sukhumvit, it's lunch time. Here are 3 great options nearby:

      1. [Spot A] - 5 min walk
         [Full operational intel: what to order, payment, tips]

      2. [Spot B] - 10 min walk (more local vibe)
         [Full operational intel]

      3. [Spot C] - 7 min Grab ride (if you want something special)
         [Full operational intel]

      Which vibe feels right?"

User → "Let's do Spot A"
Bot → Sends correct pin, specific directions
Bot → "Perfect. Text me after - curious how it is!"
```

**Flow 2: "What should I do today?" → Build the day**
```
User → "What should we do today?"
Bot → "What's your energy level? Packed day or chill vibe?"
User → "Chill, we're tired from yesterday"

Bot → Builds loose structure:
      "Cool, here's a chill day:

      Morning (9-11am):
      Start with breakfast at [Spot A] - easy walk from hotel
      Then walk through [Neighborhood], end up at [Temple/Market]

      Midday (12-2pm):
      Lunch at [Spot B] - you'll be nearby
      Then chill at [Cafe with AC] if you need a break

      Afternoon (3-6pm):
      Your call - want suggestions or just wing it?

      Evening:
      You have dinner booked at [Restaurant] at 7pm

      Text me when you're hungry or want to adjust!"
```

**Flow 3: "I'm near X, what's worth seeing?"**
```
User → "We're near Wat Pho, what else is around here?"
Bot → Filters by location + interests:
      "Great area! Here's what's within walking distance:

      🍜 [Food spot] - 3 min walk
      🛕 [Temple] - 5 min walk (less crowded than Wat Pho)
      🛥️ [River ferry] - 7 min walk (scenic ride to Chinatown)

      What sounds good?"
```

**Implementation**:
- [ ] Intent detection (hungry, what to do, where am I, etc)
- [ ] Context extraction (location, time, energy level, weather)
- [ ] Query builder (dynamic filters based on context)
- [ ] Response formatter (conversational, actionable, not overwhelming)
- [ ] Conversation memory (remember what they've done, what they liked)
- [ ] Quick response time optimization (<5 min target)

**Day 32-34: Weather Integration**

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
- ✅ "I'm hungry" flow feels natural and helpful (not robotic)
- ✅ "Build the day" guidance feels like a friend, not a search engine
- ✅ Response time <5 minutes during testing
- ✅ Weather-aware recommendations work seamlessly
- ✅ Context memory works (remembers what they've done/liked)
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
1. **Pre-trip**: Conversational profile learning → strategic decisions + anchor spots
2. **On-trip**: Active day-by-day conversational guidance (THIS IS THE MAIN TEST)
3. **Post-trip**: "How was it?" feedback collection

### What We Measure

| Metric | Target | What It Tells Us |
|--------|--------|------------------|
| Strategic decisions quality | 70%+ say "proves depth without overwhelming" | Does pre-trip format work? |
| On-trip engagement | 70%+ actively text during trip (not just read pre-trip) | Is on-trip guidance the real value? |
| Messages per trip | 10+ messages per traveler during trip | Are they relying on us or just referencing? |
| Guided feeling | 70%+ say "felt guided throughout trip" | Does "guide model" deliver on promise? |
| Follow-through | 60%+ visited recommended spots | Do they trust our recommendations? |
| Willingness to pay | 50%+ would pay $50-100 for this | Is this valuable enough to monetize? |
| Contribution willingness | 30%+ share spots back | Does post-trip contribution loop work? |

### What We Learn
- Which knowledge depth matters most? (payment methods? ordering tips? vibe? directions?)
- Does "strategic decisions only" feel valuable or do they want more upfront?
- When do travelers text us? (hungry? lost? weather change? daily check-in?)
- Do they prefer conversational guidance or comprehensive planning?
- Does on-trip guidance feel like a friend or a search engine?
- What kills the experience? (wrong info? slow response? overwhelming? confusing?)
- Would they use this again for next trip?
- Do Process Plan + Agreement Plan build trust effectively?

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
│   │   ├── strategic.js        # Strategic decisions generation logic
│   │   ├── ontrip.js           # On-trip conversational guidance logic
│   │   └── feedback.js         # Feedback loop logic
│   ├── /services
│   │   ├── whatsapp.js         # WhatsApp API wrapper
│   │   ├── database.js         # Supabase queries
│   │   ├── llm.js              # Claude API wrapper
│   │   ├── transcription.js    # Whisper API wrapper
│   │   └── weather.js          # OpenWeather API wrapper
│   ├── /prompts
│   │   ├── extraction.txt      # Prompt for data extraction
│   │   ├── profile.txt         # Prompt for profile learning
│   │   ├── strategic.txt       # Prompt for strategic decisions generation
│   │   ├── ontrip.txt          # Prompt for on-trip guidance
│   │   └── process_agreement.txt # Process Plan + Agreement Plan templates
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
3. Does "guide model" (strategic decisions + on-trip guidance) deliver more value than "itinerary model" (comprehensive dossier)?
4. Do travelers actively engage on-trip (10+ messages) or just read pre-trip info?
5. Do Process Plan + Agreement Plan build trust effectively?
6. Would they pay $50-100 for this?
7. What's the next most important thing to build?

**If we can answer YES to #1-4 and #6, we have product-market fit for MVP. Then we scale.**

**The key question**: Does "guide who walks with you" beat "map you execute alone"?

---

*Last updated: February 2026*
