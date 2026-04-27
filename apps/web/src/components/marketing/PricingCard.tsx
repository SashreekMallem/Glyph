"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StaggerChild } from "@/components/motion/primitives";

export interface PricingCardProps {
  readonly name: string;
  readonly price: string;
  readonly cadence: string;
  readonly features: readonly string[];
  readonly cta: string;
  readonly href: string;
  readonly highlighted?: boolean;
}

export function PricingCard({
  name,
  price,
  cadence,
  features,
  cta,
  href,
  highlighted = false,
}: PricingCardProps) {
  return (
    <StaggerChild>
      <div
        className={
          highlighted
            ? "relative h-full rounded-xl border-2 border-neutral-900 bg-neutral-900 p-6 text-white shadow-[0_20px_60px_-20px_rgba(0,0,0,0.4)]"
            : "relative h-full rounded-xl border border-neutral-200 bg-white p-6"
        }
      >
        <div
          className={
            highlighted
              ? "mb-1 font-mono text-[0.68rem] uppercase tracking-[0.18em] text-neutral-400"
              : "mb-1 font-mono text-[0.68rem] uppercase tracking-[0.18em] text-neutral-400"
          }
        >
          {name}
        </div>
        <div className="mb-4 flex items-baseline gap-1">
          <span className="font-serif text-4xl tracking-tight">{price}</span>
          <span
            className={
              highlighted
                ? "text-sm text-neutral-400"
                : "text-sm text-neutral-500"
            }
          >
            /{cadence}
          </span>
        </div>
        <ul
          className={
            highlighted
              ? "mb-6 space-y-2 text-sm text-neutral-300"
              : "mb-6 space-y-2 text-sm text-neutral-600"
          }
        >
          {features.map((f) => (
            <li key={f} className="leading-relaxed">
              — {f}
            </li>
          ))}
        </ul>
        <Button
          asChild
          variant={highlighted ? "default" : "outline"}
          className={highlighted ? "w-full bg-white text-neutral-900 hover:bg-neutral-100" : "w-full"}
        >
          <Link href={href}>{cta}</Link>
        </Button>
      </div>
    </StaggerChild>
  );
}
