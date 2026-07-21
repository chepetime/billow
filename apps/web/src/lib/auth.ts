import "server-only";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

import { getAuthEnv } from "@/lib/auth-env";
import { getPrisma } from "@billow/db";

const authEnv = getAuthEnv(process.env, {
  allowBuildFallback: process.env.NEXT_PHASE === "phase-production-build",
});

export const auth = betterAuth({
  baseURL: authEnv.baseUrl,
  secret: authEnv.secret,
  database: prismaAdapter(getPrisma(), {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      console.info(
        `Password reset requested for ${user.email}. Reset URL: ${url}`,
      );
    },
  },
});
