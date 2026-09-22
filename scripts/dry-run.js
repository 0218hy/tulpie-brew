#!/usr/bin/env node
// Drives the bot against a fake Telegram client and prints every message it
// would send, with the recipient named. Nothing touches the network, no bot
// token is needed, and no state file is written, so this is safe to run while
// the real bot is live.
//
//   node scripts/dry-run.js            # the order-alert walkthrough
//   node scripts/dry-run.js queue      # queue progression and notifications
//   node scripts/dry-run.js all
import { CoffeeBot } from '../src/bot.js';
import { addAdmin, recordKnownUser, setOrderNotifications, setShopStatus } from '../src/queue.js';
import { createInitialState, ShopStatus } from '../src/state.js';

const useColour = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, text) => (useColour ? `\u001b[${code}m${text}\u001b[0m` : text);
const bold = (text) => paint('1', text);
const dim = (text) => paint('2', text);
const green = (text) => paint('32', text);
const yellow = (text) => paint('33', text);

// Everyone in the scenario, so output can name a recipient instead of an id.
const CAST = {
  100: 'Ada (admin)',
  200: 'Ben (admin)',
  300: 'Cleo (customer)',
  400: 'Dev (customer)',
  500: 'Eve (customer)',
};
const who = (chatId) => CAST[String(chatId)] ?? `chat ${chatId}`;

class PrintingTelegram {
  constructor() {
    this.sent = 0;
  }

  #show(label, chatId, text, replyMarkup) {
    this.sent += 1;
    console.log(`  ${green('→')} ${bold(who(chatId))} ${dim(`[${label}]`)}`);
    for (const line of String(text ?? '').split('\n')) console.log(`      ${line}`);
    const buttons = (replyMarkup?.inline_keyboard ?? [])
      .flat()
      .map((control) => `[${control.text}]`)
      .join(' ');
    if (buttons) console.log(`      ${dim(buttons)}`);
    console.log();
  }

  async sendMessage(chatId, text, replyMarkup) {
    this.#show('sendMessage', chatId, text, replyMarkup);
  }

  async sendPhoto(chatId, photo, caption, replyMarkup) {
    this.#show(`sendPhoto ${photo}`, chatId, caption, replyMarkup);
  }

  // Edits replace a screen the person is already looking at. They are not
  // notifications, so they are muted by default to keep the output readable.
  async editMessage(chatId, messageId, text, replyMarkup) {
    if (process.env.SHOW_EDITS) this.#show(`edit #${messageId}`, chatId, text, replyMarkup);
  }

  async answerCallbackQuery() {}
}

class MemoryStore {
  constructor(state) {
    this.state = structuredClone(state);
  }

  get() {
    return structuredClone(this.state);
  }

  async update(mutator) {
    const draft = structuredClone(this.state);
    const result = await mutator(draft);
    this.state = draft;
    return result;
  }
}

function step(title) {
  console.log(bold(`\n${title}`));
  console.log(dim('─'.repeat(Math.max(title.length, 40))));
}

function note(text) {
  console.log(`  ${yellow('•')} ${text}\n`);
}

function build() {
  const state = createInitialState(['100']);
  setShopStatus(state, ShopStatus.OPEN);
  addAdmin(state, '200');
  // Everyone here has messaged the bot, which is what gives them a private
  // chat the bot is allowed to write to.
  for (const [userId, name] of [[100, 'Ada'], [200, 'Ben'], [300, 'Cleo'], [400, 'Dev'], [500, 'Eve']]) {
    recordKnownUser(state, { userId, name, username: name.toLowerCase(), chatId: userId });
  }
  // Ada opts in; Ben deliberately does not, to show alerts are per-admin.
  setOrderNotifications(state, '100', true);

  const telegram = new PrintingTelegram();
  const store = new MemoryStore(state);
  return { bot: new CoffeeBot({ telegram, store }), store, telegram };
}

