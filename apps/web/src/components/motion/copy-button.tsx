"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Copy } from "lucide-react";

import { Button } from "@billow/shadcn/components/button";
import { notifyError } from "@/lib/notify";

export function CopyButton({
  value,
  label = "Copy",
  copiedLabel = "Copied",
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      notifyError("Could not copy", "Copy it manually instead.");
    }
  }

  const transition = reduceMotion
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 600, damping: 25 };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={copy}
      aria-label={copied ? copiedLabel : label}
      render={
        <motion.button whileTap={reduceMotion ? undefined : { scale: 0.96 }} />
      }
    >
      <span className="relative flex size-4 shrink-0 items-center justify-center">
        <AnimatePresence mode="popLayout" initial={false}>
          {copied ? (
            <motion.span
              key="copied"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              transition={transition}
              className="absolute inset-0 flex items-center justify-center"
            >
              <Check className="size-4" aria-hidden="true" />
            </motion.span>
          ) : (
            <motion.span
              key="copy"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              transition={transition}
              className="absolute inset-0 flex items-center justify-center"
            >
              <Copy className="size-4" aria-hidden="true" />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      <span className="grid">
        <span aria-hidden="true" className="invisible col-start-1 row-start-1">
          {label.length >= copiedLabel.length ? label : copiedLabel}
        </span>
        <span className="col-start-1 row-start-1">
          {copied ? copiedLabel : label}
        </span>
      </span>
    </Button>
  );
}
