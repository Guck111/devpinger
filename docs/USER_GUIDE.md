# User guide

Open `@devpinger_bot` in Telegram, tap `/start`, and follow the prompts.
This page lists every command and inline action the V1 bot understands.

## Commands

| Command | What it does |
| --- | --- |
| `/start` | Show the welcome screen, kick off Connect GitHub / Connect Jira. |
| `/help` | Show the command list. |
| `/sources` | Brief description of supported sources (GitHub, Jira). |
| `/repos` | List GitHub repositories you're currently watching. |
| `/projects` | List Jira projects you're currently watching. |
| `/mutes` | List your mute rules. Add new rules with the 🔕 button on any event. |
| `/recent` | Last 20 events delivered to you (within your retention window). |
| `/stats` | Activity summary — totals, priorities, source breakdown. |
| `/lang` | Switch language between English and Русский. |
| `/cancel` | Cancel a pending comment / reply step. |

## Inline actions

Every event arrives with a row of buttons. The available buttons depend
on the event type:

**GitHub pull request**

- ✅ **Approve** — submit an approving review
- 💬 **Comment** — bot asks for your text, then posts it on the PR
- 🔍 **View diff** — fetches the PR diff (inline if small, attached as
  a file otherwise)
- 😴 **1h / 4h / 1d** — snooze the event for that long
- 🔗 **Open** — deep-link to the PR on GitHub

**GitHub issue / issue comment**

- 💬 **Comment** — post a reply
- 😴 **4h** — snooze
- 🔗 **Open**

**GitHub workflow failure**

- 😴 **1h** — snooze
- 🔕 **Mute** — mute the repo so further failures don't notify
- 🔗 **Open**

**Jira issue**

- 💬 **Comment** — bot asks for your text, then posts on the issue
- 🔄 **Transition** — change status (V1 stub; the API call lands in V1.5)
- 😴 **4h** — snooze
- 🔗 **Open**

**Jira comment**

- ↩ **Reply** — bot asks for your text, then posts a follow-up
- 😴 **4h** — snooze
- 🔗 **Open**

## Mute rules

Mutes filter events before they're delivered. Four scopes:

| Scope | Example value | Matches |
| --- | --- | --- |
| `source` | `github` | All GitHub events |
| `repo` | `acme/backend` | All events from this GitHub repo |
| `project` | `DEV` | All Jira events on project `DEV` |
| `event_type` | `pull_request` | Any event whose type starts with `pull_request.` |

Tap 🔕 **Mute** on any event to add a rule that matches its scope. Use
`/mutes` to see the list. (Removal UI is V1.5 — for now, talk to
support or remove the row in the DB.)

## Self-suppression

By default, the bot doesn't echo back events you triggered yourself —
your own PR open / close / merge or your own comments. If you'd rather
see everything, change the setting in the bot's `/settings` menu (V1.5
adds the toggle; for now the column defaults to `false`).

## Snooze

A snooze hides the event for the duration you pick. When the timer
fires, the event is re-delivered with a fresh inline action row. If
the event has moved on in the meantime (closed, merged, etc.) the
re-delivery is skipped.

## Privacy notes

- OAuth tokens are encrypted at rest with AES-256-GCM. The encryption
  key never leaves the server.
- Self-mention detection compares the event's actor against your
  GitHub login / Jira accountId, not against your real name or email.
- Event bodies are stored truncated to ~240 characters of plaintext
  preview, not full payloads.
- Retention is plan-driven (`free` = 7 days, paid plans longer).
  Expired events are deleted from the database by the daily cleanup
  worker.
