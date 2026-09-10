import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, addDoc, onSnapshot, query, orderBy, doc, getDoc, setDoc,
  updateDoc, deleteDoc, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  GoogleAuthProvider, signInWithPopup, signOut, sendPasswordResetEmail,
  EmailAuthProvider, reauthenticateWithCredential, reauthenticateWithPopup, verifyBeforeUpdateEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyA3iXxS2Ffr1-DDyGHVFW4O2a5dKkOX6Q0",
  authDomain: "lan-feedek.firebaseapp.com",
  projectId: "lan-feedek",
  storageBucket: "lan-feedek.firebasestorage.app",
  messagingSenderId: "632018940301",
  appId: "1:632018940301:web:9f4869524c22c4ca460dc4"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const MEAL_SLOTS = [
  { key:'fri-dinner',    label:'Pátek — Večeře' },
  { key:'sat-breakfast', label:'Sobota — Snídaně' },
  { key:'sat-lunch',     label:'Sobota — Oběd' },
  { key:'sat-dinner',    label:'Sobota — Večeře' },
  { key:'sun-breakfast', label:'Neděle — Snídaně' }
];
function emptyFoodSchedule(){
  const o = {};
  MEAL_SLOTS.forEach(s => o[s.key] = []);
  return o;
}

let events = [];
let regCounts = {};
let currentUser = null;
let currentNick = null;
let currentIsAdmin = false;
let pendingEventId = null;

let currentEventGames = [];
let currentEventFood = emptyFoodSchedule();

function fmtDate(iso){
  if(!iso) return '';
  const d = new Date(iso+'T00:00:00');
  return d.toLocaleDateString('cs-CZ', { day:'numeric', month:'long', year:'numeric' });
}
function fmtDateShort(iso){
  if(!iso) return '';
  const d = new Date(iso+'T00:00:00');
  return d.toLocaleDateString('cs-CZ', { day:'numeric', month:'numeric' });
}
function fmtDateRange(ev){
  if(!ev.dateStart) return '';
  if(ev.dateEnd && ev.dateEnd !== ev.dateStart) return `${fmtDateShort(ev.dateStart)} – ${fmtDate(ev.dateEnd)}`;
  return fmtDate(ev.dateStart);
}
function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
function todayIso(){ return new Date().toISOString().slice(0,10); }

// ---- Živé napojení na kolekci akcí ----
const eventsQuery = query(collection(db, 'events'), orderBy('dateStart'));
onSnapshot(eventsQuery, (snapshot) => {
  events = snapshot.docs.map(d => {
    const data = d.data();
    const dateStart = data.dateStart || data.date || '';
    const dateEnd = data.dateEnd || dateStart;
    return { id: d.id, ...data, dateStart, dateEnd };
  });
  events.forEach(ev => {
    if(!(ev.id in regCounts)){
      regCounts[ev.id] = { going:0, maybe:0 };
      onSnapshot(collection(db, 'events', ev.id, 'registrations'), (rsnap) => {
        let going=0, maybe=0;
        rsnap.forEach(r => { const st=r.data().status; if(st==='maybe') maybe++; else going++; });
        regCounts[ev.id] = { going, maybe };
        renderHome(); renderEvents();
        if(currentDetailEventId === ev.id) renderStatsAndRsvp();
      });
    }
  });
  renderHome();
  renderEvents();
  if(currentDetailEventId){
    const ev = events.find(x=>x.id===currentDetailEventId);
    if(ev) renderEventDetailStatic(ev);
  }
}, (err) => console.error('Chyba připojení k Firestore:', err));

// ---- Navigation ----
const navItems = document.querySelectorAll('.nav-item');
const views = document.querySelectorAll('.view');
function showView(name){
  navItems.forEach(n => n.classList.toggle('active', n.dataset.view === name));
  views.forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
}
navItems.forEach(n => n.addEventListener('click', () => {
  // Pokud opouštíme Akce s otevřeným, neuloženým formulářem, zavřít ho.
  if(n.dataset.view !== 'akce') closeEventForm();
  showView(n.dataset.view);
}));
document.getElementById('btn-back-to-akce').addEventListener('click', () => { showView('akce'); });

// ---- Home ----
function renderHome(){
  const card = document.getElementById('next-event-card');
  const upcoming = events.filter(e => e.dateEnd >= todayIso());
  if(upcoming.length === 0){
    card.querySelector('.val').textContent = '—';
    card.querySelector('.sub').textContent = 'Aktuálně se nic nepeče. Sleduj to tu, nebo hoď echo na Discord, ať se rozhoupeme.';
    card.onclick = null;
    return;
  }
  const next = upcoming[0];
  card.querySelector('.val').textContent = next.name;
  card.querySelector('.sub').textContent = fmtDateRange(next) + ' · ' + next.place;
  card.onclick = () => openEventDetail(next.id);
}

// ==================== FORMULÁŘ AKCE: hry (tagy) ====================
function renderFormGames(){
  const list = document.getElementById('ev-games-list');
  list.innerHTML = '';
  currentEventGames.forEach((game, idx) => {
    const li = document.createElement('li');
    li.className = 'tag-chip';
    li.innerHTML = `<span>${escapeHtml(game)}</span><span class="x" data-remove-game="${idx}">×</span>`;
    list.appendChild(li);
  });
  list.querySelectorAll('[data-remove-game]').forEach(el => {
    el.addEventListener('click', () => {
      currentEventGames.splice(parseInt(el.dataset.removeGame,10), 1);
      renderFormGames();
    });
  });
}
document.getElementById('btn-add-game').addEventListener('click', () => {
  const input = document.getElementById('input-add-game');
  const val = input.value.trim();
  if(!val) return;
  currentEventGames.push(val);
  input.value = '';
  renderFormGames();
});

// ==================== FORMULÁŘ AKCE: jídlo po blocích ====================
function renderFormFood(){
  const box = document.getElementById('food-schedule-preview');
  box.innerHTML = MEAL_SLOTS.map(slot => {
    const items = currentEventFood[slot.key] || [];
    const chips = items.length
      ? items.map((food, idx) => `<span class="tag-chip">${escapeHtml(food)}<span class="x" data-remove-food="${slot.key}|${idx}">×</span></span>`).join(' ')
      : '<span style="color:var(--text-muted);">Žádné položky</span>';
    return `<div class="meal-slot-block"><b>${slot.label}:</b><br><div class="chip-row" style="margin-top:6px;">${chips}</div></div>`;
  }).join('');
  box.querySelectorAll('[data-remove-food]').forEach(el => {
    el.addEventListener('click', () => {
      const [key, idxStr] = el.dataset.removeFood.split('|');
      currentEventFood[key].splice(parseInt(idxStr,10), 1);
      renderFormFood();
    });
  });
}
document.getElementById('btn-add-food').addEventListener('click', () => {
  const select = document.getElementById('select-food-meal');
  const input = document.getElementById('input-add-food');
  const val = input.value.trim();
  if(!val) return;
  if(!currentEventFood[select.value]) currentEventFood[select.value] = [];
  currentEventFood[select.value].push(val);
  input.value = '';
  renderFormFood();
});

