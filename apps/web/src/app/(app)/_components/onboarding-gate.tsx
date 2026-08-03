"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

const ONBOARDING_PATH = "/onboarding/recovery-key";

/**
 * Sends a signed-in user to collect their recovery key until they confirm they
 * have it.
 *
 * This is a client component specifically because a layout cannot see the
 * current path. Redirecting from the layout would fire on every route beneath
 * it — including the onboarding page itself — and loop forever. Knowing the
 * pathname is the whole reason this runs in the browser.
 *
 * The cost is that the page underneath renders for a moment first. That is the
 * right trade here: the gate is about making sure the step happens, not about
 * hiding anything. Nothing behind it is secret from the user being redirected,
 * and a server-side gate that can trap someone in a redirect loop is far worse
 * than a brief flash.
 */
export function OnboardingGate({ needsRecoveryKey }: { needsRecoveryKey: boolean }) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!needsRecoveryKey) return;
    if (pathname === ONBOARDING_PATH) return;
    router.replace(ONBOARDING_PATH);
  }, [needsRecoveryKey, pathname, router]);

  return null;
}
