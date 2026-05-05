"use client";

import { useEffect, useState } from "react";
import { motion, useMotionValue, animate } from "framer-motion";

/**
 * Live ticker showing the consumer-pay flywheel: as docs spread, reads
 * accumulate. Numbers are illustrative — they tick up while the section
 * is in view and pause when scrolled away.
 */

export function CostFlywheel() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
      <Stat
        label="Author cost"
        value={0}
        suffix=""
        prefix="$"
        sub="extraction subsidized"
      />
      <Stat
        label="Reads served"
        value={1_482_303}
        suffix=""
        sub="and counting"
        loop
      />
      <Stat
        label="Avg. consumer read"
        value={0.0021}
        prefix="$"
        suffix=""
        sub="vs $0.02 typical"
        decimals={4}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  prefix = "",
  suffix = "",
  sub,
  loop = false,
  decimals = 0,
}: {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  sub: string;
  loop?: boolean;
  decimals?: number;
}) {
  const mv = useMotionValue(0);
  const [display, setDisplay] = useState("0");

  useEffect(() => {
    const controls = animate(mv, value, {
      duration: 1.6,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) =>
        setDisplay(
          v.toLocaleString(undefined, {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
          }),
        ),
    });
    return () => controls.stop();
  }, [mv, value, decimals]);

  useEffect(() => {
    if (!loop) return;
    const t = setInterval(() => {
      const cur = mv.get();
      animate(mv, cur + Math.floor(Math.random() * 7) + 1, {
        duration: 0.8,
        ease: "easeOut",
        onUpdate: (v) =>
          setDisplay(
            v.toLocaleString(undefined, {
              minimumFractionDigits: 0,
              maximumFractionDigits: 0,
            }),
          ),
      });
    }, 1200);
    return () => clearInterval(t);
  }, [loop, mv]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4 }}
      className="rounded-2xl border border-neutral-200 bg-white p-6 sm:p-7"
    >
      <div className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-neutral-400">
        {label}
      </div>
      <div className="mt-3 font-serif text-3xl tracking-tight text-neutral-900 sm:text-4xl">
        {prefix}
        {display}
        {suffix}
      </div>
      <div className="mt-2 text-sm text-neutral-500">{sub}</div>
    </motion.div>
  );
}