// ---- Akce: založení / editace / mazání ----
const formEvent = document.getElementById('form-event');
const btnNewEvent = document.getElementById('btn-new-event');
const akceListWrap = document.getElementById('akce-list-wrap');
let editingEventId = null;

function resetEventFormHelpers(){
  currentEventGames = [];
  currentEventFood = emptyFoodSchedule();
  renderFormGames();
  renderFormFood();
}

function openEventForm(){
  formEvent.style.display = 'flex';
  akceListWrap.style.display = 'none';
}
function closeEventForm(){
  formEvent.style.display = 'none';
  akceListWrap.style.display = 'block';
  formEvent.reset();
  resetEventFormHelpers();
  editingEventId = null;
}

btnNewEvent.addEventListener('click', () => {
  if(formEvent.style.display === 'none' || !formEvent.style.display){
    editingEventId = null;
    formEvent.reset();
    resetEventFormHelpers();
    document.getElementById('btn-save-event').textContent = 'Uložit akci';
    openEventForm();
  }else{
    closeEventForm();
  }
});
document.getElementById('btn-cancel-event').addEventListener('click', closeEventForm);

formEvent.addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = document.getElementById('btn-save-event');
  submitBtn.disabled = true;
  const payload = {
    name: document.getElementById('ev-name').value.trim(),
    dateStart: document.getElementById('ev-date-start').value,
    dateEnd: document.getElementById('ev-date-end').value,
    place: document.getElementById('ev-place').value.trim(),
    cap: parseInt(document.getElementById('ev-cap').value, 10) || 1,
    desc: document.getElementById('ev-desc').value.trim(),
    imageUrl: document.getElementById('ev-image').value.trim(),
    games: [...currentEventGames],
    foodPlan: document.getElementById('ev-foodplan').value.trim(),
    foodSchedule: JSON.parse(JSON.stringify(currentEventFood)),
    changeDeadline: document.getElementById('ev-deadline').value || ''
  };
  if(payload.dateEnd < payload.dateStart){
    alert('Datum "do" nemůže být dřív než datum "od".');
    submitBtn.disabled = false;
    return;
  }
  try{
    if(editingEventId){
      await updateDoc(doc(db, 'events', editingEventId), payload);
    }else{
      await addDoc(collection(db, 'events'), payload);
    }
    closeEventForm();
  }catch(err){
    alert('Akci se nepodařilo uložit. Zkus to prosím znovu.');
    console.error(err);
  }finally{
    submitBtn.disabled = false;
  }
});

function startEditEvent(ev){
  editingEventId = ev.id;
  document.getElementById('ev-name').value = ev.name || '';
  document.getElementById('ev-date-start').value = ev.dateStart || '';
  document.getElementById('ev-date-end').value = ev.dateEnd || ev.dateStart || '';
  document.getElementById('ev-place').value = ev.place || '';
  document.getElementById('ev-cap').value = ev.cap || 1;
  document.getElementById('ev-desc').value = ev.desc || '';
  document.getElementById('ev-image').value = ev.imageUrl || '';
  document.getElementById('ev-foodplan').value = ev.foodPlan || '';
  document.getElementById('ev-deadline').value = ev.changeDeadline || '';

  currentEventGames = Array.isArray(ev.games) ? [...ev.games] : [];
  currentEventFood = emptyFoodSchedule();
  if(ev.foodSchedule){
    MEAL_SLOTS.forEach(slot => {
      currentEventFood[slot.key] = Array.isArray(ev.foodSchedule[slot.key]) ? [...ev.foodSchedule[slot.key]] : [];
    });
  }
  renderFormGames();
  renderFormFood();

  document.getElementById('btn-save-event').textContent = 'Uložit změny';
  showView('akce');
  openEventForm();
  formEvent.scrollIntoView({ behavior:'smooth', block:'start' });
}

async function deleteEvent(eventId, eventName){
  if(!confirm(`Opravdu smazat akci "${eventName}"? Tohle nejde vrátit zpět.`)) return;
  try{ await deleteDoc(doc(db, 'events', eventId)); }
  catch(err){ alert('Smazání se nepovedlo.'); console.error(err); }
}

function renderEvents(){
  btnNewEvent.style.display = currentIsAdmin ? 'inline-flex' : 'none';
  const featuredWrap = document.getElementById('featured-event-wrap');
  const grid = document.getElementById('events-grid');
  featuredWrap.innerHTML = '';
  grid.innerHTML = '';

  if(events.length === 0){
    grid.innerHTML = '<div class="empty">Zatím žádné akce.</div>';
    return;
  }

  const upcoming = events.filter(e => e.dateEnd >= todayIso());
  const featured = upcoming[0] || events[0];
  const rest = events.filter(e => e.id !== featured.id);

  const taken = (regCounts[featured.id]?.going) || 0;
  const full = taken >= featured.cap;
  const fc = document.createElement('div');
  fc.className = 'featured-card';
  fc.innerHTML = `
    <span class="tag">${full ? 'Obsazeno' : 'Nejbližší akce'}</span>
    <h3>${escapeHtml(featured.name)}</h3>
    <div class="meta">${fmtDateRange(featured)} · ${escapeHtml(featured.place)} · ${taken}/${featured.cap} míst</div>
    <p class="desc">${escapeHtml(featured.desc || '')}</p>
    ${currentIsAdmin ? `
    <div class="row" style="margin-top:14px; max-width:280px;">
      <button type="button" class="btn-ghost btn-sm" data-edit-featured style="flex:1;">Upravit</button>
      <button type="button" class="btn-ghost btn-sm" data-delete-featured style="flex:1; color:var(--crimson); border-color:var(--crimson);">Smazat</button>
    </div>` : ''}
  `;
  fc.addEventListener('click', (e) => {
    if(e.target.closest('[data-edit-featured]') || e.target.closest('[data-delete-featured]')) return;
    openEventDetail(featured.id);
  });
  const featEditBtn = fc.querySelector('[data-edit-featured]');
  if(featEditBtn) featEditBtn.addEventListener('click', (e) => { e.stopPropagation(); startEditEvent(featured); });
  const featDelBtn = fc.querySelector('[data-delete-featured]');
  if(featDelBtn) featDelBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteEvent(featured.id, featured.name); });
  featuredWrap.appendChild(fc);

  if(rest.length === 0) return;
  rest.forEach(ev => {
    const t = (regCounts[ev.id]?.going) || 0;
    const f = t >= ev.cap;
    const card = document.createElement('div');
    card.className = 'event-card';
    card.innerHTML = `
      <span class="tag ${f ? 'full' : ''}">${f ? 'Obsazeno' : 'Volná místa'}</span>
      <h3>${escapeHtml(ev.name)}</h3>
      <div class="meta">${fmtDateRange(ev)} · ${escapeHtml(ev.place)}</div>
      <p class="desc">${escapeHtml(ev.desc || 'Bez popisu.')}</p>
      <div class="row"><span class="slots">${t} / ${ev.cap} míst</span></div>
      ${currentIsAdmin ? `
      <div class="row" style="margin-top:2px;">
        <button type="button" class="btn-ghost btn-sm" data-edit="${ev.id}" style="flex:1;">Upravit</button>
        <button type="button" class="btn-ghost btn-sm" data-delete="${ev.id}" style="flex:1; color:var(--crimson); border-color:var(--crimson);">Smazat</button>
      </div>` : ''}
    `;
    card.addEventListener('click', (e) => {
      if(e.target.closest('[data-edit]') || e.target.closest('[data-delete]')) return;
      openEventDetail(ev.id);
    });
    const editBtn = card.querySelector('[data-edit]');
    if(editBtn) editBtn.addEventListener('click', () => startEditEvent(ev));
    const delBtn = card.querySelector('[data-delete]');
    if(delBtn) delBtn.addEventListener('click', () => deleteEvent(ev.id, ev.name));
    grid.appendChild(card);
  });
}

