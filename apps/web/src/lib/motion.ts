import type { Transition, Variants } from "framer-motion";

/** Lightweight tween transitions — avoids spring layout thrash on landing. */
export const easeOut: Transition = {
  type: "tween",
  ease: [0.22, 1, 0.36, 1],
  duration: 0.45,
};

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0 },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1 },
};

export const fadeRight: Variants = {
  hidden: { opacity: 0, x: 18 },
  show: { opacity: 1, x: 0 },
};

export const viewportOnce = {
  once: true,
  amount: 0.15,
  margin: "0px 0px -40px 0px",
} as const;

export function stagger(i: number, base = 0.04): Transition {
  return { ...easeOut, delay: i * base };
}
