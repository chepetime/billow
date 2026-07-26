import type { Metadata } from "next";
import Link from "next/link";

import { ApiReference } from "@/app/docs/api/api-reference";

export const metadata: Metadata = {
  title: "API Reference | Billow",
  description: "Billow's personal API reference.",
};

export default function ApiDocsPage() {
  return (
    <main className="min-h-svh bg-background text-foreground">
      <div className="border-b px-6 py-3 text-sm">
        <Link className="text-primary underline-offset-4 hover:underline" href="/api/auth/open-api/generate-schema">
          Better Auth OpenAPI document
        </Link>
      </div>
      <ApiReference />
    </main>
  );
}
