import {
  QueueError,
  activeOrderFor,
  addAdmin,
  addMenuItem,
  cancelOrder,
  cancelOwnOrder,
  completeCurrentOrder,
  createOrder,
  editOrder,
  isAdmin,
  markNotified,
  notificationTargets,
  positionFor,
  queue,
  recordKnownUser,
  removeAdmin,
  removeMenuItem,
  renameMenuItem,
  resolveKnownUser,
  setShopStatus,
  toggleMenuItem,
} from './queue.js';
import { ShopStatus } from './state.js';

const button = (text, callbackData) => ({ text, callback_data: callbackData });
const keyboard = (...rows) => ({ inline_keyboard: rows.filter((row) => row.length) });
const buttonRows = (buttons, size = 2) => {
  const rows = [];
  for (let index = 0; index < buttons.length; index += size) rows.push(buttons.slice(index, index + size));
  return rows;
};

export class CoffeeBot {
  constructor({ telegram, store }) {
    this.telegram = telegram;
    this.store = store;
    this.sessions = new Map();
  }

  async handleUpdate(update) {
    try {
      if (update.callback_query) return await this.handleCallback(update.callback_query);
      if (update.message?.text) return await this.handleMessage(update.message);
    } catch (error) {
      const chatId = update.callback_query?.message?.chat?.id ?? update.message?.chat?.id;
      if (chatId) await this.telegram.sendMessage(chatId, friendlyError(error));
      if (!(error instanceof QueueError)) console.error(error);
    }
  }

  async handleMessage(message) {
    const chatId = message.chat.id;
    const userId = String(message.from.id);
    const text = message.text.trim();
    await this.rememberUser(message.from, chatId);

    if (!text.startsWith('/')) {
      if (await this.handleSessionInput(message)) return;
      return this.showHome(chatId, userId, message.from);
    }

    const [rawCommand, argument] = text.split(/\s+/, 2);
    const command = rawCommand.split('@')[0].toLowerCase();

    switch (command) {
      case '/start':
        return this.showHome(chatId, userId, message.from);
      case '/order':
        return this.startOrder(chatId, userId, 'create');
      case '/myorder':
        return this.showMyOrder(chatId, userId);
      case '/admin':
        return this.showAdminPanel(chatId, userId);
      case '/adminqueue':
        this.requireAdmin(userId);
        return this.showAdminQueue(chatId);
      case '/open':
        return this.changeStatus(chatId, userId, ShopStatus.OPEN);
      case '/pause':
        return this.changeStatus(chatId, userId, ShopStatus.PAUSED);
      case '/resume':
        return this.changeStatus(chatId, userId, ShopStatus.OPEN);
      case '/close':
        return this.changeStatus(chatId, userId, ShopStatus.CLOSED);
      case '/advance':
        return this.advanceQueue(chatId, userId);
      case '/cancel':
        this.requireAdmin(userId);
        if (!argument) throw new QueueError('Use /cancel followed by the order ID.');
        return this.adminCancel(chatId, argument, userId);
      case '/addadmin':
        this.requireAdmin(userId);
        if (!argument) throw new QueueError('Use /addadmin followed by a Telegram user ID or @handle.');
        return this.addAdmin(chatId, argument, userId);
      case '/removeadmin':
        this.requireAdmin(userId);
        if (!argument) throw new QueueError('Use /removeadmin followed by a Telegram user ID.');
        return this.removeAdmin(chatId, argument);
      case '/cancelinput':
        this.sessions.delete(userId);
        return this.telegram.sendMessage(chatId, 'Input cancelled.');
      default:
        return this.telegram.sendMessage(chatId, 'Unknown command. Use /start to see the available actions.');
    }
  }

