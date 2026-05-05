"use client";

/**
 * Scroll-driven document journey — hero-sized.
 *
 * One enormous document at the centre of the screen. The reader scrolls;
 * the same document transforms through four moments without any
 * left/right split. JSON folds DOWN below the doc when it appears, then
 * compresses up into a padlock pill that docks to the doc's footer.
 * Readers slide in along the right edge for the final stage.
 *
 *   Stage 1 (0–22%)   The author writes.    — lines fade in like typing
 *   Stage 2 (22–52%)  Glyph reads it.       — fields highlight, JSON
 *                                              writes itself below with
 *                                              vertical connectors
 *   Stage 3 (52–74%)  Encrypts. Signs.      — JSON visibly compresses
 *                     Embeds.                  into a padlock pill on
 *                                              the doc's footer
 *   Stage 4 (74–100%) Every reader gets the — three readers slide in;
 *                     same truth.              each shows ✓ verified ·
 *                                              2 ms · $0.00
 *
 * Reduced motion: a static four-card recap.
 */

import { useRef } from "react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from "framer-motion";

// ---------------------------------------------------------------------------
// Polished resume — what the user would actually screenshot
// ---------------------------------------------------------------------------

interface DocLine {
  id: string;
  field: string;
  text: string;
}

const HEADER_LINES: ReadonlyArray<DocLine> = [
  { id: "name",  field: "personal.full_name", text: "Ada Lovelace" },
  { id: "title", field: "personal.title",     text: "Lead Algorithmist · 1843–1852" },
];

const EXP1_LINES: ReadonlyArray<DocLine> = [
  { id: "exp1-co",   field: "experience.0.company", text: "Analytical Engine Co." },
  { id: "exp1-role", field: "experience.0.title",   text: "Algorithmist" },
];

const EXP2_LINES: ReadonlyArray<DocLine> = [
  { id: "exp2-co",   field: "experience.1.company", text: "Royal Society" },
  { id: "exp2-role", field: "experience.1.title",   text: "Mathematical correspondent" },
];

const EDU_LINE: DocLine = {
  id: "edu",
  field: "education.0.institution",
  text: "University of London — Mathematics",
};

const SKILLS = ["Algorithms", "Cryptanalysis", "Translation", "Mathematics"];

// JSON rows in display order — only "owner" lines (one per field family)
const JSON_KEYS: ReadonlyArray<DocLine> = [
  HEADER_LINES[0]!, // name
  HEADER_LINES[1]!, // title
  EXP1_LINES[0]!,   // exp1 company
  EXP2_LINES[0]!,   // exp2 company
  EDU_LINE,
];

const CAPTIONS = [
  "The author writes.",
  "Glyph reads every field.",
  "Encrypts. Signs. Embeds.",
  "Every reader gets the same truth.",
] as const;

// ---------------------------------------------------------------------------
// Top-level
// ---------------------------------------------------------------------------

