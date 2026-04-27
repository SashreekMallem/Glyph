"use client";

import { Stagger } from "@/components/motion/primitives";
import type { ReactNode } from "react";

/**
 * Flex wrapper around `<Stagger>` producing a responsive 4-up grid.
 * Drop any `<StaggerChild>` (e.g. `StatsCard`) inside.
 */
export function DashboardGrid({ children }: { children: ReactNode }) {
  return (
    <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {children}
    </Stagger>
  );
}