// ==================== DETAIL AKCE ====================
let currentDetailEventId = null;
let currentTab = 'prehled';
let detailUnsubs = [];
let currentRegistrationsMap = {};

function clearDetailListeners(){
  detailUnsubs.forEach(u => u());
  detailUnsubs = [];
}

function openEventDetail(eventId){
  currentDetailEventId = eventId;
  currentTab = 'prehled';
  const ev = events.find(x => x.id === eventId);
  if(!ev) return;
  showView('event');
  renderEventDetailStatic(ev);
  clearDetailListeners();

  const unsubReg = onSnapshot(collection(db, 'events', eventId, 'registrations'), (snap) => {
    currentRegistrationsMap = {};
    snap.forEach(d => currentRegistrationsMap[d.id] = { ...d.data(), _docId: d.id });
    renderStatsAndRsvp();
    renderAttendees();
    if(currentTab === 'jidlo') renderTabJidlo(ev);
  });
  detailUnsubs.push(unsubReg);

  const unsubSug = onSnapshot(collection(db, 'events', eventId, 'suggestions'), (snap) => {
    currentSuggestions = snap.docs.map(d => ({ id:d.id, ...d.data() })).sort((a,b)=>(a.ts||'').localeCompare(b.ts||''));
    if(currentTab === 'prehled') renderTabPrehled(ev);
  });
  detailUnsubs.push(unsubSug);

  const unsubComments = onSnapshot(collection(db, 'events', eventId, 'comments'), (snap) => {
    currentComments = snap.docs.map(d => ({ id:d.id, ...d.data() })).sort((a,b)=>(a.ts||'').localeCompare(b.ts||''));
    if(currentTab === 'prehled') renderTabPrehled(ev);
  });
  detailUnsubs.push(unsubComments);

  const unsubFood = onSnapshot(collection(db, 'events', eventId, 'foodComments'), (snap) => {
    currentFoodComments = snap.docs.map(d => ({ id:d.id, ...d.data() })).sort((a,b)=>(a.ts||'').localeCompare(b.ts||''));
    if(currentTab === 'jidlo') renderTabJidlo(ev);
  });
  detailUnsubs.push(unsubFood);

  const unsubPhotos = onSnapshot(collection(db, 'events', eventId, 'photos'), (snap) => {
    currentPhotos = snap.docs.map(d => ({ id:d.id, ...d.data() })).sort((a,b)=>(b.ts||'').localeCompare(a.ts||''));
    if(currentTab === 'foto') renderTabFoto(ev);
  });
  detailUnsubs.push(unsubPhotos);
}

let currentSuggestions = [];
let currentComments = [];
let currentFoodComments = [];
let currentPhotos = [];

function renderEventDetailStatic(ev){
  document.getElementById('ed-title').textContent = ev.name;
  document.getElementById('ed-meta').textContent = fmtDateRange(ev) + ' · ' + ev.place;
  document.getElementById('ed-desc').textContent = ev.desc || '';

  const header = document.getElementById('ed-header');
  header.style.backgroundImage = ev.imageUrl ? `url('${ev.imageUrl.replace(/'/g,"")}')` : 'none';

  const mapBox = document.getElementById('ed-map');
  const q = encodeURIComponent(ev.place || '');
  mapBox.innerHTML = `<iframe src="https://www.google.com/maps?q=${q}&output=embed" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`;

  const tabPanels = { prehled:'tab-prehled', jidlo:'tab-jidlo', turnaj:'tab-turnaj', foto:'tab-foto' };
  document.querySelectorAll('#ed-tabs .tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === currentTab);
    btn.onclick = () => {
      currentTab = btn.dataset.tab;
      document.querySelectorAll('#ed-tabs .tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      Object.entries(tabPanels).forEach(([key, id]) => {
        document.getElementById(id).style.display = (key === currentTab) ? 'block' : 'none';
      });
      if(currentTab === 'prehled') renderTabPrehled(ev);
      else if(currentTab === 'jidlo') renderTabJidlo(ev);
      else if(currentTab === 'turnaj') renderTabTurnaj(ev);
      else renderTabFoto(ev);
    };
  });

  renderStatsAndRsvp();
  renderAttendees();
  renderTabPrehled(ev);
}

function isPastDeadline(ev){
  return !!ev.changeDeadline && todayIso() > ev.changeDeadline;
}

// ---- RSVP: dvoukrokové (nejdřív přihlásit, pak určitě/možná v sidebaru) ----
function renderStatsAndRsvp(){
  const ev = events.find(x => x.id === currentDetailEventId);
  if(!ev) return;

  const rsvpBox = document.getElementById('ed-rsvp');
  if(!currentUser || !currentNick){
    rsvpBox.innerHTML = `<span class="status-hint">Pro účast na akci se nejdřív přihlas.</span> <button type="button" id="rsvp-login-btn" class="btn-sm">Přihlásit se</button>`;
    document.getElementById('rsvp-login-btn').addEventListener('click', () => { pendingEventId = ev.id; showView('ucet'); });
    return;
  }

  const myReg = currentRegistrationsMap[currentUser.uid];
  const deadlinePassed = isPastDeadline(ev);
  const counts = regCounts[ev.id] || { going:0, maybe:0 };
  const full = counts.going >= ev.cap;

  if(!myReg){
    rsvpBox.innerHTML = `<button type="button" id="rsvp-register-btn" ${full ? 'disabled title="Akce je plně obsazená"' : ''}>Přihlásit se na akci</button>`;
    const btn = document.getElementById('rsvp-register-btn');
    if(btn) btn.addEventListener('click', async () => {
      try{
        await setDoc(doc(db, 'events', ev.id, 'registrations', currentUser.uid), {
          nick: currentNick, uid: currentUser.uid, status: 'going', food: {}, ts: new Date().toISOString()
        });
      }catch(err){ alert('Přihlášení se nepovedlo.'); console.error(err); }
    });
  }else{
    const statusLabel = myReg.status === 'maybe' ? 'Možná pojedeš' : 'Určitě jedeš';
    rsvpBox.innerHTML = `
      <span class="status-hint">Jsi přihlášen/a — <b style="color:var(--gold);">${statusLabel}</b>. Stav můžeš změnit vedle svého jména v seznamu vpravo.</span>
      <button type="button" id="rsvp-cancel" class="btn-ghost" ${deadlinePassed ? 'disabled title="Uzávěrka změn už proběhla"' : ''}>Odhlásit se</button>
      ${deadlinePassed ? `<span class="status-hint">Uzávěrka změn: ${fmtDate(ev.changeDeadline)}</span>` : ''}
    `;
    const cancelBtn = document.getElementById('rsvp-cancel');
    if(cancelBtn) cancelBtn.addEventListener('click', async () => {
      if(!confirm('Opravdu se chceš z akce odhlásit?')) return;
      try{ await deleteDoc(doc(db, 'events', ev.id, 'registrations', currentUser.uid)); }
      catch(err){ alert('Odhlášení se nepovedlo.'); console.error(err); }
    });
  }
}

