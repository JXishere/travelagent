"use client";

import { useState, useEffect } from "react";

export function RotatingCity({ cities, suffix, lowercase = true }: { cities: string[]; suffix?: string; lowercase?: boolean }) {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (cities.length <= 1) return;

    const interval = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIndex((i) => (i + 1) % cities.length);
        setVisible(true);
      }, 300);
    }, 3000);

    return () => clearInterval(interval);
  }, [cities]);

  const fmt = (s: string) => lowercase ? s.toLowerCase() : s;
  const text = fmt(cities[index] ?? cities[0]);

  return (
    <span className="relative inline-block text-left">
      {/* Hidden items size the container to the widest name */}
      {cities.map((c) => (
        <span key={c} className="invisible block h-0" aria-hidden>
          {fmt(c)}{suffix}
        </span>
      ))}
      {/* Visible item */}
      <span
        className="block transition-all duration-300"
        style={{
          opacity: visible ? 1 : 0,
        }}
      >
        {text}{suffix}
      </span>
    </span>
  );
}
