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

## Self-hosted server (Phase 1)

The Compose stack runs one Node 24 process. It serves the existing Vite build and exposes a local API for accounts, sessions, and workspaces. SQLite lives in the `folio-data` Docker volume on the Debian host, so recreating the container preserves the database. The PWA still uses its existing Supabase integration in this phase. Use test accounts and sample workspaces for the new API until the frontend switches over.

Start the stack for a local check:

```sh
docker compose up -d --build --wait
curl -fsS http://127.0.0.1:3000/api/health
```

Compose publishes port 3000 on the host's loopback address. To reach it from the tailnet, enable HTTPS for the tailnet, then run `tailscale serve --bg http://127.0.0.1:3000` on the Debian host. Set `FOLIO_ORIGIN` in a local Compose `.env` to the exact HTTPS origin printed by Serve, and run `docker compose up -d --wait` again. Use Tailscale access rules to limit who can reach the server. The configured origin is used to verify browser write requests.

Create a test account from a Bash shell. Reading the password silently keeps it out of shell history and process arguments.

```bash
read -rs -p 'Folio password (at least 12 characters): ' folio_password
printf '\n'
printf '%s\n' "$folio_password" | docker compose exec -T folio node server/account.mjs create you@example.com
unset folio_password
```

The account command also supports `reset-password EMAIL` with the same stdin input. A reset revokes existing sessions. There is no public signup endpoint. The API issues a secure session cookie and enforces workspace ownership. Each write supplies the revision it started from, so stale edits receive a conflict response.

Use `docker compose down` to stop the stack and preserve the data volume. Removing the volume deletes its SQLite database. For a local API test run `npm run test:server` on Node 24. Run `npm run build` first if you also want to open the PWA through `npm run serve`. Set `FOLIO_DB` to a writable database path for a non-container run.
