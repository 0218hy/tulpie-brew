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
  }

  async sendMessage(chatId, text, replyMarkup) {
    this.messages.push({ chatId: String(chatId), text, replyMarkup });
  }

  async editMessage(chatId, messageId, text, replyMarkup) {
    this.edits.push({ chatId: String(chatId), messageId, text, replyMarkup });
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

test('customers see only their own order and queue number', async () => {
  const { bot, telegram } = botWithThreeOrders();

  await bot.showMyOrder('1', '1');
  const customerView = telegram.messages.at(-1).text;
  assert.match(customerView, /Americano/);
  assert.match(customerView, /Position: 1/);
  assert.doesNotMatch(customerView, /Jamie|Sam|Latte|Cappuccino/);

  await bot.showAdminQueue('999');
  const adminView = telegram.messages.at(-1).text;
  assert.match(adminView, /Americano/);
  assert.match(adminView, /Latte/);
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

test('the home screen has no separate menu button and Order edits the existing message', async () => {
  const state = createInitialState(['999']);
  setShopStatus(state, ShopStatus.OPEN);
  const telegram = new FakeTelegram();
  const bot = new CoffeeBot({ telegram, store: new MemoryStore(state) });
  const user = { id: 1, first_name: 'Alex' };

  await bot.showHome('1', '1', user);
  const labels = telegram.messages[0].replyMarkup.inline_keyboard.flat().map((entry) => entry.text);
  assert.deepEqual(labels, ['Order', 'My order']);

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

test('unavailable drinks are hidden from customer order choices', async () => {
  const state = createInitialState(['999']);
  setShopStatus(state, ShopStatus.OPEN);
  state.menu.find((item) => item.id === 'latte').available = false;
  const telegram = new FakeTelegram();
  const bot = new CoffeeBot({ telegram, store: new MemoryStore(state) });

  await bot.startOrder('1', '1', 'create');
  const labels = telegram.messages[0].replyMarkup.inline_keyboard.flat().map((entry) => entry.text);

  assert.ok(labels.includes('Americano'));
  assert.ok(labels.includes('Cappuccino'));
  assert.ok(!labels.includes('Latte'));
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
