"use client";

/**
 * 3D document hero — pure CSS 3D, no WebGL.
 *
 * The document is a single styled card that lives in a 3D space via
 * `transform-style: preserve-3d` + `perspective`. Cursor parallax tilts
 * the card; a soft drop shadow under it sells the depth. No paper stack,
 * no second sheet, no gray slab — just one document floating.
 *
 * Why CSS over R3F here:
 *   - vector-sharp DOM at any zoom (no canvas blur)
 *   - zero WebGL context limits (the preview tool kept losing context)
 *   - sub-millisecond render path; no 150KB three.js bundle
 *   - looks identical at this scale and reads as "premium minimalist"
 */

import { useEffect, useRef, useState } from "react";

export function HeroDocumentScene() {
  const ref = useRef<HTMLDivElement>(null);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setReduced(
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
  }, []);

  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const target = { x: 0, y: 0 };
    const cur = { x: 0, y: 0 };
    const onMove = (e: PointerEvent) => {
      target.x = (e.clientY / window.innerHeight - 0.5) * -10;
      target.y = (e.clientX / window.innerWidth - 0.5) * 14;
    };
    const tick = () => {
      cur.x += (target.x - cur.x) * 0.08;
      cur.y += (target.y - cur.y) * 0.08;
      if (ref.current) {
        ref.current.style.transform = `rotateX(${cur.x}deg) rotateY(${cur.y}deg)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener("pointermove", onMove);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
  }, [reduced]);

  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ perspective: "1600px" }}
    >
      <div
        ref={ref}
        className="relative will-change-transform"
        style={{
          transformStyle: "preserve-3d",
          transform: "rotateX(0deg) rotateY(8deg)",
          transition: "transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {/* Soft cast shadow */}
        <div
          aria-hidden
          className="absolute left-1/2 top-full h-12 w-[80%] -translate-x-1/2 rounded-[50%] bg-black/20 blur-2xl"
          style={{ transform: "translateZ(-40px) translateY(-10px)" }}
        />

        {/* Idle float */}
        <div className="animate-[doc-float_6s_ease-in-out_infinite]">
          <DocumentCard />
        </div>

        {/* Floating annotation chips, positioned in 3D space around the doc */}
        <Chip
          label="✓ Ed25519"
          tone="emerald"
          style={{
            top: "-12px",
            right: "-50px",
            transform: "translateZ(60px)",
          }}
        />
        <Chip
          label="AES-256-GCM"
          tone="neutral"
          style={{
            bottom: "32px",
            left: "-70px",
            transform: "translateZ(60px)",
          }}
        />
        <Chip
          label="embedded payload"
          tone="dark"
          style={{
            bottom: "-12px",
            right: "-30px",
            transform: "translateZ(50px)",
          }}
        />
      </div>

      {/* Float keyframes */}
      <style jsx>{`
        @keyframes doc-float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }
      `}</style>
    </div>
  );
}

function DocumentCard() {
  return (
    <div
      className="rounded-xl bg-[#fdfcfa] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.25),0_18px_36px_-18px_rgba(0,0,0,0.18),inset_0_0_0_1px_rgba(0,0,0,0.04)]"
      style={{ width: 380, padding: "44px 40px" }}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-neutral-400">
        Resume · Ada Lovelace
      </div>
      <h2 className="mt-3 font-serif text-[40px] leading-[1.05] tracking-tight text-neutral-900">
        Ada Lovelace
      </h2>
      <p className="mt-1 text-[14px] text-neutral-500">
        Lead Algorithmist · 1843–1852
      </p>

      <div className="mt-6 h-px w-full bg-neutral-200" />

      <Section title="Experience">
        <Row primary="Analytical Engine Co." secondary="— Algorithmist" />
        <p className="mt-1 text-[12px] leading-relaxed text-neutral-600">
          First algorithm intended for a machine. Notes on Bernoulli
          numbers laid the groundwork for general-purpose computation.
        </p>
      </Section>

      <Section title="Education">
        <Row primary="University of London" secondary="— Mathematics" />
      </Section>

      <Section title="Skills">
        <div className="mt-1 flex flex-wrap gap-1.5">
          {["Algorithms", "Cryptanalysis", "Translation", "Mathematics"].map(
            (s) => (
              <span
                key={s}
                className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-700"
              >
                {s}
              </span>
            ),
          )}
        </div>
      </Section>

      <div className="mt-7 flex items-center justify-between border-t border-neutral-100 pt-3">
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-neutral-400">
          glyph stamp
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-emerald-600">
          ✓ signed
        </span>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-5">
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-neutral-400">
        {title}
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Row({ primary, secondary }: { primary: string; secondary?: string }) {
  return (
    <div className="text-[13px] text-neutral-900">
      <span className="font-medium">{primary}</span>
      {secondary && <span className="text-neutral-500"> {secondary}</span>}
    </div>
  );
}

function Chip({
  label,
  tone,
  style,
}: {
  label: string;
  tone: "emerald" | "neutral" | "dark";
  style?: React.CSSProperties;
}) {
  const cls =
    tone === "emerald"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
      : tone === "dark"
        ? "border-emerald-500/40 bg-neutral-950/90 text-emerald-400"
        : "border-neutral-200 bg-white/85 text-neutral-700";
  return (
    <div
      className={`absolute rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] backdrop-blur-sm ${cls}`}
      style={style}
    >
      {label}
    </div>
  );
}
