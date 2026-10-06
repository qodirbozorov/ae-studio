# AE Studio'ni Claude'ga ulash

AE Studio Claude'ga **custom connector** (remote MCP server) sifatida ulanadi. Bitta ulanish claude.ai (web), Claude Desktop va Claude mobil ilovasida ishlaydi.

**Server manzili:** `https://server-production-9c75.up.railway.app/mcp`

## Oldindan kerak

1. **Kabinetga kirish.** Kirish va ro'yxatdan o'tish Telegram orqali, email va parol kerak emas:
   1. kabinetda «Telegram orqali kirish» ni bosing;
   2. bot ochiladi — **Start** ni bosing;
   3. sahifa o'zi kiradi.

   Shu chat xabarnomalar uchun ham ulanadi.
2. **After Effects paneli ulangan bo'lishi.** AE'da AE Studio panelini oching va ko'rsatilgan kodni kabinetda (`/device`) tasdiqlang.

## Ulash (bir marta)

1. Claude'da **Settings → Connectors → Add custom connector** ni oching.
2. Nom: `AE Studio`. URL: `https://server-production-9c75.up.railway.app/mcp`. Client ID va secret maydonlarini bo'sh qoldiring.
3. **Connect** ni bosing. Brauzerda AE Studio ochiladi:
   - kirmagan bo'lsangiz — «Telegram orqali kirish» (botda Start), so'ng shu yerga qaytasiz;
   - ruxsat ekranida qaytish manzili `claude.ai` ekanini ko'ring va **Ruxsat berish** ni bosing.
4. Claude'da connector yoqilgan bo'lishi kerak: 25 ta tool va `/new-reel` buyrug'i ko'rinadi.

## Tekshirish

1. Yangi chatda: *"AE Studio: env_check"*. Javobda `ready: true` bo'lsa — panel, AE va ish papkasi tayyor.
2. Panelning holat qatorida **Claude 🟢** chiqadi (oxirgi 15 daqiqada chaqiruv bo'lgan bo'lsa).
3. Birinchi video uchun `/new-reel` buyrug'ini tanlang va brief yozing. Masalan:
   - *"Kofe do'konim uchun 20 soniyalik reel; source papkadagi rasmlardan"*;
   - ish papkasi sifatida `source/` ichiga rasm va videolar qo'yilgan mavjud papkani bering.
4. Telefon: Claude mobil ilovasida ham shu connector ko'rinadi. Panel kompyuterda ochiq bo'lishi kerak, AE ishi o'sha kompyuterda bajariladi.

## Uzish

- **Kabinetda:** "Ulangan ilovalar" bo'limida **Uzish** tugmasi. Barcha tokenlar darhol bekor bo'ladi.
- **"Faollik" bo'limi:** ruxsatlar, uzishlar va Claude'ning o'zgartiruvchi amallari (plan yozish, build va h.k.) ko'rinadi.

## Texnik ma'lumot

| Narsa | Qiymat |
|---|---|
| Transport | MCP Streamable HTTP (stateless, JSON), protokol 2025-11-25 |
| Avtorizatsiya | OAuth 2.1 |
| Klient ro'yxatdan o'tishi | DCR (`/oauth/register`) va Client ID Metadata Document |
| PKCE | S256 |
| Tokenlar | access 1 soat, refresh 30 kun (rotation) |
| Discovery | `/.well-known/oauth-protected-resource/mcp`, `/.well-known/oauth-authorization-server` |
| Callback | `https://claude.ai/api/mcp/auth_callback`; Claude Code — `http://localhost:<port>/callback` |
| Limitlar | user bo'yicha 120 MCP chaqiruv/daqiqa |

**Avtomatik sinov.** Butun oqimni (401 → metadata → DCR → ruxsat → token → MCP → refresh → uzish) quyidagi buyruq tekshiradi:

```sh
cd apps/server
AES_URL=https://server-production-9c75.up.railway.app AES_COOKIE='aes_session=…' node scripts/oauth-smoke.mjs
```
