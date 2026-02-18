import { getCityStats, getRecentSpotTeasers, getCountries } from "@/lib/supabase";
import { HomeClient } from "@/components/home-client";

export const revalidate = 60;

export default async function Home() {
  const [stats, teasers, countries] = await Promise.all([
    getCityStats(),
    getRecentSpotTeasers(),
    getCountries(),
  ]);
  return <HomeClient stats={stats} teasers={teasers} countries={countries} />;
}
