// (vyjmuto z app.js, řádky 1096-1285)
import { setDoc, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js";
import { S } from "./state.js";

// ==================== LOSOVAČKA TÝMŮ (výherní automat) ====================
export const TB_BATCH_WINDOW = 2000;
export const TB_REEL_ITEM_H = 58;

export const TB_SHOT_ICON = `<svg class="tb-icon-inline" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 4 L17 4 L14.5 17 Q10 19 5.5 17 Z" fill="#f2a71b" stroke="#1a1a1a" stroke-width="1.6"/>
    <rect x="7" y="6" width="1.6" height="8" fill="#fff" opacity="0.7"/>
    <rect x="10.5" y="6" width="1.6" height="8" fill="#fff" opacity="0.5"/>
</svg>`;
export const TB_JOINT_ICON = `<svg class="tb-icon-inline" viewBox="0 0 28 10" xmlns="http://www.w3.org/2000/svg">
    <path d="M2 4 Q0.3 5 2 6 L20 6 Q22 5 20 4 Z" fill="#f2efe6" stroke="#8a8a8a" stroke-width="0.5"/>
    <ellipse cx="8" cy="5" rx="2.2" ry="1" fill="#d9d5c8" opacity="0.5"/>
    <ellipse cx="14" cy="5" rx="2.5" ry="1" fill="#dcd8cc" opacity="0.5"/>
    <ellipse cx="23" cy="5" rx="3.4" ry="2.6" fill="#ff6a3d"/>
    <ellipse cx="23" cy="5" rx="5" ry="4" fill="#ff6a3d" opacity="0.3"/>
</svg>`;

export function tbCalculateCurrentSkill(player) {
    let skill = player.baseSkill;
    skill *= Math.pow(0.94, player.beers);
    skill *= Math.pow(0.91, player.shots);
    skill *= Math.pow(0.85, player.joints);
    return Math.max(5, Math.round(skill));
}

export async function tbSaveSkill(name, skill){
  try{ await setDoc(doc(db,'playerSkills', name.toLowerCase()), { skill, name }); }catch(err){ console.error(err); }
}
export async function tbLoadSkill(name){
  try{
    const snap = await getDoc(doc(db,'playerSkills', name.toLowerCase()));
    return snap.exists() ? snap.data().skill : null;
  }catch(err){ return null; }
}

export function tbKey(name){
  return String(name).split('').map(ch => /[A-Za-z0-9]/.test(ch) ? ch : '_' + ch.charCodeAt(0).toString(16) + '_').join('');
}
// Handicap (skill + piva/panáky/jointy) se sdílí mezi turnaji stejné akce založenými stejný den
// (klíč = akce+den), aby druhý turnaj toho dne navazoval na první. Nová akce/den = čistý start.
// Turnaj bez přiřazené akce má handicap jen pro sebe (klíč = ID turnaje).
export function handicapSessionKey(t){
  const day = (t.createdAt || '').slice(0, 10);
  return t.eventId ? `ev_${t.eventId}_${day}` : `solo_${t.id}`;
}
 // sessionKey -> { skills:{}, drinks:{} }
function handicapSessionData(t){
  return S.handicapCache[handicapSessionKey(t)] || { skills:{}, drinks:{} };
}
// "Syrový" handicap bez zadaného skillu - klesá od nuly do mínusu, žádný přepočet na efektivní skill
export function tbRawHandicap(beers, shots, joints){
  return beers * 10 + shots * 15 + joints * 20;
}
export function tbGetPlayerStats(t, name){
  const k = tbKey(name);
  const session = handicapSessionData(t);
  let base = (session.skills && typeof session.skills[k] === 'number') ? session.skills[k] : null;
  if(base === null && t.baseSkills && typeof t.baseSkills[k] === 'number') base = t.baseSkills[k];
  const d = (session.drinks && session.drinks[k]) || {};
  return { base, beers: d.beers || 0, shots: d.shots || 0, joints: d.joints || 0 };
}
export function tbEffectiveStats(t, name){
  const s = tbGetPlayerStats(t, name);
  if(s.base === null) return { ...s, eff: null, handicap: tbRawHandicap(s.beers, s.shots, s.joints) };
  const eff = tbCalculateCurrentSkill({ baseSkill: s.base, beers: s.beers, shots: s.shots, joints: s.joints });
  return { ...s, eff, handicap: Math.max(0, s.base - eff) };
}

// Hráči v losování při zakládání turnaje
let tbDrawSeq = 1;
export function tbAddDrawPlayer(name, baseSkill, opts){
  opts = opts || {};
  if(S.tbDraw.players.some(p => p.name.toLowerCase() === name.toLowerCase())) return;
  S.tbDraw.players.push({ id: tbDrawSeq++, name, baseSkill, fromEvent: !!opts.fromEvent });
  if(opts.persist !== false) tbSaveSkill(name, baseSkill);
}

export const tbBeerUpMsgs = [
    "{name} si dává pivo a slibuje, že tohle bylo fakt poslední",
    "{name} loknul piva, najednou vidí dva monitory",
    "Pivo pro {name}! Skill dolů, nálada nahoru",
    "{name} si přihnul, mířidla se rozostřují",
    "{name} si dává další rundu, gg skill",
    "{name} tvrdí, že pivo mu naopak pomáhá. Data říkají něco jiného",
    "{name} si dal loka a hned je z něj profesionál... na kecání",
    "Level piva u {name} +1, level hry -5",
    "{name} má žízeň jak velbloud, skill jak šnek",
    "{name} slaví gólovou akci pivem, i když ještě nepadl žádný gól"
];
export const tbBeerDownMsgs = [
    "{name} vystřízlivěl (aspoň trochu)",
    "{name} to pivo raději vylil, moudré rozhodnutí",
    "{name} našel v sobě sílu říct dost",
    "{name} si to rozmyslel, forma se vrací",
    "{name} vyměnil pivo za vodu, respekt",
    "{name} se rozhodl hrát fér a bez piva",
    "{name} zpytuje svědomí a odkládá sklenici",
    "{name} sype popel na hlavu a střízliví"
];
export const tbShotUpMsgs = [
    "{name} si dává panáka, ruce se třesou",
    "Panák pro {name}! Reakce klesají jak kámen",
    "{name} to srazil na ex, teď to sráží i skill",
    "{name} si dal frťana na kuráž, kuráž našel, skill ztratil",
    "{name} má oči jak návarka, po panáku",
    "Panák číslo další, kdo to u {name} ještě počítá",
    "{name} zvládl panáka bez grimasy, respekt, skill ale klesá",
    "{name} si připil na výhru, která ještě nepřišla",
    "{name} cítí, jak mu prsty samy míří vedle myši",
    "{name} slaví další frťana, tým pláče"
];
export const tbShotDownMsgs = [
    "{name} nechal panáka na stole, moudrost vítězí",
    "{name} panáka radši vylil zpátky do lahve",
    "{name} se rozhodl přibrzdit",
    "{name} si řekl dost, forma se vrací",
    "{name} panáka věnoval kamarádovi",
    "{name} zvolil cestu střízlivosti",
    "{name} nechal sklenku plnou, tým děkuje",
    "{name} se semkl a nedal si další"
];
export const tbJointUpMsgs = [
    "{name} se zapálil! Handicap roste",
    "{name} je v cloudu devět, real-life bohužel ne",
    "{name} si zapálil, teď hraje na city z jiné galaxie",
    "{name} má najednou filozofické myšlenky místo callů",
    "{name} se dokonale zrelaxoval, mapu už tolik nevidí",
    "{name} plave v pohodě, tým plave v problémech",
    "{name} si zapálil a zapomněl, že hraje ranked",
    "{name} je chill, tým je v podzemí",
    "{name} objevil vesmír, ztratil mapu",
    "{name} se nadýchl inspirace, ztratil koordinaci"
];
export const tbJointDownMsgs = [
    "{name} to uhasil, jde zpátky do formy",
    "{name} si to rozmyslel a joint uhasil",
    "{name} se probral z cloudu",
    "{name} se vrací zpátky na zem",
    "{name} joint raději věnoval sousedům",
    "{name} volí čistou hlavu",
    "{name} uhasil a je zase při smyslech",
    "{name} se semkl, forma stoupá"
];
export const tbBeerCollectiveMsgs = [
    "{names} si dávají rundu piva, tým se boří rychleji než síť",
    "{names} zvedají čepované, formy padají jak podzimní listí",
    "{names} slaví další kolo piva, kapitán pláče",
    "{names} si přiťukli, skilly kolektivně klesají",
    "{names} objednali rundu, tahle hra už nebude fér",
    "{names} mají žízeň jako poušť, hra bez nich by šla líp",
    "{names} pijí na kuráž, kuráž je, skill není",
    "{names} se semkli u dalšího piva, tým se pomalu rozpadá"
];
export const tbShotCollectiveMsgs = [
    "{names} si dávají rundu panáků, reakce jdou spát",
    "{names} to sráží na ex, tým sráží skóre",
    "{names} připíjí na vítězství, které se pomalu vzdaluje",
    "{names} mají po panáku oči jak návarky",
    "{names} slaví frťanem, protivníci se smějí",
    "{names} si dali frťana na kuráž, kuráž je, mířidla nejsou",
    "{names} zvládli panáka bez grimasy, formu ne",
    "{names} si připíjí, tým si připlácí"
];
export const tbJointCollectiveMsgs = [
    "{names} se zapálili společně, handicap roste jako lavina",
    "{names} jsou v cloudu devět, real-life bohužel ne",
    "{names} si zapálili a zapomněli, že hrají ranked",
    "{names} plavou v pohodě, tým plave v problémech",
    "{names} objevili vesmír, ztratili mapu",
    "{names} jsou naprosto chill, tým je naprosto v podzemí",
    "{names} se nadechli inspirace, ztratili koordinaci",
    "{names} mají najednou filozofické myšlenky místo callů"
];
export function tbJoinNamesCz(names) {
    if (names.length === 1) return names[0];
    if (names.length === 2) return names[0] + ' a ' + names[1];
    return names.slice(0, -1).join(', ') + ' a ' + names[names.length - 1];
}
export function tbPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
export function tbShuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
export function tbSleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }


