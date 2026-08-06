# GitHub Support request — purge unreachable objects

Send from the account that owns `chepetime/billow`, via
<https://support.github.com/contact> (category: *Account or repository*).

Delete this file once GitHub confirms the objects are gone.

---

**Subject:** Permanently remove unreachable objects containing personal data — chepetime/billow

Hello,

I force-pushed rewritten history to `chepetime/billow` to remove personal and
financial data that had been committed to a seed file by mistake. The rewrite is
complete: the data no longer exists in any branch or tag.

However, the pre-rewrite objects are still reachable by SHA. Before I made the
repository private I confirmed that both of these returned HTTP 200 after the
force-push:

- `https://github.com/chepetime/billow/commit/c0ed04faa99ac6890229e57f62e5affad9fc7a45`
- `https://raw.githubusercontent.com/chepetime/billow/c0ed04faa99ac6890229e57f62e5affad9fc7a45/app/prisma/seed.mjs`

Please run garbage collection on the repository so the unreachable objects are
permanently deleted from GitHub's storage, and confirm when it is done.

Details:

- **Repository:** chepetime/billow (now private; it was public from 2026-07-20
  until 2026-08-05)
- **Data involved:** a bank account number and CLABE, a national tax ID (RFC), a
  home address, a personal email address, a legal name, and employment details
- **First bad commit:** `c0ed04faa99ac6890229e57f62e5affad9fc7a45` (2026-07-20),
  file `app/prisma/seed.mjs`, later moved to `packages/db/prisma/seed.mjs`
- **Current tips after the rewrite:** `main` at `944197f`, tag `v0.1.0` at
  `02de8fa`
- **Forks:** none
- **Pull request refs:** PRs #1–#15 may still reference pre-rewrite commits;
  please include `refs/pull/*` in the cleanup

I intend to make the repository public again once you confirm. Please let me
know if anything else is needed from me first.

Thank you,
Jose

---

## After GitHub confirms

1. Re-check that the SHA above returns 404 while signed out.
2. `gh repo edit chepetime/billow --visibility public`
3. Delete this file.
