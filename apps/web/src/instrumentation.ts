// @billow/auth deliberately has no dependency on this app's error-log
// persistence (that module owns its own Prisma model and stays app-side to
// avoid a circular package dependency). This one-time hook wires the two
// together at server startup: Next.js calls `register()` once when the
// server process boots, before any request is handled, so the reporter is in
// place for the very first `getSession()` call.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { setAuthErrorReporter, setAuthMailer } = await import("@billow/auth");
    const { recordError } = await import("@/lib/error-log");
    setAuthErrorReporter(recordError);

    // Same seam, same reason: @billow/auth stays free of a provider SDK and a
    // React email renderer so it can be audited on its own.
    const { deliverPasswordResetEmail } = await import("@/lib/auth-mailer");
    setAuthMailer(deliverPasswordResetEmail);
  }
}