// ---- Sidebar: statistika nahoře + seznam, vlastní řádek editovatelný ----
function renderAttendees(){
  const box = document.getElementById('ed-attendees');
  const list = Object.values(currentRegistrationsMap).sort((a,b)=>(a.ts||'').localeCompare(b.ts||''));
  const going = list.filter(r => r.status !== 'maybe').length;
  const maybe = list.length - going;
  const ev = events.find(x => x.id === currentDetailEventId);
  const cap = ev ? ev.cap : '?';

  let html = `
    <div class="attendee-stats">
      <div class="row-stat"><span>Obsazeno míst</span><b>${going} / ${cap}</b></div>
      <div class="row-stat"><span>Určitě jedou</span><b>${going}</b></div>
      <div class="row-stat"><span>Možná pojedou</span><b>${maybe}</b></div>
    </div>
  `;

  if(list.length === 0){
    html += '<div class="empty">Zatím se nikdo nepřihlásil.</div>';
    box.innerHTML = html;
    return;
  }

  html += list.map(r => {
    const isSelf = currentUser && r._docId === currentUser.uid;
    let statusHtml;
    if(isSelf){
      statusHtml = `
        <button type="button" class="status-pill clickable ${r.status !== 'maybe' ? 'going' : ''}" data-self-status="going">Určitě</button>
        <button type="button" class="status-pill clickable ${r.status === 'maybe' ? 'maybe' : ''}" data-self-status="maybe">Možná</button>
      `;
    }else{
      statusHtml = `<span class="status-pill ${r.status === 'maybe' ? 'maybe' : 'going'}">${r.status === 'maybe' ? 'Možná' : 'Určitě'}</span>`;
    }
    return `
      <div class="attendee-row">
        <span>${escapeHtml(r.nick || '(bez jména)')}</span>
        <span style="display:flex; align-items:center; gap:6px;">
          ${statusHtml}
          ${(currentIsAdmin && !isSelf) ? `<button type="button" class="btn-ghost btn-sm" data-remove-attendee="${r._docId}" title="Odebrat" style="padding:2px 7px; color:var(--crimson); border-color:var(--crimson);">×</button>` : ''}
        </span>
      </div>
    `;
  }).join('');

  box.innerHTML = html;

  box.querySelectorAll('[data-self-status]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try{
        await updateDoc(doc(db, 'events', currentDetailEventId, 'registrations', currentUser.uid), { status: btn.dataset.selfStatus });
      }catch(err){ console.error(err); }
    });
  });
  box.querySelectorAll('[data-remove-attendee]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if(!confirm('Odebrat tohoto účastníka z akce?')) return;
      try{ await deleteDoc(doc(db, 'events', currentDetailEventId, 'registrations', btn.dataset.removeAttendee)); }
      catch(err){ alert('Odebrání se nepovedlo.'); console.error(err); }
    });
  });
}

// ---- Přehled: hry + návrhy (editovatelné vlastníkem/adminem) + Diskuze (editovatelná vlastníkem/adminem) ----
function renderTabPrehled(ev){
  const box = document.getElementById('tab-prehled');
  const games = ev.games || [];
  box.innerHTML = `
    <div class="section-title" style="font-size:16px;">Co se bude hrát</div>
    <div class="chip-row">${games.length ? games.map(g=>`<span class="chip">${escapeHtml(g)}</span>`).join('') : '<span class="empty">Zatím nic nevypsáno.</span>'}</div>

    <div class="section-title" style="font-size:16px; margin-top:28px;">Co by sis rád zahrál?</div>
    <div class="field" style="max-width:360px; display:flex; flex-direction:row; gap:8px; align-items:flex-end;">
      <div style="flex:1;"><input type="text" id="suggestion-input" placeholder="Např. HALO"></div>
      <button type="button" id="btn-add-suggestion" class="btn-sm">Přidat</button>
    </div>
    <div id="suggestions-list" style="margin-top:6px;"></div>

    <div class="section-title" style="font-size:16px; margin-top:28px;">Diskuze</div>
    <div class="field" style="max-width:420px; display:flex; flex-direction:row; gap:8px; align-items:flex-end;">
      <div style="flex:1;"><input type="text" id="comment-input" placeholder="Napiš příspěvek do diskuze..."></div>
      <button type="button" id="btn-add-comment" class="btn-sm">Odeslat</button>
    </div>
    <div id="comments-list" style="margin-top:6px;"></div>
  `;

  renderSuggestions(ev);
  renderComments(ev);

  document.getElementById('btn-add-suggestion').addEventListener('click', async () => {
    if(!currentUser || !currentNick){ showView('ucet'); return; }
    const input = document.getElementById('suggestion-input');
    const text = input.value.trim();
    if(!text) return;
    try{
      await addDoc(collection(db,'events',ev.id,'suggestions'), { text, author: currentNick, uid: currentUser.uid, likes: [], likeNicks: [], ts: new Date().toISOString() });
      input.value = '';
    }catch(err){ console.error(err); }
  });

  document.getElementById('btn-add-comment').addEventListener('click', async () => {
    if(!currentUser || !currentNick){ showView('ucet'); return; }
    const input = document.getElementById('comment-input');
    const text = input.value.trim();
    if(!text) return;
    try{
      await addDoc(collection(db,'events',ev.id,'comments'), { text, author: currentNick, uid: currentUser.uid, ts: new Date().toISOString() });
      input.value = '';
    }catch(err){ console.error(err); }
  });
}

