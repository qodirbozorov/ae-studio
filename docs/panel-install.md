# AE Studio panelini boshqa kompyuterda sinash

After Effects 2022 (22.0) yoki undan yangi versiya kerak (CEP 11+).

## 1-usul: build papkasini nusxalash (eng tez)

1. Dev kompyuterda: `pnpm --filter @aes/panel build` → `apps/panel/dist/cep/` papkasi tayyor bo'ladi.
2. Shu papkani AE o'rnatilgan kompyuterga nusxalang va nomini `com.aestudio.panel` qiling:
   - Windows: `%APPDATA%\Adobe\CEP\extensions\com.aestudio.panel\`
   - macOS: `~/Library/Application Support/Adobe/CEP/extensions/com.aestudio.panel/`
3. Imzolanmagan panel uchun bir marta `PlayerDebugMode` ni yoqing (AE yopiq bo'lsin):
   - Windows (PowerShell):
     ```powershell
     foreach ($v in 11, 12) { New-Item -Force "HKCU:\Software\Adobe\CSXS.$v" | Out-Null; Set-ItemProperty "HKCU:\Software\Adobe\CSXS.$v" PlayerDebugMode "1" }
     ```
   - macOS: `defaults write com.adobe.CSXS.11 PlayerDebugMode 1` (va `.12` uchun ham)
4. AE → **Window → Extensions → AE Studio**.

## 2-usul: imzolangan ZXP

1. Dev kompyuterda: `pnpm --filter @aes/panel zxp` → `apps/panel/dist/zxp/com.aestudio.panel.zxp` (self-signed, `PlayerDebugMode` shart emas).
2. AE kompyuterida ZXP Installer yoki `UnifiedPluginInstallerAgent --install <fayl>.zxp` bilan o'rnating.

## Nosozliklarni tekshirish

- Panel konsoli: Chrome'da `http://localhost:8860` (`.debug` fayldagi port) → DevTools.
- Panel ochilmasa: `PlayerDebugMode` va papka nomini tekshiring, AE'ni qayta ishga tushiring.
