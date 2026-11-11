import {
  collection, addDoc, onSnapshot, query, orderBy, doc, getDoc, getDocFromServer, getDocs, setDoc,
  updateDoc, deleteDoc, arrayUnion, arrayRemove, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  GoogleAuthProvider, signInWithPopup, signOut, sendPasswordResetEmail, sendEmailVerification,
  EmailAuthProvider, reauthenticateWithCredential, reauthenticateWithPopup, verifyBeforeUpdateEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

import { db, auth, storage, functionsApi } from "./js/firebase.js";
import { escapeHtml, fmtDate, fmtDateShort, todayIso } from "./js/util.js";
import { gameFieldHtml, setupGameField, searchGames, STEAM_SEARCH_FUNCTION_URL } from "./js/games.js";
import { S, hasPerm } from "./js/state.js";
import { appApi } from "./js/hooks.js";
import { logAction, startAuditListener, stopAuditListener } from "./js/audit.js";
import { eventHasOwnPaymentAccount, renderPersonalPaymentQr } from "./js/payment.js";
import { MEAL_SLOTS, emptyFoodSchedule, PERMISSION_AREAS } from "./js/constants.js";
import { fmtDateRange, avatarTag, emojiTag, authorLabel, setupChatEmojiRow } from "./js/ui.js";
import { renderTabFoto } from "./js/photos.js";
import { renderTabRozvrh, renderScheduleComments } from "./js/schedule.js";
import "./js/account.js";
import { renderContacts, closeContactForm } from "./js/contacts.js";
import { renderTabTurnaj } from "./js/tab-turnaj.js";
import { renderTabPrehled } from "./js/tab-prehled.js";
import { renderTabJidlo } from "./js/tab-jidlo.js";
import { renderStatsAndRsvp, renderAttendees } from "./js/rsvp.js";
import { openFoodEditor } from "./js/food-editor.js";
import { renderEventDetailStatic, renderActiveTab, renderEntryFeeBlock, renderDateVoteBlock, isPastDeadline } from "./js/event-detail.js";
import { normalizeGame, renderFormGames, renderFormFood, closeEventForm, renderEvents, startEditEvent } from "./js/event-form.js";
import { TEAM_EMBLEMS, TEAM_COLORS, autoStyle, teamName, teamObj, teamCaptain, teamMembersHtml, trophySvg, computeFfaStandings, podiumCupHtml, buildFfaPodiumHtml, renderFfaBody } from "./js/turnaj-common.js";
import { TB_BATCH_WINDOW, TB_REEL_ITEM_H, TB_SHOT_ICON, TB_JOINT_ICON, tbCalculateCurrentSkill, tbSaveSkill, tbLoadSkill, tbKey, handicapSessionKey, tbRawHandicap, tbGetPlayerStats, tbEffectiveStats, tbAddDrawPlayer, tbBeerUpMsgs, tbBeerDownMsgs, tbShotUpMsgs, tbShotDownMsgs, tbJointUpMsgs, tbJointDownMsgs, tbBeerCollectiveMsgs, tbShotCollectiveMsgs, tbJointCollectiveMsgs, tbJoinNamesCz, tbPick, tbShuffleArray, tbSleep } from "./js/tb-core.js";
import { tbInvalidateDraw, tbTeamSizeVal, tbUpdateTeamCountHint, tbRenderDrawPlayers, tbRenderDrawnTeams, tbStartDrawFromForm, tbStartDraft, tbStopLive, tbEnsureLive, openTbDevGraphModal, closeTbDevGraphModal, tbCloseDrinkModal, openTbDrinkModal, tbRefreshDrinkModal, renderTourneyTeamsPanel, tbUnlockSound, computeSwissTournament, renderSwissBody, openTeamEditorModal, openTournamentResultModal, fitBracketToScreen, layoutBracketRounds, drawBracketConnectors } from "./js/tb-live.js";
import { renderTurnajPage } from "./js/turnaj-page.js";

// funkce, které zatím zůstávají v app.js a potřebují je moduly (viz js/hooks.js)
Object.assign(appApi, { showView, usernameDocRef, updateAuthUI, hasPasswordProvider, closeAllAccountPanels, normalizeGame, renderTournamentSignupCta, isPastDeadline, applyRoute, setRoute, teamName, computeFfaStandings, computeSwissTournament, getAllUsersForMail, mailLink, openMailComposer, startEditEvent, renderTurnajPage, tbEffectiveStats, tryInitialRoute });

// ověřovací e-mail z našeho Gmailu; když funkce selže, použije se výchozí e-mail Firebase
async function sendVerifyMail(user){
  try{ await httpsCallable(functionsApi, 'sendVerificationMail')(); }
  catch(e){
    if(e && e.code === 'functions/resource-exhausted') throw e;
    console.warn('Ověřovací e-mail přes funkci selhal, zkouším výchozí:', e);
    await sendEmailVerification(user);
  }
}




// ---- Živé napojení na kolekci akcí ----
const eventsQuery = query(collection(db, 'events'), orderBy('dateStart'));
onSnapshot(eventsQuery, (snapshot) => {
  S.events = snapshot.docs.map(d => {
    const data = d.data();
    const dateStart = data.dateStart || data.date || '';
    const dateEnd = data.dateEnd || dateStart;
    return { id: d.id, ...data, dateStart, dateEnd };
  });
  S.events.forEach(ev => {
    if(!(ev.id in S.regCounts)){
      S.regCounts[ev.id] = { going:0, maybe:0 };
      onSnapshot(collection(db, 'events', ev.id, 'registrations'), (rsnap) => {
        let going=0, maybe=0;
        rsnap.forEach(r => { const st=r.data().status; if(st==='maybe') maybe++; else going++; });
        S.regCounts[ev.id] = { going, maybe };
        renderHome(); renderEvents();
        if(S.currentDetailEventId === ev.id) renderStatsAndRsvp();
      });
    }
  });
  renderHome();
  renderEvents();
  if(S.currentDetailEventId){
    const ev = S.events.find(x=>x.id===S.currentDetailEventId);
    if(ev) renderEventDetailStatic(ev);
  }
  tryInitialRoute();
}, (err) => console.error('Chyba připojení k Firestore:', err));

// ---- Navigation ----
const navItems = document.querySelectorAll('.nav-item');
const views = document.querySelectorAll('.view');
function showView(name){
  if(name === 'ucet' && (!S.currentUser || !S.currentNick)){ openLoginModal(); return; }
  navItems.forEach(n => n.classList.toggle('active', n.dataset.view === name));
  views.forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
}

function openLoginModal(){
  document.getElementById('login-modal-overlay').style.display = 'flex';
}
function closeLoginModal(){
  const overlay = document.getElementById('login-modal-overlay');
  if(overlay) overlay.style.display = 'none';
}

function setRoute(hash){
  if(location.hash === hash){ applyRoute(); return; }
  location.hash = hash;
}

function applyRoute(){
  closeEventForm();
  closeContactForm();
  closeAllAccountPanels();
  const raw = location.hash.replace(/^#/, '');
  const [view, id, sub] = raw.split('/');
  S.turnajProjectorMode = (view === 'turnaj' && !!id && sub === 'projektor');
  document.body.classList.toggle('projector-mode', S.turnajProjectorMode);
  if(!S.turnajProjectorMode) document.querySelectorAll('.tb-unlock-sound').forEach(b => b.remove());
  if(view !== 'turnaj'){ tbStopLive(); tbCloseDrinkModal(); closeTbDevGraphModal(); }

  if(view === 'event' && id){
    S.currentTournamentId = null;
    openEventDetail(id);
  }else if(view === 'turnaj'){
    S.currentTournamentId = id || null;
    S.tourneySetupStep = null;
    showView('turnaj');
    renderTurnajPage();
  }else if(view){
    showView(view);
  }else{
    showView('home');
  }
}
window.addEventListener('hashchange', applyRoute);

let initialRouteApplied = false;
let initialAuthSettled = false;
function tryInitialRoute(){
  if(initialRouteApplied) return;
  if(location.hash.startsWith('#event/')){
    const id = location.hash.split('/')[1];
    if(!S.events.find(e => e.id === id)) return; // data z Firestore ještě nedorazila, zkusíme znovu příště
  }
  if(location.hash.startsWith('#turnaj/')){
    const id = location.hash.split('/')[1];
    if(!S.allTournaments.find(x => x.id === id)) return;
  }
  initialRouteApplied = true;
  applyRoute();
}

navItems.forEach(n => n.addEventListener('click', () => setRoute('#' + n.dataset.view)));
document.getElementById('login-modal-close').addEventListener('click', closeLoginModal);
document.getElementById('login-modal-overlay').addEventListener('click', (e) => { if(e.target.id === 'login-modal-overlay') closeLoginModal(); });
document.getElementById('brand-home-link').addEventListener('click', () => setRoute('#home'));

// ---- Home ----
function renderHome(){
  const card = document.getElementById('next-event-card');
  const upcoming = S.events.filter(e => e.dateEnd >= todayIso());
  const metaBox = document.getElementById('next-event-metastrong');
  const subBox = document.getElementById('next-event-sub');
  if(upcoming.length === 0){
    card.querySelector('h2').textContent = '—';
    metaBox.textContent = '';
    subBox.textContent = 'Aktuálně se nic nepeče. Sleduj to tu, nebo hoď echo na Discord, ať se rozhoupeme.';
    card.style.backgroundImage = 'none';
    card.onclick = null;
    return;
  }
  const next = upcoming[0];
  card.querySelector('h2').textContent = (next.number ? next.number + ' — ' : '') + next.name;
  metaBox.innerHTML = `${fmtDateRange(next)} · <span class="place">${escapeHtml(next.place)}</span>`;
  subBox.textContent = next.desc || '';
  card.style.backgroundImage = next.imageUrl ? `url('${next.imageUrl.replace(/'/g,"")}')` : 'none';
  card.onclick = () => setRoute('#event/' + next.id);
}


// ==================== DETAIL AKCE ====================

function clearDetailListeners(){
  S.detailUnsubs.forEach(u => u());
  S.detailUnsubs = [];
}

function openEventDetail(eventId){
  S.currentDetailEventId = eventId;
  S.currentTab = 'prehled';
  S.currentTournamentId = null;
  const ev = S.events.find(x => x.id === eventId);
  if(!ev) return;
  showView('event');
  renderEventDetailStatic(ev);
  clearDetailListeners();

  const unsubReg = onSnapshot(collection(db, 'events', eventId, 'registrations'), (snap) => {
    S.currentRegistrationsMap = {};
    snap.forEach(d => S.currentRegistrationsMap[d.id] = { ...d.data(), _docId: d.id });
    renderStatsAndRsvp();
    renderAttendees();
    { const liveEv = S.events.find(x => x.id === eventId) || ev; renderDateVoteBlock(liveEv); }
    if(S.currentTab === 'jidlo') renderTabJidlo(ev);
  });
  S.detailUnsubs.push(unsubReg);

  const unsubSug = onSnapshot(collection(db, 'events', eventId, 'suggestions'), (snap) => {
    S.currentSuggestions = snap.docs.map(d => ({ id:d.id, ...d.data() })).sort((a,b)=>(a.ts||'').localeCompare(b.ts||''));
    if(S.currentTab === 'prehled') renderTabPrehled(ev);
  });
  S.detailUnsubs.push(unsubSug);

  const unsubComments = onSnapshot(collection(db, 'events', eventId, 'comments'), (snap) => {
    S.currentComments = snap.docs.map(d => ({ id:d.id, ...d.data() })).sort((a,b)=>(a.ts||'').localeCompare(b.ts||''));
    if(S.currentTab === 'prehled') renderTabPrehled(ev);
  });
  S.detailUnsubs.push(unsubComments);

  const unsubFood = onSnapshot(collection(db, 'events', eventId, 'foodComments'), (snap) => {
    S.currentFoodComments = snap.docs.map(d => ({ id:d.id, ...d.data() })).sort((a,b)=>(a.ts||'').localeCompare(b.ts||''));
    if(S.currentTab === 'jidlo') renderTabJidlo(ev);
  });
  S.detailUnsubs.push(unsubFood);

  const unsubSched = onSnapshot(collection(db, 'events', eventId, 'scheduleComments'), (snap) => {
    S.currentScheduleComments = snap.docs.map(d => ({ id:d.id, ...d.data() })).sort((a,b)=>(a.ts||'').localeCompare(b.ts||''));
    if(S.currentTab === 'rozvrh') renderScheduleComments(ev);   // jen seznam příspěvků, ať se nepřekreslí rozepsaný text
  });
  S.detailUnsubs.push(unsubSched);

  const unsubPhotos = onSnapshot(collection(db, 'events', eventId, 'photos'), (snap) => {
    S.currentPhotos = snap.docs.map(d => ({ id:d.id, ...d.data() })).sort((a,b)=>(b.ts||'').localeCompare(a.ts||''));
    if(S.currentTab === 'foto') renderTabFoto(ev);
  });
  S.detailUnsubs.push(unsubPhotos);
}


function renderTournamentSignupCta(ev){
  const box = document.getElementById('prehled-tourney-cta');
  if(!box) return;
  const list = S.allTournaments.filter(x => x.eventId === ev.id && x.status === 'signup');
  if(list.length === 0){ box.innerHTML = ''; return; }
  box.innerHTML = `
    <button type="button" class="tourney-signup-cta-btn" id="tourney-vote-announce-btn">
      <span class="tourney-cta-sparkles"></span>
      <span>📝 Jsou otevřené přihlášky do ${list.length > 1 ? 'turnajů' : 'turnaje'}</span>
    </button>
  `;
  document.getElementById('tourney-vote-announce-btn').addEventListener('click', () => {
    const turnajTabBtn = document.querySelector('#ed-tabs [data-tab="turnaj"]');
    if(turnajTabBtn) turnajTabBtn.click();
  });
}


// ---- Foto ----

// (Záznam změn je v js/audit.js)

// ==================== ÚČET / AUTENTIZACE ====================
function usernameDocRef(nick){ return doc(db, 'usernames', nick.trim().toLowerCase()); }
function setAuthMessage(msg){ document.getElementById('auth-message').textContent = msg || ''; }

const formAuth = document.getElementById('form-auth');
const authEmailField = document.getElementById('auth-email-field');
const authSubmitBtn = document.getElementById('auth-submit-btn');
let authStep = 1;
let pendingNickForRegistration = null;
let suppressAuthStateHandling = false;

formAuth.addEventListener('submit', async (e) => {
  e.preventDefault();
  const nick = document.getElementById('auth-nick').value.trim();
  const password = document.getElementById('auth-password').value;
  if(!nick || !password) return;
  authSubmitBtn.disabled = true;
  setAuthMessage('');
  try{
    if(authStep === 1){
      // krok 1 = pouze PŘIHLÁŠENÍ; registrace má vlastní tlačítko
      const unameSnap = await getDoc(usernameDocRef(nick));
      if(!unameSnap.exists()){
        setAuthMessage(`Přezdívka "${nick}" neexistuje. Zkontroluj ji, nebo klikni na Registrovat.`);
      }else{
        const { email } = unameSnap.data();
        await signInWithEmailAndPassword(auth, email, password);
      }
    }else{
      const email = document.getElementById('auth-email').value.trim();
      const phone = document.getElementById('auth-phone').value.trim();
      if(!email){ setAuthMessage('Doplň prosím e-mail.'); authSubmitBtn.disabled = false; return; }
      suppressAuthStateHandling = true;
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      try{ await sendVerifyMail(cred.user); }catch(e){ console.error('Ověřovací e-mail:', e); }
      await setDoc(usernameDocRef(pendingNickForRegistration), { uid: cred.user.uid, email });
      await setDoc(doc(db, 'users', cred.user.uid), { nick: pendingNickForRegistration, email, phone, createdAt: new Date().toISOString(), lastLogin: new Date().toISOString() });
      S.currentUser = cred.user;
      S.currentNick = pendingNickForRegistration;
      S.currentPhone = phone;
      S.currentEmoji = '';
      S.currentAvatar = '';
      S.currentIsAdmin = false;
      S.currentIsSuperAdmin = false;
      S.currentPermissions = {};
      suppressAuthStateHandling = false;
      updateAuthUI();
    }
  }catch(err){
    suppressAuthStateHandling = false;
    console.error(err);
    if(err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') setAuthMessage('Nesprávné heslo. Zkus to znovu.');
    else if(err.code === 'auth/email-already-in-use') setAuthMessage('Tenhle e-mail už je použitý u jiného účtu.');
    else if(err.code === 'auth/weak-password') setAuthMessage('Heslo musí mít aspoň 6 znaků.');
    else setAuthMessage('Něco se nepovedlo. Zkus to prosím znovu.');
  }finally{
    authSubmitBtn.disabled = false;
  }
});

document.getElementById('auth-register-btn').addEventListener('click', async () => {
  const nick = document.getElementById('auth-nick').value.trim();
  const password = document.getElementById('auth-password').value;
  if(!nick){ setAuthMessage('Vyplň přezdívku.'); return; }
  if(password.length < 6){ setAuthMessage('Heslo musí mít aspoň 6 znaků.'); return; }
  const btn = document.getElementById('auth-register-btn');
  btn.disabled = true;
  try{
    const unameSnap = await getDoc(usernameDocRef(nick));
    if(unameSnap.exists()){ setAuthMessage(`Přezdívka "${nick}" je už obsazená. Pokud je tvoje, klikni na Přihlásit.`); return; }
    authStep = 2;
    pendingNickForRegistration = nick;
    authEmailField.style.display = 'block';
    document.getElementById('auth-phone-field').style.display = 'block';
    document.getElementById('auth-nick').readOnly = true;
    authSubmitBtn.textContent = 'Dokončit registraci';
    btn.style.display = 'none';
    document.getElementById('auth-back-btn').style.display = '';
    setAuthMessage(`Přezdívka "${nick}" je volná — doplň e-mail a založíme ti účet.`);
  }catch(err){ console.error(err); setAuthMessage('Něco se nepovedlo. Zkus to prosím znovu.'); }
  finally{ btn.disabled = false; }
});
document.getElementById('auth-back-btn').addEventListener('click', () => {
  // zpět na přihlášení (přezdívka a heslo zůstanou vyplněné)
  authStep = 1;
  pendingNickForRegistration = null;
  authEmailField.style.display = 'none';
  document.getElementById('auth-phone-field').style.display = 'none';
  document.getElementById('auth-nick').readOnly = false;
  authSubmitBtn.textContent = 'Přihlásit';
  document.getElementById('auth-register-btn').style.display = '';
  document.getElementById('auth-back-btn').style.display = 'none';
  setAuthMessage('');
});

function resetAuthForm(){
  authStep = 1;
  document.getElementById('auth-register-btn').style.display = '';
  document.getElementById('auth-back-btn').style.display = 'none';
  pendingNickForRegistration = null;
  formAuth.reset();
  authEmailField.style.display = 'none';
  document.getElementById('auth-phone-field').style.display = 'none';
  document.getElementById('auth-nick').readOnly = false;
  authSubmitBtn.textContent = 'Přihlásit';
  setAuthMessage('');
}

document.getElementById('btn-google').addEventListener('click', async () => {
  try{ await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch(err){ console.error(err); setAuthMessage('Přihlášení přes Google se nepovedlo. Zkus to znovu.'); }
});

document.getElementById('btn-google-nick-submit').addEventListener('click', async () => {
  const nick = document.getElementById('google-nick-input').value.trim();
  const phone = document.getElementById('google-phone-input').value.trim();
  if(!nick || !S.currentUser) return;
  const btn = document.getElementById('btn-google-nick-submit');
  btn.disabled = true;
  try{
    const existing = await getDoc(usernameDocRef(nick));
    if(existing.exists()){ alert('Tahle přezdívka je už obsazená, zkus jinou.'); btn.disabled = false; return; }
    await setDoc(usernameDocRef(nick), { uid: S.currentUser.uid, email: S.currentUser.email });
    await setDoc(doc(db, 'users', S.currentUser.uid), { nick, email: S.currentUser.email, phone, createdAt: new Date().toISOString(), lastLogin: new Date().toISOString() });
    S.currentNick = nick;
    updateAuthUI();
  }catch(err){ console.error(err); alert('Uložení přezdívky se nepovedlo. Zkus to znovu.'); }
  finally{ btn.disabled = false; }
});

document.getElementById('btn-logout').addEventListener('click', async () => { closeContactForm(); closeEventForm(); await signOut(auth); });

function hasPasswordProvider(user){
  return user.providerData.some(p => p.providerId === 'password');
}

// ---- Přezdívka: změna ----

// ---------- Okno pro psaní e-mailů ----------
// E-maily se neposílají z prohlížeče: appka pro každého příjemce založí dokument v kolekci `mail`
// a rozšíření Firebase "Trigger Email from Firestore" ho odešle přes SMTP účet nastavený v konzoli Firebase
// (odesílatel = ta jedna reálná adresa, kterou tam nastavíš; heslo se zadává jen tam, nikdy do kódu).
async function getAllUsersForMail(){
  try{
    const snap = await getDocs(collection(db,'users'));
    return snap.docs.map(d => ({ uid: d.id, nick: d.data().nick || '', email: d.data().email || '' })).filter(u => u.email);
  }catch(err){ console.error(err); return []; }
}
function mailSig(t){ return t.replace(/\s+$/,'') + '\n\nZdar,\nFEEDEEK'; }
function mailLink(hash){ return `${location.origin}${location.pathname}#${hash}`; }
function mailTextToHtml(text){
  const safe = escapeHtml(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>');
  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;">${safe}</div>`;
}
// presets: [{label, subject, body, recipients:[{uid,nick,email}], hint}]
function openMailComposer(title, presets){
  const old = document.getElementById('mail-composer-overlay'); if(old) old.remove();
  const overlay = document.createElement('div');
  overlay.id = 'mail-composer-overlay';
  overlay.className = 'score-modal-backdrop';
  overlay.innerHTML = `
    <div class="mail-composer">
      <div class="section-title" style="font-size:16px;margin:0;">✉️ ${escapeHtml(title)}</div>
      <div class="mc-presets" id="mc-presets"></div>
      <div class="mc-hint" id="mc-hint"></div>
      <label class="mc-label">Předmět</label>
      <input type="text" id="mc-subject">
      <label class="mc-label">Zpráva <span class="mc-dim">({nick} se nahradí přezdívkou příjemce)</span></label>
      <textarea id="mc-body" rows="8"></textarea>
      <div class="mc-label">Komu <span class="mc-dim" id="mc-count"></span>
        <button type="button" class="btn-ghost btn-sm" id="mc-all">Všichni</button>
        <button type="button" class="btn-ghost btn-sm" id="mc-none">Nikdo</button>
      </div>
      <div class="mc-recipients" id="mc-recipients"></div>
      <label class="mc-label">Odpovědi chodí na <span class="mc-dim">(Reply-To; odesílatel je adresa nastavená v rozšíření)</span></label>
      <input type="email" id="mc-replyto" value="${escapeHtml(S.currentUser?.email || '')}">
      <div class="mc-status" id="mc-status"></div>
      <div class="mc-actions">
        <button type="button" class="btn-ghost" id="mc-cancel">Zavřít</button>
        <button type="button" class="btn-primary" id="mc-send">Odeslat</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const $ = id => overlay.querySelector('#'+id);
  let cur = 0;
  let checked = new Set();
  const renderRecipients = () => {
    const rec = presets[cur].recipients;
    $('mc-recipients').innerHTML = rec.length ? rec.map((r,i) => `
      <label class="mc-rec"><input type="checkbox" data-i="${i}" ${checked.has(r.uid) ? 'checked' : ''}> ${escapeHtml(r.nick || '?')} <span class="mc-dim">${escapeHtml(r.email)}</span></label>`).join('')
      : '<div class="empty">Nikdo takový není.</div>';
    $('mc-recipients').querySelectorAll('input').forEach(cb => cb.addEventListener('change', () => {
      const r = rec[+cb.dataset.i]; cb.checked ? checked.add(r.uid) : checked.delete(r.uid); updCount();
    }));
    updCount();
  };
  const updCount = () => { $('mc-count').textContent = `(vybráno ${checked.size} z ${presets[cur].recipients.length})`; };
  const loadPreset = (i) => {
    cur = i; const p = presets[i];
    $('mc-subject').value = p.subject; $('mc-body').value = p.noSig ? p.body : mailSig(p.body);
    $('mc-hint').textContent = p.hint || '';
    checked = new Set(p.recipients.map(r => r.uid));
    $('mc-presets').querySelectorAll('button').forEach((b,j) => b.classList.toggle('active', j === i));
    renderRecipients();
  };
  $('mc-presets').innerHTML = presets.length > 1 ? presets.map((p,i) => `<button type="button" class="mc-preset" data-i="${i}">${escapeHtml(p.label)}</button>`).join('') : '';
  $('mc-presets').querySelectorAll('button').forEach(b => b.addEventListener('click', () => loadPreset(+b.dataset.i)));
  $('mc-all').addEventListener('click', () => { presets[cur].recipients.forEach(r => checked.add(r.uid)); renderRecipients(); });
  $('mc-none').addEventListener('click', () => { checked.clear(); renderRecipients(); });
  $('mc-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('mousedown', e => { if(e.target === overlay) overlay.remove(); });
  $('mc-send').addEventListener('click', async () => {
    const subject = $('mc-subject').value.trim();
    const body = $('mc-body').value;
    const replyTo = $('mc-replyto').value.trim();
    const list = presets[cur].recipients.filter(r => checked.has(r.uid));
    if(!subject || !body.trim()){ $('mc-status').textContent = 'Vyplň předmět i zprávu.'; return; }
    if(list.length === 0){ $('mc-status').textContent = 'Vyber aspoň jednoho příjemce.'; return; }
    if(!confirm(`Odeslat e-mail ${list.length} lidem?`)) return;
    $('mc-send').disabled = true; $('mc-status').textContent = 'Zakládám zprávy…';
    const states = {};
    const report = () => {
      const v = Object.values(states);
      const ok = v.filter(x => x === 'SUCCESS').length, err = v.filter(x => x === 'ERROR').length;
      $('mc-status').textContent = `Odesláno: ${ok} z ${list.length}` + (err ? ` · chyba: ${err} (zkontroluj nastavení rozšíření)` : (ok < list.length ? ' …čekám na odeslání' : ' ✓'));
    };
    try{
      for(const r of list){
        const text = body.replace(/\{nick\}/g, r.nick || '');
        const docData = { to: [r.email], message: { subject, text, html: mailTextToHtml(text) }, createdBy: S.currentUser.uid, createdAt: new Date().toISOString() };
        if(replyTo) docData.replyTo = replyTo;
        const ref = await addDoc(collection(db,'mail'), docData);
        states[ref.id] = 'PENDING';
        onSnapshot(ref, snap => { const st = snap.data()?.delivery?.state; if(st){ states[ref.id] = st; report(); } });
      }
      logAction('mail', `odeslal e-mail „${subject}“ (${list.length} příjemců)`);
      report();
    }catch(err){
      console.error(err);
      $('mc-status').textContent = 'Zpráv se nepovedlo založit (chybí oprávnění / pravidla Firestore?).';
      $('mc-send').disabled = false;
    }
  });
  loadPreset(0);
}

function closeAllAccountPanels(){
  document.getElementById('form-change-nick').style.display = 'none';
  document.getElementById('form-change-email').style.display = 'none';
  document.getElementById('form-change-phone').style.display = 'none';
  document.getElementById('pw-reset-panel').style.display = 'none';
}

async function renderUsersList(){
  const box = document.getElementById('users-list');
  if(!box) return;
  box.innerHTML = '<div class="empty">Načítám...</div>';
  try{
    const snap = await getDocs(collection(db, 'users'));
    const users = snap.docs.map(d => ({ uid: d.id, ...d.data() })).sort((a,b) => (a.nick||'').localeCompare(b.nick||'', 'cs', { sensitivity:'base' }));
    if(users.length === 0){ box.innerHTML = '<div class="empty">Zatím žádní uživatelé.</div>'; return; }

    const showPerms = S.currentIsSuperAdmin;
    const allEmails = [...new Set(users.map(u => u.email).filter(Boolean))];
    box.innerHTML = `
      <div class="row" style="margin-bottom:16px; gap:10px;">
        <button type="button" class="btn-ghost btn-sm" id="btn-copy-emails">📋 Kopírovat e-maily (${allEmails.length})</button>
        <button type="button" class="mail-btn" id="btn-mailto-all">✉️ Napsat e-mail všem</button>
        <span class="small-msg" id="copy-emails-msg"></span>
      </div>
      <div style="overflow-x:auto;">
      <table style="width:100%; border-collapse:collapse; font-size:14px;">
        <thead><tr style="text-align:left; color:var(--text-muted); font-size:12px;">
          <th style="padding:8px 10px 8px 0;">Přezdívka</th>
          <th style="padding:8px 10px;">E-mail</th>
          <th style="padding:8px 10px;">Telefon</th>
          <th style="padding:8px 10px;">Registrace</th>
          <th style="padding:8px 10px;">Poslední přihlášení</th>
          <th></th><th></th>
          ${showPerms ? `<th style="padding:8px 10px; width:20px; border-left:1px solid var(--line);"></th><th style="padding:8px 10px;">Admin</th>${PERMISSION_AREAS.map(p=>`<th style="padding:8px 10px;" title="${escapeHtml(p.label)}">${escapeHtml(p.label.split(' ')[0])}</th>`).join('')}` : ''}
        </tr></thead>
        <tbody>
          ${users.map(u => `
            <tr style="border-top:1px solid var(--line);" data-user-row="${u.uid}">
              <td style="padding:8px 10px 8px 0;">${escapeHtml(u.nick||'')}${u.isSuperAdmin?' <span style="color:var(--gold); font-size:11px;">(hlavní admin)</span>':(u.isAdmin?' <span style="color:var(--gold); font-size:11px;">(admin)</span>':'')}</td>
              <td style="padding:8px 10px; color:var(--text-muted);">${escapeHtml(u.email||'')}<span data-verify-cell="${u.uid}"></span></td>
              <td style="padding:8px 10px;"><input type="tel" data-edit-phone="${u.uid}" value="${escapeHtml(u.phone||'')}" placeholder="—" style="width:120px; background:var(--bg-void); border:1px solid var(--line); color:var(--text); padding:4px 6px; font-size:13px;"></td>
              <td style="padding:8px 10px;"><input type="date" data-edit-created="${u.uid}" value="${u.createdAt ? u.createdAt.slice(0,10) : ''}" style="background:var(--bg-void); border:1px solid var(--line); color:var(--text); padding:4px 6px; font-size:13px;"></td>
              <td style="padding:8px 10px; color:var(--text-muted);">${u.lastLogin ? fmtDate(u.lastLogin.slice(0,10)) : '—'}</td>
              <td style="padding:8px 10px;"><button type="button" class="btn-ghost btn-sm" data-save-user="${u.uid}">Uložit</button></td>
              <td style="padding:8px 10px;">${(u.isSuperAdmin || (u.isAdmin && !S.currentIsSuperAdmin)) ? '' : `<button type="button" class="btn-ghost btn-sm" data-delete-user="${u.uid}" data-delete-nick="${escapeHtml(u.nick||'')}" style="color:var(--crimson); border-color:var(--crimson);">Smazat</button>`}</td>
              ${showPerms ? (u.isSuperAdmin ? `<td style="border-left:1px solid var(--line);"></td><td colspan="${1+PERMISSION_AREAS.length}" style="padding:8px 10px; color:var(--text-muted); font-style:italic;">má vše automaticky</td>` : `
              <td style="border-left:1px solid var(--line);"></td>
              <td style="padding:8px 10px; text-align:center; background:rgba(201,162,75,0.08);"><input type="checkbox" data-perm-admin="${u.uid}" ${u.isAdmin?'checked':''} style="width:18px; height:18px; accent-color:var(--gold);"></td>
              ${PERMISSION_AREAS.map(p=>`<td style="padding:8px 10px; text-align:center;" data-perm-area-cell="${u.uid}"><input type="checkbox" data-perm-area="${u.uid}" data-area-key="${p.key}" ${(u.permissions&&u.permissions[p.key])?'checked':''} ${u.isAdmin?'':'disabled'}></td>`).join('')}
              `) : ''}
            </tr>
          `).join('')}
        </tbody>
      </table>
      </div>

      <div class="section-title" style="font-size:16px; margin-top:36px;">Přezdívky — duplicity a osamocené záznamy</div>
      <div id="usernames-list" style="margin-top:12px;"></div>
    `;
    if(showPerms){
      box.querySelectorAll('[data-perm-admin]').forEach(cb => {
        cb.addEventListener('change', () => {
          box.querySelectorAll(`[data-perm-area="${cb.dataset.permAdmin}"]`).forEach(areaCb => {
            areaCb.disabled = !cb.checked;
            if(!cb.checked) areaCb.checked = false;
          });
        });
      });
    }
    box.querySelectorAll('[data-save-user]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = btn.dataset.saveUser;
        const phone = box.querySelector(`[data-edit-phone="${uid}"]`).value.trim();
        const createdDate = box.querySelector(`[data-edit-created="${uid}"]`).value;
        const payload = { phone };
        if(createdDate) payload.createdAt = createdDate + 'T12:00:00.000Z';
        if(showPerms){
          const adminCb = box.querySelector(`[data-perm-admin="${uid}"]`);
          if(adminCb){
            payload.isAdmin = adminCb.checked;
            const permissions = {};
            box.querySelectorAll(`[data-perm-area="${uid}"]`).forEach(cb => { permissions[cb.dataset.areaKey] = cb.checked; });
            payload.permissions = permissions;
          }
        }
        try{
          await updateDoc(doc(db,'users',uid), payload);
          { const un = (users.find(u => u.uid === uid) || {}).nick || uid;
            logAction('uzivatele', `upravil uživatele „${un}“` + (payload.permissions ? ` (admin: ${payload.isAdmin ? 'ano' : 'ne'}, oprávnění: ${Object.keys(payload.permissions).filter(k => payload.permissions[k]).join(', ') || 'žádná'})` : '')); }
          btn.textContent = 'Uloženo!';
          setTimeout(() => { btn.textContent = 'Uložit'; }, 1200);
        }catch(err){ alert('Uložení se nepovedlo.'); console.error(err); }
      });
    });
    // e-maily, které nejsou ověřené, jdou ověřit ručně
    httpsCallable(functionsApi, 'adminListVerification')().then(res => {
      const ver = (res.data && res.data.verified) || {};
      box.querySelectorAll('[data-verify-cell]').forEach(cell => {
        const uid = cell.dataset.verifyCell;
        if(ver[uid] !== false) return;
        cell.innerHTML = ` <span style="color:#e0a030; font-size:11px;">⚠ neověřen</span> <button type="button" class="btn-ghost btn-sm" data-verify-user="${uid}" style="padding:2px 8px; font-size:11px;">Ověřit</button>`;
        cell.querySelector('[data-verify-user]').addEventListener('click', async (e) => {
          const b = e.currentTarget; b.disabled = true;
          try{
            await httpsCallable(functionsApi, 'adminVerifyUser')({ uid });
            const un = (users.find(x => x.uid === uid) || {}).nick || uid;
            logAction('uzivatele', `ručně ověřil e-mail uživatele „${un}“`);
            cell.innerHTML = ' <span style="color:var(--gold); font-size:11px;">✓ ověřeno</span>';
          }catch(err){ b.disabled = false; alert('Ověření se nepovedlo.'); console.error(err); }
        });
      });
    }).catch(err => console.warn('Seznam ověření nelze načíst (funkce nenasazená?):', err));
    box.querySelectorAll('[data-delete-user]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = btn.dataset.deleteUser;
        const nick = btn.dataset.deleteNick;
        if(!confirm(`Opravdu úplně odstranit uživatele "${nick}"? Smaže se jeho profil i přezdívka. (Přihlašovací údaj ve Firebase zůstane technicky existovat, ale bez profilu se nepřihlásí.) Tohle nejde vrátit zpět.`)) return;
        try{
          await deleteDoc(doc(db,'users',uid));
          if(nick) await deleteDoc(usernameDocRef(nick));
          logAction('uzivatele', `odstranil uživatele „${nick}“`);
          renderUsersList();
        }catch(err){ alert('Smazání se nepovedlo.'); console.error(err); }
      });
    });

    document.getElementById('btn-copy-emails').addEventListener('click', async () => {
      const msg = document.getElementById('copy-emails-msg');
      try{ await navigator.clipboard.writeText(allEmails.join(', ')); msg.textContent = 'Zkopírováno!'; }
      catch(err){ msg.textContent = 'Kopírování se nepovedlo — zkopíruj ručně: ' + allEmails.join(', '); }
    });
    document.getElementById('btn-mailto-all').addEventListener('click', () => {
      const list = users.filter(u => u.email).map(u => ({ uid: u.uid, nick: u.nick || '', email: u.email }));
      openMailComposer('E-mail uživatelům', [{ label:'Zpráva', subject:'', body:'Zdar, tady FEEDEEK LAN!\n\n', recipients: list, hint:'Libovolná zpráva.' }]);
    });

    const unameBox = document.getElementById('usernames-list');
    try{
      const unameSnap = await getDocs(collection(db,'usernames'));
      const uidSet = new Set(users.map(u=>u.uid));
      const unames = unameSnap.docs.map(d => ({ nickKey:d.id, ...d.data() }));
      const uidCounts = {};
      unames.forEach(u => { uidCounts[u.uid] = (uidCounts[u.uid]||0) + 1; });
      const flagged = unames.filter(u => !uidSet.has(u.uid) || uidCounts[u.uid] > 1);
      if(flagged.length === 0){
        unameBox.innerHTML = '<div class="empty">Žádné duplicity ani osamocené záznamy — vše v pořádku.</div>';
      }else{
        unameBox.innerHTML = flagged.map(u => {
          const orphan = !uidSet.has(u.uid);
          const dup = !orphan && uidCounts[u.uid] > 1;
          const reason = orphan ? 'bez propojeného účtu' : `duplicita (${uidCounts[u.uid]}× stejný účet)`;
          return `<div class="row" style="max-width:600px; padding:6px 0; border-top:1px solid var(--line); align-items:center;">
            <span style="flex:1; font-size:13px; color:var(--crimson);">${escapeHtml(u.nickKey)} — ${reason}</span>
            <button type="button" class="btn-ghost btn-sm" data-delete-uname="${u.nickKey}" style="color:var(--crimson); border-color:var(--crimson);">Smazat</button>
          </div>`;
        }).join('');
        unameBox.querySelectorAll('[data-delete-uname]').forEach(btn => {
          btn.addEventListener('click', async () => {
            if(!confirm(`Smazat přezdívku "${btn.dataset.deleteUname}"?`)) return;
            try{ await deleteDoc(doc(db,'usernames',btn.dataset.deleteUname)); renderUsersList(); }
            catch(err){ alert('Smazání se nepovedlo.'); console.error(err); }
          });
        });
      }
    }catch(err){ console.error(err); unameBox.innerHTML = '<div class="empty">Nepovedlo se načíst.</div>'; }
  }catch(err){ console.error(err); box.innerHTML = '<div class="empty">Nepovedlo se načíst uživatele.</div>'; }
}

// Upozornění pro uživatele s nepotvrzeným e-mailem (přihlášení heslem): bez potvrzení nejde komentovat, nahrávat ani se přihlásit na akci
function updateVerifyBanner(){
  let bar = document.getElementById('verify-banner');
  const need = S.currentUser && S.currentNick && !S.currentUser.emailVerified && hasPasswordProvider(S.currentUser);
  if(!need){ if(bar) bar.remove(); return; }
  if(!bar){
    bar = document.createElement('div');
    bar.id = 'verify-banner';
    bar.style.cssText = 'position:fixed; left:0; right:0; bottom:0; z-index:9999; background:#3a2c0b; color:#f3e3b0; border-top:2px solid var(--gold); padding:12px 16px; font-size:14px; display:flex; gap:10px; align-items:center; flex-wrap:wrap; justify-content:center;';
    document.body.appendChild(bar);
  }
  bar.innerHTML = `<span>📧 Potvrď svůj e-mail (<b>${escapeHtml(S.currentUser.email || '')}</b>) odkazem, který jsme ti poslali. Do té doby nejde komentovat, nahrávat fotky ani se přihlásit na akci.</span>
    <button type="button" class="btn-sm" id="vb-resend">Poslat odkaz znovu</button>
    <button type="button" class="btn-sm btn-ghost" id="vb-check">Už jsem potvrdil</button>
    <span id="vb-msg"></span>`;
  bar.querySelector('#vb-resend').addEventListener('click', async () => {
    try{ await sendVerifyMail(S.currentUser); bar.querySelector('#vb-msg').textContent = 'Odesláno, zkontroluj poštu (i spam a hromadné). Když nic nepřijde, napiš adminovi, ověří tě ručně.'; }
    catch(e){ bar.querySelector('#vb-msg').textContent = (e && e.code === 'functions/resource-exhausted') ? 'Počkej minutu a zkus to znovu.' : 'Teď to nejde, zkus to za chvíli.'; }
  });
  bar.querySelector('#vb-check').addEventListener('click', async () => {
    try{
      await S.currentUser.reload();
      await S.currentUser.getIdToken(true);
      if(S.currentUser.emailVerified){ updateVerifyBanner(); }
      else bar.querySelector('#vb-msg').textContent = 'Zatím nepotvrzeno.';
    }catch(e){ bar.querySelector('#vb-msg').textContent = 'Nepovedlo se ověřit.'; }
  });
}

function updateAuthUI(){
  updateVerifyBanner();
  const loggedOutBox = document.getElementById('auth-logged-out');
  const loggedInBox = document.getElementById('auth-logged-in');
  const googleNickPrompt = document.getElementById('auth-google-nick-prompt');
  const navLabel = document.getElementById('nav-ucet-label');

  if(S.currentUser && S.currentNick){
    loggedOutBox.style.display = 'none';
    loggedInBox.style.display = 'block';
    googleNickPrompt.style.display = 'none';
    closeLoginModal();
    document.getElementById('account-nick-display').textContent = S.currentNick + (S.currentIsSuperAdmin ? ' (hlavní admin)' : (S.currentIsAdmin ? ' (admin)' : ''));
    document.getElementById('account-email-display').textContent = S.currentUser.email || '';
    document.getElementById('account-phone-display').textContent = S.currentPhone || '—';
    document.getElementById('account-avatar-big').style.display = S.currentAvatar ? 'block' : 'none';
    document.getElementById('account-avatar-big').src = S.currentAvatar || '';
    document.getElementById('account-avatar-placeholder').style.display = S.currentAvatar ? 'none' : 'flex';
    document.getElementById('btn-remove-avatar').style.display = S.currentAvatar ? 'inline-flex' : 'none';
    document.getElementById('reauth-password-field').style.display = hasPasswordProvider(S.currentUser) ? 'block' : 'none';
    document.getElementById('password-row').style.display = hasPasswordProvider(S.currentUser) ? 'flex' : 'none';
    navLabel.textContent = 'Účet';
  }else if(S.currentUser && !S.currentNick){
    loggedOutBox.style.display = 'block';
    loggedInBox.style.display = 'none';
    formAuth.style.display = 'none';
    document.querySelector('#auth-logged-out > div').style.display = 'none';
    document.getElementById('btn-google').style.display = 'none';
    googleNickPrompt.style.display = 'block';
    navLabel.textContent = 'Účet';
  }else{
    loggedOutBox.style.display = 'block';
    loggedInBox.style.display = 'none';
    formAuth.style.display = 'flex';
    document.querySelector('#auth-logged-out > div').style.display = 'flex';
    document.getElementById('btn-google').style.display = 'block';
    googleNickPrompt.style.display = 'none';
    resetAuthForm();
    navLabel.textContent = 'Účet';
  }
  renderEvents();
  renderContacts();
  if(S.currentDetailEventId){
    renderStatsAndRsvp(); renderAttendees();
    // po přihlášení/odhlášení musí odpovídat právům i zbytek detailu akce (panel hlasování, tlačítka správce, záložky)
    const dEv = S.events.find(x => x.id === S.currentDetailEventId);
    if(dEv){ renderEntryFeeBlock(dEv); renderDateVoteBlock(dEv); renderActiveTab(dEv); }
  }

  document.getElementById('nav-item-uzivatele').style.display = hasPerm('uzivatele') ? 'flex' : 'none';
  document.getElementById('nav-sep-admin').style.display = (hasPerm('uzivatele') || hasPerm('zaznam')) ? 'block' : 'none';
  document.getElementById('nav-sep-zaznam').style.display = (hasPerm('uzivatele') && hasPerm('zaznam')) ? 'block' : 'none';
  if(hasPerm('uzivatele')) renderUsersList();
  if(!hasPerm('uzivatele') && document.getElementById('view-uzivatele').classList.contains('active')){
    showView('akce');
  }
  document.getElementById('nav-item-zaznam').style.display = hasPerm('zaznam') ? 'flex' : 'none';
  if(hasPerm('zaznam')) startAuditListener(); else stopAuditListener();
  if(!hasPerm('zaznam') && document.getElementById('view-zaznam').classList.contains('active')) showView('akce');

  const accWidget = document.getElementById('topbar-account-widget');
  if(S.currentUser && S.currentNick){
    accWidget.innerHTML = `<span class="acc-nick">${S.currentAvatar ? avatarTag(S.currentAvatar, 24) : ''}${escapeHtml(S.currentNick)}</span><button type="button" class="btn-ghost btn-sm" id="topbar-logout-btn" style="color:var(--crimson); border-color:var(--crimson);">Odhlásit</button>`;
    document.getElementById('topbar-logout-btn').addEventListener('click', async () => { closeContactForm(); closeEventForm(); await signOut(auth); });
  }else{
    accWidget.innerHTML = `<button type="button" class="btn-sm" id="topbar-login-btn">Přihlásit / Registrovat</button>`;
    document.getElementById('topbar-login-btn').addEventListener('click', () => showView('ucet'));
  }
}

let authStateGeneration = 0;

onAuthStateChanged(auth, async (user) => {
  if(suppressAuthStateHandling) return;
  const myGen = ++authStateGeneration;
  S.currentUser = user;
  S.currentNick = null;
  S.currentIsAdmin = false;
  S.currentIsSuperAdmin = false;
  S.currentPermissions = {};
  S.currentPhone = '';
  S.currentEmoji = '';
  S.currentAvatar = '';
  if(user){
    try{
      const userDoc = await getDocFromServer(doc(db, 'users', user.uid));
      if(myGen !== authStateGeneration) return; // mezitím se spustila novější kontrola, tuhle zahodíme
      if(userDoc.exists()){
        S.currentNick = userDoc.data().nick;
        S.currentIsSuperAdmin = userDoc.data().isSuperAdmin === true || userDoc.data().isSuperAdmin === 'true';
        S.currentIsAdmin = S.currentIsSuperAdmin || userDoc.data().isAdmin === true || userDoc.data().isAdmin === 'true';
        S.currentPermissions = userDoc.data().permissions || {};
        S.currentPhone = userDoc.data().phone || '';
        S.currentEmoji = userDoc.data().emoji || '';
        S.currentAvatar = userDoc.data().avatar || '';
        if(userDoc.data().email !== user.email){
          try{
            await updateDoc(doc(db,'users',user.uid), { email: user.email });
            await updateDoc(usernameDocRef(S.currentNick), { email: user.email });
          }catch(e){ /* tichý fail, není kritické */ }
          if(myGen !== authStateGeneration) return;
        }
        // aktualizace posledního přihlášení běží na pozadí, nečeká se na ni (nesmí blokovat vykreslení)
        updateDoc(doc(db,'users',user.uid), { lastLogin: new Date().toISOString() }).catch(()=>{});
      }
    }catch(err){ console.error(err); }
    if(myGen !== authStateGeneration) return;
    updateAuthUI();
    if(S.currentNick && S.pendingEventId){
      const evId = S.pendingEventId;
      S.pendingEventId = null;
      setRoute('#event/' + evId);
    }
  }else{
    updateAuthUI();
    // skutečné odhlášení (ne první načtení stránky): zpět na úvodní stranu a překreslit, ať nezůstane
    // nic, co vidí jen přihlášený/admin (např. panel hlasování o termínu)
    if(initialAuthSettled){
      stopAuditListener();
      try{ history.replaceState(null, '', location.pathname + location.search); }catch(e){}
      applyRoute();
    }
  }
  // Přihlášení se ověřuje na pozadí a stránka se mohla vykreslit dřív, než bylo hotovo
  // (např. tlačítka podle práv). Jakmile ověření poprvé doběhne, aktuální pohled se
  // znovu vykreslí, ať odpovídá skutečným právům. Dál už se to nedělá, aby to při
  // pozdějším přihlášení/odhlášení neresetovalo rozpracovaný pohled (otevřenou záložku apod.).
  if(!initialAuthSettled){
    initialAuthSettled = true;
    applyRoute();
  }
});

// inicializace pomocných bloků formuláře (prázdné hry/jídlo)
renderFormGames();
renderFormFood();
tryInitialRoute();

let resizeRedrawTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeRedrawTimer);
  resizeRedrawTimer = setTimeout(() => {
    document.querySelectorAll('.bracket-wrap:not(.bracket-compact)').forEach(w => { w.style.transform = 'none'; layoutBracketRounds(w); drawBracketConnectors(w); fitBracketToScreen(w); });
  }, 150);
});


