"use client";

import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      onClick={() => window.print()}
    >
      Print / Save PDF
    </Button>
  );
}
