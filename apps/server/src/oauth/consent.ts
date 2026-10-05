/**
 * Ruxsat (consent) ekrani — server tomonida render qilinadigan oddiy HTML.
 * MCP spec: redirect URI host'i aniq ko'rsatiladi, faqat loopback bo'lsa qo'shimcha ogohlantirish.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STYLE = `
:root{color-scheme:light dark;--bg:#f6f6f4;--card:#fff;--text:#1d1d1b;--muted:#6b6b66;--border:#e2e2dc;--accent:#2f6fde;--warn:#b45309}
@media (prefers-color-scheme:dark){:root{--bg:#161616;--card:#202020;--text:#e8e8e3;--muted:#9a9a93;--border:#333;--accent:#5b8ff0;--warn:#f59e0b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:440px;margin:48px auto;padding:0 16px}.card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:24px}
h1{font-size:20px;margin:0 0 4px}p{margin:8px 0}.muted{color:var(--muted);font-size:13px}.warn{color:var(--warn);font-size:13px}
ul{padding-left:18px;margin:8px 0}code{font-size:13px;word-break:break-all}
.actions{display:flex;gap:8px;margin-top:20px}button{flex:1;padding:10px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text);font:inherit;cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;
}

export function errorPage(message: string): string {
  return page(
    "AE Studio — xato",
    `<div class="card"><h1>Ulanib bo'lmadi</h1><p>${escapeHtml(message)}</p><p class="muted">Claude'dagi ulanishni qaytadan boshlang.</p></div>`,
  );
}

export interface ConsentInput {
  clientName: string;
  clientId: string;
  redirectHost: string;
  loopbackOnly: boolean;
  email: string;
  /** Formada qayta yuboriladigan parametrlar. */
  fields: Record<string, string>;
  csrf: string;
}

export function consentPage(input: ConsentInput): string {
  const hidden = Object.entries(input.fields)
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
    )
    .join("");
  const warning = input.loopbackOnly
    ? `<p class="warn">⚠️ Bu ilova faqat shu kompyuterdagi manzilga (<code>${escapeHtml(input.redirectHost)}</code>) qaytadi. Uni o'zingiz ishga tushirgan bo'lsangizgina ruxsat bering.</p>`
    : "";
  return page(
    "AE Studio — ruxsat",
    `<div class="card">
<h1>${escapeHtml(input.clientName)} ulanmoqchi</h1>
<p class="muted">Hisob: ${escapeHtml(input.email)}</p>
<p>Ruxsat bersangiz, ilova sizning nomingizdan quyidagilarni qila oladi:</p>
<ul><li>loyihalar, rejalar va fayllar ro'yxatini ko'rish</li><li>After Effects'da video qurish, kadrlarni ko'rish va render qilish</li></ul>
<p class="muted">Qaytish manzili: <code>${escapeHtml(input.redirectHost)}</code><br>Ilova: <code>${escapeHtml(input.clientId)}</code></p>
${warning}
<form method="post" action="/oauth/authorize">${hidden}<input type="hidden" name="csrf" value="${escapeHtml(input.csrf)}">
<div class="actions"><button type="submit" name="decision" value="deny">Rad etish</button><button type="submit" name="decision" value="allow" class="primary">Ruxsat berish</button></div>
</form>
<p class="muted">Ruxsatni istalgan payt kabinetdagi "Ulangan ilovalar" bo'limida bekor qilish mumkin.</p>
</div>`,
  );
}
