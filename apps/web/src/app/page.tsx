import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  Check,
  FileText,
  Landmark,
  Send,
} from "lucide-react";

import { buttonVariants } from "@billow/shadcn/components/button";
import { Card, CardContent } from "@billow/shadcn/components/card";
import { ThemeToggle } from "@/components/theme-toggle";
import { getAppMetadata } from "@/lib/app-metadata";
import { getSession } from "@/lib/auth-session";
import { canRegister } from "@/lib/registration";
import { getRegistrationEnabled } from "@/lib/registration-settings";
import { cn } from "@/lib/utils";
import { getPrisma } from "@billow/db";

export const dynamic = "force-dynamic";

const capabilities = [
  {
    icon: FileText,
    title: "Professional invoices",
    description:
      "Create clear invoices with your details, payment terms, and a consistent number sequence.",
  },
  {
    icon: Send,
    title: "Ready to send",
    description:
      "Keep each invoice moving from draft to sent, paid, or void without losing the history.",
  },
  {
    icon: Landmark,
    title: "Payment details included",
    description:
      "Store your bank details once and give every client exactly what they need to pay you.",
  },
] as const;

async function countUsers() {
  try {
    return await getPrisma().user.count();
  } catch {
    // The public site should still render while the local database is down.
    return null;
  }
}

export default async function Home() {
  const session = await getSession();
  if (session) {
    redirect("/dashboard");
  }

  const [metadata, userCount, registrationEnabled] = await Promise.all([
    getAppMetadata(),
    countUsers(),
    getRegistrationEnabled().catch(() => false),
  ]);
  const name = metadata?.name ?? "Billow";
  const tagline =
    metadata?.tagline ?? "Personal invoices without the spreadsheet drift.";
  const registrationOpen =
    userCount !== null &&
    canRegister(userCount, registrationEnabled);
  const primaryHref = registrationOpen ? "/register" : "/login";
  const primaryLabel = registrationOpen ? "Get started" : "Log in";

  return (
    <main className="min-h-svh bg-background text-foreground">
      <header className="border-b">
        <nav
          aria-label="Marketing navigation"
          className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-4 sm:px-8"
        >
          <Link href="/" className="text-base font-semibold">
            {name}
          </Link>

          <div className="flex items-center gap-1.5 sm:gap-3">
            <Link
              href="/"
              className={cn(
                buttonVariants({ variant: "ghost", size: "sm" }),
                "hidden sm:inline-flex",
              )}
            >
              Home
            </Link>
            <ThemeToggle className="hidden sm:flex" />
            <Link
              href="/login"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              Sign in
            </Link>
            <Link href={primaryHref} className={buttonVariants({ size: "sm" })}>
              {primaryLabel}
            </Link>
          </div>
        </nav>
      </header>

      <section className="border-b">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center px-6 pt-20 pb-12 text-center sm:px-8 sm:pt-28">
          <p className="mb-5 text-sm font-medium text-muted-foreground">
            Invoicing for independent work
          </p>
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight text-balance sm:text-6xl">
            Send invoices that make getting paid feel straightforward.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
            {tagline} {name} gives your invoices a dependable home from first
            draft through payment.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href={primaryHref} className={buttonVariants({ size: "lg" })}>
              {primaryLabel}
              <ArrowRight aria-hidden="true" />
            </Link>
            <Link
              href="/login"
              className={buttonVariants({ variant: "outline", size: "lg" })}
            >
              Sign in
            </Link>
          </div>

          <div className="mt-14 w-full overflow-hidden border bg-card text-left shadow-sm">
            <div className="flex items-center justify-between border-b px-5 py-3 sm:px-6">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />
                Invoice workspace
              </div>
              <span className="text-xs text-muted-foreground">July 2026</span>
            </div>
            <div className="grid divide-y sm:grid-cols-[1.25fr_0.75fr] sm:divide-x sm:divide-y-0">
              <div className="p-5 sm:p-6">
                <div className="mb-6 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      INVOICE
                    </p>
                    <p className="mt-1 text-xl font-semibold">#INV-024</p>
                  </div>
                  <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    Paid
                  </span>
                </div>
                <div className="space-y-3">
                  {[
                    ["Product design", "$1,800.00"],
                    ["Development support", "$950.00"],
                    ["Project handoff", "$250.00"],
                  ].map(([item, amount]) => (
                    <div
                      key={item}
                      className="flex items-center justify-between border-b pb-3 text-sm"
                    >
                      <span>{item}</span>
                      <span className="font-medium">{amount}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-5 flex items-center justify-between text-sm font-semibold">
                  <span>Total</span>
                  <span>$3,000.00 USD</span>
                </div>
              </div>
              <div className="flex flex-col justify-between bg-muted/30 p-5 sm:p-6">
                <div>
                  <p className="text-sm font-medium">Invoice overview</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    See each invoice, its status, and the amount due at a glance.
                  </p>
                </div>
                <dl className="mt-8 grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Outstanding</dt>
                    <dd className="mt-1 text-lg font-semibold">$1,240</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">This month</dt>
                    <dd className="mt-1 text-lg font-semibold">$8,450</dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 py-16 sm:px-8 sm:py-20">
        <div className="max-w-xl">
          <p className="text-sm font-medium text-muted-foreground">Everything in one place</p>
          <h2 className="mt-3 text-3xl font-semibold text-balance sm:text-4xl">
            Less invoice admin. More confidence in every payment.
          </h2>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {capabilities.map(({ icon: Icon, title, description }) => (
            <Card key={title} className="rounded-lg py-0 shadow-none">
              <CardContent className="p-5">
                <div className="flex size-9 items-center justify-center rounded-lg border bg-background">
                  <Icon aria-hidden="true" className="size-4" />
                </div>
                <h3 className="mt-5 text-base font-medium">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-3 border-t pt-8 text-sm text-muted-foreground">
          {[
            "Clear payment terms",
            "Printable invoice records",
            "A focused personal workspace",
          ].map((item) => (
            <span key={item} className="flex items-center gap-2">
              <Check aria-hidden="true" className="size-4 text-emerald-600 dark:text-emerald-400" />
              {item}
            </span>
          ))}
        </div>
      </section>

      <footer className="border-t bg-muted/30">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-8 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div>
            <p className="font-medium text-foreground">{name}</p>
            <p className="mt-1 text-muted-foreground">Personal invoicing, kept simple.</p>
          </div>
          <div className="flex items-center gap-4 text-muted-foreground">
            <Link href="/" className="hover:text-foreground">
              Home
            </Link>
            <Link href="/login" className="hover:text-foreground">
              Sign in
            </Link>
            <span>v{process.env.NEXT_PUBLIC_APP_VERSION}</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
