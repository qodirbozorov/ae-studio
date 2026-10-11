---
version: 1
slug: "apps-web"
primary_target: "apps/web"
related_targets: []
---

# Web kabinet (apps/web) — surface brief

Scope: butun kabinet (login, shell, barcha sahifalar). Mode: Operate. Build path: code-led (reference rasm pinned, comp yo'q).
Audience/job: admin va jamoa — qurilma holati, job kuzatuvi, ulash, sozlash. Constraint: faqat light, o'z komponentlarimiz (flowbite olib tashlanadi), Inter (Google Fonts) 200–500 og'irliklar, o'zbekcha matn.

## Direction contract

THESIS: Kabinet — yumshoq, havodor "porcelain" boshqaruv paneli: kulrang maydon ichidagi katta radiusli qobiq, chap tomonda daraxt-navigatsiya, o'ngda bir nechta katta oq "overview" kartalar. Rad etiladi: ko'k aksentli, zich, flowbite-ko'rinishli standart admin.
OWN-WORLD: zamin #e3e3e3, qobiq #f1f1f1 (r=44px), kartalar oqdan #f5f5f5 ga yumshoq o'tish (r=40px, faqat soya). Siyoh #1d1d1f / #5c5c5c / #737373; ikki tonli sarlavha (to'q + kulrang so'z). Pastel hisoblagichlar: shaftoli #fdc6a8, yalpiz #c4ead3. Holat pill'lari: yashil chiziqli (onlayn/tayyor), shaftoli (kutish), qizil (to'xtagan). Ikonlar lucide 1.5 stroke. Inter 300 display, 400 matn, 500 faol.
STORY: Kirgan odam darhol qaysi qurilma onlayn, nima qurilayotgani va qayerda to'xtaganini ko'radi; bir bosishda faollik lentasiga, ulashga, sozlamaga o'tadi.
FIRST VIEWPORT: chapda 300px yon panel: metall-hexagon logo, nav (Qurilmalar ochiq — ostida qurilmalar daraxti, onlayn soni yashil badge), pastda profil chip + chiqish. O'ngda 52px ingichka ikki tonli sarlavha "Qurilmalar holati", ostida har qurilma uchun katta karta: nom, aylana ikon qudug'i, "Joriy job" yorlig'i, 72px thin progress raqami, onlayn pill + "oxirgi aloqa". Asosiy amal "Qurilma ulash" — sarlavha yonida qora pill tugma.
FORM: brief-pinned reference (foydalanuvchi rasmi), concept-seed ishlatilmadi; seed key: none (pinned). Signature move: egri daraxt-chiziqlar (nav ostki bandlari) audit va faollik lentalarida ham takrorlanadi.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
