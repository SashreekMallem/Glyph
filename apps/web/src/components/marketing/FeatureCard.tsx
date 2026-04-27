"use client";

import type { ReactNode } from "react";
import { StaggerChild } from "@/components/motion/primitives";

export interface FeatureCardProps {
  readonly icon?: ReactNode;
  readonly title: string;
  readonly body: string;
}

export function FeatureCard({ icon, title, body }: FeatureCardProps) {
  return (
    <StaggerChild>
      <div className="group relative h-full rounded-xl border border-neutral-200 bg-white p-6 transition-all hover:border-neutral-900 hover:shadow-[0_8px_32px_-12px_rgba(0,0,0,0.1)]">
        {icon !== undefined && (
          <div className="mb-4 text-neutral-900">{icon}</div>
        )}
        <h3 className="mb-2 font-serif text-lg tracking-tight text-neutral-900">
          {title}
        </h3>
        <p className="text-sm leading-relaxed text-neutral-500">{body}</p>
      </div>
    </StaggerChild>
  );
}
