# Folio for Windows

A working, independent desktop app inspired by Craft’s public documentation and published pages, inspected with REA. This is a first version, not full Craft feature parity.

## Open the app

Run `release/Folio-Windows.exe`. It is a portable Windows x64 application: no Node.js installation or account is needed to use the packaged app. Its first launch creates a workspace with a few example documents.

Your real workspace is stored in `%APPDATA%/Folio/workspace.json`. Settings displays the exact path. A previous-write copy is retained as `workspace.json.bak`. The executable and source folder do not contain your working notes.

## Included

- Rich text documents: headings, bold, italic, underline, strikethrough, lists, task lists, quotes, code, links, highlights, text colors, dividers, and resizable tables.
- Slash insertion menu, undo/redo, document outline, word count, local images and file attachments.
- Spaces, nested folders, nested pages, favorites, tags, full-text document search, grid/list library, and Trash with restore.
- Daily notes with a monthly calendar; one note per date.
- Tasks gathered from documents, quick task entry, due dates, and open/today/completed filters.
- Collections with table/gallery views, editable text/number/date/status/checkbox fields, and item pages.
- Whiteboards with freehand drawing, pen colors, movable sticky notes, and stroke undo.
- Six starter templates and the ability to save document templates.
- Page covers, three typography styles, comfortable/wide page widths, and light/dark mode.
- Automatic local saves, complete JSON workspace backups, backup import, basic Markdown/text import, and individual document Markdown/HTML/JSON export.

## Useful shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl K | Search documents and text |
| Ctrl N | New document |
| Ctrl S | Save immediately |
| Ctrl B / I / U | Bold / italic / underline |
| Ctrl Z / Ctrl Shift Z | Undo / redo |
| `/` while editing | Insert a block |
| Escape | Close a dialog |

Drag document cards onto a folder to move them. Collection names can be double-clicked to open an item page. Sticky-note text can be double-clicked to edit it.

## Practical limits of this version

The app works without a network connection. Cloud sync, collaborative editing, online publishing, Craft account integration, web embeds, online AI, and connected calendars are not included. Due dates are stored and displayed; operating-system reminder notifications are not implemented.

Collections and whiteboards currently live as separate documents rather than inline blocks. Collections do not yet have relations, custom status options, formulas, field hiding, or filter/sort/group controls. The whiteboard is a fixed canvas, not an infinite board. Block drag-and-drop, multi-column document layouts, inline mathematics, advanced block styling, and full-fidelity Craft import are not implemented.

Markdown/text import preserves basic headings and task lines; it is not a complete Markdown round trip. Markdown export preserves text and the most common formatting. HTML export is intended for ordinary documents; collection/board structure is best preserved with JSON workspace backups. Attachments are stored inside the workspace (12 MB per attachment; 100 MB workspace limit). Use Settings → Export workspace for a complete portable backup.

Public examples expose published-page behavior and documented features. They do not expose Craft’s private server implementation or establish exact parity with its signed-in editor. See `research/REA-findings.md` for the evidence boundary.

## Source and development

The app uses Electron, TipTap/ProseMirror, Vite, and Lucide. All runtime UI assets are bundled locally. The renderer has no Node.js access; desktop operations pass through a small preload bridge.

```powershell
npm install
npm run build
npm start
```

`npm test` runs interaction and persistence tests in an isolated workspace. `npm run package` builds the portable Windows executable. `npm run dev` serves the renderer for development, but the app’s persistence bridge is available only inside Electron.

The application is unsigned. No signing certificate was configured for this local build.

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

## Self-hosted PWA (Phase 2)

Docker builds the self-hosted PWA. For a non-container run, build it with
`npm run build:self-hosted` and start the local API with `npm run serve`.
The default `npm run build` remains the Netlify/Electron build.

Sign in using an account created on the server. Folio saves edits to the
browser first and syncs the complete workspace to SQLite when connected.
Edits made while signed out remain in the guest workspace. Export the guest
workspace before signing in if you want to bring those notes into an account.
Signing out leaves account drafts and caches in browser storage. Clear site data
to remove them from a shared device after exporting anything you need.

Folio checks the server when it starts, reconnects, or regains focus, and every
15 seconds while visible. If two tabs or devices change the same workspace
revision, the first save wins on the server. The other draft stays on its device.
In **Account**, download that draft or open the server copy after Folio starts a
draft download. The **Download pending drafts** option also recovers device-local
drafts from other tabs. If it downloads several drafts in one JSON file, each
array entry is a separate workspace backup. Background push on the self-hosted
origin is planned for Phase 3. Reminders still alert while Folio is open.

Run `npm run build:self-hosted && npm run test:web` to check sync in Chromium.
Use `npx playwright install chromium` if Playwright's browser is missing, or
set `FOLIO_CHROMIUM` to your installed Chromium executable.

### Future phase — n8n integration

Provide a versioned REST API for n8n to list, read, and create notes, tasks, and
reminders. Add calendar event endpoints only if Folio gains a separate event
model. The existing calendar displays daily notes and task due dates.

Use owner-bound, revocable credentials with independent read/create scopes per
resource. Store token hashes in Folio and keep the token itself in n8n's
credentials store. Document endpoints and errors with OpenAPI and include
examples for n8n's HTTP Request node. Use a private HTTPS endpoint, enforce
authorization on every route, and support idempotency keys on creates so workflow
retries do not create duplicates. REST writes must participate in the same
workspace revision checks as PWA writes. n8n should access Folio through HTTPS
and keep its own credentials and data volume.
