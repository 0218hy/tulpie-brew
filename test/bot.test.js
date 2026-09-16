import assert from 'node:assert/strict';
import test from 'node:test';
import { CoffeeBot } from '../src/bot.js';
import { createOrder, setShopStatus } from '../src/queue.js';
import { createInitialState, ShopStatus } from '../src/state.js';

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

class FakeTelegram {
  constructor() {
    this.messages = [];
    this.edits = [];
    this.photos = [];
  }

  async sendMessage(chatId, text, replyMarkup, options) {
    this.messages.push({ chatId: String(chatId), text, replyMarkup, options });
  }

  async editMessage(chatId, messageId, text, replyMarkup) {
    this.edits.push({ chatId: String(chatId), messageId, text, replyMarkup });
  }

  async sendPhoto(chatId, photo, caption, replyMarkup) {
    this.photos.push({ chatId: String(chatId), photo, caption, replyMarkup });
  }

  async answerCallbackQuery() {}
}

function botWithThreeOrders() {
  const state = createInitialState(['999']);
  setShopStatus(state, ShopStatus.OPEN);
  createOrder(state, { userId: '1', name: 'Alex', menuItemId: 'americano' });
  createOrder(state, { userId: '2', name: 'Jamie', menuItemId: 'latte' });
  createOrder(state, { userId: '3', name: 'Sam', menuItemId: 'cappuccino' });
  const telegram = new FakeTelegram();
  const store = new MemoryStore(state);
  return { bot: new CoffeeBot({ telegram, store }), store, telegram };
}

test('notifies two customers initially, then only the third after completion', async () => {
  const { bot, telegram } = botWithThreeOrders();
  await bot.notifyQueueWindow();

  assert.deepEqual(telegram.messages.map((message) => message.chatId), ['1', '2']);
  assert.match(telegram.messages[0].text, /your turn/i);
  assert.match(telegram.messages[1].text, /You are next/i);

  telegram.messages.length = 0;
  await bot.completeOwn('1', '1', '1');
  const turnMessages = telegram.messages.filter((message) => /turn|next/i.test(message.text));
  assert.deepEqual(turnMessages.map((message) => message.chatId), ['3']);
  assert.match(turnMessages[0].text, /You are next/i);
});

test('the my-order view stays private while customers can open a shared queue', async () => {
  const { bot, telegram } = botWithThreeOrders();

  await bot.showMyOrder('1', '1');
  const customerView = telegram.messages.at(-1).text;
  assert.match(customerView, /White Coffee/);
  assert.match(customerView, /Queue position: 1/);
  assert.doesNotMatch(customerView, /Jamie|Sam|Black Coffee|Hot Chocolate/);

  await bot.showCustomerQueue('1');
  const sharedQueue = telegram.messages.at(-1).text;
  assert.match(sharedQueue, /Alex|Jamie|Sam/);
  assert.match(sharedQueue, /White Coffee|Black Coffee|Hot Chocolate/);

  await bot.showAdminQueue('999');
  const adminView = telegram.messages.at(-1).text;
  assert.match(adminView, /White Coffee/);
  assert.match(adminView, /Black Coffee/);
});

test('closing the shop leaves customer completion and notifications active', async () => {
  const { bot, store, telegram } = botWithThreeOrders();
  await bot.notifyQueueWindow();
  await store.update((state) => setShopStatus(state, ShopStatus.CLOSED));
  telegram.messages.length = 0;

  await bot.completeOwn('1', '1', '1');
  assert.equal(store.get().shopStatus, ShopStatus.CLOSED);
  assert.ok(telegram.messages.some((message) => message.chatId === '3' && /next/i.test(message.text)));
});

test('the home screen includes help and notification controls and Order edits the existing message', async () => {
  const state = createInitialState(['999']);
  setShopStatus(state, ShopStatus.OPEN);
  const telegram = new FakeTelegram();
  const bot = new CoffeeBot({ telegram, store: new MemoryStore(state) });
  const user = { id: 1, first_name: 'Alex' };

  await bot.showHome('1', '1', user);
  assert.match(telegram.messages[0].text, /<b>WELCOME TO THE TULPIE BREWSSS BOT!!!<\/b>/);
  assert.match(telegram.messages[0].text, /OPEN ☑️/);
  assert.equal(telegram.messages[0].options.parse_mode, 'HTML');
  const labels = telegram.messages[0].replyMarkup.inline_keyboard.flat().map((entry) => entry.text);
  assert.deepEqual(labels, ['☕ Order a drink', '🧾 My order', '👥 View queue', '❓ Help / How to order', '🔔 Notify me when open']);

  await bot.handleCallback({
    id: 'callback-1',
    from: user,
    data: 'order',
    message: { message_id: 10, chat: { id: 1 } },
  });

  assert.equal(telegram.messages.length, 1);
  assert.equal(telegram.edits.length, 1);
  assert.match(telegram.edits[0].text, /Choose a drink/);
});

