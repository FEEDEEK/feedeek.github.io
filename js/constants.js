// (vyjmuto z app.js, řádky 32-53)


export const MEAL_SLOTS = [
  { key:'pivo',          label:'Pivo', day:'Pivo' },
  { key:'fri-dinner',    label:'Pátek — Večeře', day:'Pátek' },
  { key:'sat-breakfast', label:'Sobota — Snídaně', day:'Sobota' },
  { key:'sat-lunch',     label:'Sobota — Oběd', day:'Sobota' },
  { key:'sat-dinner',    label:'Sobota — Večeře', day:'Sobota' },
  { key:'sun-breakfast', label:'Neděle — Snídaně', day:'Neděle' }
];
export function emptyFoodSchedule(){
  const o = {};
  MEAL_SLOTS.forEach(s => o[s.key] = []);
  return o;
}

export const PERMISSION_AREAS = [
  { key:'akce', label:'Akce (vytváření, úprava, účastníci)' },
  { key:'turnaj', label:'Turnaje' },
  { key:'jidlo', label:'Jídlo' },
  { key:'kontakty', label:'Kontakty' },
  { key:'uzivatele', label:'Uživatelé (správa profilů)' },
  { key:'zaznam', label:'Záznam změn (vidí historii akcí adminů)' }
];
