import Link from "next/link";

import type { InvoiceFormOptions } from "@/lib/workspace-records";

/**
 * What an invoice is missing before it can be created.
 *
 * Requirements: onboarding sections may be skipped, but invoice creation
 * requires the missing records. This names which ones and links straight at
 * them rather than sending the user back to a generic setup screen.
 */
export function WorkspaceSetupNotice({
  options,
}: {
  options: InvoiceFormOptions;
}) {
  if (!options.available) {
    return (
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-sm font-medium">Database unavailable</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Billow could not reach the database. Try again in a moment.
        </p>
      </div>
    );
  }

  const missing = [
    {
      done: options.profiles.length > 0,
      label: "A sender profile",
      href: "/senders/new",
      cta: "Add a sender",
    },
    {
      done: options.accounts.length > 0,
      label: "A bank account",
      href: "/banks/new",
      cta: "Add an account",
    },
    {
      done: options.clients.length > 0,
      label: "A client",
      href: "/clients/new",
      cta: "Add a client",
    },
  ];

  return (
    <div className="rounded-lg border bg-card p-6">
      <h2 className="text-sm font-medium">Set up your workspace first</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        An invoice needs a sender, somewhere to be paid, and someone to bill.
      </p>

      <ul className="mt-4 space-y-3">
        {missing.map((item) => (
          <li
            key={item.href}
            className="flex flex-wrap items-center justify-between gap-3 text-sm"
          >
            <span
              className={
                item.done ? "text-muted-foreground line-through" : undefined
              }
            >
              {item.label}
            </span>
            {item.done ? (
              <span className="text-sm text-muted-foreground">Done</span>
            ) : (
              <Link
                href={item.href}
                className="text-primary underline-offset-4 hover:underline"
              >
                {item.cta}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
