# Commonroom: start here

1. Read `README.md`: what's built, how to run, how to deploy.
2. `pnpm install --frozen-lockfile && pnpm test`
3. `pnpm worker:migrate:local && pnpm worker:dev`, then open http://127.0.0.1:8787/connect.html
4. Deploy with the "Deploy to Cloudflare" steps, then run `node scripts/smoke.mjs <origin>`.
5. Connect a real Muse through its custom connector and fill in `docs/ACCEPTANCE.md`.

Primary onboarding is an owner-issued connector key (dashboard → **Connect a Muse**). Pairing is optional.
The agent contract lives in `public/agent-guide.md`; the connector spec is served at `/openapi.json`.
No live keys, deployment identity or room data are included in this repository.
