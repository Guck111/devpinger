# User guide

Open `@dev_pinger_bot` in Telegram, tap `/start`, and follow the prompts.
This page lists every command and inline action the V1 bot understands.

## Commands

| Command | What it does |
| --- | --- |
| `/start` | Show the welcome screen, kick off Connect GitHub / Connect Jira. |
| `/help` | Show the command list. |
| `/repos` | List GitHub repositories you're currently watching. |
| `/projects` | List Jira projects you're currently watching. |
| `/mutes` | List your mute rules, with a button on each row to remove it. |
| `/recent` | Last 20 events delivered to you (within your retention window). |
| `/stats` | Activity summary — totals, priorities, source breakdown. |
| `/lang` | Switch language between English and Русский. |
| `/notify_self [on\|off]` | Toggle whether the bot notifies you about your *own* actions (PRs you opened, comments you authored). Default off. |
| `/cancel` | Cancel a pending comment / reply step. |

### Privacy commands

| Command | What it does |
| --- | --- |
| `/unsubscribe` | Delete your account. Cascades to connections, subscriptions, events, mute rules. Webhooks on the provider side (GitHub repo settings, Jira app) are not auto-revoked; revoke them manually if you reuse those repos. |
| `/export` | Download a JSON copy of your profile, connections (metadata only — tokens are **not** included), subscriptions, mute rules, and up to the last 1000 events. |
| `/forget_event <id>` | Delete a single event from your history. Get the id from `/export` or from callback button data (`act:approve:<id>`). |

### Admin

| Command | What it does |
| --- | --- |
| `/status` | Diagnostic snapshot for the bot operator. Gated by `ADMIN_TELEGRAM_ID` env var. |

## Inline actions

Every event arrives with a row of buttons. The available buttons depend
on the event type:

**GitHub pull request (open)**

- ✅ **Approve** — submit an approving review
- 💬 **Comment** — bot asks for your text, then posts it on the PR
- 🔍 **View diff** — fetches the PR diff (inline if small, attached as
  a file otherwise)
- 😴 **4h / 1d** — snooze the event for that long
- 🔕 **Mute** — open the mute-scope picker (event type / repo / source)
- 🔗 **Open** — deep-link to the PR on GitHub

For closed or merged PRs the Approve button is hidden; the remaining
row stays the same.

**GitHub issue / issue comment**

- 💬 **Comment** — post a reply
- 😴 **4h** — snooze
- 🔕 **Mute**
- 🔗 **Open**

**GitHub workflow failure**

- 😴 **1h** — snooze (shorter because CI flakes resolve faster)
- 🔕 **Mute** — usually scoped to the repo
- 🔗 **Open**

**Jira issue**

- 💬 **Comment** — bot asks for your text, then posts on the issue
- 🔄 **Transition** — shows the available next states for the issue and
  performs the chosen one via the Jira API
- 😴 **4h** — snooze
- 🔕 **Mute**
- 🔗 **Open**

**Jira comment**

- ↩ **Reply** — bot asks for your text, then posts a follow-up
- 😴 **4h** — snooze
- 🔕 **Mute**
- 🔗 **Open**

## Mute rules

Mutes filter events before they're delivered. Four scopes:

| Scope | Example value | Matches |
| --- | --- | --- |
| `source` | `github` | All GitHub events |
| `repo` | `acme/backend` | All events from this GitHub repo |
| `project` | `DEV` | All Jira events on project `DEV` |
| `event_type` | `pull_request` | Any event whose type starts with `pull_request.` |

Tap 🔕 **Mute** on any event to pick a scope and add a rule. Use
`/mutes` to see the list; each row has a Remove button.

## Self-suppression

By default the bot does **not** echo back events you triggered yourself —
your own PR open / close / merge, your own comments, your own Jira
transitions. Toggle with `/notify_self on` if you'd rather see
everything (useful for verifying webhook delivery during setup), or
toggle the same option from the bot's Settings menu.

## Snooze

A snooze hides the event for the duration you pick. When the timer
fires, the event is re-delivered with a fresh inline action row. If
the event has moved on in the meantime (closed, merged, etc.) the
re-delivery is skipped.

## Privacy notes

- OAuth tokens are encrypted at rest with AES-256-GCM. The encryption
  key never leaves the server (`packages/crypto/src/index.ts`).
- Self-mention detection compares the event's actor against your
  GitHub login / Jira accountId, not against your real name or email.
- Event bodies are stored truncated to ~240 characters of plaintext
  preview, not full payloads.
- Retention is plan-driven (`free` = 7 days, `personal` = 90 days,
  `pro` / `team` = 365 days). Expired events are deleted from the
  database by the daily cleanup worker. Delete a single event sooner
  with `/forget_event`.
