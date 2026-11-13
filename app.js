import { collection, onSnapshot, query, orderBy, doc, getDocFromServer, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged, signOut, sendEmailVerification } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

import { db, auth, storage, functionsApi } from "./js/firebase.js";
import { escapeHtml, todayIso } from "./js/util.js";

import { S, hasPerm } from "./js/state.js";
import { appApi } from "./js/hooks.js";
import { startAuditListener, stopAuditListener } from "./js/audit.js";


import { fmtDateRange, avatarTag } from "./js/ui.js";
import { renderTabFoto } from "./js/photos.js";
import { renderScheduleComments } from "./js/schedule.js";
import "./js/account.js";
import { renderContacts, closeContactForm } from "./js/contacts.js";

import { renderTabPrehled } from "./js/tab-prehled.js";
import { renderTabJidlo } from "./js/tab-jidlo.js";
import { renderStatsAndRsvp, renderAttendees } from "./js/rsvp.js";

import { renderEventDetailStatic, renderActiveTab, renderEntryFeeBlock, renderDateVoteBlock, isPastDeadline } from "./js/event-detail.js";
import { normalizeGame, renderFormGames, renderFormFood, closeEventForm, renderEvents, startEditEvent } from "./js/event-form.js";
import { teamName, computeFfaStandings } from "./js/turnaj-common.js";
import { tbEffectiveStats } from "./js/tb-core.js";
import { tbStopLive, closeTbDevGraphModal, tbCloseDrinkModal, computeSwissTournament, fitBracketToScreen, layoutBracketRounds, drawBracketConnectors } from "./js/tb-live.js";
import { renderTurnajPage } from "./js/turnaj-page.js";
import { renderUsersList } from "./js/users-list.js";
import { getAllUsersForMail, mailLink, openMailComposer } from "./js/mail.js";
import { usernameDocRef, formAuth, resetAuthForm, hasPasswordProvider } from "./js/auth-form.js";

// funkce, které zatím zůstávají v app.js a potřebují je moduly (viz js/hooks.js)
Object.assign(appApi, { showView, usernameDocRef, updateAuthUI, hasPasswordProvider, closeAllAccountPanels, normalizeGame, renderTournamentSignupCta, isPastDeadline, applyRoute, setRoute, teamName, computeFfaStandings, computeSwissTournament, getAllUsersForMail, mailLink, openMailComposer, startEditEvent, renderTurnajPage, tbEffectiveStats, tryInitialRoute, sendVerifyMail });

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
  metaBox.innerHTML = `${fmtDateRange(next)} · <span class="place">${next.place ? escapeHtml(next.place) : 'místo upřesníme'}</span>`;
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
// ---- Přezdívka: změna ----

function closeAllAccountPanels(){
  document.getElementById('form-change-nick').style.display = 'none';
  document.getElementById('form-change-email').style.display = 'none';
  document.getElementById('form-change-phone').style.display = 'none';
  document.getElementById('pw-reset-panel').style.display = 'none';
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
  if(S.suppressAuthStateHandling) return;
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
    if(S.initialAuthSettled){
      stopAuditListener();
      try{ history.replaceState(null, '', location.pathname + location.search); }catch(e){}
      applyRoute();
    }
  }
  // Přihlášení se ověřuje na pozadí a stránka se mohla vykreslit dřív, než bylo hotovo
  // (např. tlačítka podle práv). Jakmile ověření poprvé doběhne, aktuální pohled se
  // znovu vykreslí, ať odpovídá skutečným právům. Dál už se to nedělá, aby to při
  // pozdějším přihlášení/odhlášení neresetovalo rozpracovaný pohled (otevřenou záložku apod.).
  if(!S.initialAuthSettled){
    S.initialAuthSettled = true;
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