function renderSuggestions(ev){
  const sugList = document.getElementById('suggestions-list');
  if(!sugList) return;
  if(currentSuggestions.length === 0){
    sugList.innerHTML = '<div class="empty">Zatím nikdo nic nenavrhl.</div>';
    return;
  }
  sugList.innerHTML = currentSuggestions.map(s => {
    const liked = currentUser && (s.likes||[]).includes(currentUser.uid);
    const likers = (s.likeNicks||[]).join(', ');
    const canEdit = currentUser && (s.uid === currentUser.uid || currentIsAdmin);
    return `
    <div class="suggestion-row" data-sug-row="${s.id}">
      <span class="txt" data-sug-display="${s.id}">Hráč: ${escapeHtml(s.author)} — ${escapeHtml(s.text)}</span>
      <span class="sug-actions">
        <button type="button" class="like-btn ${liked?'liked':''}" data-sug-like="${s.id}" title="${escapeHtml(likers)}">♥ ${ (s.likes||[]).length }</button>
        ${canEdit ? `<button type="button" class="btn-ghost btn-sm" data-sug-edit="${s.id}">Upravit</button><button type="button" class="btn-ghost btn-sm" data-sug-delete="${s.id}" style="color:var(--crimson); border-color:var(--crimson);">Smazat</button>` : ''}
      </span>
    </div>`;
  }).join('');

  sugList.querySelectorAll('[data-sug-like]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if(!currentUser || !currentNick){ showView('ucet'); return; }
      const sug = currentSuggestions.find(s => s.id === btn.dataset.sugLike);
      const liked = (sug.likes||[]).includes(currentUser.uid);
      try{
        await updateDoc(doc(db,'events',ev.id,'suggestions',sug.id), {
          likes: liked ? arrayRemove(currentUser.uid) : arrayUnion(currentUser.uid),
          likeNicks: liked ? arrayRemove(currentNick) : arrayUnion(currentNick)
        });
      }catch(err){ console.error(err); }
    });
  });

  sugList.querySelectorAll('[data-sug-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if(!confirm('Smazat tenhle návrh?')) return;
      try{ await deleteDoc(doc(db,'events',ev.id,'suggestions',btn.dataset.sugDelete)); }
      catch(err){ console.error(err); }
    });
  });

  sugList.querySelectorAll('[data-sug-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const sugId = btn.dataset.sugEdit;
      const sug = currentSuggestions.find(s => s.id === sugId);
      const row = sugList.querySelector(`[data-sug-row="${sugId}"]`);
      const display = row.querySelector('[data-sug-display]');
      display.outerHTML = `
        <span class="txt" style="display:flex; gap:6px;">
          <input type="text" id="sug-edit-input-${sugId}" value="${escapeHtml(sug.text)}" style="flex:1; background:var(--bg-void); border:1px solid var(--line); color:var(--text); padding:4px 8px;">
          <button type="button" class="btn-sm" data-sug-save="${sugId}">Uložit</button>
        </span>
      `;
      row.querySelector(`[data-sug-save="${sugId}"]`).addEventListener('click', async () => {
        const newText = document.getElementById(`sug-edit-input-${sugId}`).value.trim();
        if(!newText) return;
        try{ await updateDoc(doc(db,'events',ev.id,'suggestions',sugId), { text: newText }); }
        catch(err){ console.error(err); }
      });
    });
  });
}

function renderComments(ev){
  const commentsList = document.getElementById('comments-list');
  if(!commentsList) return;
  if(currentComments.length === 0){
    commentsList.innerHTML = '<div class="empty">Zatím žádná diskuze.</div>';
    return;
  }
  commentsList.innerHTML = currentComments.map(c => {
    const canEdit = currentUser && (c.uid === currentUser.uid || currentIsAdmin);
    return `
    <div class="comment-row" data-comment-row="${c.id}">
      <span class="who">${escapeHtml(c.author)}</span><span class="when">${c.ts ? new Date(c.ts).toLocaleDateString('cs-CZ') : ''}</span>
      <div class="txt" data-comment-display="${c.id}">${escapeHtml(c.text)}</div>
      ${canEdit ? `<div class="row-actions"><button type="button" class="btn-ghost btn-sm" data-comment-edit="${c.id}">Upravit</button><button type="button" class="btn-ghost btn-sm" data-comment-delete="${c.id}" style="color:var(--crimson); border-color:var(--crimson);">Smazat</button></div>` : ''}
    </div>`;
  }).join('');

  commentsList.querySelectorAll('[data-comment-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if(!confirm('Smazat tenhle příspěvek?')) return;
      try{ await deleteDoc(doc(db,'events',ev.id,'comments',btn.dataset.commentDelete)); }
      catch(err){ console.error(err); }
    });
  });

  commentsList.querySelectorAll('[data-comment-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cId = btn.dataset.commentEdit;
      const c = currentComments.find(x => x.id === cId);
      const row = commentsList.querySelector(`[data-comment-row="${cId}"]`);
      const display = row.querySelector('[data-comment-display]');
      display.outerHTML = `
        <div class="txt" style="display:flex; gap:6px;">
          <input type="text" id="comment-edit-input-${cId}" value="${escapeHtml(c.text)}" style="flex:1; background:var(--bg-void); border:1px solid var(--line); color:var(--text); padding:4px 8px;">
          <button type="button" class="btn-sm" data-comment-save="${cId}">Uložit</button>
        </div>
      `;
      row.querySelector(`[data-comment-save="${cId}"]`).addEventListener('click', async () => {
        const newText = document.getElementById(`comment-edit-input-${cId}`).value.trim();
        if(!newText) return;
        try{ await updateDoc(doc(db,'events',ev.id,'comments',cId), { text: newText }); }
        catch(err){ console.error(err); }
      });
    });
  });
}

