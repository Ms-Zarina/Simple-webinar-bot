# Simple Čestina Webinar Telegram Bot

Telegram-бот для вебинарной воронки: регистрация, прогрев, день вебинара, follow-up и реактивация.

## Быстрый запуск

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```

## Docker deploy

```bash
cp .env.example .env
nano .env
docker compose up -d --build
docker compose exec bot node src/db/migrate.js
docker compose logs -f bot
```

## Endpoints

- `POST /webhook/telegram` — Telegram webhook
- `GET /webhook/health` — healthcheck
- `POST /webhook/admin/broadcast-offer` — ручной запуск оффера
- `POST /webhook/admin/mark-attendance` — отметить посетил/не посетил
- `POST /webhook/landing/register` — webhook от лендинга
