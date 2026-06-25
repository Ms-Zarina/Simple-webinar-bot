# Simple Cestina Webinar Telegram Bot

Telegram bot for the webinar funnel: registration, warmup messages, webinar-day reminders, offer broadcast, follow-up, and reactivation.

## Quick Start

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```

## How to edit webinar content (for the marketing team)

**You only ever touch two things — no code files.**

| What you want to change            | Where                                                       |
| ---------------------------------- | ---------------------------------------------------------- |
| All texts, links, buttons, date    | `src/content/ru.json`                                      |
| Pictures the bot sends             | `src/assets/` (see [`src/assets/README.md`](src/assets/README.md)) |

### Where the texts are

Everything the bot says is in **`src/content/ru.json`**, grouped into sections:

- `webinar` — title, subtitle, description, **date**, **time**, timezone, Zoom link, recording link
- `leadMagnet` — the free PDF (title, description, link, button)
- `diagnostics`, `groupCourse`, `manager` — the offer blocks (title, description, link, button)
- `buttons` — labels for buttons
- `questions` — the goal/level questions and their answer options
- `messages` — every funnel message: welcome, warm-up series, day-of reminders, the offer, follow-ups, no-show

### How to replace the most common things

- **Zoom date / time:** edit `webinar.date` (format `YYYY-MM-DD`, e.g. `2026-07-15`), `webinar.time` (format `HH:MM`, e.g. `19:00`). The reminder schedule recalculates automatically.
- **Zoom link:** edit `webinar.zoomUrl`.
- **PDF gift link:** edit `leadMagnet.pdfUrl`.
- **Manager username:** edit `manager.username` (e.g. `@altos_manager`).
- **Recording link:** edit `webinar.recordingUrl`.
- **Pictures:** drop new PNGs into `src/assets/` using the exact filenames listed in [`src/assets/README.md`](src/assets/README.md).

### Placeholders inside texts

Messages can reuse content with `{{...}}` placeholders, so you change a value once:

```
"Вы зарегистрированы на вебинар «{{webinar.title}}» {{webinar.date}} в {{webinar.time}}."
```

Available placeholders: `{{webinar.title}}`, `{{webinar.date}}`, `{{webinar.time}}`,
`{{webinar.zoomUrl}}`, `{{webinar.recordingUrl}}`, `{{leadMagnet.pdfUrl}}`,
`{{diagnostics.url}}`, `{{groupCourse.url}}`, `{{manager.username}}`,
`{{links.audio}}`, `{{links.materials}}`, `{{links.trial}}`.

### What NOT to touch

- Do **not** rename the JSON keys (the left side of `"key": "value"`) — only edit the text after the colon.
- Do **not** change `key` values inside `questions.*.options` (e.g. `"key": "this_year"`) — they link answers to the database.
- Keep it valid JSON: every text in `"double quotes"`, items separated by commas, no trailing comma after the last item. Use `\n` for a line break inside a message.
- Do not edit any `.js` files or the `.env` file for content changes.

### Check your edit didn't break the file

After editing, validate the content loads (the bot also does this on startup and
refuses to start with a clear error if something is missing):

```bash
node -e "import('./src/content/loadContent.js').then(()=>console.log('content OK')).catch(e=>{console.error(e.message);process.exit(1)})"
```

If a required field is missing or the JSON is malformed, you get a precise list
of what to fix (e.g. `missing or empty string: webinar.zoomUrl`).

## Docker Deploy

```bash
cp .env.example .env
docker compose up -d --build
docker compose exec bot node src/db/migrate.js
docker compose logs -f bot
```

## Local PostgreSQL Setup

The bot can run locally (`npm run dev`) while only PostgreSQL runs in Docker.
PostgreSQL is **required** for Zoom attendance — registrants are persisted in the
`users` table so attendance survives restarts/deploys.

The `postgres` service in `docker-compose.yml` uses the default local
credentials (`simple` / `simple`, database `simple_bot`) and exposes port `5432`
to localhost, so the default `.env` works as-is:

```env
DATABASE_ENABLED=true
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=simple
DATABASE_PASSWORD=simple
DATABASE_NAME=simple_bot
```

Start Postgres, run migrations, then start the bot:

```bash
docker compose up -d postgres
npm run db:migrate
npm run dev
```

`npm run db:migrate` creates the `users` / `events_log` tables and adds the Zoom
columns (idempotent — safe to re-run). Data persists in the `pgdata` Docker
volume across restarts.

### Troubleshooting: port 5432 already in use

If `docker compose up -d postgres` fails with a port-bind error, or
`npm run db:migrate` connects to the wrong database (e.g. another local Postgres
already listening on 5432), check what owns the port.

On Windows (PowerShell):

```powershell
# Which process is listening on 5432?
Get-NetTCPConnection -LocalPort 5432 -State Listen |
  Select-Object LocalAddress, LocalPort, OwningProcess