  async handleCallback(callback) {
    await this.telegram.answerCallbackQuery(callback.id);
    const chatId = callback.message.chat.id;
    const messageId = callback.message.message_id;
    const userId = String(callback.from.id);
    const data = callback.data;
    await this.rememberUser(callback.from, chatId);

    if (data === 'home') return this.showHome(chatId, userId, callback.from, messageId);
    if (data === 'my_order') return this.showMyOrder(chatId, userId, messageId);
    if (data === 'order') return this.startOrder(chatId, userId, 'create', messageId);
    if (data === 'edit_order') return this.startOrder(chatId, userId, 'edit', messageId);
    if (data === 'cancel_own_confirm') return this.confirmCancelOwn(chatId, userId, messageId);
    if (data === 'cancel_own') return this.cancelOwn(chatId, userId, messageId);
    if (data.startsWith('pick:')) return this.pickItem(chatId, userId, data.slice(5), messageId);
    if (data === 'confirm_order') return this.confirmOrder(chatId, userId, callback.from, messageId);
    if (data.startsWith('done:')) return this.completeOwn(chatId, userId, data.slice(5), messageId);

    this.requireAdmin(userId);
    if (data === 'admin') return this.showAdminPanel(chatId, userId, messageId);
    if (data === 'admin_queue') return this.showAdminQueue(chatId, messageId);
    if (data === 'admin_cancel_list') return this.showCancelOrderList(chatId, messageId);
    if (data === 'admin_menu') return this.showAdminMenu(chatId, messageId);
    if (data === 'admin_add_item') return this.prompt(chatId, userId, { type: 'add_item' }, 'Send the new drink name.');
    if (data === 'admin_add') {
      return this.prompt(
        chatId,
        userId,
        { type: 'add_admin' },
        'Send the new admin’s numeric Telegram user ID or @handle. They must send /start to this bot first.',
      );
    }
    if (data === 'admin_remove') return this.showRemoveAdmin(chatId, messageId);
    if (data.startsWith('admin_remove_confirm:')) return this.confirmRemoveAdmin(chatId, data.slice(21), messageId);
    if (data.startsWith('admin_remove_do:')) return this.removeAdmin(chatId, data.slice(16), messageId);
    if (data.startsWith('status:')) return this.changeStatus(chatId, userId, data.slice(7), messageId);
    if (data === 'advance_confirm') return this.confirmAdvance(chatId, messageId);
    if (data === 'advance') return this.advanceQueue(chatId, userId, messageId);
    if (data.startsWith('admin_cancel_confirm:')) return this.confirmAdminCancel(chatId, data.slice(21), messageId);
    if (data.startsWith('admin_cancel:')) return this.adminCancel(chatId, data.slice(13), userId, messageId);
    if (data.startsWith('item:')) return this.showAdminItem(chatId, data.slice(5), messageId);
    if (data.startsWith('toggle_item:')) return this.toggleItem(chatId, data.slice(12), messageId);
    if (data.startsWith('rename_item:')) {
      const itemId = data.slice(12);
      return this.prompt(chatId, userId, { type: 'rename_item', itemId }, 'Send the new drink name.');
    }
    if (data.startsWith('delete_item_confirm:')) return this.confirmDeleteItem(chatId, data.slice(20), messageId);
    if (data.startsWith('delete_item:')) return this.deleteItem(chatId, data.slice(12), messageId);
  }

  async showHome(chatId, userId, from, messageId) {
    const state = this.store.get();
    const status = titleCase(state.shopStatus);
    const rows = [
      [button('Order', 'order')],
      [button('My order', 'my_order')],
    ];
    if (isAdmin(state, userId)) rows.push([button('Admin', 'admin')]);
    return this.render(chatId, messageId, `Tulpie Brew\n${status}`, keyboard(...rows));
  }

  async startOrder(chatId, userId, mode, messageId) {
    const state = this.store.get();
    if (mode === 'create') {
      if (state.shopStatus === ShopStatus.CLOSED) throw new QueueError('The coffee shop is closed. New orders are not being accepted.');
      if (state.shopStatus === ShopStatus.PAUSED) throw new QueueError('The queue is paused. Please try again later.');
      if (activeOrderFor(state, userId)) return this.showMyOrder(chatId, userId, messageId);
    } else {
      const existing = activeOrderFor(state, userId);
      if (!existing) throw new QueueError('You do not have an active order.');
      if (positionFor(state, userId) <= 2) throw new QueueError('You cannot edit while you are current or next in the queue.');
    }

    const available = state.menu.filter((item) => item.available);
    if (!available.length) throw new QueueError('No drinks are currently available.');
    this.sessions.set(userId, { type: 'order', mode });
    return this.render(
      chatId,
      messageId,
      mode === 'edit' ? 'Change drink' : 'Choose a drink',
      keyboard(...available.map((item) => [button(item.name, `pick:${item.id}`)]), [button('Home', 'home')]),
    );
  }

  async pickItem(chatId, userId, itemId, messageId) {
    const session = this.sessions.get(userId);
    if (session?.type !== 'order') throw new QueueError('That order session expired. Please start again.');
    const item = this.store.get().menu.find((entry) => entry.id === itemId && entry.available);
    if (!item) throw new QueueError('That drink is not currently available.');
    Object.assign(session, { itemId });
    return this.showOrderConfirmation(chatId, userId, messageId);
  }

