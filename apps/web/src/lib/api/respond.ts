import { NextResponse } from "next/server";
import type { z } from "zod";

export function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export function validationError(issue: z.ZodError) {
  return NextResponse.json(
    {
      error: "Invalid request.",
      fields: issue.flatten().fieldErrors,
    },
    { status: 400 },
  );
}
