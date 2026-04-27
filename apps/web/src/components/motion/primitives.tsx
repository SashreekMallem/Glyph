"use client";

/**
 * Shared Motion primitives for Glyph.
 *
 * Reasonable defaults so feature code stays declarative. Prefer these
 * over ad-hoc `motion.div` configs so timing + easing stay consistent
 * across the product. All primitives respect `prefers-reduced-motion`
 * via `<MotionConfig reducedMotion="user">` in the provider.
 */

import { motion, type HTMLMotionProps, type Variants } from "motion/react";
import { forwardRef, type ReactNode } from "react";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const fadeInUpVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } },
};

const fadeInVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.35, ease: EASE } },
};

const staggerParent: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05, delayChildren: 0.05 } },
};

/** Fade + slide upward on mount. Use for hero blocks, stat cards. */
export const FadeInUp = forwardRef<HTMLDivElement, HTMLMotionProps<"div">>(
  function FadeInUp({ children, ...rest }, ref) {
    return (
      <motion.div
        ref={ref}
        variants={fadeInUpVariants}
        initial="hidden"
        animate="visible"
        {...rest}
      >
        {children}
      </motion.div>
    );
  },
);

/** Simple fade-in on mount. Use for content panes. */
export const FadeIn = forwardRef<HTMLDivElement, HTMLMotionProps<"div">>(
  function FadeIn({ children, ...rest }, ref) {
    return (
      <motion.div
        ref={ref}
        variants={fadeInVariants}
        initial="hidden"
        animate="visible"
        {...rest}
      >
        {children}
      </motion.div>
    );
  },
);

/**
 * Stagger wrapper — every direct `<StaggerChild>` inside animates with
 * a small delay between siblings. Perfect for lists + cards.
 */
export function Stagger({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      variants={staggerParent}
      initial="hidden"
      animate="visible"
    >
      {children}
    </motion.div>
  );
}

export const StaggerChild = forwardRef<HTMLDivElement, HTMLMotionProps<"div">>(
  function StaggerChild({ children, ...rest }, ref) {
    return (
      <motion.div ref={ref} variants={fadeInUpVariants} {...rest}>
        {children}
      </motion.div>
    );
  },
);

/** Subtle press feedback for interactive cards / buttons. */
export const PressScale = forwardRef<HTMLDivElement, HTMLMotionProps<"div">>(
  function PressScale({ children, ...rest }, ref) {
    return (
      <motion.div
        ref={ref}
        whileHover={{ y: -1 }}
        whileTap={{ scale: 0.985 }}
        transition={{ duration: 0.18, ease: EASE }}
        {...rest}
      >
        {children}
      </motion.div>
    );
  },
);