  async showOrderConfirmation(chatId, userId, messageId) {
    const session = this.sessions.get(userId);
    const item = this.store.get().menu.find((entry) => entry.id === session.itemId);
    return this.render(
      chatId,
      messageId,
      `Your order\n${item.name}`,
      keyboard([button(session.mode === 'edit' ? 'Save' : 'Confirm', 'confirm_order')], [button('Start over', session.mode === 'edit' ? 'edit_order' : 'order')]),
    );
  }

  async confirmOrder(chatId, userId, from, messageId) {
    const session = this.sessions.get(userId);
    if (session?.type !== 'order' || !session.itemId) throw new QueueError('That order session expired. Please start again.');
    const payload = { menuItemId: session.itemId };
    let order;
    if (session.mode === 'edit') {
      order = await this.store.update((state) => editOrder(state, userId, payload));
    } else {
      order = await this.store.update((state) => createOrder(state, {
        ...payload,
        userId,
        name: displayName(from),
      }));
    }
    this.sessions.delete(userId);
    await this.render(
      chatId,
      messageId,
      `${session.mode === 'edit' ? 'Order updated' : 'Order placed'}\n${orderDescription(order)}\nPosition: ${positionFor(this.store.get(), userId)}`,
      keyboard([button('My order', 'my_order')], [button('Home', 'home')]),
    );
    await this.notifyQueueWindow();
  }

  async showMyOrder(chatId, userId, messageId) {
    const state = this.store.get();
    const order = activeOrderFor(state, userId);
    if (!order) return this.render(chatId, messageId, 'No active order.', keyboard([button('Order', 'order')], [button('Home', 'home')]));
    const position = positionFor(state, userId);
    const status = position === 1 ? 'CURRENT' : position === 2 ? 'NEXT' : 'WAITING';
    const rows = [];
    if (position === 1) rows.push([button('Done / Collected', `done:${order.id}`)]);
    if (position > 2) rows.push([button('Edit order', 'edit_order')]);
    rows.push([button('Cancel order', 'cancel_own_confirm')], [button('Home', 'home')]);
    return this.render(
      chatId,
      messageId,
      `Your order\n${orderDescription(order)}\nPosition: ${position}\n${titleCase(status)}`,
      keyboard(...rows),
    );
  }

  async confirmCancelOwn(chatId, userId, messageId) {
    const order = activeOrderFor(this.store.get(), userId);
    if (!order) throw new QueueError('You do not have an active order.');
    return this.render(chatId, messageId, `Cancel this order?\n${orderDescription(order)}`, keyboard([button('Cancel order', 'cancel_own')], [button('Keep order', 'my_order')]));
  }

  async cancelOwn(chatId, userId, messageId) {
    await this.store.update((state) => cancelOwnOrder(state, userId));
    await this.render(chatId, messageId, 'Order cancelled.', keyboard([button('Home', 'home')]));
    await this.notifyQueueWindow();
  }

  async completeOwn(chatId, userId, orderId, messageId) {
    const current = queue(this.store.get())[0];
    if (!current || current.id !== orderId) throw new QueueError('This order is no longer current.');
    await this.store.update((state) => completeCurrentOrder(state, { userId, completedBy: `customer:${userId}` }));
    await this.render(chatId, messageId, 'Order complete. Thank you.', keyboard([button('Home', 'home')]));
    await this.notifyQueueWindow();
  }

  async render(chatId, messageId, text, replyMarkup) {
    if (!messageId) return this.telegram.sendMessage(chatId, text, replyMarkup);
    try {
      return await this.telegram.editMessage(chatId, messageId, text, replyMarkup);
    } catch (error) {
      if (String(error.message).includes('message is not modified')) return;
      return this.telegram.sendMessage(chatId, text, replyMarkup);
    }
  }

  async showAdminPanel(chatId, userId, messageId) {
    this.requireAdmin(userId);
    const state = this.store.get();
    const statusControls = state.shopStatus === ShopStatus.OPEN
      ? [button('Pause', 'status:paused'), button('Close', 'status:closed')]
      : state.shopStatus === ShopStatus.PAUSED
        ? [button('Resume', 'status:open'), button('Close', 'status:closed')]
        : [button('Open', 'status:open')];
    return this.render(
      chatId,
      messageId,
      `Admin\n${titleCase(state.shopStatus)} · ${queue(state).length} queued`,
      keyboard(
        statusControls,
        [button('Queue', 'admin_queue'), button('Menu', 'admin_menu')],
        [button('Add admin', 'admin_add'), button('Remove admin', 'admin_remove')],
        [button('Customer view', 'home')],
      ),
    );
  }

