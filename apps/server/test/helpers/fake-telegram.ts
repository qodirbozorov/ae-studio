/** Soxta Telegram Bot API: `getUpdates` navbati, yuborilgan/tahrirlangan xabarlar, inline tugmalar. */
type Keyboard = { text: string; callback_data: string }[][];

export interface SentMessage {
  chat_id: string;
  text: string;
  message_id: number;
  keyboard?: Keyboard;
}

export class FakeTelegram {
  readonly sent: SentMessage[] = [];
  readonly edited: { chat_id: string; message_id: number; text: string }[] = [];
  readonly answered: { id: string; text?: string }[] = [];
  readonly calls: { method: string; body: Record<string, unknown> }[] = [];
  private updates: unknown[] = [];
  private nextId = 1;
  /** true — keyingi so'rov tarmoq xatosi bilan tugaydi. */
  failNext = false;

  /** Foydalanuvchi botga yozgan xabar. */
  userWrites(chatId: number, text: string, title = "Ali"): void {
    this.updates.push({
      update_id: this.nextId++,
      message: { chat: { id: chatId, first_name: title }, text },
    });
  }

  /** Ixtiyoriy shakldagi xabar (masalan `from` bilan). */
  updatesPush(message: Record<string, unknown>): void {
    this.updates.push({ update_id: this.nextId++, message });
  }

  /** Inline tugma bosildi (`callback_query`). */
  press(
    from: { id: number; first_name?: string; username?: string },
    data: string,
    message?: SentMessage,
  ): Record<string, unknown> {
    const update = {
      update_id: this.nextId++,
      callback_query: {
        id: `cb${this.nextId}`,
        from,
        data,
        ...(message === undefined
          ? {}
          : { message: { message_id: message.message_id, chat: { id: Number(message.chat_id) } } }),
      },
    };
    this.updates.push(update);
    return update;
  }

  /** Oxirgi tugmali xabar va uning tugmalari. */
  lastKeyboard(): { message: SentMessage; buttons: { text: string; data: string }[] } {
    const message = [...this.sent].reverse().find((m) => m.keyboard !== undefined);
    if (message === undefined) throw new Error("tugmali xabar yo'q");
    return {
      message,
      buttons: message.keyboard!.flat().map((b) => ({ text: b.text, data: b.callback_data })),
    };
  }

  readonly fetch: typeof fetch = async (input, init) => {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("ECONNRESET");
    }
    const url = String(input);
    const method = url.split("/").pop()!;
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    if (!/\/botTEST:TOKEN\//.test(url)) {
      return Response.json({ ok: false, description: "Unauthorized" }, { status: 401 });
    }
    this.calls.push({ method, body });
    if (method === "getUpdates") {
      const offset = Number(body.offset ?? 0);
      const result = this.updates.filter((u) => (u as { update_id: number }).update_id >= offset);
      this.updates = [];
      return Response.json({ ok: true, result });
    }
    if (method === "sendMessage") {
      const markup = body.reply_markup as { inline_keyboard?: Keyboard } | undefined;
      const message: SentMessage = {
        chat_id: String(body.chat_id),
        text: String(body.text),
        message_id: this.sent.length + 1,
        ...(markup?.inline_keyboard === undefined ? {} : { keyboard: markup.inline_keyboard }),
      };
      this.sent.push(message);
      return Response.json({ ok: true, result: { message_id: message.message_id } });
    }
    if (method === "editMessageText") {
      this.edited.push({
        chat_id: String(body.chat_id),
        message_id: Number(body.message_id),
        text: String(body.text),
      });
      return Response.json({ ok: true, result: true });
    }
    if (method === "answerCallbackQuery") {
      this.answered.push({
        id: String(body.callback_query_id),
        ...(body.text === undefined ? {} : { text: String(body.text) }),
      });
      return Response.json({ ok: true, result: true });
    }
    if (method === "setWebhook" || method === "deleteWebhook") {
      return Response.json({ ok: true, result: true });
    }
    return Response.json({ ok: false, description: "unknown method" }, { status: 404 });
  };
}
