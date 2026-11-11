# FEEDEEK LAN – web

Web pro pořádání LAN party (HTML/CSS/JS + Firebase Firestore, Storage, Auth, Cloud Functions). Hostuje GitHub Pages: https://feedeek.github.io/

## Struktura repozitáře

| Složka / soubor | Co v ní je |
|---|---|
| `index.html`, `style.css`, `app.js` | samotný web (`app.js` se postupně dělí na moduly) |
| `js/` | moduly vyndané z `app.js`: `util.js` (text, datum), `payment.js` (QR platba), `games.js` (vyhledávání her; zde se vkládá RAWG klíč), `firebase.js` (připojení k Firebase), `audit.js` (záznam změn), `state.js` (sdílený stav: přihlášený uživatel, oprávnění) |
| `assets/img/` | **upravené** obrázky, které web používá (webp, zmenšené) |
| `assets/audio/` | zvuky, které web používá |
| `images/` | fotky akcí – **cesty se nesmí měnit**, odkazují na ně URL uložené v databázi akcí. Obsah je jen optimalizovaný |
| `originals/` | **původní** soubory v plné velikosti (zálohy, web je nenačítá) |
| `firebase/` | pravidla databáze a úložiště, Cloud Functions, návod na nasazení |

## Pravidla
- Obrázek použitý na webu: originál do `originals/`, zmenšená verze do `assets/img/`.
- Soubory v `images/` nepřejmenovávat ani nepřesouvat.
- Pravidla (`firebase/*.rules`) se po úpravě musí zkopírovat do Firebase konzole (Firestore → Pravidla, Storage → Pravidla).
- Funkce se nasazují z Cloud Shellu (`firebase/NASAZENI-FUNKCE.md`).
