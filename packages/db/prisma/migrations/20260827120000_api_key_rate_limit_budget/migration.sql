-- BetterAuth's api-key plugin stores the rate-limit budget on each key row at
-- creation time, so changing the plugin's configuration only affects keys
-- created afterwards. Every key issued so far carries the plugin's own
-- defaults -- 10 requests per 24 hours -- which is a budget for occasional use,
-- not for the account owner's own scripts. Nothing in this app has ever set
-- these per key, so a row still holding both old defaults is one that never
-- had a deliberate value, and is safe to move onto the new budget.
UPDATE "apikey"
SET "rateLimitMax" = 120,
    "rateLimitTimeWindow" = 60000
WHERE "rateLimitMax" = 10
  AND "rateLimitTimeWindow" = 86400000;

-- The column defaults are inert -- the plugin always writes both values
-- explicitly on insert -- but they are what the schema advertises, so they
-- track the application defaults rather than contradicting them.
ALTER TABLE "apikey" ALTER COLUMN "rateLimitTimeWindow" SET DEFAULT 60000;
ALTER TABLE "apikey" ALTER COLUMN "rateLimitMax" SET DEFAULT 120;
