"use client";

import { createAuthClient } from "better-auth/react";
import {
  adminClient,
  twoFactorClient,
  usernameClient,
} from "better-auth/client/plugins";
import { apiKeyClient } from "@better-auth/api-key/client";

export const authClient = createAuthClient({
  plugins: [
    usernameClient(),
    // BetterAuth handles the successful sign-in response before the form sees
    // it. Give its client plugin the local challenge page explicitly.
    twoFactorClient({ twoFactorPage: "/two-factor" }),
    apiKeyClient(),
    adminClient(),
  ],
});
