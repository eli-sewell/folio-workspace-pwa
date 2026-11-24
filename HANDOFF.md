# Folio self-hosting handoff

The development branch is `self-hosted/phase-2` in
[eli-sewell/folio-workspace-pwa](https://github.com/eli-sewell/folio-workspace-pwa).
Phase 1 is in `61f533d`, Phase 2 application changes are in `7b3f25d`, and
the Debian deployment guide was added in `69a4bfe`. The development branch
began at production commit `92c14d4`.

Phases 1 and 2 are complete. Debian and tailnet verification are pending.
Route traffic to a fresh test workspace until the owner approves a data
migration. Netlify and Supabase still serve production. The Debian host is a
Dell OptiPlex 3020 with an i3-4130, 8 GB RAM, and a 256 GB SSD. Docker Compose,
Tailscale, and a separate n8n instance already run there. Confirm actual host
ports and existing Serve routes with the owner before installing Folio.
Use the local agent's existing Tailscale connection and the owner's authorized
SSH account. If the earlier temporary Cloud deployment public key was installed,
the owner can remove its `folio-phase2-deploy` entry.

## Architecture and implementation

- **Build and runtime.** `Dockerfile` builds the Vite PWA with
  `npm run build:self-hosted`. One non-root Node 24 process serves the static
  assets and same-origin API. `compose.yaml` binds the host port to loopback
  and mounts the SQLite volume. Tailscale Serve provides HTTPS. The default
  Vite build still contains the legacy Netlify/Supabase integration, and
  Electron continues to use its local preload bridge.
- **Phase 1.** `server/index.mjs` serves assets and account, session,
  health, and workspace routes. `server/db.mjs` runs
  `server/migrations/001.sql` and configures SQLite with WAL and foreign keys.
  `server/auth.mjs` handles scrypt password hashes and hashed, revocable
  session tokens. The browser receives a secure HTTP-only cookie.
  `server/account.mjs` provides administrator-only account creation and
  password resets through stdin.
- **Phase 2.** `src/browser.js` selects the self-hosted browser adapter.
  `src/local-account.js` and `src/local-sync.js` handle sign-in, offline
  IndexedDB drafts, and synchronization. Drafts can be downloaded when a
  workspace revision conflicts. The API checks ownership and atomically compares
  revisions before saving. Conditional reads avoid retransmitting unchanged
  snapshots. `server/workspace.mjs` validates incoming version-1 workspaces.
  `vite.config.js` limits the self-hosted build to same-origin API access and
  keeps API responses out of service-worker caching.
- **Data model.** An account owns one versioned JSON snapshot containing
  notes, tasks, whiteboards, reminders, settings, and embedded attachments.
  Workspace JSON and per-note Markdown export already exist. Markdown has
  limited fidelity for rich content. Foreground reminders still work.
  Concurrent edits to different notes can conflict because sync operates on
  the entire workspace. Browser drafts remain local after sign-out.

## Completed tests

| Check | Result |
|---|---|
| Vite default build | Passed. The legacy build still includes the Supabase configuration. |
| `npm run build:self-hosted` | Passed. The local build uses a same-origin CSP and excludes the Supabase endpoint and publishable key. |
| `npm run test:server` | Passed. Covered account isolation, cross-origin write rejection, login, logout, password-reset revocation, conditional reads, concurrent revision conflicts, and persistence across a server restart. |
| `FOLIO_CHROMIUM=/usr/bin/chromium npm run test:web` after the self-hosted build | Passed twice on the final Phase 2 frontend. Two Chromium profiles exercised sync, simulated connection loss, offline reload, and verified the conflicting note was present in the downloaded draft. The test uses a deterministic request-failure shim along with Chromium offline mode. |
| Docker Compose smoke checks in Cloud | Phase 1 served a workspace that persisted across container replacement. Phase 2 served the self-hosted PWA and a healthy API over host loopback. The Phase 2 Docker smoke run preceded the final browser-only offline guard, which was verified in Chromium. The Cloud build used its proxy CA as a build-only secret. |
| `docker compose -p folio-home config` | Deployment values resolved to loopback port 3318, the sample HTTPS origin, and volume `folio-home_folio-data`. |

The existing Electron smoke suite, actual Debian deployment, Tailscale HTTPS
reachability, and coexistence with the live n8n instance were not verified in
Cloud. For the browser test, use the local Chromium path or install Playwright's
Chromium with `npx playwright install chromium`.

## Remaining phases

1. **Phase 3 — reminders and recovery.** Add local device-enrollment routes,
   VAPID credentials, and a scheduler with durable per-device delivery records,
   bounded retries, and cleanup of expired subscriptions. Verify notifications
   with the PWA closed and re-enroll devices on the new origin. Add consistent
   SQLite backups and rehearse restoring into a clean deployment. Verify
   Markdown and JSON export with representative data.
2. **Phase 4 — migration and cutover.** Rehearse a read-only Supabase export
   and transactional SQLite import. Preserve the original owner UUID,
   revision, and complete JSON snapshot. Reconcile any offline or guest drafts
   from the old origin before cutover. Validate content, reminders, links, and
   attachments, then coordinate a single write cutover and a rollback window.
   Record any writes made after cutover before reverting. Coordinate retiring
   the old reminder job so notifications are sent by only one system.
3. **Future — n8n integration.** Provide documented, versioned HTTPS endpoints
   for reading and creating notes, tasks, and reminders. Add calendar event
   endpoints if an event model is introduced. Use owner-bound revocable
   credentials with per-resource read/create scopes and idempotency keys for
   creates. Store credentials in n8n, keep writes in Folio's revision
   mechanism, and route all integration traffic through the API.

Wait for the owner's approval before starting the remaining implementation
phases or migrating production data.

## Deploy on Debian

Use the `self-hosted/phase-2` branch and a dedicated directory.

```sh
git clone --branch self-hosted/phase-2 --single-branch https://github.com/eli-sewell/folio-workspace-pwa.git ~/folio-self-hosted
cd ~/folio-self-hosted
docker compose ls --all
ss -ltn '( sport = :3318 or sport = :8443 )'
tailscale serve status
tailscale funnel status
```

The first two commands check out the deployment branch. Check that `folio-home`
is available as a Compose project name, 3318 and 8443 have no listeners, and
Tailscale Serve and Funnel have no route using 8443. If either port is in use,
choose another and use it consistently in the commands below. Enable HTTPS
certificates for your tailnet if needed, then add a private Serve listener on
Folio's own HTTPS port.

```sh
sudo tailscale serve --bg --https=8443 http://127.0.0.1:3318
```

Create `.env` in the checkout. Replace the example origin with the exact URL
printed by Serve, including the HTTPS port and omitting the trailing slash.

```dotenv
FOLIO_PORT=3318
FOLIO_ORIGIN=https://optiplex.example-tailnet.ts.net:8443
```

`FOLIO_PORT` sets the host loopback port that Serve connects to. The container
still listens on port 3000 internally. `FOLIO_ORIGIN` tells the API which
browser origin may send write requests. If tailnet access rules restrict ports,
allow the intended users and devices to reach the Folio HTTPS port.

```sh
docker compose -p folio-home config
docker compose -p folio-home up -d --build --wait
curl -fsS http://127.0.0.1:3318/api/health
```

`config` shows the resolved Compose configuration. `up` builds the image,
starts it in the background, and waits for its health check. On first start
the server initializes SQLite at `/data/folio.sqlite` in the
`folio-home_folio-data` Docker volume. The health request should return
`{"status":"ok"}`. Use a fresh workspace and test data until the migration.

Create a Folio account from Bash. The password prompt is silent, and the
password is passed through stdin.

```bash
read -rs -p 'Folio password (at least 12 characters): ' folio_password
printf '\n'
printf '%s\n' "$folio_password" | docker compose -p folio-home exec -T folio node server/account.mjs create you@example.com
unset folio_password
```

Replace the example email with your own. The account command also supports
`reset-password EMAIL` with the same stdin input. A reset revokes existing
sessions. Open the Serve URL from a tailnet device and sign in. You can also
append `/api/health` to that URL to verify the HTTPS route.

Use `docker compose -p folio-home down` to stop Folio and preserve its data
volume. To remove only Folio's Tailscale route, run
`sudo tailscale serve --https=8443 off` using the HTTPS port you selected.
Removing the Docker volume deletes the SQLite database.

## Prompt for local Codex

> Open the Folio checkout on branch `self-hosted/phase-2` and read
> `HANDOFF.md`. Help me deploy the completed Phase 2 build as a fresh test
> installation on my Debian OptiPlex through my existing Tailscale connection.
> Ask for my SSH username and tailnet hostname if needed. First inspect the
> host's Compose projects, listening ports, and Tailscale Serve/Funnel routes.
> Choose free ports and use a dedicated Folio Compose project and SQLite
> volume so n8n can keep running. Verify the loopback and tailnet HTTPS health
> endpoints, then help me create the first Folio account using a local password
> prompt and verify sync on two devices. Summarize what you changed and any
> checks I still need to perform. Keep Netlify and Supabase in service and wait
> for my approval before Phase 3 or any production data migration.
