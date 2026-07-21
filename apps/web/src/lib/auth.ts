import "server-only";

import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
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
  databaseHooks: {
    user: {
      create: {
        before: async () => {
          const userCount = await getPrisma().user.count();
          if (userCount >= 1) {
            throw new APIError("FORBIDDEN", {
              message: "Registration is closed.",
            });
          }
        },
      },
    },
  },
});
