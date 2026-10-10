# Xato kodlari va yechimlari

> Avtomatik generatsiya qilingan (`pnpm gen:docs`, manba: `packages/shared/src/errors.ts`). Qo'lda tahrirlamang.

Har xato: `code`, `retryable` (sabab tuzatilmasa ham qayta urinish yordam beradimi), `hint` (nima qilish kerak),
ixtiyoriy `message` va `details`. Job BLOCKED bo'lsa sabab tuzatilgach `job_resume` (panelda — Davom ettirish).

## Muhit (panel, AE, papka, ffmpeg)

| Kod | Qayta urinish | Nima qilish kerak |
|---|---|---|
| `ENV_AGENT_OFFLINE` | ha | Panel serverga ulanmagan. After Effects'da AE Studio panelini oching; ulanishi bilan job avtomatik davom etadi. |
| `ENV_AE_CLOSED` | ha | After Effects yopiq yoki javob bermayapti. AE'ni oching va panelni qayta yuklang. |
| `ENV_NO_FOLDER` | ha | Ish papkasi tanlanmagan. Panelning 'Ish papkasi' ekranida papkani tanlang. |
| `ENV_FFMPEG_MISSING` | ha | ffmpeg/ffprobe topilmadi. Panel sozlamalarida ffmpeg yo'lini tekshiring. |

## Avtorizatsiya

| Kod | Qayta urinish | Nima qilish kerak |
|---|---|---|
| `AUTH_INVALID` | yo'q | Token yaroqsiz. Qayta kiring yoki panelni qayta ulang. |
| `AUTH_EXPIRED` | yo'q | Sessiya muddati tugagan. Qayta kiring. |
| `AUTH_DEVICE_REVOKED` | yo'q | Bu qurilma web kabinetda bekor qilingan. Panelni yangi kod bilan qayta ulang. |

## Spec (reja)

| Kod | Qayta urinish | Nima qilish kerak |
|---|---|---|
| `SPEC_INVALID` | yo'q | Spec sxemaga mos emas. details dagi path'larni tuzatib plan_patch qiling. |
| `SPEC_UNKNOWN_ASSET` | yo'q | Spec'da noma'lum 'asset:' havolasi bor. assets_list bilan mavjud kalitlarni tekshirib plan_patch qiling. |
| `SPEC_UNKNOWN_TEMPLATE` | yo'q | Spec'da noma'lum shablon bor. templates_list bilan tekshirib plan_patch qiling. |

## Fayllar

| Kod | Qayta urinish | Nima qilish kerak |
|---|---|---|
| `ASSET_MISSING` | yo'q | Fayl topilmadi. Faylni ish papkasiga qo'ying va assets_scan qiling. |
| `ASSET_CORRUPT` | ha | Fayl buzilgan yoki sha256 mos kelmadi. Qayta yuklab olinadi; takrorlansa manba faylni almashtiring. |
| `ASSET_UNSUPPORTED` | yo'q | Fayl formati qo'llanmaydi. Uni boshqa formatga o'tkazing yoki Spec'dan olib tashlang. |
| `ASSET_OUTSIDE_ROOT` | yo'q | Fayl yo'li ish papkasidan tashqarida. Faqat ish papkasi ichidagi nisbiy yo'llardan foydalaning. |

## After Effects

| Kod | Qayta urinish | Nima qilish kerak |
|---|---|---|
| `AE_SCRIPT_ERROR` | yo'q | ExtendScript xatosi. message va qatorni tekshiring; Spec'ni tuzatib qayta quring. |
| `AE_TIMEOUT` | ha | AE op vaqtida tugamadi (modal oyna yoki og'ir ish bo'lishi mumkin). AE'ni tekshirib job_resume qiling. |
| `AE_FONT_MISSING` | yo'q | Shrift AE'da topilmadi. Shriftni o'rnating yoki brand fallback shriftini ishlating. |
| `AE_VERSION` | yo'q | After Effects versiyasi qo'llanmaydi (kamida 22.0 kerak). |
| `AE_UNKNOWN_OP` | yo'q | Panel bu opni bilmaydi. Panelni yangilang. |
| `AE_BAD_PARAMS` | yo'q | Op parametrlari noto'g'ri. details ni tekshiring. |
| `AE_PROJECT_DIRTY` | ha | AE'da ochiq loyihada saqlanmagan o'zgarishlar bor. Uni saqlang (yoki job avtomatik _autosave nusxasini yaratsin) va qayta urining. |
| `AE_MODAL_SUSPECTED` | ha | After Effects javob bermayapti — ehtimol ochiq dialog oynasi bor. AE'dagi dialogni yoping va qayta urining. |
| `AE_NOT_FOUND` | yo'q | Havola qilingan comp/layer/element AE loyihasida topilmadi. Oldingi op bajarilganini tekshiring. |

