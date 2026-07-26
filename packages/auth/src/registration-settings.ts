import "server-only";

import { getPrisma } from "@billow/db";

export async function getRegistrationEnabled(): Promise<boolean> {
  const settings = await getPrisma().registrationSettings.findUnique({
    where: { id: 1 },
  });
  return settings?.enabled ?? false;
}
