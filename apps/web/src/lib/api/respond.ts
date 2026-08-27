import { NextResponse } from "next/server";
import { z } from "zod";

export function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

type FieldErrors = Record<string, string[] | undefined>;

/**
 * Accepts either a `ZodError` or already-flattened field errors: a route
 * validating its own body has the former, while a rule in `lib/workspace/`
 * has already flattened its own and passes the latter. Both produce one
 * response shape, so a client parses a single error format across the API.
 */
export function validationError(issue: z.ZodError | FieldErrors) {
  const fields =
    issue instanceof z.ZodError ? issue.flatten().fieldErrors : issue;
  return NextResponse.json(
    { error: "Invalid request.", fields },
    { status: 400 },
  );
}

/**
 * The single way this app says "slow down".
 *
 * Always 429 with a `Retry-After`, never a bare 401: a client that reads a
 * throttled request as an authentication failure discards a working
 * credential and retries immediately, which is the opposite of what the
 * limiter is asking for. The status and the header are what non-human callers
 * actually back off on — the message is for people reading logs.
 *
 * `retryAfterSeconds` is floored at one second because `Retry-After: 0` reads
 * as "retry now" and turns a limit into a spin loop.
 */
export function rateLimited(message: string, retryAfterSeconds: number) {
  const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
  return NextResponse.json(
    { error: message, retryAfter: seconds },
    { status: 429, headers: { "Retry-After": String(seconds) } },
  );
}