Get-Process -Id (Get-NetTCPConnection -LocalPort 5432 -State Listen).OwningProcess
```

To use a different host port (e.g. 5433), change **only the host side** of the
mapping in `docker-compose.yml`:

```yaml
  postgres:
    ports:
      - "5433:5432"   # host 5433 -> container 5432
```

and set the matching host port in `.env`:

```env
DATABASE_PORT=5433
```

Then re-run:

```bash
docker compose up -d postgres
npm run db:migrate
npm run dev
```

(The container always listens on 5432 internally; only the host-side port
changes. The `bot` service inside Docker still connects via `postgres:5432` and
is unaffected.)

## Endpoints

- `POST /webhook/telegram` - Telegram webhook
- `GET /webhook/health` - healthcheck
- `POST /webhook/admin/broadcast-offer` - manual offer broadcast
- `POST /webhook/admin/mark-attendance` - mark attendee/no-show
- `POST /webhook/landing/register` - landing page webhook

## Google Sheets Integration Via Apps Script

This bot does not use the ManyChat native Google Sheets integration. The old ManyChat bot can continue using the existing integration. This Telegram webinar bot sends lead data to the same old Google Spreadsheet through a separate Apps Script Web App webhook.

### 1. Create A New Tab In The Existing Google Sheet

Open the existing Google Sheet that managers already use and create a new tab:

```text
Telegram Webinar Bot
```

The Apps Script code also creates this tab automatically if it does not exist.

### 2. Add Apps Script Code

In the Google Sheet:

1. Open `Extensions -> Apps Script`.
2. Create or open `Code.gs`.
3. Paste the code from:

```text
apps-script/telegram-webinar-bot.gs
```

4. Save the script.

### 3. Deploy Apps Script As Web App

In Apps Script:

1. Click `Deploy -> New deployment`.
2. Select type: `Web app`.
3. Execute as: `Me`.
4. Who has access: `Anyone`.
5. Click `Deploy`.
6. Copy the Web App URL.

### 4. Paste Web App URL Into `.env`

```env
GOOGLE_SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
```

Restart the bot after changing `.env`.

### 5. What The Bot Sends

The bot sends lead updates on:

- `/start`
- goal answer
- level answer
- Zoom registration (after the user becomes qualified)
- `/sync_zoom_attendance` (one row per registrant)

Payload example:

```json
{
  "source": "telegram_webinar_bot",
  "event": "lead_updated",
  "telegramId": "123456789",
  "telegramUsername": "username",
  "firstName": "Zarina",
  "lastName": "",
  "goal": "Планирую подать документы в этом году",
  "level": "A1-A2 - базовые фразы",
  "stage": "qualified",
  "webinarTitle": "Как сдать экзамен ПМЖ с первого раза",
  "webinarDate": "2026-06-21",
  "createdAt": "2026-06-21T20:45:00.000Z",
  "updatedAt": "2026-06-21T20:50:00.000Z",
  "zoomRegistrantId": "abc123",
  "zoomJoinUrl": "https://zoom.us/w/123?tk=...",
  "zoomAttendanceStatus": "attended",
  "zoomJoinTime": "2026-07-01T17:00:00Z",
  "zoomLeaveTime": "2026-07-01T18:05:00Z",
  "zoomDurationMinutes": 65,
  "followUpSegment": "attended",
  "followUpSentAt": ""
}
```

> The Apps Script repairs its header row automatically on the next write, so an
> existing `Telegram Webinar Bot` tab is migrated from 14 to 22 columns without
> losing data.

### 6. Test Apps Script Manually

```bash
curl -X POST "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec" \
  -H "Content-Type: application/json" \
  -d "{\"source\":\"telegram_webinar_bot\",\"event\":\"lead_updated\",\"telegramId\":\"123456789\",\"telegramUsername\":\"username\",\"firstName\":\"Zarina\",\"lastName\":\"\",\"goal\":\"Планирую подать документы в этом году\",\"level\":\"A1-A2 - базовые фразы\",\"stage\":\"qualified\",\"webinarTitle\":\"Как сдать экзамен ПМЖ с первого раза\",\"webinarDate\":\"2026-06-21\",\"createdAt\":\"2026-06-21T20:45:00.000Z\",\"updatedAt\":\"2026-06-21T20:50:00.000Z\"}"