export function ScrollJourney() {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });

  if (reduced) return <ReducedFallback />;

  return (
    <section
      ref={ref}
      className="relative bg-neutral-50 dark:bg-neutral-950"
      style={{ height: "440vh" }}
    >
      <div className="sticky top-0 flex h-screen flex-col overflow-hidden">
        <Header progress={scrollYProgress} />

        <div className="relative flex-1">
          <Stage progress={scrollYProgress} />
        </div>

        <ProgressBar progress={scrollYProgress} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Header — one title, one swapping caption
// ---------------------------------------------------------------------------

function Header({ progress }: { progress: MotionValue<number> }) {
  return (
    <div className="mx-auto w-full max-w-4xl px-6 pt-10 text-center">
      <p className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-neutral-400">
        How a Glyph document is born
      </p>
      <h2 className="mt-2 font-serif text-4xl leading-[1.05] tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-5xl">
        One document. Four moments. Same truth.
      </h2>
      <div className="relative mt-4 h-7">
        {CAPTIONS.map((cap, i) => (
          <CaptionLine key={cap} cap={cap} index={i} progress={progress} />
        ))}
      </div>
    </div>
  );
}

function CaptionLine({
  cap,
  index,
  progress,
}: {
  cap: string;
  index: number;
  progress: MotionValue<number>;
}) {
  const opacity = useTransform(progress, (v) => {
    const center = (index + 0.5) / CAPTIONS.length;
    const dist = Math.abs(v - center);
    return Math.max(0, 1 - dist * 6);
  });
  return (
    <motion.div
      style={{ opacity }}
      className="absolute inset-0 font-serif text-base text-emerald-700 dark:text-emerald-400 sm:text-lg"
    >
      {cap}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Stage — the giant doc + auxiliary layers
// ---------------------------------------------------------------------------

function Stage({ progress }: { progress: MotionValue<number> }) {
  const p1 = useTransform(progress, [0,    0.22], [0, 1]);
  const p2 = useTransform(progress, [0.22, 0.52], [0, 1]);
  const p3 = useTransform(progress, [0.52, 0.74], [0, 1]);
  const p4 = useTransform(progress, [0.74, 1   ], [0, 1]);

  // Doc compresses + drifts left when readers arrive
  const docScale = useTransform(progress, [0.7, 1], [1, 0.7]);
  const docX     = useTransform(progress, [0.7, 1], ["0%", "-22%"]);
  // Stages 2/3 push the doc up so the JSON panel can sit underneath it.
  const docY     = useTransform(progress, [0.18, 0.52, 0.74, 1], [0, -90, -40, 0]);

  return (
    <div className="relative h-full w-full">
      <motion.div
        style={{ scale: docScale, x: docX, y: docY }}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      >
        <Document p1={p1} p2={p2} p3={p3} />
      </motion.div>

      <JsonPanel p2={p2} p3={p3} />
      <Connectors p2={p2} p3={p3} />
      <ReadersStrip p4={p4} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Document — hero-sized
// ---------------------------------------------------------------------------

function Document({
  p1,
  p2,
  p3,
}: {
  p1: MotionValue<number>;
  p2: MotionValue<number>;
  p3: MotionValue<number>;
}) {
  return (
    <div className="w-[680px] rounded-3xl border border-neutral-200 bg-[#fdfcfa] p-12 shadow-[0_40px_80px_-40px_rgba(0,0,0,0.22),0_24px_40px_-24px_rgba(0,0,0,0.14)] dark:border-neutral-800 dark:bg-neutral-900 sm:w-[760px] sm:p-14">
      {/* Letterhead */}
      <div className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-neutral-400">
        Resume · Confidential
      </div>

      <div className="mt-6 space-y-1">
        {HEADER_LINES.map((l, i) => (
          <DocLineEl key={l.id} line={l} index={i} totalAbove={0} totalLines={ALL_LINES.length} p1={p1} p2={p2} size={i === 0 ? "h" : "sub"} />
        ))}
      </div>

      <div className="mt-8 h-px w-full bg-neutral-200 dark:bg-neutral-800" />

      <Section title="Experience">
        <ExpEntry lines={EXP1_LINES} startIndex={2} p1={p1} p2={p2} />
        <ExpEntry lines={EXP2_LINES} startIndex={4} p1={p1} p2={p2} />
      </Section>

      <Section title="Education">
        <DocLineEl line={EDU_LINE} index={6} totalAbove={0} totalLines={ALL_LINES.length} p1={p1} p2={p2} size="body" />
      </Section>

      <Section title="Skills">
        <SkillsRow p1={p1} />
      </Section>

      <FooterStamp p3={p3} />
    </div>
  );
}

// Keep a flat ordered list of all lines so reveal timing is monotonic.
const ALL_LINES: ReadonlyArray<DocLine> = [
  ...HEADER_LINES,
  ...EXP1_LINES,
  ...EXP2_LINES,
  EDU_LINE,
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-7">
      <div className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-neutral-400">
        {title}
      </div>
      <div className="mt-3 space-y-2">{children}</div>
    </div>
  );
}

function ExpEntry({
  lines,
  startIndex,
  p1,
  p2,
}: {
  lines: ReadonlyArray<DocLine>;
  startIndex: number;
  p1: MotionValue<number>;
  p2: MotionValue<number>;
}) {
  const [coLine, roleLine] = lines;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <DocLineEl line={coLine!} index={startIndex} totalAbove={0} totalLines={ALL_LINES.length} p1={p1} p2={p2} size="body-bold" />
        <DocLineEl line={roleLine!} index={startIndex + 1} totalAbove={0} totalLines={ALL_LINES.length} p1={p1} p2={p2} size="body-muted" />
      </div>
    </div>
  );
}

function SkillsRow({ p1 }: { p1: MotionValue<number> }) {
  // Reveal skills row at the very end of stage 1.
  const opacity = useTransform(p1, [0.85, 1], [0, 1]);
  return (
    <motion.div style={{ opacity }} className="flex flex-wrap gap-1.5">
      {SKILLS.map((s) => (
        <span
          key={s}
          className="rounded-full bg-neutral-100 px-2.5 py-1 text-[12px] text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
        >
          {s}
        </span>
      ))}
    </motion.div>
  );
}

function DocLineEl({
  line,
  index,
  totalLines,
  p1,
  p2,
  size,
}: {
  line: DocLine;
  index: number;
  totalAbove: number;
  totalLines: number;
  p1: MotionValue<number>;
  p2: MotionValue<number>;
  size: "h" | "sub" | "body" | "body-bold" | "body-muted";
}) {
  // Stage 1: lines reveal sequentially.
  const reveal = useTransform(p1, (v) => {
    const start = (index / totalLines) * 0.85;
    const end   = start + 0.85 / totalLines;
    return Math.max(0, Math.min(1, (v - start) / (end - start)));
  });
  const yShift  = useTransform(reveal, (v) => (1 - v) * 6);

  // Stage 2: each line gets boxed in turn.
  const boxOpacity = useTransform(p2, (v) => {
    const start = index / totalLines;
    return Math.max(0, Math.min(1, (v - start) * 4));
  });

  const cls =
    size === "h"
      ? "font-serif text-[40px] leading-[1.05] tracking-tight text-neutral-900 dark:text-neutral-50"
      : size === "sub"
        ? "text-[16px] text-neutral-500"
        : size === "body-bold"
          ? "text-[15px] font-medium text-neutral-900 dark:text-neutral-50"
          : size === "body-muted"
            ? "text-[14px] text-neutral-500"
            : "text-[15px] text-neutral-800 dark:text-neutral-200";

  return (
    <motion.div
      id={`doc-line-${line.id}`}
      style={{ opacity: reveal, y: yShift }}
      className="relative inline-block"
    >
      <span className={`${cls} relative z-10`}>{line.text}</span>
      <motion.span
        aria-hidden
        style={{ opacity: boxOpacity }}
        className="pointer-events-none absolute inset-x-[-6px] inset-y-[-3px] rounded-md border border-emerald-400/60 bg-emerald-300/15 mix-blend-multiply dark:mix-blend-screen"
      />
    </motion.div>
  );
}

function FooterStamp({ p3 }: { p3: MotionValue<number> }) {
  const opacity = useTransform(p3, [0.55, 1], [0, 1]);
  return (
    <motion.div
      style={{ opacity }}
      className="mt-10 flex items-center justify-between border-t border-neutral-100 pt-4 dark:border-neutral-800"
    >
      <span className="font-mono text-[0.65rem] uppercase tracking-[0.22em] text-neutral-400">
        glyph stamp
      </span>
      <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 font-mono text-[0.65rem] uppercase tracking-[0.22em] text-emerald-700 dark:text-emerald-400">
        <LockIcon />
        encrypted · signed · 1.4 KB
      </span>
    </motion.div>
  );
}

function LockIcon() {
  return (
    <svg width="11" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// JSON panel sitting BELOW the doc; folds up + shrinks during stage 3
// ---------------------------------------------------------------------------

function JsonPanel({ p2, p3 }: { p2: MotionValue<number>; p3: MotionValue<number> }) {
  const opacity = useTransform([p2, p3] as const, ([a, b]) => {
    const fadeIn  = a as number;
    const fadeOut = (b as number) * 1.4;
    return Math.max(0, Math.min(1, fadeIn - fadeOut));
  });
  // Slide up from below into final position, then collapse upward.
  const y = useTransform(p2, (v) => 60 - v * 60);
  const collapseY = useTransform(p3, [0, 1], [0, -120]);
  const scale     = useTransform(p3, [0, 1], [1, 0.4]);

  return (
    <motion.div
      style={{ opacity, y, translateY: collapseY, scale }}
      className="absolute left-1/2 top-[calc(50%+260px)] w-[460px] -translate-x-1/2 rounded-2xl border border-neutral-800 bg-neutral-950 p-5 shadow-[0_30px_60px_-20px_rgba(0,0,0,0.4)]"
    >
      <div className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-neutral-500">
        structured.json
      </div>
      <div className="mt-3 space-y-1">
        {JSON_KEYS.map((line, i) => (
          <JsonRow key={line.id} line={line} index={i} total={JSON_KEYS.length} p2={p2} />
        ))}
      </div>
    </motion.div>
  );
}

function JsonRow({
  line,
  index,
  total,
  p2,
}: {
  line: DocLine;
  index: number;
  total: number;
  p2: MotionValue<number>;
}) {
  const opacity = useTransform(p2, (v) => {
    const start = (index / total) * 0.8 + 0.1;
    return Math.max(0, Math.min(1, (v - start) * 4));
  });
  return (
    <motion.div
      id={`json-row-${line.id}`}
      style={{ opacity }}
      className="font-mono text-[11.5px] leading-[1.6]"
    >
      <span className="text-emerald-400/85">{`"${line.field}"`}</span>
      <span className="text-neutral-500">: </span>
      <span className="text-amber-300/95">{`"${line.text}"`}</span>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Vertical connectors — line goes straight DOWN from each doc highlight
// to the corresponding json key
// ---------------------------------------------------------------------------

function Connectors({ p2, p3 }: { p2: MotionValue<number>; p3: MotionValue<number> }) {
  const opacity = useTransform([p2, p3] as const, ([a, b]) =>
    Math.max(0, Math.min(1, (a as number) * 1.2 - (b as number) * 1.6)),
  );
  // Decorative SVG with vertical-ish curves; coordinates are within a
  // 1000×1000 logical box stretched to the section. Five lines, evenly
  // spaced — same count as JSON_KEYS.
  return (
    <motion.svg
      aria-hidden
      style={{ opacity }}
      className="pointer-events-none absolute inset-0 z-[5] h-full w-full"
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
    >
      {JSON_KEYS.map((line, i) => {
        const x = 500;
        const yTop = 360 + i * 36;
        const yBot = 720 + i * 18;
        return (
          <motion.path
            key={line.id}
            d={`M ${x - 40} ${yTop} C ${x - 40} ${(yTop + yBot) / 2} ${x + 40} ${(yTop + yBot) / 2} ${x + 40} ${yBot}`}
            fill="none"
            stroke="rgba(16,185,129,0.55)"
            strokeWidth="1"
            strokeDasharray="3 4"
          />
        );
      })}
    </motion.svg>
  );
}

// ---------------------------------------------------------------------------
// Readers — three cards on the right
// ---------------------------------------------------------------------------

const READERS: ReadonlyArray<{ kind: string; name: string }> = [
  { kind: "ATS",       name: "Greenhouse" },
  { kind: "Recruiter", name: "Acme Talent" },
  { kind: "Agent",     name: "Claude" },
];

function ReadersStrip({ p4 }: { p4: MotionValue<number> }) {
  return (
    <div className="pointer-events-none absolute right-[6%] top-1/2 z-10 flex -translate-y-1/2 flex-col gap-3">
      {READERS.map((r, i) => (
        <ReaderCard key={r.kind} index={i} kind={r.kind} name={r.name} p4={p4} />
      ))}
    </div>
  );
}

function ReaderCard({
  index,
  kind,
  name,
  p4,
}: {
  index: number;
  kind: string;
  name: string;
  p4: MotionValue<number>;
}) {
  const stagger = index * 0.16;
  const opacity = useTransform(p4, (v) =>
    Math.max(0, Math.min(1, (v - stagger) * 4)),
  );
  const x = useTransform(p4, (v) => {
    const local = Math.max(0, Math.min(1, (v - stagger) * 4));
    return (1 - local) * 80;
  });
  const verifyOpacity = useTransform(p4, (v) =>
    Math.max(0, Math.min(1, (v - stagger - 0.15) * 5)),
  );
  return (
    <motion.div
      style={{ opacity, x }}
      className="w-[220px] rounded-2xl border border-neutral-200 bg-white p-4 shadow-[0_20px_40px_-20px_rgba(0,0,0,0.18)] dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div className="font-mono text-[0.6rem] uppercase tracking-[0.22em] text-neutral-400">
        {kind} · {name}
      </div>
      <div className="mt-2 font-serif text-lg text-neutral-900 dark:text-neutral-50">
        Ada Lovelace
      </div>
      <div className="text-[12px] text-neutral-500">Lead Algorithmist</div>
      <motion.div
        style={{ opacity: verifyOpacity }}
        className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-1 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-400"
      >
        ✓ verified · 2 ms · $0.00
      </motion.div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

function ProgressBar({ progress }: { progress: MotionValue<number> }) {
  return (
    <div className="absolute bottom-8 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2">
      {[0, 1, 2, 3].map((i) => (
        <ProgressPip key={i} index={i} progress={progress} />
      ))}
    </div>
  );
}

function ProgressPip({
  index,
  progress,
}: {
  index: number;
  progress: MotionValue<number>;
}) {
  const w = useTransform(progress, (v) =>
    Math.max(0, Math.min(1, v * 4 - index)) * 36 + 10,
  );
  const opacity = useTransform(progress, (v) => (v * 4 > index ? 1 : 0.25));
  return (
    <motion.div
      style={{ width: w, opacity }}
      className="h-[2px] rounded-full bg-emerald-500"
    />
  );
}

// ---------------------------------------------------------------------------
// Reduced motion
// ---------------------------------------------------------------------------

function ReducedFallback() {
  return (
    <section className="border-y border-neutral-200/80 bg-white py-20 dark:border-neutral-900 dark:bg-neutral-950 sm:py-28">
      <div className="mx-auto max-w-4xl px-6 text-center">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-neutral-400">
          How a Glyph document is born
        </p>
        <h2 className="mt-2 font-serif text-3xl leading-tight tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-4xl">
          One document. Four moments. Same truth.
        </h2>
        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {CAPTIONS.map((c, i) => (
            <div
              key={c}
              className="rounded-2xl border border-neutral-200 bg-white p-6 text-left dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-emerald-600">
                Step 0{i + 1}
              </div>
              <div className="mt-2 font-serif text-lg text-neutral-900 dark:text-neutral-50">
                {c}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