// ---- Jídlo po blocích ----
function renderTabJidlo(ev){
  const box = document.getElementById('tab-jidlo');
  const myReg = currentUser ? currentRegistrationsMap[currentUser.uid] : null;
  const deadlinePassed = isPastDeadline(ev);
  const schedule = ev.foodSchedule || {};
  const activeSlots = MEAL_SLOTS.filter(slot => schedule[slot.key] && schedule[slot.key].length > 0);

  let slotsHtml = '';
  if(activeSlots.length === 0){
    slotsHtml = '<div class="empty">Zatím nejsou vypsané žádné jídelní bloky.</div>';
  }else{
    slotsHtml = activeSlots.map(slot => {
      const options = schedule[slot.key];
      const myChoice = myReg && myReg.food ? myReg.food[slot.key] : '';
      const optionsHtml = options.map(o => `<option value="${escapeHtml(o)}" ${myChoice===o?'selected':''}>${escapeHtml(o)}</option>`).join('');
      const pickerHtml = myReg
        ? `<select data-food-slot="${slot.key}" ${deadlinePassed?'disabled':''}><option value="">— nevybráno —</option>${optionsHtml}</select>`
        : `<span class="status-hint">Přihlas se na akci, ať můžeš vybrat.</span>`;

      const whoPicked = Object.values(currentRegistrationsMap)
        .filter(r => r.food && r.food[slot.key])
        .map(r => `${escapeHtml(r.nick)}: ${escapeHtml(r.food[slot.key])}`)
        .join(', ') || 'Zatím nikdo nic nevybral.';

      return `
        <div class="meal-slot-block" style="margin-bottom:22px;">
          <b style="font-size:14px;">${slot.label}</b>
          <div style="margin-top:6px;">${pickerHtml}</div>
          <div style="font-size:12px; color:var(--text-muted); margin-top:6px;">${whoPicked}</div>
        </div>
      `;
    }).join('');
  }

  box.innerHTML = `
    <div class="section-title" style="font-size:16px;">Plán jídla</div>
    <p class="lede" style="margin-top:0;">${escapeHtml(ev.foodPlan || 'Zatím nic naplánováno.')}</p>
    ${deadlinePassed ? '<p class="status-hint">Uzávěrka změn proběhla — výběr už nejde měnit.</p>' : ''}
    ${slotsHtml}

    <div class="section-title" style="font-size:16px; margin-top:28px;">Diskuze k jídlu</div>
    <div class="field" style="max-width:420px; display:flex; flex-direction:row; gap:8px; align-items:flex-end;">
      <div style="flex:1;"><input type="text" id="food-comment-input" placeholder="Kdo co doveze, návrhy..."></div>
      <button type="button" id="btn-add-food-comment" class="btn-sm">Odeslat</button>
    </div>
    <div id="food-comments-list" style="margin-top:6px;"></div>
  `;

  box.querySelectorAll('[data-food-slot]').forEach(sel => {
    sel.addEventListener('change', async () => {
      const key = sel.dataset.foodSlot;
      const newFood = { ...(myReg.food || {}) };
      newFood[key] = sel.value;
      try{ await updateDoc(doc(db,'events',ev.id,'registrations',currentUser.uid), { food: newFood }); }
      catch(err){ alert('Nepovedlo se uložit.'); console.error(err); }
    });
  });

  const foodCommentsList = document.getElementById('food-comments-list');
  foodCommentsList.innerHTML = currentFoodComments.length === 0
    ? '<div class="empty">Zatím žádná diskuze.</div>'
    : currentFoodComments.map(c => {
        const canEdit = currentUser && (c.uid === currentUser.uid || currentIsAdmin);
        return `
        <div class="comment-row" data-food-comment-row="${c.id}">
          <span class="who">${escapeHtml(c.author)}</span><span class="when">${c.ts ? new Date(c.ts).toLocaleDateString('cs-CZ') : ''}</span>
          <div class="txt">${escapeHtml(c.text)}</div>
          ${canEdit ? `<div class="row-actions"><button type="button" class="btn-ghost btn-sm" data-food-comment-delete="${c.id}" style="color:var(--crimson); border-color:var(--crimson);">Smazat</button></div>` : ''}
        </div>`;
      }).join('');

  foodCommentsList.querySelectorAll('[data-food-comment-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if(!confirm('Smazat tenhle příspěvek?')) return;
      try{ await deleteDoc(doc(db,'events',ev.id,'foodComments',btn.dataset.foodCommentDelete)); }
      catch(err){ console.error(err); }
    });
  });

  document.getElementById('btn-add-food-comment').addEventListener('click', async () => {
    if(!currentUser || !currentNick){ showView('ucet'); return; }
    const input = document.getElementById('food-comment-input');
    const text = input.value.trim();
    if(!text) return;
    try{
      await addDoc(collection(db,'events',ev.id,'foodComments'), { text, author: currentNick, uid: currentUser.uid, ts: new Date().toISOString() });
      input.value = '';
    }catch(err){ console.error(err); }
  });
}

// ---- Turnaj: pavouci ----
function buildBracketRoundCounts(size){
  const rounds = [];
  let n = size;
  while(n >= 1){ rounds.push(n); n = Math.floor(n/2); if(n===0) break; }
  return rounds;
}

function renderTabTurnaj(ev){
  const box = document.getElementById('tab-turnaj');
  const bracket = ev.bracket;

  let adminSetupHtml = '';
  if(currentIsAdmin){
    const goingNicks = Object.values(currentRegistrationsMap).filter(r=>r.status!=='maybe').sort((a,b)=>(a.ts||'').localeCompare(b.ts||'')).map(r=>r.nick);
    adminSetupHtml = `
      <div class="bracket-setup">
        <div class="field" style="max-width:160px;">
          <label>Počet účastníků / týmů</label>
          <select id="bracket-size-select">
            ${[2,4,8,16,32].map(n => `<option value="${n}" ${bracket && bracket.size===n ? 'selected':''}>${n}</option>`).join('')}
          </select>
        </div>
        <button type="button" id="btn-generate-bracket" class="btn-sm">Vygenerovat pavouka z přihlášených</button>
        ${bracket ? '<button type="button" id="btn-save-bracket" class="btn-sm">Uložit úpravy jmen</button><button type="button" id="btn-clear-bracket" class="btn-ghost btn-sm" style="color:var(--crimson); border-color:var(--crimson);">Smazat turnaj</button>' : ''}
      </div>
    `;
    box.innerHTML = `<div class="section-title" style="font-size:16px;">Turnaj</div>${adminSetupHtml}<div id="bracket-render"></div>`;

    document.getElementById('btn-generate-bracket').addEventListener('click', async () => {
      const size = parseInt(document.getElementById('bracket-size-select').value, 10);
      const slots = [];
      for(let i=0;i<size;i++) slots.push(goingNicks[i] || '');
      try{ await updateDoc(doc(db,'events',ev.id), { bracket: { size, slots } }); }
      catch(err){ alert('Uložení pavouka se nepovedlo.'); console.error(err); }
    });
    const saveBtn = document.getElementById('btn-save-bracket');
    if(saveBtn) saveBtn.addEventListener('click', async () => {
      const inputs = box.querySelectorAll('[data-bracket-slot]');
      const slots = [...bracket.slots];
      inputs.forEach(inp => { slots[parseInt(inp.dataset.bracketSlot,10)] = inp.value.trim(); });
      try{ await updateDoc(doc(db,'events',ev.id), { bracket: { size: bracket.size, slots } }); }
      catch(err){ alert('Uložení se nepovedlo.'); console.error(err); }
    });
    const clearBtn = document.getElementById('btn-clear-bracket');
    if(clearBtn) clearBtn.addEventListener('click', async () => {
      if(!confirm('Opravdu smazat celý turnajový pavouk?')) return;
      try{ await updateDoc(doc(db,'events',ev.id), { bracket: null }); }
      catch(err){ console.error(err); }
    });
  }else{
    box.innerHTML = `<div class="section-title" style="font-size:16px;">Turnaj</div><div id="bracket-render"></div>`;
  }

  const renderBox = document.getElementById('bracket-render');
  if(!bracket || !bracket.slots || bracket.slots.length === 0){
    renderBox.innerHTML = '<div class="empty">Turnaj zatím nebyl vypsán.</div>';
    return;
  }

  const roundCounts = buildBracketRoundCounts(bracket.size);
  let html = '<div class="bracket-wrap">';
  roundCounts.forEach((count, roundIdx) => {
    html += `<div class="bracket-round"><div class="bracket-round-title">${roundIdx===0 ? '1. kolo' : (count===1 ? 'Finále' : roundIdx+1+'. kolo')}</div>`;
    if(roundIdx === 0){
      for(let i=0; i<bracket.slots.length; i+=2){
        html += `<div class="bracket-match">
          <div class="bracket-slot">${currentIsAdmin ? `<input type="text" data-bracket-slot="${i}" value="${escapeHtml(bracket.slots[i]||'')}" placeholder="volný slot">` : (escapeHtml(bracket.slots[i]) || '<span class="placeholder">volný slot</span>')}</div>
          <div class="bracket-slot">${currentIsAdmin ? `<input type="text" data-bracket-slot="${i+1}" value="${escapeHtml(bracket.slots[i+1]||'')}" placeholder="volný slot">` : (escapeHtml(bracket.slots[i+1]) || '<span class="placeholder">volný slot</span>')}</div>
        </div>`;
      }
    }else{
      const matchCount = Math.max(1, count);
      for(let i=0; i<matchCount; i++){
        html += `<div class="bracket-match">
          <div class="bracket-slot placeholder">Vítěz zápasu ${i*2+1}</div>
          <div class="bracket-slot placeholder">Vítěz zápasu ${i*2+2}</div>
        </div>`;
      }
    }
    html += `</div>`;
  });
  html += '</div>';
  renderBox.innerHTML = html;
}