  async changeStatus(chatId, userId, status, messageId) {
    this.requireAdmin(userId);
    await this.store.update((state) => setShopStatus(state, status));
    return this.showAdminPanel(chatId, userId, messageId);
  }

  async showAdminQueue(chatId, messageId) {
    const state = this.store.get();
    const orders = queue(state);
    const lines = orders.map((order, index) => {
      const label = index === 0 ? 'CURRENT' : index === 1 ? 'NEXT' : 'WAITING';
      return `${index + 1}. ${order.name} · ${titleCase(label)}\n${orderDescription(order)}`;
    });
    const firstRow = orders.length ? [button('Advance current', 'advance_confirm')] : [];
    const cancelRow = orders.length ? [button('Cancel an order', 'admin_cancel_list')] : [];
    return this.render(
      chatId,
      messageId,
      `Queue · ${titleCase(state.shopStatus)}\n${orders.length} waiting\n\n${lines.join('\n\n') || 'Queue is empty.'}`,
      keyboard([...firstRow, ...cancelRow], [button('Refresh', 'admin_queue'), button('Admin', 'admin')]),
    );
  }

  async showCancelOrderList(chatId, messageId) {
    const orders = queue(this.store.get());
    const rows = orders.map((order, index) => [
      button(`${index + 1}. ${order.name}`, `admin_cancel_confirm:${order.id}`),
    ]);
    return this.render(
      chatId,
      messageId,
      'Cancel an order',
      keyboard(...buttonRows(rows.flat()), [button('Queue', 'admin_queue')]),
    );
  }

  async confirmAdvance(chatId, messageId) {
    const current = queue(this.store.get())[0];
    if (!current) throw new QueueError('The queue is empty.');
    return this.render(chatId, messageId, `Advance past ${current.name}?`, keyboard([button('Advance', 'advance')], [button('Back', 'admin_queue')]));
  }

  async advanceQueue(chatId, userId, messageId) {
    this.requireAdmin(userId);
    await this.store.update((state) => completeCurrentOrder(state, { completedBy: `admin:${userId}` }));
    await this.notifyQueueWindow();
    return this.showAdminQueue(chatId, messageId);
  }

  async confirmAdminCancel(chatId, orderId, messageId) {
    const order = queue(this.store.get()).find((entry) => entry.id === orderId);
    if (!order) throw new QueueError('Active order not found.');
    return this.render(chatId, messageId, `Cancel ${order.name}'s order?`, keyboard([button('Cancel order', `admin_cancel:${order.id}`)], [button('Keep order', 'admin_cancel_list')]));
  }

  async adminCancel(chatId, orderId, adminId, messageId) {
    const order = await this.store.update((state) => cancelOrder(state, orderId, `admin:${adminId}`));
    try {
      await this.telegram.sendMessage(order.userId, `Your order #${order.id} was cancelled by the coffee shop.`);
    } catch (error) {
      // Cancellation and queue progression should still succeed if the customer
      // has blocked the bot or Telegram cannot deliver this one message.
      console.error(`Could not notify cancelled order ${order.id}:`, error);
    }
    await this.notifyQueueWindow();
    return this.showAdminQueue(chatId, messageId);
  }

  async showAdminMenu(chatId, messageId) {
    const state = this.store.get();
    const itemButtons = state.menu.map((item) => button(`${item.available ? '[On]' : '[Off]'} ${item.name}`, `item:${item.id}`));
    return this.render(chatId, messageId, 'Menu', keyboard(...buttonRows(itemButtons), [button('Add drink', 'admin_add_item'), button('Admin', 'admin')]));
  }

  async showAdminItem(chatId, itemId, messageId) {
    const item = this.store.get().menu.find((entry) => entry.id === itemId);
    if (!item) throw new QueueError('Menu item not found.');
    return this.render(
      chatId,
      messageId,
      `${item.name}\n${item.available ? 'Available' : 'Unavailable'}`,
      keyboard(
        [button(item.available ? 'Mark unavailable' : 'Mark available', `toggle_item:${item.id}`)],
        [button('Rename', `rename_item:${item.id}`), button('Remove drink', `delete_item_confirm:${item.id}`)],
        [button('Menu', 'admin_menu')],
      ),
    );
  }

  async toggleItem(chatId, itemId, messageId) {
    await this.store.update((state) => toggleMenuItem(state, itemId));
    return this.showAdminItem(chatId, itemId, messageId);
  }

