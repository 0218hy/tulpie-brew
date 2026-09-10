# Tulpie Brew

A Telegram coffee-order queue bot designed to keep admin work to a minimum.

## Queue workflow

1. An admin opens the shop.
2. Customers choose a drink, confirm it, and join the queue.
3. The bot automatically notifies the first two customers:
   - Queue #1: **It is your turn. Please come to the coffee counter now.**
   - Queue #2: **You are next. Please be ready.**
4. Queue #1 collects their drink and presses **Done / Collected**.
5. The bot completes that order and automatically notifies the new Queue #2.
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
- Editable menu with add, rename, availability, and remove drink controls
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

## Main commands

Customers normally use the buttons shown by `/start`.

| Command | Access | Purpose |
| --- | --- | --- |
| `/start` | Everyone | Open the main panel |
| `/order` | Everyone | Place an order |
| `/myorder` | Everyone | View, edit, cancel, or complete your active order |
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

Menu editing is available from `/admin` using short button flows.