// ---- Foto ----
function renderTabFoto(ev){
  const box = document.getElementById('tab-foto');
  box.innerHTML = `
    <div class="section-title" style="font-size:16px;">Foto</div>
    <p class="lede" style="margin-top:0;">Vlož odkaz na fotku (např. z Google Photos, Imgur nebo jiného hostingu) — přímé nahrávání souborů zatím není zapojené.</p>
    <div class="photo-add-row">
      <div class="field" style="flex:1;"><label>URL fotky</label><input type="url" id="photo-url-input" placeholder="https://..."></div>
      <button type="button" id="btn-add-photo" class="btn-sm">Přidat</button>
    </div>
    <div class="photo-grid" id="photo-grid"></div>
  `;

  document.getElementById('btn-add-photo').addEventListener('click', async () => {
    if(!currentUser || !currentNick){ showView('ucet'); return; }
    const input = document.getElementById('photo-url-input');
    const url = input.value.trim();
    if(!url) return;
    try{
      await addDoc(collection(db,'events',ev.id,'photos'), { url, author: currentNick, uid: currentUser.uid, ts: new Date().toISOString() });
      input.value = '';
    }catch(err){ console.error(err); }
  });

  const grid = document.getElementById('photo-grid');
  if(currentPhotos.length === 0){
    grid.innerHTML = '<div class="empty">Zatím žádné fotky.</div>';
    return;
  }
  grid.innerHTML = currentPhotos.map(p => {
    const canDelete = currentUser && (p.uid === currentUser.uid || currentIsAdmin);
    return `
      <div class="photo-card">
        <img src="${p.url.replace(/"/g,'&quot;')}" alt="Foto od ${escapeHtml(p.author)}" loading="lazy">
        <div class="photo-meta">
          <span>${escapeHtml(p.author)}</span>
          ${canDelete ? `<span class="photo-del" data-photo-delete="${p.id}">Smazat</span>` : ''}
        </div>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('[data-photo-delete]').forEach(el => {
    el.addEventListener('click', async () => {
      if(!confirm('Smazat tuhle fotku?')) return;
      try{ await deleteDoc(doc(db,'events',ev.id,'photos',el.dataset.photoDelete)); }
      catch(err){ console.error(err); }
    });
  });
}

// ==================== ÚČET / AUTENTIZACE ====================
function usernameDocRef(nick){ return doc(db, 'usernames', nick.trim().toLowerCase()); }
function setAuthMessage(msg){ document.getElementById('auth-message').textContent = msg || ''; }

const formAuth = document.getElementById('form-auth');
const authEmailField = document.getElementById('auth-email-field');
const authSubmitBtn = document.getElementById('auth-submit-btn');
let authStep = 1;
let pendingNickForRegistration = null;

formAuth.addEventListener('submit', async (e) => {
  e.preventDefault();
  const nick = document.getElementById('auth-nick').value.trim();
  const password = document.getElementById('auth-password').value;
  if(!nick || !password) return;
  authSubmitBtn.disabled = true;
  setAuthMessage('');
  try{
    if(authStep === 1){
      const unameSnap = await getDoc(usernameDocRef(nick));
      if(unameSnap.exists()){
        const { email } = unameSnap.data();
        await signInWithEmailAndPassword(auth, email, password);
      }else{
        authStep = 2;
        pendingNickForRegistration = nick;
        authEmailField.style.display = 'block';
        document.getElementById('auth-nick').readOnly = true;
        authSubmitBtn.textContent = 'Dokončit registraci';
        setAuthMessage(`Přezdívka "${nick}" je volná — doplň e-mail a založíme ti účet.`);
      }
    }else{
      const email = document.getElementById('auth-email').value.trim();
      if(!email){ setAuthMessage('Doplň prosím e-mail.'); authSubmitBtn.disabled = false; return; }
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await setDoc(usernameDocRef(pendingNickForRegistration), { uid: cred.user.uid, email });
      await setDoc(doc(db, 'users', cred.user.uid), { nick: pendingNickForRegistration, email });
    }
  }catch(err){
    console.error(err);
    if(err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') setAuthMessage('Nesprávné heslo. Zkus to znovu.');
    else if(err.code === 'auth/email-already-in-use') setAuthMessage('Tenhle e-mail už je použitý u jiného účtu.');
    else if(err.code === 'auth/weak-password') setAuthMessage('Heslo musí mít aspoň 6 znaků.');
    else setAuthMessage('Něco se nepovedlo. Zkus to prosím znovu.');
  }finally{
    authSubmitBtn.disabled = false;
  }
});

function resetAuthForm(){
  authStep = 1;
  pendingNickForRegistration = null;
  formAuth.reset();
  authEmailField.style.display = 'none';
  document.getElementById('auth-nick').readOnly = false;
  authSubmitBtn.textContent = 'Pokračovat';
  setAuthMessage('');
}

document.getElementById('btn-google').addEventListener('click', async () => {
  try{ await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch(err){ console.error(err); setAuthMessage('Přihlášení přes Google se nepovedlo. Zkus to znovu.'); }
});

document.getElementById('btn-google-nick-submit').addEventListener('click', async () => {
  const nick = document.getElementById('google-nick-input').value.trim();
  if(!nick || !currentUser) return;
  const btn = document.getElementById('btn-google-nick-submit');
  btn.disabled = true;
  try{
    const existing = await getDoc(usernameDocRef(nick));
    if(existing.exists()){ alert('Tahle přezdívka je už obsazená, zkus jinou.'); btn.disabled = false; return; }
    await setDoc(usernameDocRef(nick), { uid: currentUser.uid, email: currentUser.email });
    await setDoc(doc(db, 'users', currentUser.uid), { nick, email: currentUser.email });
    currentNick = nick;
    updateAuthUI();
  }catch(err){ console.error(err); alert('Uložení přezdívky se nepovedlo. Zkus to znovu.'); }
  finally{ btn.disabled = false; }
});

document.getElementById('btn-logout').addEventListener('click', async () => { await signOut(auth); });

function hasPasswordProvider(user){
  return user.providerData.some(p => p.providerId === 'password');
}

// ---- Přezdívka: změna ----
document.getElementById('btn-toggle-nick').addEventListener('click', () => {
  const form = document.getElementById('form-change-nick');
  const opening = form.style.display === 'none';
  closeAllAccountPanels();
  if(opening){
    document.getElementById('new-nick-input').value = currentNick || '';
    form.style.display = 'flex';
  }
});
document.getElementById('btn-cancel-nick').addEventListener('click', () => {
  document.getElementById('form-change-nick').style.display = 'none';
});
document.getElementById('form-change-nick').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('nick-change-msg');
  const newNick = document.getElementById('new-nick-input').value.trim();
  if(!newNick || !currentUser) return;
  if(newNick.toLowerCase() === (currentNick||'').toLowerCase()){
    document.getElementById('form-change-nick').style.display = 'none';
    return;
  }
  msg.textContent = '';
  try{
    const existing = await getDoc(usernameDocRef(newNick));
    if(existing.exists()){ msg.textContent = 'Tahle přezdívka je už obsazená.'; return; }
    await setDoc(usernameDocRef(newNick), { uid: currentUser.uid, email: currentUser.email });
    await deleteDoc(usernameDocRef(currentNick));
    await updateDoc(doc(db,'users',currentUser.uid), { nick: newNick });
    currentNick = newNick;
    document.getElementById('form-change-nick').style.display = 'none';
    msg.textContent = '';
    updateAuthUI();
  }catch(err){ console.error(err); msg.textContent = 'Nepovedlo se — zkus to prosím znovu.'; }
});

// ---- E-mail: změna ----
document.getElementById('btn-toggle-email').addEventListener('click', () => {
  const form = document.getElementById('form-change-email');
  const opening = form.style.display === 'none';
  closeAllAccountPanels();
  if(opening) form.style.display = 'flex';
});
document.getElementById('btn-cancel-email').addEventListener('click', () => {
  document.getElementById('form-change-email').style.display = 'none';
});
document.getElementById('form-change-email').addEventListener('submit', async (e) => {
  e.preventDefault();
  if(!currentUser) return;
  const msg = document.getElementById('email-change-msg');
  const newEmail = document.getElementById('new-email').value.trim();
  if(!newEmail) return;
  msg.textContent = '';
  try{
    if(hasPasswordProvider(currentUser)){
      const pw = document.getElementById('reauth-password').value;
      const cred = EmailAuthProvider.credential(currentUser.email, pw);
      await reauthenticateWithCredential(currentUser, cred);
    }else{
      await reauthenticateWithPopup(currentUser, new GoogleAuthProvider());
    }
    await verifyBeforeUpdateEmail(currentUser, newEmail);
    msg.textContent = `Ověřovací odkaz byl odeslán na ${newEmail}. Po kliknutí na něj se e-mail změní.`;
  }catch(err){
    console.error(err);
    if(err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') msg.textContent = 'Nesprávné heslo.';
    else if(err.code === 'auth/email-already-in-use') msg.textContent = 'Tenhle e-mail už používá jiný účet.';
    else msg.textContent = 'Nepovedlo se — zkus to prosím znovu.';
  }
});

// ---- Heslo: potvrzovací panel ----
document.getElementById('btn-toggle-password').addEventListener('click', () => {
  const panel = document.getElementById('pw-reset-panel');
  const opening = panel.style.display === 'none';
  closeAllAccountPanels();
  if(opening){
    document.getElementById('pw-reset-target-email').textContent = currentUser?.email || '';
    panel.style.display = 'flex';
  }
});
document.getElementById('btn-cancel-password').addEventListener('click', () => {
  document.getElementById('pw-reset-panel').style.display = 'none';
  document.getElementById('pw-reset-msg').textContent = '';
});
document.getElementById('btn-change-password').addEventListener('click', async () => {
  if(!currentUser || !currentUser.email) return;
  const msg = document.getElementById('pw-reset-msg');
  try{
    await sendPasswordResetEmail(auth, currentUser.email);
    msg.textContent = `Odkaz pro změnu hesla byl odeslán na ${currentUser.email}.`;
  }catch(err){ console.error(err); msg.textContent = 'Nepovedlo se odeslat odkaz. Zkus to znovu.'; }
});

function closeAllAccountPanels(){
  document.getElementById('form-change-nick').style.display = 'none';
  document.getElementById('form-change-email').style.display = 'none';
  document.getElementById('pw-reset-panel').style.display = 'none';
}

function updateAuthUI(){
  const loggedOutBox = document.getElementById('auth-logged-out');
  const loggedInBox = document.getElementById('auth-logged-in');
  const googleNickPrompt = document.getElementById('auth-google-nick-prompt');
  const navLabel = document.getElementById('nav-ucet-label');

  if(currentUser && currentNick){
    loggedOutBox.style.display = 'none';
    loggedInBox.style.display = 'block';
    googleNickPrompt.style.display = 'none';
    document.getElementById('account-nick-display').textContent = currentNick + (currentIsAdmin ? ' (admin)' : '');
    document.getElementById('account-email-display').textContent = currentUser.email || '';
    document.getElementById('reauth-password-field').style.display = hasPasswordProvider(currentUser) ? 'block' : 'none';
    document.getElementById('password-row').style.display = hasPasswordProvider(currentUser) ? 'flex' : 'none';
    navLabel.textContent = currentNick;
  }else if(currentUser && !currentNick){
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
  if(currentDetailEventId){ renderStatsAndRsvp(); renderAttendees(); }
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  currentNick = null;
  currentIsAdmin = false;
  if(user){
    try{
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if(userDoc.exists()){
        currentNick = userDoc.data().nick;
        currentIsAdmin = userDoc.data().isAdmin === true;
        if(userDoc.data().email !== user.email){
          try{
            await updateDoc(doc(db,'users',user.uid), { email: user.email });
            await updateDoc(usernameDocRef(currentNick), { email: user.email });
          }catch(e){ /* tichý fail, není kritické */ }
        }
      }
    }catch(err){ console.error(err); }
    updateAuthUI();
    if(currentNick && pendingEventId){
      const evId = pendingEventId;
      pendingEventId = null;
      openEventDetail(evId);
    }
  }else{
    updateAuthUI();
  }
});

// inicializace pomocných bloků formuláře (prázdné hry/jídlo)
renderFormGames();
renderFormFood();
