"use client";

import { StaggerChild } from "@/components/motion/primitives";

export interface StepCardProps {
  readonly step: number;
  readonly title: string;
  readonly body: string;
}

export function StepCard({ step, title, body }: StepCardProps) {
  return (
    <StaggerChild>
      <div className="relative rounded-xl border border-neutral-200 bg-white p-6">
        <div className="mb-3 font-mono text-[0.68rem] uppercase tracking-[0.18em] text-neutral-400">
          Step {String(step).padStart(2, "0")}
        </div>
        <h3 className="mb-2 font-serif text-lg tracking-tight text-neutral-900">
          {title}
        </h3>
        <p className="text-sm leading-relaxed text-neutral-500">{body}</p>
      </div>
    </StaggerChild>
  );
}
