import { notFound } from "next/navigation";

import { ForgotPasswordForm } from "@/app/(auth)/_components/forgot-password-form";
import { requireGuest } from "@billow/auth";
import { getEmailCapability } from "@billow/email";

export const dynamic = "force-dynamic";

export const metadata = { title: "Reset your password" };

export default async function ForgotPasswordPage() {
  await requireGuest();

  // Hiding the link on the sign-in page is not enough on its own: a bookmark,
  // a shared URL or a search result would otherwise still reach a form whose
  // only possible outcome is "check your inbox" for a message that cannot be
  // sent. 404 rather than a redirect, because on an installation without
  // email this page genuinely does not exist.
  const { canSendUserEmail } = await getEmailCapability();
  if (!canSendUserEmail) notFound();

  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-background px-6 py-10 text-foreground">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1.5 text-center">
          <h1 className="text-2xl font-semibold tracking-normal">
            Reset your password
          </h1>
          <p className="text-sm text-muted-foreground">
            Enter your email and we&apos;ll send you a link to choose a new
            password.
          </p>
        </div>

        <div className="rounded-lg border bg-card p-6">
          <ForgotPasswordForm />
        </div>

        {/*
          Stated before the reset, not after it. A reset changes the password
          but not the key the data is encrypted with, so anyone without their
          recovery key needs to know that now — while they might still remember
          the old password — rather than discovering it at the next sign-in.
        */}
        <p className="text-sm text-muted-foreground">
          Resetting your password does not unlock your data on its own. You will
          need your recovery key afterwards to get back to it — without it, a
          reset leaves that data unreadable.
        </p>
      </div>
    </main>
  );
}
