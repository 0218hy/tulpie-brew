import assert from 'node:assert/strict';
import test from 'node:test';
import {
  QueueError,
  addAdmin,
  addMenuItem,
  cancelOrder,
  completeCurrentOrder,
  createOrder,
  editOrder,
  markNotified,
  notificationTargets,
  positionFor,
  queue,
  recordKnownUser,
  removeAdmin,
  removeMenuItem,
  resolveKnownUser,
  setShopStatus,
} from '../src/queue.js';
import { createInitialState, ShopStatus } from '../src/state.js';

const customer = (number) => ({
  userId: String(number),
  name: `Customer ${number}`,
  menuItemId: 'americano',
});

function openState() {
  const state = createInitialState(['999']);
  setShopStatus(state, ShopStatus.OPEN);
  return state;
}

test('closed and paused shops reject new orders', () => {
  const state = createInitialState(['999']);
  assert.throws(() => createOrder(state, customer(1)), /closed/);
  setShopStatus(state, ShopStatus.PAUSED);
  assert.throws(() => createOrder(state, customer(1)), /paused/);
});

test('closing preserves and continues the existing queue', () => {
  const state = openState();
  createOrder(state, customer(1));
  createOrder(state, customer(2));
  setShopStatus(state, ShopStatus.CLOSED);

  assert.equal(queue(state).length, 2);
  assert.throws(() => createOrder(state, customer(3)), /closed/);
  completeCurrentOrder(state, { userId: '1' });
  assert.equal(queue(state)[0].userId, '2');
});

test('only the first two queue entries are notified', () => {
  const state = openState();
  createOrder(state, customer(1));
  createOrder(state, customer(2));
  createOrder(state, customer(3));

  assert.deepEqual(notificationTargets(state).map((order) => order.userId), ['1', '2']);
  markNotified(state, '1');
  markNotified(state, '2');
  completeCurrentOrder(state, { userId: '1' });
  assert.deepEqual(notificationTargets(state).map((order) => order.userId), ['3']);
});

test('only the current customer can complete the order', () => {
  const state = openState();
  createOrder(state, customer(1));
  createOrder(state, customer(2));
  assert.throws(() => completeCurrentOrder(state, { userId: '2' }), /Only the current/);
  completeCurrentOrder(state, { userId: '1' });
  assert.equal(positionFor(state, '2'), 1);
});

test('queue positions one and two cannot edit, while position three can', () => {
  const state = openState();
  createOrder(state, customer(1));
  createOrder(state, customer(2));
  createOrder(state, customer(3));

  assert.throws(() => editOrder(state, '1', { menuItemId: 'latte' }), /cannot edit/);
  assert.throws(() => editOrder(state, '2', { menuItemId: 'latte' }), /cannot edit/);
  const edited = editOrder(state, '3', { menuItemId: 'latte' });
  assert.equal(edited.menuItemName, 'Latte');
  assert.equal(positionFor(state, '3'), 3);
});

test('cancelling an order closes the gap in the queue', () => {
  const state = openState();
  createOrder(state, customer(1));
  const second = createOrder(state, customer(2));
  createOrder(state, customer(3));
  cancelOrder(state, second.id, 'admin:999');
  assert.deepEqual(queue(state).map((order) => order.userId), ['1', '3']);
  assert.equal(positionFor(state, '3'), 2);
});

test('an admin can remove a drink without changing saved orders', () => {
  const state = openState();
  const order = createOrder(state, customer(1));
  removeMenuItem(state, 'americano');

  assert.equal(state.menu.some((item) => item.id === 'americano'), false);
  assert.equal(order.menuItemName, 'Americano');
  assert.equal(queue(state).length, 1);
});

test('admins can manage admins but cannot remove the final admin', () => {
  const state = createInitialState(['999']);
  assert.throws(() => removeAdmin(state, '999'), QueueError);
  addAdmin(state, '888');
  removeAdmin(state, '999');
  assert.deepEqual(state.adminIds, ['888']);
});

test('a handle resolves only after that person has started the bot', () => {
  const state = createInitialState(['999']);
  assert.throws(() => resolveKnownUser(state, '@jamie'), /send \/start/);

  recordKnownUser(state, {
    userId: '888',
    name: 'Jamie',
    username: 'Jamie',
    chatId: '888',
  });
  assert.equal(resolveKnownUser(state, '@jamie'), '888');
  assert.equal(resolveKnownUser(state, '888'), '888');
});
