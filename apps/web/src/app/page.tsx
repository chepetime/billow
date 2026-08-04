import { getRegistrationEnabled, getSession } from "@billow/auth";
import { canRegister } from "@billow/auth/env";
import { getPrisma } from "@billow/db";

import { buttonVariants } from "@billow/shadcn/components/button";
import { Card, CardContent } from "@billow/shadcn/components/card";
import {
  ArrowRight,
  Check,
  Container,
  Database,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { getAppMetadata } from "@/lib/app-metadata";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const capabilities = [
  {
    icon: ShieldCheck,
    title: "Accounts, already finished",
    description:
      "Email and username sign-in, TOTP two-factor with backup codes, API keys, session management, admin roles and impersonation.",
  },
  {
    icon: Database,
    title: "A typed data layer",
    description:
      "Prisma against PostgreSQL, with migrations applied at container start, schema-validated forms, and workspace backup and restore.",
  },
  {
    icon: Container,
    title: "Built to be operated",
    description:
      "One Docker image, a health endpoint, a persisted error log, and CI that boots the built image and smoke-tests it before release.",
  },
] as const;

/**
 * Major versions only. Patch numbers on a landing page are stale within a
 * fortnight and nobody is choosing a starter on them; the major is the part
 * that actually tells you what you are getting into.
 */
const stack = [
  {
    layer: "Interface",
    items: [
      "Next.js 16 (App Router, RSC)",
      "React 19",
      "TypeScript 5",
      "Tailwind CSS 4",
      "shadcn/ui on Base UI",
    ],
  },
  {
    layer: "Data",
    items: ["PostgreSQL 16", "Prisma 7", "Zod 4", "React Hook Form"],
  },
  {
    layer: "Identity",
    items: [
      "better-auth",
      "TOTP two-factor",
      "API keys",
      "Admin and impersonation",
    ],
  },
  {
    layer: "Platform",
    items: [
      "next-intl",
      "next-themes",
      "Resend email",
      "File uploads",
      "Health and error log",
    ],
  },
  {
    layer: "Build and ship",
    items: [
      "pnpm workspaces",
      "Turborepo",
      "Vitest",
      "Playwright",
      "Docker on Node 24",
      "GitHub Actions to GHCR",
    ],
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
    metadata?.tagline ??
    "A self-hosted app with the boring parts already built.";
  const registrationOpen =
    userCount !== null && canRegister(userCount, registrationEnabled);
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
            A foundation for self-hosted apps
          </p>
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight text-balance sm:text-6xl">
            Everything before the interesting part, already done.
          </h1>
          {/*
            The tagline is operator-set metadata, so it stands as its own line
            rather than being glued to the front of the sentence below. Joined,
            an unexpected tagline turns the whole paragraph into a run-on that
            contradicts itself — which is exactly what a stale seeded value did.
          */}
          <p className="mt-6 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
            {tagline}
          </p>
          <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
            {name} is a full-stack starter for software you run yourself:
            accounts, two-factor, an API, migrations, backups, a Docker image
            and a release pipeline — so the only thing left to build is whatever
            you actually wanted to build.
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
                <span
                  className="size-2 rounded-full bg-emerald-500"
                  aria-hidden="true"
                />
                The stack
              </div>
              <span className="text-xs text-muted-foreground">
                TypeScript end to end
              </span>
            </div>
            <dl className="grid divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0 lg:grid-cols-5">
              {stack.map(({ layer, items }) => (
                <div key={layer} className="p-5 sm:p-6">
                  <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {layer}
                  </dt>
                  <dd>
                    <ul className="mt-3 space-y-2 text-sm">
                      {items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 py-16 sm:px-8 sm:py-20">
        <div className="max-w-xl">
          <p className="text-sm font-medium text-muted-foreground">
            What comes with it
          </p>
          <h2 className="mt-3 text-3xl font-semibold text-balance sm:text-4xl">
            The scaffolding every app needs and nobody enjoys writing twice.
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
            "A pnpm and Turborepo monorepo",
            "Tested with Vitest and Playwright",
            "Ships as a single Docker image",
            "Runs on Umbrel, or any Docker host",
          ].map((item) => (
            <span key={item} className="flex items-center gap-2">
              <Check
                aria-hidden="true"
                className="size-4 text-emerald-600 dark:text-emerald-400"
              />
              {item}
            </span>
          ))}
        </div>

        <p className="mt-10 max-w-2xl text-sm leading-6 text-muted-foreground">
          The signed-in app ships with a small invoicing workspace. It is a
          worked example of the platform rather than the point — a real domain
          wired through the same auth, validation, backups and API conventions,
          there to be replaced by yours.
        </p>
      </section>

      <footer className="border-t bg-muted/30">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-8 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div>
            <p className="font-medium text-foreground">{name}</p>
            <p className="mt-1 text-muted-foreground">
              A self-hosted starter, kept boring on purpose.
            </p>
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
