-- API keys now carry a scope: {"billow":["read"]} or {"billow":["read","write"]}.
--
-- Every key issued before this has NULL permissions, and BetterAuth refuses
-- *every* permission check for such a key -- reporting the refusal as
-- KEY_NOT_FOUND, i.e. a 401 reading "invalid key" for a credential that is
-- perfectly valid. The application reads NULL as read-only rather than relying
-- on that path, but a key created while the API had no scopes was created with
-- full access, and silently demoting it would break a working integration.
--
-- So existing keys keep what they had. New keys default to read-only in the
-- settings form, which is where least privilege belongs: at issue time, as a
-- deliberate choice, not applied retroactively to something already deployed.
UPDATE "apikey"
SET "permissions" = '{"billow":["read","write"]}'
WHERE "permissions" IS NULL;
