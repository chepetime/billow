import Link from "next/link";

import { requireSession } from "@/lib/auth-session";

const placeholderCards = [
  {
    title: "Invoices",
    description: "Coming soon.",
  },
  {
    title: "Clients",
    description: "Coming soon.",
  },
] as const;

export default async function DashboardPage() {
  const session = await requireSession();

  return (
    <div className="flex flex-1 flex-col gap-8">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-normal">
          Welcome back, {session.user.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          Here&apos;s what&apos;s happening with your invoices.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {placeholderCards.map((card) => (
          <div key={card.title} className="rounded-lg border bg-card p-5">
            <h2 className="text-sm font-medium">{card.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {card.description}
            </p>
          </div>
        ))}
      </div>

      <p className="text-sm text-muted-foreground">
        Manage your account in{" "}
        <Link
          href="/settings"
          className="text-primary underline-offset-4 hover:underline"
        >
          Settings
        </Link>
        .
      </p>
    </div>
  );
}
