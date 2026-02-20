-- Sam Travel Intelligence — Database Schema
-- Run this in your Supabase SQL editor to set up all tables.

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ============================================
-- CONTRIBUTORS — Who added knowledge
-- (Must be created before spots due to FK reference)
-- ============================================
create table contributors (
  id uuid primary key default uuid_generate_v4(),
  whatsapp_number text unique not null,
  name text,
  cities_contributed text[] default '{}',
  spots_contributed integer default 0,
  created_at timestamp with time zone default now()
);

-- ============================================
-- SPOTS — The knowledge graph
-- ============================================
create table spots (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  city text not null default 'Kuala Lumpur',
  area text,
  category text, -- breakfast, lunch, dinner, cafe, activity, nightlife, market

  tier integer default 2, -- 1 (must-do), 2 (should-do), 3 (nice-to-have/hidden gem)

  -- Operational intelligence
  address text,
  latitude decimal,
  longitude decimal,
  google_pin_accurate boolean default true,
  payment_methods text[] default '{"cash","card"}',
  opening_hours jsonb, -- { "mon": "8am-10pm", "tue": "8am-10pm", ... }
  price_range text, -- $, $$, $$$

  -- Ordering / experience intelligence
  what_to_order text[],
  what_to_skip text[],
  pro_tips text[],
  vibe text, -- casual, upscale, chaotic, chill, local, touristy

  -- Context flags
  weather_dependent boolean default false,
  best_time_of_day text, -- morning, afternoon, evening, late-night
  indoor_outdoor text default 'indoor', -- indoor, outdoor, both

  -- Metadata
  contributor_id uuid references contributors(id),
  confidence_score decimal default 0.7,
  use_count integer default 0,
  source text default 'manual', -- seed, voice, text, llm_verified, manual
  last_verified timestamp with time zone default now(),
  created_at timestamp with time zone default now()
);

-- ============================================
-- TRAVELERS — User profiles
-- ============================================
create table travelers (
  id uuid primary key default uuid_generate_v4(),
  whatsapp_number text unique not null,
  name text,

  -- User type: 'local', 'traveler', or 'unknown'
  user_type text default 'unknown',
  home_areas text[] default '{}',

  -- Learned preferences
  preferences jsonb default '{}',
  -- e.g. { "budget": "mid", "pace": "moderate", "interests": ["food", "culture"], "style": "adventurous" }

  dietary_restrictions text[] default '{}',

  -- Trip context
  current_city text,
  trip_dates jsonb, -- { "start": "2026-03-15", "end": "2026-03-19" }
  travel_party text, -- solo, couple, friends, family
  first_time_visitor boolean default true,

  -- History
  spots_visited uuid[] default '{}',
  spots_liked uuid[] default '{}',
  spots_disliked uuid[] default '{}',
  trips_taken integer default 0,

  -- Proactive messaging
  last_proactive_at timestamp with time zone,
  spots_feedback_asked uuid[] default '{}',

  created_at timestamp with time zone default now()
);

-- ============================================
-- CONVERSATIONS — State management
-- ============================================
create table conversations (
  id uuid primary key default uuid_generate_v4(),
  whatsapp_number text unique not null,
  current_flow text default 'general',
  -- flows: general, contribution, query, profile_learning, strategic, ontrip, feedback

  flow_state jsonb default '{}',
  -- stores flow-specific context (e.g. partial spot data during contribution)

  messages jsonb default '[]',
  -- conversation history for Claude context

  -- When the user last messaged us (for WhatsApp 24h window check)
  last_user_message_at timestamp with time zone,

  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- ============================================
-- FEEDBACK — Post-trip validation
-- ============================================
create table feedback (
  id uuid primary key default uuid_generate_v4(),
  spot_id uuid references spots(id),
  traveler_id uuid references travelers(id),
  rating integer check (rating >= 1 and rating <= 5),
  did_they_go boolean,
  comments text,
  user_tips text[],
  created_at timestamp with time zone default now()
);

-- ============================================
-- INDEXES
-- ============================================
create index idx_spots_city on spots(city);
create index idx_spots_area on spots(area);
create index idx_spots_category on spots(category);
create index idx_spots_tier on spots(tier);
create index idx_conversations_phone on conversations(whatsapp_number);
create index idx_travelers_phone on travelers(whatsapp_number);
create index idx_feedback_spot on feedback(spot_id);

-- ============================================
-- ROW LEVEL SECURITY (basic — tighten for production)
-- ============================================
alter table spots enable row level security;
alter table contributors enable row level security;
alter table travelers enable row level security;
alter table conversations enable row level security;
alter table feedback enable row level security;

-- Allow service role full access (used by server)
create policy "Service role full access" on spots for all using (true);
create policy "Service role full access" on contributors for all using (true);
create policy "Service role full access" on travelers for all using (true);
create policy "Service role full access" on conversations for all using (true);
create policy "Service role full access" on feedback for all using (true);

-- ============================================
-- EVENTS — Analytics / usage tracking
-- ============================================
create table events (
  id uuid primary key default uuid_generate_v4(),
  session_id text not null,
  channel text not null check (channel in ('web', 'whatsapp')),
  event_type text not null,
  event_data jsonb default '{}',
  created_at timestamp with time zone default now()
);

create index idx_events_session on events(session_id);
create index idx_events_type on events(event_type);
create index idx_events_created on events(created_at);

alter table events enable row level security;
create policy "Service role full access" on events for all using (true);

-- ============================================
-- SPOT CONTRIBUTIONS — Per-contributor attribution
-- ============================================
create table spot_contributions (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid references spots(id) on delete cascade not null,
  contributor_id uuid references contributors(id) not null,
  what_to_order text[] default '{}',
  what_to_skip text[] default '{}',
  pro_tips text[] default '{}',
  vibe text,
  tier integer,
  created_at timestamptz default now() not null
);

create index idx_spot_contributions_spot_id on spot_contributions(spot_id);
create index idx_spot_contributions_contributor_id on spot_contributions(contributor_id);

alter table spot_contributions enable row level security;
create policy "Public can read spot contributions" on spot_contributions for select using (true);
