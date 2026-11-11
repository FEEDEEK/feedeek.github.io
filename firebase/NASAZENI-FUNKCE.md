# E-mail při novém komentáři k akci (Cloud Function)

Funkce `notifyNewEventComment` (složka `functions/`) po každém novém komentáři k akci zapíše e-maily
do kolekce `mail`. Odesílá je stejné rozšíření jako e-maily z tlačítek pro adminy.

1. V `functions/index.js` nastav `REGION` (stejná oblast jako Firestore) a `SITE_URL` (adresa webu).
2. Jednou na počítači: `npm i -g firebase-tools`, `firebase login`, `firebase init functions`
   (použij existující projekt, JavaScript, soubory nepřepisuj) – nebo jen ve složce projektu
   vytvoř `firebase.json` podle `firebase.json.example`.
3. `cd functions && npm install`, potom v kořeni projektu `firebase deploy --only functions`.
4. Projekt musí mít plán Blaze (už ho kvůli e-mailům máš).
