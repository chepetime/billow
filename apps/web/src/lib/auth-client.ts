"use client";

import { createAuthClient } from "better-auth/react";
import { twoFactorClient, usernameClient } from "better-auth/client/plugins";
import { apiKeyClient } from "@better-auth/api-key/client";

export const authClient = createAuthClient({
  plugins: [usernameClient(), twoFactorClient(), apiKeyClient()],
});
