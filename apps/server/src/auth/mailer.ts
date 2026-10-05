/**
 * Email yuborish (magic link). `RESEND_API_KEY` bo'lsa Resend API, aks holda dev rejim: havola logga chiqadi.
 */
import type { FastifyBaseLogger } from "fastify";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export class ConsoleMailer implements Mailer {
  constructor(private readonly log: FastifyBaseLogger) {}
  async send(mail: Mail): Promise<void> {
    this.log.info(
      { to: mail.to, subject: mail.subject, text: mail.text },
      "📧 dev email (yuborilmadi)",
    );
  }
}

export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly timeoutMs = 10_000,
  ) {}

  async send(mail: Mail): Promise<void> {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: this.from,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Resend: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
    }
  }
}

/** Test uchun: yuborilgan xatlarni yig'adi. */
export class MemoryMailer implements Mailer {
  readonly sent: Mail[] = [];
  async send(mail: Mail): Promise<void> {
    this.sent.push(mail);
  }
}