```

Expected response:

```json
{ "ok": true }
```

## Zoom Integration (Server-to-Server OAuth)

The bot can register qualified users for a Zoom meeting/webinar, send each user a
personal join URL, and later reconcile attendance from the Zoom participant
report. This is additive — the warm-up messages and funnel logic are unchanged.

### 1. Create A Server-to-Server OAuth App

1. Go to https://marketplace.zoom.us -> `Develop` -> `Build App`.
2. Choose `Server-to-Server OAuth`.
3. Copy `Account ID`, `Client ID`, `Client Secret`.
4. Add scopes:
   - `meeting:write:admin` (registrants) — or `webinar:write:admin` for webinars.
   - `report:read:admin` (attendance report).
5. Activate the app.

### 2. Configure `.env`

```env
ZOOM_ENABLED=true
ZOOM_ACCOUNT_ID=your_account_id
ZOOM_CLIENT_ID=your_client_id
ZOOM_CLIENT_SECRET=your_client_secret
ZOOM_MEETING_TYPE=meeting        # or webinar
ZOOM_MEETING_ID=1234567890        # the numeric meeting/webinar id
ZOOM_ATTENDANCE_MINUTES=1
```

`ZOOM_CLIENT_SECRET` is never written to logs.

> Registration requires the meeting to have **registration enabled** in Zoom.
> The attendance report only returns data **after the meeting has ended** and
> requires a paid Zoom plan.

### 3. How It Works

- **After a user answers the level question** (becomes `qualified`), the bot
  registers them via `POST /{meetings|webinars}/{id}/registrants`, using
  `first_name`, `last_name`, `username`, `telegramId`. If Zoom requires an email,
  the bot uses the fallback `telegram_<telegramId>@example.com`. The personal
  `join_url` is sent to the user and `zoomRegistrantId` / `zoomJoinUrl` are synced
  to Google Sheets.
- **`/sync_zoom_attendance`** pulls the participant report and classifies each
  registrant:
  - `attended` — duration >= `ZOOM_ATTENDANCE_MINUTES`
  - `attended_short` — `0 < duration < ZOOM_ATTENDANCE_MINUTES`
  - `no_show` — registered but not present in the report
  Then it syncs the attendance fields to Google Sheets.

> Registrants are currently kept in memory (PostgreSQL is disabled), so run
> `/sync_zoom_attendance` in the same process lifetime as the registrations, or
> move the registry into the DB for durability.

### 4. Diagnostic Commands

- `/zoom_status` — checks `ZOOM_ENABLED`, required env vars, and requests an
  access token. Replies with a safe status (no secret).
- `/zoom_register_me` — quick Zoom registration test without going through the
  full `/start` -> goal -> level funnel. Registers the current Telegram user for
  the configured meeting and replies with the personal Zoom `join_url`. Google
  Sheets receives `Zoom Registrant ID` + `Zoom Join URL` for that user.
  > Warning: the registrant is stored in memory, so it counts toward
  > `/sync_zoom_attendance` only within the same bot process lifetime. If the bot
  > restarts before you sync attendance, the registry is empty and the user
  > cannot be reconciled.
- `/sync_zoom_attendance` — fetches the report, classifies attendance, and syncs
  to Google Sheets. Replies with per-status counts.
