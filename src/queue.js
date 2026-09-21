import { ShopStatus } from './state.js';

export class QueueError extends Error {}

export function queue(state) {
  return state.orders
    .filter((order) => order.status === 'queued')
    .sort((a, b) => a.sequence - b.sequence);
}

export function positionFor(state, userId) {
  const index = queue(state).findIndex((order) => order.userId === String(userId));
  return index === -1 ? null : index + 1;
}

export function activeOrderFor(state, userId) {
  return queue(state).find((order) => order.userId === String(userId)) ?? null;
}

export function isAdmin(state, userId) {
  return state.adminIds.includes(String(userId));
}

export function recordKnownUser(state, { userId, name, username, chatId }) {
  const id = String(userId);
  state.users ??= {};
  const existing = state.users[id] ?? {};
  state.users[id] = {
    ...existing,
    userId: id,
    name: name || 'Customer',
    username: username ? username.replace(/^@/, '').toLowerCase() : null,
    chatId: String(chatId ?? userId),
    openNotifications: existing.openNotifications ?? false,
    orderNotifications: existing.orderNotifications ?? false,
    lastSeenAt: new Date().toISOString(),
  };
  return state.users[id];
}

export function setOpenNotifications(state, userId, enabled) {
  const user = state.users?.[String(userId)];
  if (!user) throw new QueueError('Send /start before changing notification settings.');
  user.openNotifications = Boolean(enabled);
  return user.openNotifications;
}

export function openNotificationSubscribers(state) {
  return Object.values(state.users ?? {}).filter((user) => user.openNotifications && user.chatId);
}

export function setOrderNotifications(state, userId, enabled) {
  const user = state.users?.[String(userId)];
  if (!user) throw new QueueError('Send /start before changing notification settings.');
  user.orderNotifications = Boolean(enabled);
  return user.orderNotifications;
}

// Admin status is checked here rather than cleared in removeAdmin, so a demoted
// admin goes quiet at once and keeps their preference if they are added back.
export function orderNotificationAdmins(state) {
  return Object.values(state.users ?? {})
    .filter((user) => user.orderNotifications && user.chatId && isAdmin(state, user.userId));
}

export function resolveKnownUser(state, reference) {
  const value = String(reference).trim();
  if (/^\d+$/.test(value)) return value;
  if (!value.startsWith('@')) throw new QueueError('Enter a numeric Telegram ID or an @handle.');

  const username = value.slice(1).toLowerCase();
  const user = Object.values(state.users ?? {}).find((candidate) => candidate.username === username);
  if (!user) throw new QueueError('This user is not known yet. Ask them to send /start to the bot first.');
  return user.userId;
}

export function assertCanOrder(state) {
  if (state.shopStatus === ShopStatus.CLOSED) {
    throw new QueueError('Sorry, coffee shop is closed. New orders are not being accepted.');
  }
  if (state.shopStatus === ShopStatus.PAUSED) {
    throw new QueueError('The queue is paused. Please try again later.');
  }
}

export function createOrder(state, { userId, name, menuItemId, useShopCup = false }) {
  assertCanOrder(state);
  if (activeOrderFor(state, userId)) throw new QueueError('You already have an active order.');

  const item = availableItem(state, menuItemId);
  if (useShopCup) reserveShopCup(state);
  const order = {
    id: String(state.nextOrderId++),
    userId: String(userId),
    name: name || 'Customer',
    menuItemId: item.id,
    menuItemName: item.name,
    useShopCup: Boolean(useShopCup),
    status: 'queued',
    sequence: state.orders.length
      ? Math.max(...state.orders.map((entry) => entry.sequence)) + 1
      : 1,
    notifiedCurrent: false,
    notifiedNext: false,
    createdAt: new Date().toISOString(),
  };

  state.orders.push(order);
  return order;
}

export function editOrder(state, userId, { menuItemId, useShopCup = false }) {
  const order = activeOrderFor(state, userId);
  if (!order) throw new QueueError('You do not have an active order.');
  if (positionFor(state, userId) <= 2) {
    throw new QueueError('You cannot edit while you are current or next in the queue.');
  }

  const item = availableItem(state, menuItemId);
  if (useShopCup && !order.useShopCup) reserveShopCup(state);
  if (!useShopCup && order.useShopCup) state.cupsAvailable += 1;
  order.menuItemId = item.id;
  order.menuItemName = item.name;
  order.useShopCup = Boolean(useShopCup);
  order.updatedAt = new Date().toISOString();
  return order;
}

export function cancelOwnOrder(state, userId) {
  const order = activeOrderFor(state, userId);
  if (!order) throw new QueueError('You do not have an active order.');
  return cancelOrder(state, order.id, `customer:${userId}`);
}

export function cancelOrder(state, orderId, cancelledBy = 'admin') {
  const order = state.orders.find(
    (candidate) => candidate.id === String(orderId) && candidate.status === 'queued',
  );
  if (!order) throw new QueueError('Active order not found.');
  order.status = 'cancelled';
  if (order.useShopCup) {
    state.cupsAvailable += 1;
    order.cupReservationReleased = true;
  }
  order.cancelledBy = String(cancelledBy);
  order.completedAt = new Date().toISOString();
  return order;
}

