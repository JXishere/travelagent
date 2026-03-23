---
## PROJECT PAUSED — 2026-03-23

Pausing the project to stop ongoing costs. All data is safe.

**State at pause:**
- 738 spots in DB (KL 504, PJ 169, Penang 65, Taipei 1)
- Railway bot services suspended (prod + dev)
- Supabase project paused
- Vercel web left running (free tier, no cost)

**To resume:**
1. Unpause Supabase project (dashboard → Settings → Restore)
2. Unsuspend Railway services (dashboard → fortunate-friendship)
3. `npm run build:bot && railway up --service "@sam/bot"`
4. Verify: `GET https://sambot-production-6ab1.up.railway.app/health`

**Last things on my mind before pausing:**

---

sam should be more detailed than google. everytime google will show the same best 2-3 restaurants only.


feels like sam cannot understand food category context because the DB only has the name of the spot and possibly some intel about what to order and stuff but not really understanding the nature of the query


recheck the plan for Sam in regards to Open Claw

i need to make sure what every session is doing.


plan for the daily report:
-total messages
-total cost
-total websearch


-remove cash or card..

-each spot should be able to hold multiple categories. (store as a list)

-create agent to report daily cost/total messages

-create agent to report daily new spots, new countries

-feels like we need to find a way for Sam to get user's input and search online for the correct name and let user confirm

-sam could be good with directions and transportation too. is that possible?


-if sam always recommends must go and verified or with use-counts, will that be unfair for those with low use counts?

-also how can we verify what sam stores is good? 

-what if someone just fucks around and simply uploads?

-sam should be able to look for things to do or things that are happening around town.


-think about "secret rooms", "magic locks"


-something i heard recently- many people havent explored many places yet. they mostly only go to places they are used to. and marginally plan for new places to go (only will execute if the stars align) i often hear them say things like "oh i have been wanting to visit that restaurant but havent found the right time to"

-think about Sam's gaps on day planning. 