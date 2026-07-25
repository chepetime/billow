import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { getAppMetadata } from "@/lib/app-metadata";
import { getSession } from "@/lib/auth-session";
import { canRegister } from "@/lib/registration";
import { getPrisma } from "@billow/db";

export const dynamic = "force-dynamic";

const features = [
  "Draft and send invoices with your own branding details.",
  "Keep clients, bank accounts, and payment terms in one place.",
  "Print or save any invoice as a PDF.",
] as const;

async function countUsers() {
  try {
    return await getPrisma().user.count();
  } catch {
    // The landing page should still render if the database is unreachable.
    return null;
  }
}

export default async function Home() {
  const [metadata, session, userCount] = await Promise.all([
    getAppMetadata(),
    getSession(),
    countUsers(),
  ]);

  const registrationOpen = userCount !== null && canRegister(userCount);

  return (
    <main className="flex min-h-svh flex-col bg-background text-foreground">
      <section className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-6 py-16 sm:px-8">
        <div className="space-y-4">
          <p className="text-sm font-medium text-muted-foreground">
            Personal invoice app
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            {metadata?.name ?? "Billow"}
          </h1>
          <p className="text-lg leading-8 text-muted-foreground">
            {metadata?.tagline ??
              "Personal invoices without the spreadsheet drift."}
          </p>
        </div>

        <ul className="space-y-2">
          {features.map((feature) => (
            <li
              key={feature}
              className="flex gap-2.5 text-sm text-muted-foreground"
            >
              <span aria-hidden="true" className="text-foreground">
                —
              </span>
              {feature}
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-3">
          {session ? (
            <Link href="/dashboard" className={buttonVariants({ size: "lg" })}>
              Go to dashboard
            </Link>
          ) : (
            <>
              <Link href="/login" className={buttonVariants({ size: "lg" })}>
                Sign in
              </Link>
              {/* Registration is first-user-only, so only offer sign-up while
                  the instance still has no account. */}
              {registrationOpen ? (
                <Link
                  href="/register"
                  className={buttonVariants({ variant: "outline", size: "lg" })}
                >
                  Sign up
                </Link>
              ) : null}
            </>
          )}
        </div>

        <footer className="mt-auto pt-8 text-sm text-muted-foreground">
          Billow v{process.env.NEXT_PUBLIC_APP_VERSION}
        </footer>
      </section>
    </main>
  );
}