  async confirmDeleteItem(chatId, itemId, messageId) {
    const item = this.store.get().menu.find((entry) => entry.id === itemId);
    if (!item) throw new QueueError('Menu item not found.');
    return this.render(chatId, messageId, `Remove ${item.name}?`, keyboard([button('Remove drink', `delete_item:${item.id}`)], [button('Keep drink', `item:${item.id}`)]));
  }

  async deleteItem(chatId, itemId, messageId) {
    await this.store.update((state) => removeMenuItem(state, itemId));
    return this.showAdminMenu(chatId, messageId);
  }

  async showRemoveAdmin(chatId, messageId) {
    const admins = this.store.get().adminIds;
    const adminButtons = admins.map((id) => button(id, `admin_remove_confirm:${id}`));
    return this.render(chatId, messageId, 'Remove admin', keyboard(...buttonRows(adminButtons), [button('Admin', 'admin')]));
  }

  async confirmRemoveAdmin(chatId, adminId, messageId) {
    return this.render(chatId, messageId, `Remove admin ${adminId}?`, keyboard([button('Remove admin', `admin_remove_do:${adminId}`)], [button('Keep admin', 'admin_remove')]));
  }

  async addAdmin(chatId, reference, actingAdminId) {
    const adminId = await this.store.update((state) => {
      const resolvedId = resolveKnownUser(state, reference);
      addAdmin(state, resolvedId);
      return resolvedId;
    });
    const user = this.store.get().users?.[adminId];
    const label = user?.username ? `@${user.username}` : user?.name || adminId;
    await this.telegram.sendMessage(chatId, `Admin ${label} added.`);
    return this.showAdminPanel(chatId, actingAdminId);
  }

  async removeAdmin(chatId, adminId, messageId) {
    await this.store.update((state) => removeAdmin(state, adminId));
    return this.render(chatId, messageId, `Admin ${adminId} removed.`, keyboard([button('Admin', 'admin')]));
  }

  prompt(chatId, userId, session, text) {
    this.sessions.set(userId, session);
    return this.telegram.sendMessage(chatId, `${text}\n\nSend /cancelinput to stop.`);
  }

  async handleSessionInput(message) {
    const userId = String(message.from.id);
    const session = this.sessions.get(userId);
    if (!session || session.type === 'order') return false;
    this.requireAdmin(userId);
    const chatId = message.chat.id;
    const text = message.text.trim();

    if (session.type === 'add_item') {
      const item = await this.store.update((state) => addMenuItem(state, text));
      this.sessions.delete(userId);
      await this.telegram.sendMessage(chatId, `${item.name} added and available.`);
      await this.showAdminItem(chatId, item.id);
      return true;
    }
    if (session.type === 'rename_item') {
      await this.store.update((state) => renameMenuItem(state, session.itemId, text));
      this.sessions.delete(userId);
      await this.showAdminItem(chatId, session.itemId);
      return true;
    }
    if (session.type === 'add_admin') {
      await this.addAdmin(chatId, text, userId);
      this.sessions.delete(userId);
      return true;
    }
    return false;
  }

  async notifyQueueWindow() {
    const targets = notificationTargets(this.store.get());
    for (const order of targets) {
      const currentPosition = positionFor(this.store.get(), order.userId);
      const text = currentPosition === 1
        ? `Your turn\nPlease come to the counter.\n\n${orderDescription(order)}`
        : `You are next\nPlease be ready.\n\n${orderDescription(order)}`;
      // Both notified customers keep this button. It only succeeds for queue #1,
      // so queue #2 can use the same message after moving forward.
      const controls = keyboard(
        [button('Done / Collected', `done:${order.id}`)],
        [button('My order', 'my_order')],
      );
      try {
        await this.telegram.sendMessage(order.userId, text, controls);
        await this.store.update((state) => markNotified(state, order.id));
      } catch (error) {
        console.error(`Could not notify order ${order.id}:`, error);
      }
    }
  }

  requireAdmin(userId) {
    if (!isAdmin(this.store.get(), userId)) throw new QueueError('Admin access required.');
  }

  async rememberUser(from, chatId) {
    await this.store.update((state) => recordKnownUser(state, {
      userId: from.id,
      name: displayName(from),
      username: from.username,
      chatId,
    }));
  }
}

function displayName(from = {}) {
  return [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'Customer';
}

function orderDescription(order) {
  return order.menuItemName;
}

function friendlyError(error) {
  return error instanceof QueueError ? error.message : 'Something went wrong. Please try again.';
}

function titleCase(value) {
  const text = String(value).toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
