"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";

/**
 * Tri-state theme toggle: light · system · dark.
 *
 * Renders three small icon buttons in a single rounded container with a
 * sliding selection pill — the kind of toggle Linear and Vercel use.
 * Suppresses hydration mismatch by only rendering after mount.
 */
export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    // Reserve the same width to prevent layout shift.
    return <div className="h-8 w-[88px]" aria-hidden />;
  }

  const items: Array<{ key: "light" | "system" | "dark"; icon: React.ReactNode }> = [
    { key: "light", icon: <SunIcon /> },
    { key: "system", icon: <SystemIcon /> },
    { key: "dark", icon: <MoonIcon /> },
  ];
  const active = (theme as "light" | "system" | "dark") ?? "system";
  const idx = items.findIndex((i) => i.key === active);

  return (
    <div className="relative inline-flex items-center rounded-full border border-neutral-200 bg-white/70 p-0.5 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/70">
      <motion.div
        layout
        className="absolute inset-y-0.5 z-0 w-[28px] rounded-full bg-neutral-900 dark:bg-neutral-100"
        animate={{ left: 2 + idx * 28 }}
        transition={{ type: "spring", stiffness: 400, damping: 32 }}
      />
      {items.map((it) => {
        const isActive = it.key === active;
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => setTheme(it.key)}
            aria-label={`${it.key} theme`}
            aria-pressed={isActive}
            className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
              isActive
                ? "text-white dark:text-neutral-900"
                : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            }`}
          >
            {it.icon}
          </button>
        );
      })}
      <span className="sr-only">resolved: {resolvedTheme}</span>
    </div>
  );
}

function SunIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function SystemIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M9 21h6M12 17v4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
