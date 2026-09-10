import { resolve } from 'node:path';
import { CoffeeBot } from './bot.js';
import { createInitialState, JsonStore } from './state.js';
import { TelegramClient } from './telegram.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required. Copy .env.example to .env and add your token.');

const adminIds = (process.env.ADMIN_IDS ?? '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
if (!adminIds.length) throw new Error('ADMIN_IDS must contain at least one Telegram numeric user ID.');

const dataFile = resolve(process.env.DATA_FILE || './data/state.json');
const store = new JsonStore(dataFile, createInitialState(adminIds));
await store.load();

// Environment admins are merged on startup so a stale data file cannot lock out
// a newly configured administrator.
await store.update((state) => {
  state.adminIds = [...new Set([...state.adminIds, ...adminIds])];
});

const telegram = new TelegramClient(token);
const bot = new CoffeeBot({ telegram, store });
await bot.notifyQueueWindow();

let offset = 0;
console.log('Tulpie Brew bot is running.');

while (true) {
  try {
    const updates = await telegram.getUpdates(offset);
    for (const update of updates) {
      offset = update.update_id + 1;
      await bot.handleUpdate(update);
    }
  } catch (error) {
    console.error('Polling failed:', error);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
  }
}