const order = (bot, userId, name, itemId, useShopCup = false) => {
  bot.sessions.set(String(userId), { type: 'order', mode: 'create', itemId, useShopCup });
  return bot.confirmOrder(userId, String(userId), { id: userId, first_name: name });
};

const queueOf = (store) => store.get().orders
  .filter((entry) => entry.status === 'queued')
  .sort((a, b) => a.sequence - b.sequence)
  .map((entry, index) => `#${index + 1} ${entry.name} (${entry.menuItemName})`)
  .join(', ') || 'empty';

async function orderAlerts() {
  const { bot, store } = build();

  step('Three customers order');
  note('Ada has order alerts on, Ben does not. Only Ada should be alerted.');
  await order(bot, 300, 'Cleo', 'americano');
  await order(bot, 400, 'Dev', 'latte');
  await order(bot, 500, 'Eve', 'cappuccino');
  console.log(dim(`  queue: ${queueOf(store)}\n`));

  step('Eve edits her drink while behind positions #1 and #2');
  bot.sessions.set('500', { type: 'order', mode: 'edit', itemId: 'latte', useShopCup: false });
  await bot.confirmOrder(500, '500', { id: 500, first_name: 'Eve' });

  step('Eve cancels');
  await bot.cancelOwn(500, '500');
  console.log(dim(`  queue: ${queueOf(store)}\n`));

  step('An admin places their own order');
  note('Ada should not be alerted about an order she placed herself.');
  await order(bot, 100, 'Ada', 'americano');

  step('Ben turns his own alerts on');
  await bot.handleCallback({
    id: 'dry-run-1',
    from: { id: 200, first_name: 'Ben' },
    data: 'admin_order_alerts',
    message: { message_id: 1, chat: { id: 200, type: 'private' } },
  });
  console.log(dim(`  Ben's alerts: ${store.get().users['200'].orderNotifications ? 'on' : 'off'}\n`));

  step('One more order, now that both admins are opted in');
  await order(bot, 500, 'Eve', 'cappuccino');
}

async function queueProgression() {
  const { bot, store } = build();

  step('Three customers order, then the queue is worked through');
  await order(bot, 300, 'Cleo', 'americano');
  await order(bot, 400, 'Dev', 'latte');
  await order(bot, 500, 'Eve', 'cappuccino');
  console.log(dim(`  queue: ${queueOf(store)}\n`));

  step('Cleo collects');
  note('Dev should be told it is now his turn, and Eve that she is next.');
  const current = store.get().orders.find((entry) => entry.status === 'queued');
  await bot.completeOwn(300, '300', current.id, undefined);
  console.log(dim(`  queue: ${queueOf(store)}\n`));

  step('An admin cancels Eve’s order');
  const remaining = store.get().orders.filter((entry) => entry.status === 'queued');
  await bot.adminCancel(100, remaining.at(-1).id, '100', undefined);
  console.log(dim(`  queue: ${queueOf(store)}\n`));

  step('Re-running the notifier sends nothing');
  note('Every alert is recorded once, so a repeat pass is silent.');
  const before = bot.telegram.sent;
  await bot.notifyQueueWindow();
  console.log(dim(`  messages sent: ${bot.telegram.sent - before}\n`));
}

const SCENARIOS = {
  orders: orderAlerts,
  queue: queueProgression,
};

const requested = process.argv[2] ?? 'orders';
const chosen = requested === 'all' ? Object.keys(SCENARIOS) : [requested];
if (chosen.some((name) => !SCENARIOS[name])) {
  console.error(`Unknown scenario "${requested}". Use one of: ${Object.keys(SCENARIOS).join(', ')}, all.`);
  process.exit(1);
}

console.log(dim('Dry run — no network, no bot token, no state file written.'));
console.log(dim('Screen edits are hidden; set SHOW_EDITS=1 to include them.'));
for (const name of chosen) {
  console.log(bold(`\n${'═'.repeat(60)}\n  scenario: ${name}\n${'═'.repeat(60)}`));
  await SCENARIOS[name]();
}
