const TELEGRAM_API = 'https://api.telegram.org';

export class TelegramClient {
  constructor(token) {
    this.token = token;
  }

  async call(method, body = {}) {
    const response = await fetch(`${TELEGRAM_API}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.description || `Telegram ${method} failed.`);
    return payload.result;
  }

  sendMessage(chatId, text, replyMarkup) {
    return this.call('sendMessage', {
      chat_id: chatId,
      text,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  }

  editMessage(chatId, messageId, text, replyMarkup) {
    return this.call('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  }

  answerCallbackQuery(id, text) {
    return this.call('answerCallbackQuery', {
      callback_query_id: id,
      ...(text ? { text } : {}),
    });
  }

  getUpdates(offset) {
    return this.call('getUpdates', {
      offset,
      timeout: 30,
      allowed_updates: ['message', 'callback_query'],
    });
  }
}
