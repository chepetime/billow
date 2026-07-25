import { headers } from "next/headers";

import { AccountForm } from "@/app/(app)/_components/account-form";
import {
  ApiKeysSection,
  type ApiKeySummary,
} from "@/app/(app)/_components/api-keys-section";
import { TwoFactorSection } from "@/app/(app)/_components/two-factor-section";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/auth-session";
import { recordError } from "@/lib/error-log";

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

export default async function SettingsPage() {
  const session = await requireSession();
  const apiKeys = await listApiKeys();
  const user = session.user as typeof session.user & {
    username?: string | null;
    twoFactorEnabled?: boolean | null;
  };

  return (
    <div className="flex flex-1 flex-col gap-8">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-normal">
          Account settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage your profile, security, and integrations.
        </p>
      </div>

      <AccountForm
        name={user.name}
        email={user.email}
        username={user.username ?? null}
      />

      <TwoFactorSection enabled={Boolean(user.twoFactorEnabled)} />

      <ApiKeysSection keys={apiKeys} />
    </div>
  );
}
