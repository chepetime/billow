import { auth, requireSession } from "@billow/auth";
import type { Metadata } from "next";
import { headers } from "next/headers";
import {
  type ApiKeySummary,
  ApiKeysSection,
} from "@/app/(app)/_components/api-keys-section";
import { recordError } from "@/lib/error-log";

export const metadata: Metadata = {
  title: "API keys",
};

export const dynamic = "force-dynamic";

async function listApiKeys(): Promise<ApiKeySummary[]> {
  try {
    const result = await auth.api.listApiKeys({ headers: await headers() });
    return (Array.isArray(result) ? result : result.apiKeys) as ApiKeySummary[];
  } catch (error) {
    await recordError("listApiKeys", error);
    return [];
  }
}

export default async function ApiKeysSettingsPage() {
  await requireSession();
  const apiKeys = await listApiKeys();

  return (
    <div className="space-y-8">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-normal">API keys</h1>
        <p className="text-sm text-muted-foreground">
          Create personal credentials for integrations that call the Billow API.
        </p>
      </div>

      <ApiKeysSection keys={apiKeys} />
    </div>
  );
}
