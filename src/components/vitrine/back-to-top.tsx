"use client";

/**
 * BackToTop — floating button that appears after scrolling 400px.
 * Smooth-scrolls to the top of the page. Respects reduced-motion.
 */

import * as React from "react";
import { ArrowUp } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export default function BackToTop() {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const onScroll = () => {
      setVisible(window.scrollY > 400);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleClick = () => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({
      top: 0,
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  };

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.6 }}
          transition={{ duration: 0.15 }}
          className="fixed bottom-20 right-4 z-30 sm:bottom-24 sm:right-6"
        >
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={handleClick}
            aria-label="Voltar ao topo"
            title="Voltar ao topo"
            className={cn(
              "size-11 rounded-full border-emerald-200 bg-background/95 shadow-lg backdrop-blur",
              "hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700",
              "dark:border-emerald-800/60 dark:hover:bg-emerald-950/40 dark:hover:text-emerald-300",
            )}
          >
            <ArrowUp className="size-5" />
          </Button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