export function completeCurrentOrder(state, { userId, completedBy = 'customer' } = {}) {
  const current = queue(state)[0];
  if (!current) throw new QueueError('There is no active order to complete.');
  if (userId && current.userId !== String(userId)) {
    throw new QueueError('Only the current customer can mark this order as collected.');
  }
  current.status = 'completed';
  current.completedBy = String(completedBy);
  current.completedAt = new Date().toISOString();
  return current;
}

export function notificationTargets(state) {
  return queue(state).slice(0, 2).flatMap((order, index) => {
    const position = index + 1;
    const alreadyNotified = position === 1 ? order.notifiedCurrent : order.notifiedNext;
    return alreadyNotified ? [] : [{ order, position }];
  });
}

export function markNotified(state, orderId, position) {
  const order = queue(state)[position - 1];
  if (order?.id !== String(orderId)) return;
  if (position === 1) order.notifiedCurrent = true;
  if (position === 2) order.notifiedNext = true;
}

export function setShopStatus(state, status) {
  if (!Object.values(ShopStatus).includes(status)) throw new QueueError('Invalid shop status.');
  state.shopStatus = status;
  return status;
}

export function setHelpText(state, text) {
  const value = String(text ?? '').trim();
  if (!value) throw new QueueError('Help instructions cannot be empty.');
  if (value.length > 3500) throw new QueueError('Help instructions must be 3,500 characters or fewer.');
  state.helpText = value;
  return value;
}

export function setMenuImage(state, fileId) {
  state.menuImageFileId = fileId ? String(fileId) : null;
  return state.menuImageFileId;
}

export function setMenuMessage(state, text) {
  const value = String(text ?? '').trim();
  if (!value) throw new QueueError('The menu message cannot be empty.');
  if (value.length > 1000) throw new QueueError('The menu message must be 1,000 characters or fewer.');
  state.menuMessage = value;
  return value;
}

export function setCupInventory(state, quantity) {
  const number = Number(quantity);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new QueueError('Cup quantity must be a whole number of 0 or more.');
  }
  state.cupsAvailable = number;
  return number;
}

export function addAdmin(state, userId) {
  const normalizedId = String(userId);
  if (!/^\d+$/.test(normalizedId)) throw new QueueError('Admin ID must be a Telegram numeric user ID.');
  if (!state.adminIds.includes(normalizedId)) state.adminIds.push(normalizedId);
  return normalizedId;
}

export function removeAdmin(state, userId) {
  const normalizedId = String(userId);
  if (!state.adminIds.includes(normalizedId)) throw new QueueError('Admin not found.');
  if (state.adminIds.length === 1) throw new QueueError('The last admin cannot be removed.');
  state.adminIds = state.adminIds.filter((id) => id !== normalizedId);
  return normalizedId;
}

export function addMenuItem(state, name) {
  if (!name?.trim()) throw new QueueError('A drink name is required.');
  const id = uniqueId(state.menu.map((item) => item.id), name);
  const item = { id, name: name.trim(), description: '', available: true };
  state.menu.push(item);
  return item;
}

export function setMenuItemDescription(state, itemId, description) {
  const item = findMenuItem(state, itemId);
  const value = String(description ?? '').trim();
  if (value.length > 500) throw new QueueError('Drink descriptions must be 500 characters or fewer.');
  item.description = value === '-' ? '' : value;
  return item;
}

export function renameMenuItem(state, itemId, name) {
  if (!name?.trim()) throw new QueueError('A drink name is required.');
  const item = findMenuItem(state, itemId);
  item.name = name.trim();
  return item;
}

export function removeMenuItem(state, itemId) {
  const index = state.menu.findIndex((item) => item.id === itemId);
  if (index === -1) throw new QueueError('Menu item not found.');
  return state.menu.splice(index, 1)[0];
}

export function toggleMenuItem(state, itemId) {
  const item = findMenuItem(state, itemId);
  item.available = !item.available;
  return item;
}

function availableItem(state, itemId) {
  const item = state.menu.find((candidate) => candidate.id === itemId && candidate.available);
  if (!item) throw new QueueError('That drink is not currently available.');
  return item;
}

function reserveShopCup(state) {
  if (!Number.isSafeInteger(state.cupsAvailable) || state.cupsAvailable <= 0) {
    throw new QueueError('All shop cups are currently lent out. Please bring your own cup.');
  }
  state.cupsAvailable -= 1;
}

function findMenuItem(state, itemId) {
  const item = state.menu.find((candidate) => candidate.id === itemId);
  if (!item) throw new QueueError('Menu item not found.');
  return item;
}

function uniqueId(existingIds, value) {
  const base = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'item';
  let id = base;
  let suffix = 2;
  while (existingIds.includes(id)) id = `${base}-${suffix++}`;
  return id;
}
