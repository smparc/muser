# Acceptance report

Date: 2026-09-19. Three kinds of evidence are kept separate below:

- **Verified locally**: automated tests (`pnpm test`: 37 passing, including a Miniflare D1 run), an HTTP smoke run against `wrangler dev` (the real Workers runtime with local D1), and a browser check of the dashboard and 3D room.
- **Needs deployment**: requires a public HTTPS origin. Nothing has been deployed yet; the owner's Cloudflare account is needed.
- **Needs Muse**: requires a real Muse custom connector. No Muse client has been used. Every "agent" request so far came from test code.

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | New owner creates a connector key without pairing | Verified locally | `tests/connector.test.mjs` "owner issues a connector key without any pairing"; smoke step 1; browser: the dashboard issued a key and showed **Awaiting first request** |
| 2 | Key saved in Muse's connector; `/me` succeeds through it | Local HTTP only; **needs Muse** | Bearer-only `/me` → Connected (tests, smoke step 2, browser). Not yet exercised by Muse's connector |
| 3 | Muse answers the initial task; dashboard shows the real reply | Local HTTP only; **needs Muse** | Reply rendered in dashboard and 3D panel from a test client |
| 4 | Connector works in a later Muse session without re-pasting | **Needs Muse** | Server side: keys are stateless bearer credentials valid until expiry, replacement or revocation |
| 5 | Recurring Muse task answers new work after prompting stops | **Needs Muse** | Dashboard records every inbox check and shows the median gap plus reply times. Record the configured schedule and actual reply times here |
| 6 | Exact retries create one record; wrong nonce and cross-connection answers fail | Verified locally | connector, mcp and d1 tests (concurrent retries on real D1); smoke step 6 |
| 7 | Replacement kills the old key; updating restores access | Verified locally (server side) | Tests and smoke step 7. Updating the saved Muse connector **needs Muse** |
| 8 | Revoked and expired keys fail; another owner cannot issue, replace or revoke | Verified locally | connector and owner-auth tests; smoke step 8 |
| 9 | Data survives restarts; private data unavailable anonymously and across rooms | Verified locally | SQLite reopen test; `wrangler dev` state persisted in `.wrangler/state`; anonymous 401; cross-room isolation tests |
| 10 | External connector traffic reaches the deployed API without cookies or challenges | **Needs deployment + Muse** | Agent routes need no cookies. Run `node scripts/smoke.mjs <origin>` from outside, then test Muse itself. Keep bot protection off for `/api/v1/*` and `/mcp` |
| — | Platform sign-in forwards a stable identity | Standalone: verified locally. Sites: **needs deployment** | Standalone accounts are app-managed. For Sites, check `oai-authenticated-user-id` is present |

## Live integration log (fill in during Muse testing)

| Field | Value |
| --- | --- |
| Deployment origin | |
| Connector type used (REST/OpenAPI or MCP) | |
| Connector fields as configured (no secret) | |
| First `/me` through connector (time) | |
| Initial reply (time, text) | |
| New session without re-paste (pass/fail) | |
| Configured schedule reported by Muse | |
| Observed median inbox-check gap (dashboard) | |
| Delayed or round task queued → answered (times) | |
| Key replacement → connector updated → access restored | |
| Remaining issues | |
