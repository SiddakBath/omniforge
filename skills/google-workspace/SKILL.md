---
name: Google Workspace
description: Gmail, Calendar, Drive, Contacts, Sheets, and Docs via `gog` CLI.
homepage: https://gogcli.sh
metadata:
  emoji: "🎮"
  requires:
    bins:
      - gog
    env:
      - GOG_ACCOUNT
---

# Google Workspace

Use `gog` for Gmail, Calendar, Drive, Contacts, Sheets, and Docs. Requires OAuth setup.

Setup (once)

- `gog auth credentials /path/to/client_secret.json`
- `gog auth add you@gmail.com --services gmail,calendar,drive,contacts,docs,sheets`
- `gog auth list`

Common commands

**Gmail**

- Search: `gog gmail search 'newer_than:7d' --max 10`
- Send plain: `gog gmail send --to a@b.com --subject "Hi" --body "Hello"`
- Send with file: `gog gmail send --to a@b.com --subject "Hi" --body-file ./message.txt`
- Send HTML: `gog gmail send --to a@b.com --subject "Hi" --body-html "<p>Hello</p>"`
- Draft: `gog gmail drafts create --to a@b.com --subject "Hi" --body-file ./message.txt`
- Reply: `gog gmail send --to a@b.com --subject "Re: Hi" --body "Reply" --reply-to-message-id <msgId>`

**Calendar**

- List events: `gog calendar events <calendarId> --from <iso> --to <iso>`
- Create event: `gog calendar create <calendarId> --summary "Title" --from <iso> --to <iso>`
- With color: `gog calendar create <calendarId> --summary "Title" --from <iso> --to <iso> --event-color 7`
- Update event: `gog calendar update <calendarId> <eventId> --summary "New Title"`
- Show colors: `gog calendar colors`

**Drive**

- Search: `gog drive search "query" --max 10`
- List files: `gog drive list --max 20`

**Contacts**

- List: `gog contacts list --max 20`

**Sheets**

- Get range: `gog sheets get <sheetId> "Tab!A1:D10" --json`
- Update: `gog sheets update <sheetId> "Tab!A1:B2" --values-json '[["A","B"],["1","2"]]'`
- Append: `gog sheets append <sheetId> "Tab!A:C" --values-json '[["x","y","z"]]'`
- Clear: `gog sheets clear <sheetId> "Tab!A2:Z"`

**Docs**

- Export: `gog docs export <docId> --format txt --out /tmp/doc.txt`
- Cat: `gog docs cat <docId>`

Email formatting

- Prefer plain text with `--body-file` for multi-paragraph
- Use `--body-file -` for stdin: `gog gmail send --to x@y.com --subject "Hi" --body-file -`
- `--body` does not unescape `\n`; use heredoc: `$'Line 1\n\nLine 2'`
- HTML: `<p>`, `<br>`, `<strong>`, `<em>`, `<a href="url">`, `<ul>`/`<li>`

Calendar colors

- IDs 1-11 available (use `gog calendar colors` to list)
- Example: 1=#a4bdfc, 2=#7ae7bf, 4=#ff887c, 7=#46d6db

Principles

1. Confirm before sending mail or creating events
2. Set `GOG_ACCOUNT` env to skip repeating `--account`
3. For scripting, prefer `--json` plus `--no-input`
4. Sheets: use `--values-json` for complex data
5. Docs supports export/cat/copy (in-place edits need full API client)

Notes

- `gog gmail search` returns one row per thread
- Use `gog gmail messages search` for individual emails
- Pagination: most commands support `--max` and offset flags
