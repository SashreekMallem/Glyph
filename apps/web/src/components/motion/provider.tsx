"use client";

/**
 * Global Motion provider. Enables:
 *  - `reducedMotion="user"` — honour the OS "Reduce motion" setting.
 *  - A single place to override default transitions if we want to.
 */

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig
      reducedMotion="user"
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </MotionConfig>
  );
}
