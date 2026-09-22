# Tulpie Brew

A Telegram coffee-order queue bot designed to keep admin work to a minimum.

## Queue workflow

1. An admin opens the shop.
2. Customers choose a drink, confirm it, and join the queue. Everyone can view the read-only customer queue.
3. The bot automatically notifies the first two customers:
   - Queue #1: **It is your turn. Please come to the coffee counter now.**
   - Queue #2: **You are next. Please be ready.**
4. Queue #1 collects their drink and presses **Done / Collected**.
5. The bot completes that order, tells the former Queue #2 it is now their turn, and notifies the new Queue #2 that they are next.
6. The process continues until the queue is empty.

Customers see only their own order, status, and queue position. Only admins can see the complete queue and order details.

## Features

- Customer and admin roles
- Admins can add or remove other admins; use a numeric Telegram ID or an @handle after that person has sent `/start` to the bot
- Open, pause, resume, and close shop controls
- Pausing or closing blocks new orders while the existing queue continues normally
- Two-person automatic notification window
- Customer-driven **Done / Collected** queue progression
- Admin **Advance current** fallback
- Customer and admin cancellation
- Customers can edit only when they are behind queue positions #1 and #2
- Admin queue view with full order details
- Full-width customer controls and compact two-column admin controls
- Customer order view with their own order, status, and queue position
- Customizable customer help instructions
- Opt-in, persisted notifications sent only after an admin explicitly opens the shop
- Opt-in admin order alerts for new, edited, and customer-cancelled orders
- Persisted shop status across bot restarts without duplicate opening alerts
- Editable menu/opening message included in opening notifications
- Editable menu with drink descriptions, availability, and a customer-facing image
- Shop-cup lending with admin-managed available inventory and automatic reservation
- JSON persistence for the initial version

## Setup

Requirements: Node.js 22.9 or newer and a Telegram bot token from BotFather.

```bash
cp .env.example .env
```

Set these values in `.env`:

```text
TELEGRAM_BOT_TOKEN=your-token
ADMIN_IDS=your-numeric-telegram-user-id
DATA_FILE=./data/state.json
```

Multiple initial admins can be comma-separated. Start the bot with:

```bash
npm start
```

Run tests with:

```bash
npm test
```

## Dry run

`scripts/dry-run.js` drives the bot against a fake Telegram client and prints
every message it would send, naming each recipient. It needs no bot token, makes
no network calls, and writes no state file, so it is safe to run while the real
bot is live.

```bash
npm run dry-run            # order alerts: who is notified about what
npm run dry-run -- queue   # queue progression as customers are served
npm run dry-run -- all
```

Screen edits are hidden by default so the notifications stand out; set
`SHOW_EDITS=1` to include them.

Use this to check notification behaviour before touching a real bot. To test
against Telegram itself, create a **second** bot with BotFather and point a
separate `DATA_FILE` at it. Never run a second instance against the production
token: Telegram allows one `getUpdates` consumer per token, so the two would
steal updates from each other and the live bot would start missing button
presses.

## Docker Compose

From the project directory, create `.env`:

```bash
cp .env.example .env
```

Set `TELEGRAM_BOT_TOKEN` and `ADMIN_IDS` in `.env`. Keep `DATA_FILE=./data/state.json` so the bot writes its state to the mounted directory. Then start it:

```bash
mkdir -p data
docker compose up --build -d
```

Compose stores `data/state.json` in the project directory, so orders and settings survive container restarts. The `data` directory must be writable by UID 1000, the user that runs the bot in the container. The bot polls Telegram and does not need a published port. View its logs with `docker compose logs -f bot` and stop it with `docker compose down`.

## Main commands

Customers normally use the buttons shown by `/start`.

| Command | Access | Purpose |
| --- | --- | --- |
| `/start` | Everyone | Open the main panel |
| `/order` | Everyone | Place an order |
| `/myorder` | Everyone | View, edit, cancel, or complete your active order |
| `/queue` | Everyone | View the read-only customer queue |
| `/help` | Everyone | View the admin-configured help instructions |
| `/admin` | Admin | Open the compact admin panel |
| `/open` | Admin | Accept new orders |
| `/pause` | Admin | Pause new orders; keep processing the queue |
| `/resume` | Admin | Accept new orders again |
| `/close` | Admin | Close new orders; keep processing the queue |
| `/adminqueue` | Admin | View the queue with order details |
| `/advance` | Admin | Complete the current order as a fallback |
| `/cancel <orderId>` | Admin | Cancel any active order |
| `/addadmin <userId or @handle>` | Admin | Add an admin; a handle must already have sent `/start` to the bot |
| `/removeadmin <userId>` | Admin | Remove an admin |

Menu descriptions, the menu image, and the customer-facing menu message are managed from **Admin → Menu**. When opening or resuming, an admin can keep the current menu message or replace it before the shop opens. Help text, the number of shop cups currently available to lend, and each admin's order alerts are managed directly from the admin panel.

Admins can turn on order alerts from **Admin → Order alerts**. The setting is per-admin and off by default, so an admin who does not want to be pinged simply leaves it off. While it is on, that admin receives a message whenever a customer places an order, edits a waiting order, or cancels their own order. Each alert shows the customer name, drink, cup choice, order ID, and the resulting queue length, with buttons to open the admin queue or cancel that order. An admin is never alerted about their own order, and alerts stop immediately if that admin is removed. Admin-initiated cancellations are not announced, since the admin who ran the cancellation already knows and the rest see it in the queue view.

Customers can opt in or out of shop-opening notifications from the home panel. Their Telegram chat ID and preference are stored in the configured JSON data file. A bot restart preserves the current open, paused, or closed state without sending another opening notification; notifications are sent only after an admin explicitly changes the shop to open. When an order reserves a shop cup, the available count is reduced. Cancelling that order returns the reservation; completed orders remain deducted until an admin updates the available quantity after a cup is returned.
