"use client";

import type { ReactNode } from "react";
import { LazyMotion, domAnimation } from "framer-motion";

/** Loads a slim framer-motion feature set for smoother landing animations. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      {children}
    </LazyMotion>
  );
}
