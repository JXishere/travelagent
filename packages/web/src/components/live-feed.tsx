"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

interface NewSpot {
  name: string;
  area: string | null;
  category: string;
  what_to_order: string[] | null;
  pro_tips: string[] | null;
  vibe: string | null;
  best_time_of_day: string | null;
}

function generateTeaser(spot: NewSpot): string | null {
  const area = spot.area;
  if (!area) return null;

  const cat = spot.category;
  const dish = spot.what_to_order?.[0]?.toLowerCase();

  const candidates: string[] = [];

  if (dish) {
    candidates.push(
      `Sam just learned where to get the best ${dish} in ${area}.`,
      `Someone just told Sam where the locals go for ${dish} in ${area}.`,
    );
  }

  if (spot.pro_tips?.length) {
    candidates.push(
      `Sam just picked up an insider tip about a ${cat} spot in ${area}.`,
    );
  }

  if (spot.vibe) {
    candidates.push(`Sam just found a ${spot.vibe} little ${cat} spot in ${area}.`);
  }

  candidates.push(
    `Sam just got the inside scoop on a new spot in ${area}.`,
  );

  return candidates[Math.floor(Math.random() * candidates.length)];
}

export function LiveFeed({ teasers: initialTeasers }: { teasers: string[] }) {
  const [teasers, setTeasers] = useState(initialTeasers);
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset to index 0 with a fade when a new teaser is prepended
  const prependTeaser = useCallback((teaser: string) => {
    setVisible(false);
    setTimeout(() => {
      setTeasers((prev) => [teaser, ...prev]);
      setIndex(0);
      setVisible(true);
    }, 400);
  }, []);

  // Rotation
  useEffect(() => {
    if (teasers.length <= 1) return;

    intervalRef.current = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIndex((i) => (i + 1) % teasers.length);
        setVisible(true);
      }, 400);
    }, 5000);

    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [teasers]);

  // Supabase Realtime subscription
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_KEY;
    if (!url || !key) return;

    const supabase = createClient(url, key);
    const channel = supabase
      .channel("spots-live-feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "spots" },
        (payload) => {
          const spot = payload.new as NewSpot;
          const teaser = generateTeaser(spot);
          if (teaser) {
            // Reset rotation timer so the new teaser stays visible longer
            if (intervalRef.current) clearInterval(intervalRef.current);
            prependTeaser(teaser);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [prependTeaser]);

  if (teasers.length === 0) return null;

  return (
    <span
      className="block transition-opacity duration-400"
      style={{ opacity: visible ? 1 : 0, minHeight: "2lh", overflow: "hidden" }}
    >
      {teasers[index]}
    </span>
  );
}
