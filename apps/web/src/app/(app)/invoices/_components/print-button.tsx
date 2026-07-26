"use client";

import { Button } from "@billow/shadcn/components/button";

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
