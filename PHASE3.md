# Phase 3 operations

Phase 3 adds self-hosted Web Push delivery and SQLite backup/recovery. It does not migrate production data or change the Netlify/Supabase deployment.

## Device notifications

Open **Reminders** in the installed Folio PWA and select **Enable device notifications** on every device that should receive alerts. On iPhone and iPad, install Folio with Safari's **Add to Home Screen** first and enable notifications from that installed app.

The server stores VAPID credentials, enrolled endpoints, and durable delivery records in SQLite. It checks for due reminders every 30 seconds, retries temporary failures with bounded backoff, removes subscriptions rejected as expired by a push provider, and prunes old delivery records. A device receives only reminders that become due after that device enrolls.

## Backups

Compose mounts a separate `folio-home_folio-backups` volume at `/backups`. The server creates and integrity-checks a backup after startup and every 24 hours. It retains 14 backups by default; set `FOLIO_BACKUP_KEEP` in `.env` to change this.

List and verify backups:

```sh
docker compose -p folio-home exec folio sh -lc 'ls -lh /backups'
docker compose -p folio-home exec folio node server/backup.mjs verify /backups/BACKUP.sqlite
```

Create one immediately:

```sh
docker compose -p folio-home exec folio node server/backup.mjs create
```

Rehearse a restore without touching the live database:

```sh
docker compose -p folio-home exec folio node server/backup.mjs restore /backups/BACKUP.sqlite /backups/restore-rehearsal.sqlite
docker compose -p folio-home exec folio node server/backup.mjs verify /backups/restore-rehearsal.sqlite
```

The backup volume protects against a bad application update or a damaged live database, but it is on the same OptiPlex disk. Copy backups to another machine or drive to protect against SSD or host loss.

## Rollback

The Phase 2 Git commit remains `a8a92be`. Before rolling back application code, create and preserve a current Phase 3 backup. Phase 2 cannot open a database after the Phase 3 schema migration, so rollback requires restoring a pre-Phase-3 database backup or retaining the Phase 3 server code.

Phase 4 production migration still requires separate owner approval.

## OptiPlex deployment update, November 27, 2026

Folio runs as a private web app on the Debian OptiPlex. The browser keeps a local workspace for offline use and syncs changes to the Folio service. SQLite on the server holds the shared workspace. The Folio Compose project is named `folio-home`. Tailscale Serve provides HTTPS on port 8443 for the app and 9443 for the Muse API. The app and API listeners on the host use loopback ports 3318 and 3319. The backup procedure above applies to the shared database.

### Using the planner

Open **Calendar & Reminders**. Month cells show the first event title and a count of additional events. Select a date to see its events, due tasks, and reminders. The daily note opens through its own button. The day panel appears alongside the calendar on wide screens and below it on phones. **Event agenda** lists events for the displayed month.

Choose **New event** and enter a title and date. Leave the time blank for an all-day event. A timed entry uses the device time zone for input and the planner displays event times in America/New_York. Location is optional. The Reminders section supports adding and dismissing reminders and enabling device notifications.

### Muse integration

The optional Compose override runs an agent listener against the same workspace. Muse can read today and the week and create tasks, reminders, and standalone events. Its Tailscale tag has access to TCP 9443 on the server. The application authenticates workspace requests with a bearer token scoped to the configured account. The token and account configuration belong in the private server-side .agent.env file.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | /api/v1/health | Check listener health |
| GET | /api/v1/today | Read today's schedule |
| GET | /api/v1/week | Read the week's schedule |
| POST | /api/v1/tasks | Create a task or reminder |
| POST | /api/v1/events | Create a calendar event |

### Verification and release status

The November 27 release passed a browser test covering event creation at desktop width and agenda visibility at phone width. Two-device sync, offline conflict recovery, and authenticated agent API tests passed. The deployed app returned a healthy response over tailnet HTTPS and served the expected release assets. Physical iPad behavior was not part of that browser test.

Event editing, deletion, recurrence, and Apple or Google calendar import remain open. The earlier Supabase workspace importer serves a different purpose. The deployment worktree contains planner and agent source changes that were not present in GitHub commit e465e0b. This operations update documents the live behavior. Rebuilding that commit alone will omit those features.