## ElevenLabs

| Kod | Qayta urinish | Nima qilish kerak |
|---|---|---|
| `EL_AUTH` | yo'q | ElevenLabs kaliti yaroqsiz. Web kabinetda kalitni yangilang. |
| `EL_QUOTA` | yo'q | ElevenLabs kvotasi yetmaydi. Tarifni oshiring yoki vazifalarni qisqartiring (ask_user). |
| `EL_RATE_LIMIT` | ha | ElevenLabs so'rovlar chegarasi. Biroz kutib qayta urinadi. |
| `EL_TIMEOUT` | ha | ElevenLabs javob bermadi. Qayta urinadi. |
| `EL_BAD_PARAMS` | yo'q | ElevenLabs parametrlari noto'g'ri. details ni tekshirib vazifani tuzating. |

## Render

| Kod | Qayta urinish | Nima qilish kerak |
|---|---|---|
| `RENDER_NOT_CONFIRMED` | yo'q | Render foydalanuvchi kompyuterini band qiladi: avval foydalanuvchi natijani AE timeline'ida ko'rsin; render faqat u aniq so'rasa (user_confirmed: true). |
| `RENDER_FAILED` | ha | Render muvaffaqiyatsiz. Qayta urinib ko'riladi; takrorlansa render logini tekshiring. |
| `RENDER_DURATION_MISMATCH` | ha | Render davomiyligi Spec'ga mos emas. Qayta render qilinadi. |

## Job boshqaruvi

| Kod | Qayta urinish | Nima qilish kerak |
|---|---|---|
| `JOB_ACTIVE` | yo'q | Bu qurilmada boshqa job ishlayapti. U tugashini kuting yoki uni bekor qiling (cancel). |
| `JOB_BAD_ACTION` | yo'q | Bu amal job'ning hozirgi holatida mumkin emas. job holatini qayta o'qing. |

## VERIFY sikli

| Kod | Qayta urinish | Nima qilish kerak |
|---|---|---|
| `LOOP_PATCH_LIMIT` | yo'q | Patch chegarasi (3) tugadi. Foydalanuvchidan yo'l-yo'riq so'rang (ask_user). |

## Kadrlar (VERIFY)

| Kod | Qayta urinish | Nima qilish kerak |
|---|---|---|
| `FRAME_CAPTURE_FAILED` | ha | Kadrlar olinmadi. details.reason ga qarang: modal_suspected — AE'dagi dialogni yoping; comp_not_found — job qurilganini tekshiring; timeout/render_error — qayta urining. |

## Effektlar

| Kod | Qayta urinish | Nima qilish kerak |
|---|---|---|
| `FX_UNKNOWN` | yo'q | Effekt AE'da topilmadi (plagin o'rnatilmaganmi?). ae_effects bilan o'rnatilgan effektlar va matchName'ni tekshiring. |
| `FX_PARAM_UNKNOWN` | yo'q | Effekt parametri topilmadi yoki qiymat mos emas. fx_params bilan aniq nom, indeks va turini oling. |

## Tizim

| Kod | Qayta urinish | Nima qilish kerak |
|---|---|---|
| `SYS_INTERNAL` | ha | Kutilmagan server xatosi. Qayta urinib ko'ring. |
| `SYS_BAD_REQUEST` | yo'q | So'rov noto'g'ri. details ni tekshiring. |
| `SYS_NOT_FOUND` | yo'q | So'ralgan obyekt topilmadi. |
| `SYS_RATE_LIMIT` | ha | So'rovlar chegarasi. Biroz kutib qayta urining. |
