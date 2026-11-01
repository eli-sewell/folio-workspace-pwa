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
