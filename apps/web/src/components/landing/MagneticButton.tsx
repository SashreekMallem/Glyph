"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { motion, useMotionValue, useSpring } from "framer-motion";

/**
 * Magnetic-button wrapper. The child is nudged toward the cursor when
 * the cursor enters a 120-px radius. Max pull is 6 px at 0 distance,
 * falling off linearly to 0 at 120 px. Resets on pointer-leave.
 *
 * The child renders inside an inner motion.span — the wrapper itself
 * stays a normal flow element so it doesn't break parent layout.
 */
export function MagneticButton({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 150, damping: 15 });
  const sy = useSpring(y, { stiffness: 150, damping: 15 });

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    const RADIUS = 120;
    const MAX_PULL = 6;

    const onMove = (e: PointerEvent) => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > RADIUS) {
        x.set(0);
        y.set(0);
        return;
      }
      const strength = (1 - dist / RADIUS) * MAX_PULL;
      x.set((dx / Math.max(dist, 1)) * strength);
      y.set((dy / Math.max(dist, 1)) * strength);
    };
    const onLeave = () => {
      x.set(0);
      y.set(0);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
    };
  }, [x, y]);

  return (
    <span ref={ref} className="inline-block">
      <motion.span style={{ x: sx, y: sy }} className="inline-block">
        {children}
      </motion.span>
    </span>
  );
}
