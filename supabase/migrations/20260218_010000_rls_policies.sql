-- Replace blanket "using (true)" RLS policies with proper role-based access
-- The bot server uses the service_role key, which bypasses RLS entirely.
-- These policies protect against accidental exposure via the anon key.

-- Drop existing blanket policies
drop policy if exists "Service role full access" on spots;
drop policy if exists "Service role full access" on contributors;
drop policy if exists "Service role full access" on travelers;
drop policy if exists "Service role full access" on conversations;
drop policy if exists "Service role full access" on feedback;

-- SPOTS: public read (for landing page stats), service-role write
create policy "spots_read_all" on spots
  for select using (true);

create policy "spots_service_write" on spots
  for all to service_role using (true) with check (true);

-- CONTRIBUTORS: public read (for stats), service-role write
create policy "contributors_read_all" on contributors
  for select using (true);

create policy "contributors_service_write" on contributors
  for all to service_role using (true) with check (true);

-- TRAVELERS: service-role only (contains personal data)
create policy "travelers_service_only" on travelers
  for all to service_role using (true) with check (true);

-- CONVERSATIONS: service-role only (contains message history)
create policy "conversations_service_only" on conversations
  for all to service_role using (true) with check (true);

-- FEEDBACK: service-role only
create policy "feedback_service_only" on feedback
  for all to service_role using (true) with check (true);
