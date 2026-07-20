import { Button } from "@/components/ui/button";
import { getAppMetadata } from "@/lib/app-metadata";

export const dynamic = "force-dynamic";

const metadataRows = [
  ["App ID", "appId"],
  ["Version", "version"],
  ["Docker Image", "dockerImage"],
] as const;

export default async function Home() {
  const metadata = await getAppMetadata();

  return (
    <main className="flex min-h-svh flex-col bg-background text-foreground">
      <section className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-10 sm:px-8 lg:py-16">
        <div className="space-y-4">
          <p className="text-sm font-medium text-muted-foreground">
            Personal invoice app
          </p>
          <h1 className="max-w-2xl text-3xl font-semibold tracking-normal text-balance sm:text-4xl">
            {metadata?.name ?? "Billow"}
          </h1>
          <p className="max-w-2xl text-base leading-7 text-muted-foreground">
            {metadata?.tagline ??
              "Personal invoices without the spreadsheet drift."}
          </p>
        </div>

        <div className="overflow-hidden rounded-lg border bg-card">
          <dl className="divide-y">
            {metadataRows.map(([label, key]) => (
              <div
                className="grid gap-1 px-4 py-3 sm:grid-cols-[160px_1fr] sm:gap-6 sm:px-5"
                key={key}
              >
                <dt className="text-sm font-medium text-muted-foreground">
                  {label}
                </dt>
                <dd className="break-words text-sm font-medium">
                  {metadata?.[key] ?? "Not seeded"}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <form action="/api/metadata" method="get">
          <Button type="submit" variant="outline" size="lg">
            View API JSON
          </Button>
        </form>
      </section>
    </main>
  );
}
