"use client";

import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StaggerChild } from "@/components/motion/primitives";
import { cn } from "@/lib/utils";

export interface StatsCardProps {
  label: string;
  value: ReactNode;
  hint?: string;
  trend?: "up" | "down" | "flat";
  className?: string;
}

/**
 * Premium minimalist stat card. Wrapped in `StaggerChild` so parents
 * can animate a row of stats with a single `<Stagger>`.
 */
export function StatsCard({ label, value, hint, trend, className }: StatsCardProps) {
  return (
    <StaggerChild>
      <Card
        className={cn(
          "transition-shadow hover:shadow-md",
          className,
        )}
      >
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium uppercase tracking-[0.14em] text-neutral-500">
            {label}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-2">
            <div className="text-2xl font-semibold tracking-tight text-neutral-900">
              {value}
            </div>
            {trend !== undefined && (
              <span
                aria-hidden
                className={cn(
                  "text-xs",
                  trend === "up" && "text-emerald-600",
                  trend === "down" && "text-red-600",
                  trend === "flat" && "text-neutral-400",
                )}
              >
                {trend === "up" ? "↑" : trend === "down" ? "↓" : "–"}
              </span>
            )}
          </div>
          {hint !== undefined && (
            <p className="mt-1 text-xs text-neutral-500">{hint}</p>
          )}
        </CardContent>
      </Card>
    </StaggerChild>
  );
}
