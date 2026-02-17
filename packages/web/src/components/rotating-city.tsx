"use client";

import { useState, useEffect } from "react";

export function RotatingCity({ cities }: { cities: string[] }) {
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

  if (cities.length <= 1) {
    return <span>{cities[0]?.toLowerCase()}</span>;
  }

  return (
    <span className="relative inline-block">
      {/* Hidden cities size the container to the widest name */}
      {cities.map((city) => (
        <span key={city} className="block invisible h-0" aria-hidden>
          {city.toLowerCase()}
        </span>
      ))}
      {/* Visible city, absolutely positioned so it doesn't affect size */}
      <span
        className="block transition-all duration-300"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(4px)",
        }}
      >
        {cities[index].toLowerCase()}
      </span>
    </span>
  );
}
