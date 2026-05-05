"use client";

const FORMATS = [".docx", ".pdf", ".gdoc", ".txt", ".md", ".html", ".json", ".eml"];

/**
 * Two opposing infinite marquees of file-format chips. CSS-only animation
 * (cheaper than Framer Motion at this scale). Each row duplicates its
 * contents so the loop is seamless. Pauses on hover, respects
 * prefers-reduced-motion.
 */
export function FormatMarquee() {
  return (
    <div className="relative flex flex-col gap-3 overflow-hidden py-4">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-neutral-50 to-transparent dark:from-neutral-950" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-neutral-50 to-transparent dark:from-neutral-950" />

      <Row direction="left" />
      <Row direction="right" />

      <style jsx>{`
        @keyframes marquee-l {
          from { transform: translateX(0%); }
          to   { transform: translateX(-50%); }
        }
        @keyframes marquee-r {
          from { transform: translateX(-50%); }
          to   { transform: translateX(0%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .marquee-track { animation: none !important; }
        }
      `}</style>
    </div>
  );
}

function Row({ direction }: { direction: "left" | "right" }) {
  const items = [...FORMATS, ...FORMATS, ...FORMATS, ...FORMATS];
  const anim =
    direction === "left"
      ? "marquee-l 40s linear infinite"
      : "marquee-r 50s linear infinite";
  return (
    <div className="group flex">
      <div
        className="marquee-track flex shrink-0 gap-3 [animation-play-state:running] hover:[animation-play-state:paused]"
        style={{ animation: anim, width: "max-content" }}
      >
        {items.map((f, i) => (
          <Chip key={`${f}-${i}`} ext={f} />
        ))}
      </div>
    </div>
  );
}

function Chip({ ext }: { ext: string }) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-neutral-200 bg-white/80 px-3 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.18em] text-neutral-700 backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-300">
      <FileGlyph />
      {ext}
    </div>
  );
}

function FileGlyph() {
  return (
    <svg width="11" height="13" viewBox="0 0 11 13" fill="none" aria-hidden>
      <path
        d="M1 1.5C1 0.95 1.45 0.5 2 0.5h5L10 3.5v8c0 0.55-0.45 1-1 1H2c-0.55 0-1-0.45-1-1V1.5z"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M7 0.5v3h3"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
