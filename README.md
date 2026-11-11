# FEEDEEK LAN – web

Web pro pořádání LAN party (HTML/CSS/JS + Firebase Firestore, Storage, Auth, Cloud Functions). Hostuje GitHub Pages: https://feedeek.github.io/

## Struktura repozitáře

| Složka / soubor | Co v ní je |
|---|---|
| `index.html`, `app.js`, `js/`, `css/` | samotný web (`app.js` je jen úvod, zbytek je v modulech `js/`; styly jsou ve `css/` a načítají se v tomto pořadí: base, pages, losovacka, turnaj, komponenty, akce-hlavicka) |
| `js/` | moduly (každý soubor = jedna část webu): základ `firebase.js`, `state.js` (sdílený stav `S`), `hooks.js` (`appApi` – přemostění pár funkcí zůstávajících v `app.js`), `util.js`, `ui.js`, `constants.js`, `audit.js`, `payment.js`, `games.js` (zde se vkládá RAWG klíč); akce: `event-form.js`, `event-detail.js`, `rsvp.js`, `tab-prehled.js`, `tab-jidlo.js`, `tab-turnaj.js`, `schedule.js`, `photos.js`, `food-editor.js`; turnaje: `turnaj-common.js`, `turnaj-page.js`, `tb-core.js`, `tb-live.js` (losovačka, zvuk, živé hlášky); účty: `auth-form.js`, `account.js`, `users-list.js`, `mail.js`; ostatní: `contacts.js`, `early-route.js` (nastaví stránku dřív, než se načte app.js) |
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