test('customer menu shows descriptions and uses the configured image', async () => {
  const state = createInitialState(['999']);
  setShopStatus(state, ShopStatus.OPEN);
  state.menu[0].description = 'Smooth white coffee';
  state.menuImageFileId = 'telegram-photo-id';
  const telegram = new FakeTelegram();
  const bot = new CoffeeBot({ telegram, store: new MemoryStore(state) });

  await bot.startOrder('1', '1', 'create');
  assert.equal(telegram.photos.length, 1);
  assert.equal(telegram.photos[0].photo, 'telegram-photo-id');
  assert.match(telegram.photos[0].caption, /<b>🤍☕ White Coffee<\/b>\nSmooth white coffee/);
  assert.match(telegram.photos[0].caption, new RegExp(state.menuMessage));
});

test('subscribers are notified only after an admin explicitly confirms opening', async () => {
  const state = createInitialState(['999']);
  state.users['1'] = { userId: '1', chatId: '101', openNotifications: true };
  const telegram = new FakeTelegram();
  const bot = new CoffeeBot({ telegram, store: new MemoryStore(state) });

  await bot.changeStatus('999', '999', ShopStatus.OPEN);
  assert.equal(bot.store.get().shopStatus, ShopStatus.CLOSED);
  assert.ok(!telegram.messages.some((message) => message.chatId === '101'));

  await bot.openShop('999', '999');
  assert.ok(telegram.messages.some((message) => message.chatId === '101' && /open/i.test(message.text)));
  assert.ok(telegram.messages.some((message) => message.chatId === '101' && message.text.includes(state.menuMessage)));
});

test('cup choice is hidden when inventory is empty', async () => {
  const state = createInitialState(['999']);
  setShopStatus(state, ShopStatus.OPEN);
  const telegram = new FakeTelegram();
  const bot = new CoffeeBot({ telegram, store: new MemoryStore(state) });
  bot.sessions.set('1', { type: 'order', mode: 'create', itemId: 'americano' });

  await bot.showCupChoice('1', '1');
  const labels = telegram.messages[0].replyMarkup.inline_keyboard.flat().map((entry) => entry.text);
  assert.ok(labels.includes('♻️ I will bring my own cup'));
  assert.ok(!labels.some((label) => /Use a shop cup/.test(label)));
  assert.match(telegram.messages[0].text, /bring your own cup/i);
});

test('unavailable drinks are hidden from customer order choices', async () => {
  const state = createInitialState(['999']);
  setShopStatus(state, ShopStatus.OPEN);
  state.menu.find((item) => item.id === 'latte').available = false;
  const telegram = new FakeTelegram();
  const bot = new CoffeeBot({ telegram, store: new MemoryStore(state) });

  await bot.startOrder('1', '1', 'create');
  const labels = telegram.messages[0].replyMarkup.inline_keyboard.flat().map((entry) => entry.text);

  assert.ok(labels.includes('🤍☕ White Coffee'));
  assert.ok(labels.includes('🍫 Hot Chocolate'));
  assert.ok(!labels.includes('🖤 ☕ Black Coffee'));
});

test('admin controls use a compact two-column layout', async () => {
  const state = createInitialState(['999']);
  setShopStatus(state, ShopStatus.OPEN);
  const telegram = new FakeTelegram();
  const bot = new CoffeeBot({ telegram, store: new MemoryStore(state) });

  await bot.showAdminPanel('999', '999');
  const rows = telegram.messages[0].replyMarkup.inline_keyboard;

  assert.ok(rows.some((row) => row.length === 2));
  assert.ok(rows.every((row) => row.length <= 2));
});

test('admin queue refresh edits the existing message', async () => {
  const { bot, telegram } = botWithThreeOrders();

  await bot.handleCallback({
    id: 'refresh-1',
    from: { id: 999, first_name: 'Admin' },
    data: 'admin_queue',
    message: { message_id: 25, chat: { id: 999 } },
  });

  assert.equal(telegram.messages.length, 0);
  assert.equal(telegram.edits.length, 1);
  assert.equal(telegram.edits[0].messageId, 25);
  assert.match(telegram.edits[0].text, /3 waiting/);
});
