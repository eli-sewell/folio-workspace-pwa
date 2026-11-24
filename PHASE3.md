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
