/** Soxta Telegram Bot API: `getUpdates` navbati va yuborilgan xabarlar (`sendMessage`). */
export class FakeTelegram {
  readonly sent: { chat_id: string; text: string }[] = [];
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

  readonly fetch: typeof fetch = async (input, init) => {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("ECONNRESET");
    }
    const url = String(input);
    const method = url.split("/").pop();
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    if (!/\/botTEST:TOKEN\//.test(url)) {
      return Response.json({ ok: false, description: "Unauthorized" }, { status: 401 });
    }
    if (method === "getUpdates") {
      const offset = Number(body.offset ?? 0);
      const result = this.updates.filter((u) => (u as { update_id: number }).update_id >= offset);
      this.updates = [];
      return Response.json({ ok: true, result });
    }
    if (method === "sendMessage") {
      this.sent.push({ chat_id: String(body.chat_id), text: String(body.text) });
      return Response.json({ ok: true, result: { message_id: this.sent.length } });
    }
    return Response.json({ ok: false, description: "unknown method" }, { status: 404 });
  };
}
