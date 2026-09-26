import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, addDoc, onSnapshot, query, orderBy, doc, getDoc, getDocFromServer, getDocs, setDoc,
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
  { key:'fri-dinner',    label:'Pátek — Večeře', day:'Pátek' },
  { key:'sat-breakfast', label:'Sobota — Snídaně', day:'Sobota' },
  { key:'sat-lunch',     label:'Sobota — Oběd', day:'Sobota' },
  { key:'sat-dinner',    label:'Sobota — Večeře', day:'Sobota' },
  { key:'sun-breakfast', label:'Neděle — Snídaně', day:'Neděle' },
  { key:'pivo',          label:'Pivo', day:'Ostatní' }
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
let currentIsSuperAdmin = false;
let currentPermissions = {};
const PERMISSION_AREAS = [
  { key:'akce', label:'Akce (vytváření, úprava, účastníci)' },
  { key:'turnaj', label:'Turnaje' },
  { key:'jidlo', label:'Jídlo' },
  { key:'kontakty', label:'Kontakty' },
  { key:'uzivatele', label:'Uživatelé (správa profilů)' }
];
function hasPerm(area){
  if(!currentUser) return false;
  if(currentIsSuperAdmin) return true;
  return currentIsAdmin && currentPermissions[area] === true;
}
let currentPhone = '';
let currentEmoji = '';
let pendingEventId = null;

let currentEventGames = [];
let currentEventFood = emptyFoodSchedule();
let currentEventDateOptions = [];

function fmtDate(iso){
  if(!iso) return '';
  const d = new Date(iso+'T00:00:00');
  return d.toLocaleDateString('cs-CZ', { day:'numeric', month:'numeric', year:'numeric' });
}
function fmtDateShort(iso){
  if(!iso) return '';
  const d = new Date(iso+'T00:00:00');
  return d.toLocaleDateString('cs-CZ', { day:'numeric', month:'numeric' });
}
function fmtDateRange(ev){
  if(ev.dateUnconfirmed) return 'Termín se vybírá hlasováním';
  if(!ev.dateStart) return '';
  const multiDay = ev.dateEnd && ev.dateEnd !== ev.dateStart;
  if(!multiDay){
    let s = fmtDate(ev.dateStart);
    if(ev.timeStart) s += `, ${ev.timeStart}${ev.timeEnd ? '–'+ev.timeEnd : ''}`;
    return s;
  }
  const startPart = fmtDateShort(ev.dateStart) + (ev.timeStart ? ` ${ev.timeStart}` : '');
  const endPart = fmtDate(ev.dateEnd) + (ev.timeEnd ? ` ${ev.timeEnd}` : '');
  return `${startPart} – ${endPart}`;
}
function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
function authorLabel(author, emoji){
  return `${emoji ? escapeHtml(emoji)+' ' : ''}${escapeHtml(author)}`;
}
const CHAT_EMOJIS = ['😀','😂','😎','👍','👎','🔥','🎉','❤️','😢','🤔','🎮','🕹️','👾','💻','🖱️','⌨️','🍕','🍺','🌙','⚡','💀','👑','🐉','🚗'];
function setupChatEmojiRow(btnId, panelId, inputId){
  const btn = document.getElementById(btnId);
  const panel = document.getElementById(panelId);
  if(!btn || !panel) return;
  panel.innerHTML = CHAT_EMOJIS.map(e => `<span data-chat-emoji="${e}">${e}</span>`).join('');
  panel.style.position = 'fixed';

  function positionPanel(){
    const rect = btn.getBoundingClientRect();
    const panelWidth = panel.offsetWidth || 220;
    let left = rect.right - panelWidth;
    left = Math.max(8, Math.min(left, window.innerWidth - panelWidth - 8));
    panel.style.left = left + 'px';
    panel.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
    panel.style.top = 'auto';
    panel.style.right = 'auto';
    panel.style.marginBottom = '0';
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = panel.style.display === 'none';
    if(opening) positionPanel();
    panel.style.display = opening ? 'grid' : 'none';
  });
  panel.querySelectorAll('[data-chat-emoji]').forEach(el => {
    el.addEventListener('click', () => {
      const input = document.getElementById(inputId);
      input.value += el.dataset.chatEmoji;
      input.focus();
      panel.style.display = 'none';
    });
  });
  document.addEventListener('click', (e) => {
    if(!panel.contains(e.target) && e.target !== btn) panel.style.display = 'none';
  });
  window.addEventListener('resize', () => { if(panel.style.display !== 'none') positionPanel(); });
  window.addEventListener('scroll', () => { if(panel.style.display !== 'none') positionPanel(); }, true);
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
  tryInitialRoute();
}, (err) => console.error('Chyba připojení k Firestore:', err));

// ---- Navigation ----
const navItems = document.querySelectorAll('.nav-item');
const views = document.querySelectorAll('.view');
function showView(name){
  navItems.forEach(n => n.classList.toggle('active', n.dataset.view === name));
  views.forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
}

function setRoute(hash){
  if(location.hash === hash){ applyRoute(); return; }
  location.hash = hash;
}

function applyRoute(){
  closeEventForm();
  closeContactForm();
  const raw = location.hash.replace(/^#/, '');
  const [view, id] = raw.split('/');

  if(view === 'event' && id){
    currentTournamentId = null;
    openEventDetail(id);
  }else if(view === 'turnaj'){
    currentTournamentId = id || null;
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
    if(!events.find(e => e.id === id)) return; // data z Firestore ještě nedorazila, zkusíme znovu příště
  }
  if(location.hash.startsWith('#turnaj/')){
    const id = location.hash.split('/')[1];
    if(!allTournaments.find(x => x.id === id)) return;
  }
  initialRouteApplied = true;
  applyRoute();
}

navItems.forEach(n => n.addEventListener('click', () => setRoute('#' + n.dataset.view)));
document.getElementById('brand-home-link').addEventListener('click', () => setRoute('#home'));

// ---- Kontakty / Tablo ----
let contacts = [];
let editingContactId = null;
onSnapshot(collection(db, 'contacts'), (snap) => {
  contacts = snap.docs.map(d => ({ id:d.id, ...d.data() }));
  renderContacts();
});

function renderContacts(){
  const grid = document.getElementById('contacts-grid');
  if(!grid) return;
  document.getElementById('btn-new-contact').style.display = hasPerm('kontakty') ? 'inline-flex' : 'none';
  if(contacts.length === 0){ grid.innerHTML = '<div class="empty">Zatím žádné kontakty.</div>'; return; }
  grid.innerHTML = contacts.map(c => `
    <div class="contact-card">
      <div class="contact-avatar" style="${c.photo ? `background-image:url('${c.photo.replace(/'/g,"")}')` : ''}">${c.photo ? '' : (c.emoji || '👤')}</div>
      <h3>${escapeHtml(c.name)}</h3>
      ${c.role ? `<div class="role">${escapeHtml(c.role)}</div>` : ''}
      ${c.contact ? `<div class="info">${escapeHtml(c.contact)}</div>` : ''}
      ${hasPerm('kontakty') ? `
      <div class="row" style="margin-top:14px; gap:6px;">
        <button type="button" class="btn-ghost btn-sm" data-edit-contact="${c.id}" style="flex:1;">Upravit</button>
        <button type="button" class="btn-ghost btn-sm" data-delete-contact="${c.id}" style="flex:1; color:var(--crimson); border-color:var(--crimson);">Smazat</button>
      </div>` : ''}
    </div>
  `).join('');

  grid.querySelectorAll('[data-edit-contact]').forEach(btn => {
    btn.addEventListener('click', () => startEditContact(contacts.find(c=>c.id===btn.dataset.editContact)));
  });
  grid.querySelectorAll('[data-delete-contact]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if(!confirm('Smazat tento kontakt?')) return;
      try{ await deleteDoc(doc(db,'contacts',btn.dataset.deleteContact)); }
      catch(err){ alert('Smazání se nepovedlo.'); console.error(err); }
    });
  });
}

const formContact = document.getElementById('form-contact');
function closeContactForm(){
  formContact.style.display = 'none';
  formContact.reset();
  editingContactId = null;
}
document.getElementById('btn-new-contact').addEventListener('click', () => {
  if(formContact.style.display === 'none' || !formContact.style.display){
    editingContactId = null;
    formContact.reset();
    document.getElementById('btn-save-contact').textContent = 'Uložit';
    formContact.style.display = 'flex';
  }else{
    formContact.style.display = 'none';
  }
});
document.getElementById('btn-cancel-contact').addEventListener('click', () => {
  formContact.style.display = 'none';
  formContact.reset();
  editingContactId = null;
});
function startEditContact(c){
  if(!c) return;
  editingContactId = c.id;
  document.getElementById('ct-name').value = c.name || '';
  document.getElementById('ct-role').value = c.role || '';
  document.getElementById('ct-contact').value = c.contact || '';
  document.getElementById('ct-emoji').value = c.emoji || '';
  document.getElementById('ct-photo').value = c.photo || '';
  document.getElementById('btn-save-contact').textContent = 'Uložit změny';
  formContact.style.display = 'flex';
  formContact.scrollIntoView({ behavior:'smooth', block:'start' });
}
formContact.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    name: document.getElementById('ct-name').value.trim(),
    role: document.getElementById('ct-role').value.trim(),
    contact: document.getElementById('ct-contact').value.trim(),
    emoji: document.getElementById('ct-emoji').value.trim(),
    photo: document.getElementById('ct-photo').value.trim()
  };
  if(!payload.name) return;
  try{
    if(editingContactId) await updateDoc(doc(db,'contacts',editingContactId), payload);
    else await addDoc(collection(db,'contacts'), payload);
    formContact.reset();
    formContact.style.display = 'none';
    editingContactId = null;
  }catch(err){ alert('Uložení se nepovedlo.'); console.error(err); }
});

// ---- Home ----
function renderHome(){
  const card = document.getElementById('next-event-card');
  const upcoming = events.filter(e => e.dateEnd >= todayIso());
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

// ==================== FORMULÁŘ AKCE: hry (tagy) ====================
// Zdroj log her: RAWG.io (zdarma, potřeba vlastní API klíč z rawg.io/apidocs)
const RAWG_API_KEY = ''; // <-- sem vlož svůj klíč z https://rawg.io/apidocs

function normalizeGame(g){
  return (typeof g === 'string') ? { name: g, image: '' } : g;
}

function renderFormGames(){
  const list = document.getElementById('ev-games-list');
  list.innerHTML = '';
  currentEventGames.forEach((rawGame, idx) => {
    const game = normalizeGame(rawGame);
    const li = document.createElement('li');
    li.className = 'tag-chip';
    li.innerHTML = `${game.image ? `<img src="${game.image.replace(/"/g,'&quot;')}" alt="" class="game-chip-logo">` : ''}<span>${escapeHtml(game.name)}</span><span class="x" data-remove-game="${idx}">×</span>`;
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
  currentEventGames.push({ name: val, image: '' });
  input.value = '';
  document.getElementById('game-autocomplete-list').style.display = 'none';
  renderFormGames();
});

let gameSearchDebounce = null;
document.getElementById('input-add-game').addEventListener('input', (e) => {
  clearTimeout(gameSearchDebounce);
  const q = e.target.value.trim();
  const box = document.getElementById('game-autocomplete-list');
  if(!RAWG_API_KEY || q.length < 2){ box.style.display = 'none'; return; }
  gameSearchDebounce = setTimeout(async () => {
    try{
      const res = await fetch(`https://api.rawg.io/api/games?key=${RAWG_API_KEY}&search=${encodeURIComponent(q)}&page_size=6`);
      const data = await res.json();
      const results = data.results || [];
      if(results.length === 0){ box.style.display = 'none'; return; }
      box.innerHTML = results.map(r => `
        <div class="game-autocomplete-item" data-pick-game="${escapeHtml(r.name)}" data-pick-image="${r.background_image ? r.background_image.replace(/"/g,'&quot;') : ''}">
          ${r.background_image ? `<img src="${r.background_image.replace(/"/g,'&quot;')}" alt="">` : '<div class="game-autocomplete-noimg">🎮</div>'}
          <span>${escapeHtml(r.name)}</span>
        </div>
      `).join('');
      box.style.display = 'block';
      box.querySelectorAll('[data-pick-game]').forEach(item => {
        item.addEventListener('click', () => {
          currentEventGames.push({ name: item.dataset.pickGame, image: item.dataset.pickImage || '' });
          document.getElementById('input-add-game').value = '';
          box.style.display = 'none';
          renderFormGames();
        });
      });
    }catch(err){ console.error(err); box.style.display = 'none'; }
  }, 400);
});
document.addEventListener('click', (e) => {
  if(!e.target.closest('#input-add-game') && !e.target.closest('#game-autocomplete-list')){
    document.getElementById('game-autocomplete-list').style.display = 'none';
  }
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

// ==================== FORMULÁŘ AKCE: termíny k hlasování ====================
function renderFormDateOptions(){
  const list = document.getElementById('ev-dateopts-list');
  list.innerHTML = currentEventDateOptions.map((d, idx) => `
    <li class="tag-chip"><span>${fmtDateShort(d.start)} – ${fmtDate(d.end)}</span><span class="x" data-remove-dateopt="${idx}">×</span></li>
  `).join('');
  list.querySelectorAll('[data-remove-dateopt]').forEach(el => {
    el.addEventListener('click', () => {
      currentEventDateOptions.splice(parseInt(el.dataset.removeDateopt,10), 1);
      renderFormDateOptions();
    });
  });
}
document.getElementById('btn-add-dateopt').addEventListener('click', () => {
  const startInput = document.getElementById('ev-dateopt-start');
  const endInput = document.getElementById('ev-dateopt-end');
  const start = startInput.value, end = endInput.value || startInput.value;
  if(!start){ alert('Zadej alespoň počáteční datum.'); return; }
  if(end < start){ alert('Konec nemůže být dřív než začátek.'); return; }
  currentEventDateOptions.push({ start, end });
  startInput.value = ''; endInput.value = '';
  renderFormDateOptions();
});

// ---- Akce: založení / editace / mazání ----
const formEvent = document.getElementById('form-event');
const btnNewEvent = document.getElementById('btn-new-event');
const akceListWrap = document.getElementById('akce-list-wrap');
let editingEventId = null;

function resetEventFormHelpers(){
  currentEventGames = [];
  currentEventFood = emptyFoodSchedule();
  currentEventDateOptions = [];
  renderFormGames();
  renderFormFood();
  renderFormDateOptions();
  document.getElementById('ev-dateopt-deadline').value = '';
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

  const enteredStart = document.getElementById('ev-date-start').value;
  const enteredEnd = document.getElementById('ev-date-end').value;
  const dateOptions = [...currentEventDateOptions];

  if(!enteredStart && dateOptions.length === 0){
    alert('Zadej datum akce, nebo přidej alespoň jeden termín k hlasování.');
    submitBtn.disabled = false;
    return;
  }

  let dateStart = enteredStart;
  let dateEnd = enteredEnd || enteredStart;
  let dateUnconfirmed = false;
  if(!enteredStart && dateOptions.length > 0){
    dateStart = dateOptions[0].start;
    dateEnd = dateOptions[0].end;
    dateUnconfirmed = true;
  }
  if(dateEnd < dateStart){
    alert('Datum "do" nemůže být dřív než datum "od".');
    submitBtn.disabled = false;
    return;
  }

  const payload = {
    number: document.getElementById('ev-number').value.trim(),
    name: document.getElementById('ev-name').value.trim(),
    dateStart, dateEnd, dateUnconfirmed,
    timeStart: document.getElementById('ev-time-start').value || '',
    timeEnd: document.getElementById('ev-time-end').value || '',
    place: document.getElementById('ev-place').value.trim(),
    cap: parseInt(document.getElementById('ev-cap').value, 10) || 1,
    desc: document.getElementById('ev-desc').value.trim(),
    imageUrl: document.getElementById('ev-image').value.trim(),
    fee: parseInt(document.getElementById('ev-fee').value, 10) || 0,
    qrUrl: document.getElementById('ev-qr').value.trim(),
    dateOptions,
    dateVoteDeadline: document.getElementById('ev-dateopt-deadline').value || '',
    games: [...currentEventGames],
    foodPlan: document.getElementById('ev-foodplan').value.trim(),
    foodSchedule: JSON.parse(JSON.stringify(currentEventFood)),
    changeDeadline: document.getElementById('ev-deadline').value || ''
  };
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
  document.getElementById('ev-number').value = ev.number || '';
  document.getElementById('ev-name').value = ev.name || '';
  document.getElementById('ev-date-start').value = ev.dateUnconfirmed ? '' : (ev.dateStart || '');
  document.getElementById('ev-date-end').value = ev.dateUnconfirmed ? '' : (ev.dateEnd || ev.dateStart || '');
  document.getElementById('ev-time-start').value = ev.timeStart || '';
  document.getElementById('ev-time-end').value = ev.timeEnd || '';
  document.getElementById('ev-place').value = ev.place || '';
  document.getElementById('ev-cap').value = ev.cap || 1;
  document.getElementById('ev-desc').value = ev.desc || '';
  document.getElementById('ev-image').value = ev.imageUrl || '';
  document.getElementById('ev-fee').value = ev.fee || '';
  document.getElementById('ev-qr').value = ev.qrUrl || '';
  currentEventDateOptions = Array.isArray(ev.dateOptions) ? [...ev.dateOptions] : [];
  renderFormDateOptions();
  document.getElementById('ev-dateopt-deadline').value = ev.dateVoteDeadline || '';
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
  btnNewEvent.style.display = hasPerm('akce') ? 'inline-flex' : 'none';
  const featuredWrap = document.getElementById('featured-event-wrap');
  const grid = document.getElementById('events-grid');
  const historyWrap = document.getElementById('history-wrap');
  featuredWrap.innerHTML = '';
  grid.innerHTML = '';
  historyWrap.innerHTML = '';

  if(events.length === 0){
    grid.innerHTML = '<div class="empty">Zatím žádné akce.</div>';
    return;
  }

  const upcoming = events.filter(e => e.dateEnd >= todayIso());
  const past = events.filter(e => e.dateEnd < todayIso()).sort((a,b)=> b.dateStart.localeCompare(a.dateStart));

  if(upcoming.length === 0 && past.length > 0){
    grid.innerHTML = '<div class="empty">Žádná nadcházející akce zatím není vypsaná.</div>';
  }

  if(upcoming.length > 0){
    const featured = upcoming[0];
    const rest = upcoming.slice(1);

    const taken = (regCounts[featured.id]?.going) || 0;
    const full = taken >= featured.cap;
    const fc = document.createElement('div');
    fc.className = 'featured-card';
    fc.style.backgroundImage = featured.imageUrl ? `url('${featured.imageUrl.replace(/'/g,"")}')` : 'none';
    fc.style.backgroundSize = 'cover';
    fc.style.backgroundPosition = 'center';
    fc.innerHTML = `
      <div style="background:linear-gradient(90deg, rgba(20,23,31,0.95), rgba(20,23,31,0.75)); margin:-26px -28px; padding:26px 28px;">
        <span class="tag">${full ? 'Obsazeno' : 'Nejbližší akce'}</span>
        <h3>${featured.number ? escapeHtml(featured.number) + ' — ' : ''}${escapeHtml(featured.name)}</h3>
        <div class="meta-strong">${fmtDateRange(featured)} · <span class="place">${escapeHtml(featured.place)}</span> · ${taken}/${featured.cap} míst</div>
        <p class="desc">${escapeHtml(featured.desc || '')}</p>
        ${hasPerm('akce') ? `
        <div class="row" style="margin-top:14px; max-width:280px;">
          <button type="button" class="btn-ghost btn-sm" data-edit-featured style="flex:1;">Upravit</button>
          <button type="button" class="btn-ghost btn-sm" data-delete-featured style="flex:1; color:var(--crimson); border-color:var(--crimson);">Smazat</button>
        </div>` : ''}
      </div>
    `;
    fc.addEventListener('click', (e) => {
      if(e.target.closest('[data-edit-featured]') || e.target.closest('[data-delete-featured]')) return;
      setRoute('#event/' + featured.id);
    });
    const featEditBtn = fc.querySelector('[data-edit-featured]');
    if(featEditBtn) featEditBtn.addEventListener('click', (e) => { e.stopPropagation(); startEditEvent(featured); });
    const featDelBtn = fc.querySelector('[data-delete-featured]');
    if(featDelBtn) featDelBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteEvent(featured.id, featured.name); });
    featuredWrap.appendChild(fc);

    rest.forEach(ev => {
      const t = (regCounts[ev.id]?.going) || 0;
      const f = t >= ev.cap;
      const card = document.createElement('div');
      card.className = 'event-card';
      card.innerHTML = `
        <span class="tag ${f ? 'full' : ''}">${f ? 'Obsazeno' : 'Volná místa'}</span>
        <h3>${ev.number ? escapeHtml(ev.number) + ' — ' : ''}${escapeHtml(ev.name)}</h3>
        <div class="meta" style="font-weight:600; color:var(--gold); font-size:14px;">${fmtDateRange(ev)} · <span style="color:var(--teal);">${escapeHtml(ev.place)}</span></div>
        <p class="desc">${escapeHtml(ev.desc || 'Bez popisu.')}</p>
        <div class="row"><span class="slots">${t} / ${ev.cap} míst</span></div>
        ${hasPerm('akce') ? `
        <div class="row" style="margin-top:2px;">
          <button type="button" class="btn-ghost btn-sm" data-edit="${ev.id}" style="flex:1;">Upravit</button>
          <button type="button" class="btn-ghost btn-sm" data-delete="${ev.id}" style="flex:1; color:var(--crimson); border-color:var(--crimson);">Smazat</button>
        </div>` : ''}
      `;
      card.addEventListener('click', (e) => {
        if(e.target.closest('[data-edit]') || e.target.closest('[data-delete]')) return;
        setRoute('#event/' + ev.id);
      });
      const editBtn = card.querySelector('[data-edit]');
      if(editBtn) editBtn.addEventListener('click', () => startEditEvent(ev));
      const delBtn = card.querySelector('[data-delete]');
      if(delBtn) delBtn.addEventListener('click', () => deleteEvent(ev.id, ev.name));
      grid.appendChild(card);
    });
  }

  if(past.length > 0){
    historyWrap.innerHTML = `<div class="section-title" style="font-size:18px;">Proběhlé akce</div><div class="history-grid" id="history-grid"></div>`;
    const hgrid = document.getElementById('history-grid');
    past.forEach(ev => {
      const card = document.createElement('div');
      card.className = 'history-card';
      card.innerHTML = `
        <div class="thumb ${ev.imageUrl ? '' : 'empty-thumb'}" style="${ev.imageUrl ? `background-image:url('${ev.imageUrl.replace(/'/g,"")}')` : ''}">${ev.imageUrl ? '' : 'Bez fotky'}</div>
        <div class="info">
          <h4>${ev.number ? escapeHtml(ev.number) + ' — ' : ''}${escapeHtml(ev.name)}</h4>
          <div class="meta">${fmtDateRange(ev)}</div>
          ${hasPerm('akce') ? `
          <div class="row" style="margin-top:8px; gap:6px;">
            <button type="button" class="btn-ghost btn-sm" data-edit-history style="flex:1;">Upravit</button>
            <button type="button" class="btn-ghost btn-sm" data-delete-history style="flex:1; color:var(--crimson); border-color:var(--crimson);">Smazat</button>
          </div>` : ''}
        </div>
      `;
      card.addEventListener('click', (e) => {
        if(e.target.closest('[data-edit-history]') || e.target.closest('[data-delete-history]')) return;
        setRoute('#event/' + ev.id);
      });
      const editBtn = card.querySelector('[data-edit-history]');
      if(editBtn) editBtn.addEventListener('click', (e) => { e.stopPropagation(); startEditEvent(ev); });
      const delBtn = card.querySelector('[data-delete-history]');
      if(delBtn) delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteEvent(ev.id, ev.name); });
      hgrid.appendChild(card);
    });
  }
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
  currentTournamentId = null;
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
  document.getElementById('ed-title').textContent = (ev.number ? ev.number + ' — ' : '') + ev.name;
  document.getElementById('ed-meta').textContent = fmtDateRange(ev) + ' · ' + ev.place;
  document.getElementById('ed-desc').textContent = ev.desc || '';

  const header = document.getElementById('ed-header');
  header.style.backgroundImage = ev.imageUrl ? `url('${ev.imageUrl.replace(/'/g,"")}')` : 'none';

  renderEntryFeeBlock(ev);
  renderDateVoteBlock(ev);

  const mapBox = document.getElementById('ed-map');
  const q = encodeURIComponent(ev.place || '');
  mapBox.innerHTML = `<iframe src="https://www.google.com/maps?q=${q}&output=embed" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`;

  const tabPanels = { prehled:'tab-prehled', rozvrh:'tab-rozvrh', jidlo:'tab-jidlo', turnaj:'tab-turnaj', foto:'tab-foto' };
  Object.entries(tabPanels).forEach(([key, id]) => {
    document.getElementById(id).style.display = (key === currentTab) ? 'block' : 'none';
  });
  updateHeaderVisibility();
  document.querySelectorAll('#ed-tabs .tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === currentTab);
    btn.onclick = () => {
      currentTab = btn.dataset.tab;
      document.querySelectorAll('#ed-tabs .tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      Object.entries(tabPanels).forEach(([key, id]) => {
        document.getElementById(id).style.display = (key === currentTab) ? 'block' : 'none';
      });
      updateHeaderVisibility();
      renderActiveTab(ev);
    };
  });

  renderStatsAndRsvp();
  renderAttendees();
  renderActiveTab(ev);
}

function updateHeaderVisibility(){
  const onPrehled = currentTab === 'prehled';
  document.getElementById('ed-header').style.display = onPrehled ? 'flex' : 'none';
  const grid = document.querySelector('.detail-grid');
  const rightCol = document.querySelector('.detail-col-right');
  if(rightCol) rightCol.style.display = onPrehled ? 'block' : 'none';
  if(grid) grid.classList.toggle('no-sidebar', !onPrehled);
}

function renderActiveTab(ev){
  if(currentTab === 'prehled') renderTabPrehled(ev);
  else if(currentTab === 'rozvrh') renderTabRozvrh(ev);
  else if(currentTab === 'jidlo') renderTabJidlo(ev);
  else if(currentTab === 'turnaj') renderTabTurnaj(ev);
  else renderTabFoto(ev);
}

function renderEntryFeeBlock(ev){
  const box = document.getElementById('ed-entryfee');
  if(!ev.fee && !ev.qrUrl){ box.innerHTML = ''; return; }
  box.innerHTML = `
    ${ev.qrUrl ? `<img class="qr-code-img" src="${ev.qrUrl.replace(/"/g,'&quot;')}" alt="QR kód pro platbu" style="margin-bottom:8px;">` : ''}
    ${ev.fee ? `<div style="font-size:28px; font-weight:700; color:var(--gold); text-shadow:0 2px 8px rgba(0,0,0,0.8);">${ev.fee} Kč</div><div style="font-size:13px; font-weight:600; color:var(--gold); text-transform:uppercase; letter-spacing:.08em; text-shadow:0 1px 4px rgba(0,0,0,0.8);">Vstupné</div>` : ''}
  `;
}

function renderDateVoteBlock(ev){
  const box = document.getElementById('ed-datevote');
  const options = ev.dateOptions || [];
  if(options.length === 0 || ev.dateVotingClosed){ box.innerHTML = ''; box.style.display = 'none'; return; }
  box.style.display = 'block';

  const votes = ev.dateVotes || {};
  function votesOf(uid){
    const v = votes[uid];
    if(Array.isArray(v)) return v;
    if(typeof v === 'number') return [v];
    return [];
  }
  const myVotes = currentUser ? votesOf(currentUser.uid) : [];
  const deadlinePassedForVote = ev.dateVoteDeadline && todayIso() > ev.dateVoteDeadline;

  box.className = 'panel';
  box.style.cssText = 'flex:0 0 300px; margin-top:0;';
  box.innerHTML = `
    <div class="section-title" style="font-size:15px;">🗳️ Hlasování o termínu</div>
    <p class="lede" style="margin-top:0; font-size:12px;">Můžeš hlasovat pro víc termínů, které ti vyhovují.</p>
    ${ev.dateVoteDeadline ? `<p class="lede" style="margin-top:0; font-size:13px;">Hlasování otevřené do ${fmtDate(ev.dateVoteDeadline)}.</p>` : ''}
    ${options.map((opt, idx) => {
      const voterNicks = Object.keys(votes).filter(uid => votesOf(uid).includes(idx)).map(uid => currentRegistrationsMap[uid]?.nick || '(neznámý)');
      const isMine = myVotes.includes(idx);
      const countTitle = hasPerm('akce') ? (voterNicks.length ? voterNicks.join('\n') : 'Zatím nikdo') : '';
      return `
        <div class="row" style="margin-top:8px; align-items:center; flex-wrap:wrap;">
          <span style="flex:1; font-size:13px;">${fmtDateShort(opt.start)} – ${fmtDate(opt.end)} <span class="status-hint" title="${escapeHtml(countTitle)}" style="${hasPerm('akce')?'cursor:help; border-bottom:1px dotted var(--text-muted);':''}">(${voterNicks.length} hlasů)</span></span>
          ${currentUser ? `<button type="button" class="btn-sm ${isMine?'btn-active':''}" data-vote-date="${idx}" ${deadlinePassedForVote?'disabled':''}>${isMine?'✓ Hlasováno':'Hlasovat'}</button>` : ''}
          ${hasPerm('akce') ? `<button type="button" class="btn-ghost btn-sm" data-finalize-date="${idx}">Vybrat</button>` : ''}
        </div>
      `;
    }).join('')}
  `;

  box.querySelectorAll('[data-vote-date]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if(!currentUser){ showView('ucet'); return; }
      const idx = parseInt(btn.dataset.voteDate,10);
      const mine = votesOf(currentUser.uid);
      const newVotes = mine.includes(idx) ? mine.filter(i=>i!==idx) : [...mine, idx];
      try{ await updateDoc(doc(db,'events',ev.id), { [`dateVotes.${currentUser.uid}`]: newVotes }); }
      catch(err){ console.error(err); }
    });
  });
  box.querySelectorAll('[data-finalize-date]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.finalizeDate,10);
      const opt = options[idx];
      if(!confirm(`Nastavit termín akce na ${fmtDateShort(opt.start)} – ${fmtDate(opt.end)}?`)) return;
      try{ await updateDoc(doc(db,'events',ev.id), { dateStart: opt.start, dateEnd: opt.end, dateVotingClosed: true, dateUnconfirmed: false }); }
      catch(err){ alert('Nepovedlo se uložit.'); console.error(err); }
    });
  });
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
    rsvpBox.innerHTML = `<button type="button" id="rsvp-login-btn">Přihlásit se na akci</button>`;
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
          nick: currentNick, emoji: currentEmoji, uid: currentUser.uid, status: 'going', food: {}, ts: new Date().toISOString()
        });
      }catch(err){ alert('Přihlášení se nepovedlo.'); console.error(err); }
    });
  }else{
    rsvpBox.innerHTML = `<button type="button" class="btn-ghost" id="rsvp-cancel" ${deadlinePassed ? 'disabled title="Uzávěrka změn už proběhla"' : ''}>Odhlásit se z akce</button>`;
    const cancelBtn = document.getElementById('rsvp-cancel');
    if(cancelBtn) cancelBtn.addEventListener('click', async () => {
      if(!confirm('Opravdu se chceš z akce odhlásit?')) return;
      try{ await deleteDoc(doc(db, 'events', ev.id, 'registrations', currentUser.uid)); }
      catch(err){ alert('Odhlášení se nepovedlo.'); console.error(err); }
    });
  }
}

// ---- Sidebar: statistika nahoře + seznam, vlastní řádek editovatelný ----
function coinSvg(paid){
  const base = paid ? '#f0c94e' : '#8a4a4a';
  const baseDark = paid ? '#c99a2e' : '#5c2a2a';
  const rim  = paid ? '#a5781f' : '#4d2020';
  const coin = (cx, cy, r) => `
    <ellipse cx="${cx}" cy="${cy+1.5}" rx="${r}" ry="${r*0.42}" fill="${rim}" opacity="0.55"/>
    <ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r*0.42}" fill="${base}" stroke="${baseDark}" stroke-width="1"/>
    <ellipse cx="${cx-r*0.3}" cy="${cy-r*0.1}" rx="${r*0.35}" ry="${r*0.14}" fill="#fff" opacity="0.5" class="coin-shine"/>
  `;
  return `
    <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      ${coin(20, 21, 10)}
      ${coin(12, 17, 10)}
      ${coin(17, 12, 10)}
    </svg>
  `;
}

async function openAddAttendeeModal(){
  const eventId = currentDetailEventId;
  const backdrop = document.createElement('div');
  backdrop.className = 'score-modal-backdrop';
  backdrop.innerHTML = `
    <div class="score-modal" style="width:320px;">
      <div style="font-size:14px; font-weight:600;">Přidat účastníka</div>
      <div class="field" style="margin:0;">
        <label>Z registrovaných</label>
        <select id="add-att-select"><option value="">— načítám... —</option></select>
      </div>
      <div class="field" style="margin:0;">
        <label>Nebo napiš jméno ručně</label>
        <input type="text" id="add-att-custom" placeholder="Jméno / přezdívka">
      </div>
      <div style="display:flex; gap:8px;">
        <button type="button" id="add-att-save">Přidat</button>
        <button type="button" class="btn-ghost" id="add-att-cancel">Zrušit</button>
      </div>
      <div class="small-msg" id="add-att-msg"></div>
    </div>
  `;
  document.body.appendChild(backdrop);
  document.getElementById('add-att-cancel').addEventListener('click', () => backdrop.remove());

  const select = document.getElementById('add-att-select');
  try{
    const snap = await getDocs(collection(db,'users'));
    const already = new Set(Object.values(currentRegistrationsMap).map(r=>r._docId));
    const options = snap.docs
      .map(d => ({ uid:d.id, ...d.data() }))
      .filter(u => !already.has(u.uid))
      .sort((a,b) => (a.nick||'').localeCompare(b.nick||''));
    select.innerHTML = `<option value="">— vyber, nebo napiš vlastní níže —</option>` + options.map(u => `<option value="${u.uid}" data-nick="${escapeHtml(u.nick||'')}" data-emoji="${escapeHtml(u.emoji||'')}">${escapeHtml(u.nick||'')}</option>`).join('');
  }catch(err){ select.innerHTML = `<option value="">(nepovedlo se načíst)</option>`; console.error(err); }

  document.getElementById('add-att-save').addEventListener('click', async () => {
    const msg = document.getElementById('add-att-msg');
    const uid = select.value;
    const customName = document.getElementById('add-att-custom').value.trim();
    try{
      if(uid){
        const opt = select.querySelector(`option[value="${uid}"]`);
        await setDoc(doc(db,'events',eventId,'registrations',uid), {
          nick: opt.dataset.nick, emoji: opt.dataset.emoji || '', uid, status:'going', food:{}, ts:new Date().toISOString()
        }, { merge:true });
      }else if(customName){
        await addDoc(collection(db,'events',eventId,'registrations'), {
          nick: customName, status:'going', food:{}, ts:new Date().toISOString(), manual:true
        });
      }else{
        msg.textContent = 'Vyber ze seznamu, nebo napiš jméno.';
        return;
      }
      backdrop.remove();
    }catch(err){ msg.textContent = 'Přidání se nepovedlo.'; console.error(err); }
  });
}

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
  }else{
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
      const coinHtml = (ev && ev.fee)
        ? `<span class="coin-icon ${r.paid ? 'paid' : 'unpaid'} ${hasPerm('akce') ? 'admin-toggle' : ''}" data-toggle-paid="${hasPerm('akce') ? r._docId : ''}" title="${r.paid ? 'Zaplaceno' : 'Nezaplaceno'}">${coinSvg(r.paid)}</span>`
        : '';
      return `
        <div class="attendee-row">
          <span style="display:flex; align-items:center; gap:6px;">${coinHtml}${r.emoji ? escapeHtml(r.emoji)+' ' : ''}${escapeHtml(r.nick || '(bez jména)')}</span>
          <span style="display:flex; align-items:center; gap:6px;">
            ${statusHtml}
            ${(hasPerm('akce') && !isSelf) ? `<button type="button" class="btn-ghost btn-sm" data-remove-attendee="${r._docId}" title="Odebrat" style="padding:2px 7px; color:var(--crimson); border-color:var(--crimson);">×</button>` : ''}
          </span>
        </div>
      `;
    }).join('');
  }

  if(hasPerm('akce')){
    html += `<div style="margin-top:12px; padding-top:10px; border-top:1px solid var(--line);"><button type="button" id="btn-add-manual-attendee" class="btn-ghost btn-sm" style="width:100%;">+ Přidat účastníka</button></div>`;
  }

  box.innerHTML = html;

  const addManualBtn = document.getElementById('btn-add-manual-attendee');
  if(addManualBtn) addManualBtn.addEventListener('click', openAddAttendeeModal);

  box.querySelectorAll('[data-toggle-paid]').forEach(el => {
    if(!el.dataset.togglePaid) return;
    el.addEventListener('click', async () => {
      const r = currentRegistrationsMap[el.dataset.togglePaid];
      try{ await updateDoc(doc(db, 'events', currentDetailEventId, 'registrations', el.dataset.togglePaid), { paid: !r.paid }); }
      catch(err){ console.error(err); }
    });
  });
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
  const games = [...(ev.games || [])].map(normalizeGame).sort((a,b) => a.name.localeCompare(b.name, 'cs'));
  box.innerHTML = `
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:28px;">
      <div>
        <div class="section-title" style="font-size:16px;">Co se bude hrát</div>
        <div class="chip-row" style="flex-direction:column; align-items:flex-start;">${games.length ? games.map(g=>`<span class="chip">${g.image ? `<img src="${g.image.replace(/"/g,'&quot;')}" alt="" class="game-chip-logo">` : ''}${escapeHtml(g.name)}</span>`).join('') : '<span class="empty">Zatím nic nevypsáno.</span>'}</div>
      </div>
      <div>
        <div class="section-title" style="font-size:16px;">Chtěl by sis zahrát ještě něco jiného?</div>
        <div class="field" style="display:flex; flex-direction:row; gap:8px; align-items:flex-end;">
          <div style="flex:1;"><input type="text" id="suggestion-input" placeholder="Např. HALO"></div>
          <button type="button" id="btn-add-suggestion" class="btn-sm">Přidat</button>
        </div>
        <div id="suggestions-list" style="margin-top:6px;"></div>
      </div>
    </div>

    <div class="section-title" style="font-size:16px; margin-top:28px;">Diskuze</div>
    <div class="discussion-block">
      <div class="discussion-list" id="comments-list"></div>
      <div class="discussion-input-row">
        <div class="discussion-input-wrap">
          <textarea class="discussion-input" id="comment-input" placeholder="Napiš příspěvek do diskuze..."></textarea>
          <button type="button" class="emoji-picker-btn" id="emoji-btn-comment" title="Vložit emotikon">🙂</button>
          <div class="emoji-picker-panel" id="emoji-panel-comment" style="display:none;"></div>
        </div>
        <button type="button" id="btn-add-comment" class="btn-sm">Odeslat</button>
      </div>
    </div>
  `;
  setupChatEmojiRow('emoji-btn-comment', 'emoji-panel-comment', 'comment-input');

  renderSuggestions(ev);
  renderComments(ev);

  document.getElementById('btn-add-suggestion').addEventListener('click', async () => {
    if(!currentUser || !currentNick){ showView('ucet'); return; }
    const input = document.getElementById('suggestion-input');
    const text = input.value.trim();
    if(!text) return;
    try{
      await addDoc(collection(db,'events',ev.id,'suggestions'), { text, author: currentNick, authorEmoji: currentEmoji, uid: currentUser.uid, likes: [], likeNicks: [], ts: new Date().toISOString() });
      input.value = '';
    }catch(err){ console.error(err); }
  });

  document.getElementById('btn-add-comment').addEventListener('click', async () => {
    if(!currentUser || !currentNick){ showView('ucet'); return; }
    const input = document.getElementById('comment-input');
    const text = input.value.trim();
    if(!text) return;
    try{
      await addDoc(collection(db,'events',ev.id,'comments'), { text, author: currentNick, authorEmoji: currentEmoji, uid: currentUser.uid, ts: new Date().toISOString() });
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
    const likers = (s.likeNicks||[]).join('\n');
    const canEdit = currentUser && (s.uid === currentUser.uid || hasPerm('akce'));
    return `
    <div class="suggestion-row" data-sug-row="${s.id}">
      <span class="txt" data-sug-display="${s.id}">Hráč: ${authorLabel(s.author, s.authorEmoji)} — ${escapeHtml(s.text)}</span>
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
    const canEdit = currentUser && (c.uid === currentUser.uid || hasPerm('akce'));
    return `
    <div class="comment-row" data-comment-row="${c.id}">
      <span class="who">${authorLabel(c.author, c.authorEmoji)}</span><span class="when">${c.ts ? new Date(c.ts).toLocaleDateString('cs-CZ') : ''}</span>
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

  commentsList.scrollTop = commentsList.scrollHeight;
}

// ---- Jídlo: zaškrtávací výběr + potvrzení + počty porcí pro admina ----
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
    const dayGroups = [];
    activeSlots.forEach(slot => {
      let grp = dayGroups.find(g => g.day === slot.day);
      if(!grp){ grp = { day: slot.day, slots: [] }; dayGroups.push(grp); }
      grp.slots.push(slot);
    });

    slotsHtml = '<div class="food-day-columns">' + dayGroups.map(grp => `
      <div class="food-day-column">
        <div class="food-day-heading">${escapeHtml(grp.day)}</div>
        ${grp.slots.map(slot => {
          const options = schedule[slot.key];
          const myChoices = (myReg && myReg.food && Array.isArray(myReg.food[slot.key])) ? myReg.food[slot.key] : [];

          const portionCounts = {};
          options.forEach(o => portionCounts[o] = 0);
          Object.values(currentRegistrationsMap).forEach(r => {
            if(r.food && Array.isArray(r.food[slot.key])){
              r.food[slot.key].forEach(o => { if(portionCounts[o] !== undefined) portionCounts[o]++; });
            }
          });

          const checkboxesHtml = options.map((o,idx) => `
            <label class="food-checkbox-row">
              <span class="food-toggle ${myChoices.includes(o)?'checked':''} ${(!myReg || deadlinePassed) ? 'disabled' : ''}" data-food-toggle data-slot="${slot.key}" data-value="${escapeHtml(o)}">
                <svg viewBox="0 0 26 26" class="food-toggle-svg">
                  <polygon points="6.5,1.5 19.5,1.5 25,13 19.5,24.5 6.5,24.5 1,13"/>
                  <path class="food-check" d="M7.5 13.5l3.3 3.3 7.7-7.7"/>
                </svg>
              </span>
              <span>${escapeHtml(o)}</span>
              ${hasPerm('jidlo') ? `<span class="portion-count">${portionCounts[o]}×</span>` : ''}
            </label>
          `).join('');

          return `
            <div class="meal-slot-block" style="margin-bottom:18px;">
              <b style="font-size:13px;">${slot.label.includes('—') ? slot.label.split('—')[1].trim() : slot.label}</b>
              <div style="margin-top:6px;">${myReg ? checkboxesHtml : '<span class="status-hint">Přihlas se na akci, ať můžeš vybrat.</span>'}</div>
            </div>
          `;
        }).join('')}
      </div>
    `).join('') + '</div>';
  }

  box.innerHTML = `
    <div class="section-title" style="font-size:16px;">Plán jídla</div>
    <p class="lede" style="margin-top:0;">${escapeHtml(ev.foodPlan || 'Zatím nic naplánováno.')}</p>
    ${deadlinePassed ? '<p class="status-hint">Uzávěrka změn proběhla — výběr už nejde měnit.</p>' : ''}
    ${slotsHtml}
    ${(myReg && activeSlots.length > 0 && !deadlinePassed) ? `
      <div class="food-confirm-row">
        <button type="button" id="btn-confirm-food">Potvrdit menu</button>
        <span class="small-msg" id="food-confirm-msg"></span>
      </div>` : ''}

    <div class="section-title" style="font-size:16px; margin-top:28px;">Diskuze k jídlu</div>
    <div class="discussion-block">
      <div class="discussion-list" id="food-comments-list"></div>
      <div class="discussion-input-row">
        <div class="discussion-input-wrap">
          <textarea class="discussion-input" id="food-comment-input" placeholder="Kdo co doveze, návrhy..."></textarea>
          <button type="button" class="emoji-picker-btn" id="emoji-btn-food" title="Vložit emotikon">🙂</button>
          <div class="emoji-picker-panel" id="emoji-panel-food" style="display:none;"></div>
        </div>
        <button type="button" id="btn-add-food-comment" class="btn-sm">Odeslat</button>
      </div>
    </div>
  `;
  setupChatEmojiRow('emoji-btn-food', 'emoji-panel-food', 'food-comment-input');

  box.querySelectorAll('[data-food-toggle]').forEach(el => {
    if(el.classList.contains('disabled')) return;
    el.addEventListener('click', () => {
      el.classList.toggle('checked');
    });
  });

  const confirmBtn = document.getElementById('btn-confirm-food');
  if(confirmBtn) confirmBtn.addEventListener('click', async () => {
    const newFood = {};
    activeSlots.forEach(slot => {
      const checked = Array.from(box.querySelectorAll(`[data-food-toggle][data-slot="${slot.key}"].checked`)).map(el => el.dataset.value);
      newFood[slot.key] = checked;
    });
    confirmBtn.disabled = true;
    try{
      await updateDoc(doc(db,'events',ev.id,'registrations',currentUser.uid), { food: newFood });
      document.getElementById('food-confirm-msg').textContent = 'Menu uloženo.';
    }catch(err){
      alert('Nepovedlo se uložit.'); console.error(err);
    }finally{
      confirmBtn.disabled = false;
    }
  });

  const foodCommentsList = document.getElementById('food-comments-list');
  foodCommentsList.innerHTML = currentFoodComments.length === 0
    ? '<div class="empty">Zatím žádná diskuze.</div>'
    : currentFoodComments.map(c => {
        const canEdit = currentUser && (c.uid === currentUser.uid || hasPerm('jidlo'));
        return `
        <div class="comment-row" data-food-comment-row="${c.id}">
          <span class="who">${authorLabel(c.author, c.authorEmoji)}</span><span class="when">${c.ts ? new Date(c.ts).toLocaleDateString('cs-CZ') : ''}</span>
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

  foodCommentsList.scrollTop = foodCommentsList.scrollHeight;

  document.getElementById('btn-add-food-comment').addEventListener('click', async () => {
    if(!currentUser || !currentNick){ showView('ucet'); return; }
    const input = document.getElementById('food-comment-input');
    const text = input.value.trim();
    if(!text) return;
    try{
      await addDoc(collection(db,'events',ev.id,'foodComments'), { text, author: currentNick, authorEmoji: currentEmoji, uid: currentUser.uid, ts: new Date().toISOString() });
      input.value = '';
    }catch(err){ console.error(err); }
  });
}

// ---- Turnaj: samostatná kolekce, propojená s konkrétní akcí přes eventId ----
let allTournaments = [];
let currentTournamentId = null;
let turnajDrawToolOpen = false;
const TEAM_EMBLEMS = ['🛡️','⚔️','🐺','🦅','🔥','💀','👑','🌙','⭐','🐉','🦁','🍀','🐍','🦂','⚡','🎯'];
const TEAM_COLORS = ['#e8e3d8','#c9a24b','#8b2635','#2f8f8f','#4a90d9','#9b59b6','#e67e22','#2ecc71','#e84393','#95a5a6'];

onSnapshot(collection(db, 'tournaments'), (snap) => {
  allTournaments = snap.docs.map(d => ({ id:d.id, ...d.data() }));
  if(document.getElementById('view-turnaj')?.classList.contains('active')) renderTurnajPage();
  if(currentDetailEventId && currentTab === 'turnaj'){
    const ev = events.find(x=>x.id===currentDetailEventId);
    if(ev) renderTabTurnaj(ev);
  }
  tryInitialRoute();
});

function teamName(t, idx){ return t.teams[idx] ? t.teams[idx].name : `Tým ${idx+1}`; }

// ---- Horní stránka "Turnaj" (celostránkové zobrazení, správa) ----
function renderTurnajPage(){
  const box = document.getElementById('view-turnaj-content');
  if(!box) return;

  if(turnajDrawToolOpen){
    renderTeamDrawTool(box);
    return;
  }

  if(currentTournamentId){
    const t = allTournaments.find(x => x.id === currentTournamentId);
    if(!t){ currentTournamentId = null; if(location.hash !== '#turnaj') location.hash = '#turnaj'; renderTurnajPage(); return; }
    const ev = events.find(x => x.id === t.eventId);
    const swissPreview = computeSwissTournament(t);
    box.innerHTML = `
      <div class="tourney-main-row">
        <div class="tourney-bracket-col">
          <div class="bracket-scale-wrap" id="turnaj-detail-body"></div>
        </div>
        <div class="tourney-title-corner">
          <div class="tourney-title-top">
            ${ev ? `<div class="status-hint">${escapeHtml(ev.name)}</div>` : ''}
            <h1 class="headline" style="font-size:22px;">${escapeHtml(t.name)}</h1>
            ${t.imageUrl ? `<img src="${t.imageUrl.replace(/"/g,'&quot;')}" alt="" class="tourney-title-image">` : ''}
          </div>
          <div class="tourney-title-result" id="tourney-title-result"></div>
        </div>
      </div>
      <div class="tourney-corner-actions" id="tourney-corner-actions"></div>
    `;

    const cornerActions = document.getElementById('tourney-corner-actions');
    if(hasPerm('turnaj')){
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'btn-ghost btn-sm';
      toggleBtn.textContent = 'Upravit týmy';
      toggleBtn.addEventListener('click', () => openTeamEditorModal(t));
      cornerActions.appendChild(toggleBtn);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-ghost btn-sm';
      delBtn.style.cssText = 'color:var(--crimson); border-color:var(--crimson);';
      delBtn.textContent = 'Smazat turnaj';
      delBtn.addEventListener('click', async () => {
        if(!confirm(`Opravdu smazat turnaj "${t.name}"? Tohle nejde vrátit zpět.`)) return;
        try{ await deleteDoc(doc(db,'tournaments',t.id)); currentTournamentId = null; if(location.hash !== '#turnaj') location.hash = '#turnaj'; }
        catch(err){ alert('Smazání se nepovedlo.'); console.error(err); }
      });
      cornerActions.appendChild(delBtn);
    }
    if(swissPreview.placements.length > 0){
      const resultBtn = document.createElement('button');
      resultBtn.type = 'button';
      resultBtn.className = 'btn-sm';
      resultBtn.textContent = '🏆 Výsledek turnaje';
      resultBtn.addEventListener('click', () => openTournamentResultModal(t, swissPreview));
      document.getElementById('tourney-title-result').appendChild(resultBtn);
    }

    const bodyWrap = document.getElementById('turnaj-detail-body');

    const swiss = computeSwissTournament(t);
    renderSwissBody(t, swiss, bodyWrap, false);
    return;
  }

  // seznam turnajů
  let html = `<div class="toolbar"><div><h1 class="headline" style="font-size:28px;">Turnaj</h1></div><div style="display:flex; gap:10px;">`;
  html += hasPerm('turnaj') ? `<button type="button" class="btn-ghost" id="btn-open-draw-tool">🎰 Losovačka týmů</button>` : '';
  html += hasPerm('turnaj') ? `<button type="button" id="btn-new-tourney-page">+ Nový turnaj</button>` : '';
  html += `</div></div><div id="turnaj-form-slot"></div><div class="grid" id="turnaj-list-grid" style="margin-top:24px;"></div>`;
  box.innerHTML = html;

  const drawToolBtn = document.getElementById('btn-open-draw-tool');
  if(drawToolBtn) drawToolBtn.addEventListener('click', () => { turnajDrawToolOpen = true; renderTurnajPage(); });

  const newBtn = document.getElementById('btn-new-tourney-page');
  if(newBtn) newBtn.addEventListener('click', () => openNewTournamentForm());

  const grid = document.getElementById('turnaj-list-grid');
  if(allTournaments.length === 0){
    grid.innerHTML = '<div class="empty">Zatím žádný turnaj nebyl založen.</div>';
    return;
  }
  grid.innerHTML = allTournaments.map(t => {
    const ev = events.find(x => x.id === t.eventId);
    const swiss = computeSwissTournament(t);
    const champion = swiss.placements.find(p => p.rank === 1);
    let statusTxt = 'Základní část se ještě hraje';
    if(champion) statusTxt = `🏆 Vítěz: ${escapeHtml(teamName(t, champion.team))}`;
    return `
      <div class="event-card" data-open-tourney="${t.id}">
        <div style="display:flex; align-items:center; gap:10px;">
          ${t.imageUrl ? `<img src="${t.imageUrl.replace(/"/g,'&quot;')}" alt="" style="width:36px; height:36px; object-fit:cover; border-radius:50%; border:1px solid var(--gold-dim); flex-shrink:0;">` : ''}
          <span class="tag">${(t.teams||[]).length} týmů</span>
        </div>
        <h3>${escapeHtml(t.name)}</h3>
        <div class="meta">${ev ? escapeHtml(ev.name) : 'Bez přiřazené akce'}</div>
        <p class="desc">${statusTxt}</p>
        ${hasPerm('turnaj') ? `
        <div class="row" style="margin-top:2px;">
          <button type="button" class="btn-ghost btn-sm" data-edit-tourney="${t.id}" style="flex:1;">Upravit</button>
          <button type="button" class="btn-ghost btn-sm" data-delete-tourney="${t.id}" style="flex:1; color:var(--crimson); border-color:var(--crimson);">Smazat</button>
        </div>` : ''}
      </div>
    `;
  }).join('');
  grid.querySelectorAll('[data-open-tourney]').forEach(card => {
    card.addEventListener('click', (e) => {
      if(e.target.closest('[data-edit-tourney]') || e.target.closest('[data-delete-tourney]')) return;
      setRoute('#turnaj/' + card.dataset.openTourney);
    });
  });
  grid.querySelectorAll('[data-edit-tourney]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const t = allTournaments.find(x => x.id === btn.dataset.editTourney);
      if(t) openNewTournamentForm(t);
    });
  });
  grid.querySelectorAll('[data-delete-tourney]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const t = allTournaments.find(x => x.id === btn.dataset.deleteTourney);
      if(!t) return;
      if(!confirm(`Opravdu smazat turnaj "${t.name}"? Tohle nejde vrátit zpět.`)) return;
      try{ await deleteDoc(doc(db,'tournaments',t.id)); }
      catch(err){ alert('Smazání se nepovedlo.'); console.error(err); }
    });
  });
}

function openNewTournamentForm(existing){
  const slot = document.getElementById('turnaj-form-slot');
  const evOptions = [...events].sort((a,b) => (b.dateStart||'').localeCompare(a.dateStart||''));
  const isEdit = !!existing;
  slot.innerHTML = `
    <form class="panel" id="form-new-tourney">
      <div class="field"><label>Název turnaje</label><input type="text" id="new-tourney-name" placeholder="Hlavní Dota turnaj" value="${isEdit?escapeHtml(existing.name):''}" required></div>
      <div class="field"><label>Akce (nepovinné)</label><select id="new-tourney-event">
        <option value="">— bez přiřazené akce —</option>
        ${evOptions.map(e=>`<option value="${e.id}" ${isEdit && existing.eventId===e.id?'selected':''}>${escapeHtml(e.name)}${e.dateEnd < todayIso() ? ' (proběhlo)' : ''}</option>`).join('')}
      </select></div>
      ${isEdit ? '' : `<div class="field"><label>Počet týmů</label><input type="number" id="new-tourney-count" min="2" value="4"></div>`}
      <div class="field"><label>URL obrázku turnaje (nepovinné)</label><input type="url" id="new-tourney-image" value="${isEdit?escapeHtml(existing.imageUrl||''):''}"></div>
      <div style="display:flex; gap:10px;">
        <button type="submit">${isEdit ? 'Uložit změny' : 'Vytvořit'}</button>
        <button type="button" class="btn-ghost" id="btn-cancel-new-tourney">Zrušit</button>
      </div>
    </form>
  `;
  slot.scrollIntoView({ behavior:'smooth', block:'start' });
  document.getElementById('btn-cancel-new-tourney').addEventListener('click', () => { slot.innerHTML = ''; });
  document.getElementById('form-new-tourney').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('new-tourney-name').value.trim();
    const eventId = document.getElementById('new-tourney-event').value;
    const imageUrl = document.getElementById('new-tourney-image').value.trim();
    if(!name) return;
    try{
      if(isEdit){
        await updateDoc(doc(db,'tournaments',existing.id), { name, eventId, imageUrl });
      }else{
        const count = Math.max(2, parseInt(document.getElementById('new-tourney-count').value,10)||2);
        const teams = [];
        for(let i=0;i<count;i++) teams.push({ name:`Tým ${i+1}`, members:[], emblem:'' });
        const docRef = await addDoc(collection(db,'tournaments'), { name, eventId, teams, results:{}, swissResults:{}, imageUrl, createdAt: new Date().toISOString() });
        currentTournamentId = docRef.id;
      }
      slot.innerHTML = '';
      renderTurnajPage();
    }catch(err){ alert('Uložení se nepovedlo.'); console.error(err); }
  });
}

// ==================== LOSOVAČKA TÝMŮ (výherní automat) ====================
let tbPlayers = [];
let tbSoundEnabled = true;
let tbAudioCtx = null;
let tbDraftInProgress = false;
let tbEventQueue = Promise.resolve();
let tbPendingEvents = [];
let tbBatchTimer = null;
const TB_BATCH_WINDOW = 2000;
let tbSelectedVoiceURI = '';
let tbCurrentDraft = null;
let tbSpinBusy = false;
let tbDraftCancelled = false;
const TB_REEL_ITEM_H = 58;

const TB_SHOT_ICON = `<svg class="tb-icon-inline" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 4 L17 4 L14.5 17 Q10 19 5.5 17 Z" fill="#f2a71b" stroke="#1a1a1a" stroke-width="1.6"/>
    <rect x="7" y="6" width="1.6" height="8" fill="#fff" opacity="0.7"/>
    <rect x="10.5" y="6" width="1.6" height="8" fill="#fff" opacity="0.5"/>
</svg>`;
const TB_JOINT_ICON = `<svg class="tb-icon-inline" viewBox="0 0 28 10" xmlns="http://www.w3.org/2000/svg">
    <path d="M2 4 Q0.3 5 2 6 L20 6 Q22 5 20 4 Z" fill="#f2efe6" stroke="#8a8a8a" stroke-width="0.5"/>
    <ellipse cx="8" cy="5" rx="2.2" ry="1" fill="#d9d5c8" opacity="0.5"/>
    <ellipse cx="14" cy="5" rx="2.5" ry="1" fill="#dcd8cc" opacity="0.5"/>
    <ellipse cx="23" cy="5" rx="3.4" ry="2.6" fill="#ff6a3d"/>
    <ellipse cx="23" cy="5" rx="5" ry="4" fill="#ff6a3d" opacity="0.3"/>
</svg>`;

function tbCalculateCurrentSkill(player) {
    let skill = player.baseSkill;
    skill *= Math.pow(0.94, player.beers);
    skill *= Math.pow(0.91, player.shots);
    skill *= Math.pow(0.85, player.joints);
    return Math.max(5, Math.round(skill));
}

async function tbSaveSkill(name, skill){
  try{ await setDoc(doc(db,'playerSkills', name.toLowerCase()), { skill, name }); }catch(err){ console.error(err); }
}
async function tbLoadSkill(name){
  try{
    const snap = await getDoc(doc(db,'playerSkills', name.toLowerCase()));
    return snap.exists() ? snap.data().skill : null;
  }catch(err){ return null; }
}

function tbAddPlayerObj(name, baseSkill){
  if(tbPlayers.some(p => p.name.toLowerCase() === name.toLowerCase())){ return; }
  tbPlayers.push({ id: Date.now()+Math.random(), name, baseSkill, beers:0, shots:0, joints:0 });
  tbSaveSkill(name, baseSkill);
  tbRenderPlayers();
}

function tbRemovePlayer(id) {
    tbPlayers = tbPlayers.filter(p => p.id !== id);
    tbRenderPlayers();
}

const tbBeerUpMsgs = [
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
const tbBeerDownMsgs = [
    "{name} vystřízlivěl (aspoň trochu)",
    "{name} to pivo raději vylil, moudré rozhodnutí",
    "{name} našel v sobě sílu říct dost",
    "{name} si to rozmyslel, forma se vrací",
    "{name} vyměnil pivo za vodu, respekt",
    "{name} se rozhodl hrát fér a bez piva",
    "{name} zpytuje svědomí a odkládá sklenici",
    "{name} sype popel na hlavu a střízliví"
];
const tbShotUpMsgs = [
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
const tbShotDownMsgs = [
    "{name} nechal panáka na stole, moudrost vítězí",
    "{name} panáka radši vylil zpátky do lahve",
    "{name} se rozhodl přibrzdit",
    "{name} si řekl dost, forma se vrací",
    "{name} panáka věnoval kamarádovi",
    "{name} zvolil cestu střízlivosti",
    "{name} nechal sklenku plnou, tým děkuje",
    "{name} se semkl a nedal si další"
];
const tbJointUpMsgs = [
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
const tbJointDownMsgs = [
    "{name} to uhasil, jde zpátky do formy",
    "{name} si to rozmyslel a joint uhasil",
    "{name} se probral z cloudu",
    "{name} se vrací zpátky na zem",
    "{name} joint raději věnoval sousedům",
    "{name} volí čistou hlavu",
    "{name} uhasil a je zase při smyslech",
    "{name} se semkl, forma stoupá"
];
const tbBeerCollectiveMsgs = [
    "{names} si dávají rundu piva, tým se boří rychleji než síť",
    "{names} zvedají čepované, formy padají jak podzimní listí",
    "{names} slaví další kolo piva, kapitán pláče",
    "{names} si přiťukli, skilly kolektivně klesají",
    "{names} objednali rundu, tahle hra už nebude fér",
    "{names} mají žízeň jako poušť, hra bez nich by šla líp",
    "{names} pijí na kuráž, kuráž je, skill není",
    "{names} se semkli u dalšího piva, tým se pomalu rozpadá"
];
const tbShotCollectiveMsgs = [
    "{names} si dávají rundu panáků, reakce jdou spát",
    "{names} to sráží na ex, tým sráží skóre",
    "{names} připíjí na vítězství, které se pomalu vzdaluje",
    "{names} mají po panáku oči jak návarky",
    "{names} slaví frťanem, protivníci se smějí",
    "{names} si dali frťana na kuráž, kuráž je, mířidla nejsou",
    "{names} zvládli panáka bez grimasy, formu ne",
    "{names} si připíjí, tým si připlácí"
];
const tbJointCollectiveMsgs = [
    "{names} se zapálili společně, handicap roste jako lavina",
    "{names} jsou v cloudu devět, real-life bohužel ne",
    "{names} si zapálili a zapomněli, že hrají ranked",
    "{names} plavou v pohodě, tým plave v problémech",
    "{names} objevili vesmír, ztratili mapu",
    "{names} jsou naprosto chill, tým je naprosto v podzemí",
    "{names} se nadechli inspirace, ztratili koordinaci",
    "{names} mají najednou filozofické myšlenky místo callů"
];
function tbJoinNamesCz(names) {
    if (names.length === 1) return names[0];
    if (names.length === 2) return names[0] + ' a ' + names[1];
    return names.slice(0, -1).join(', ') + ' a ' + names[names.length - 1];
}
function tbPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function tbShuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
function tbSleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function tbEnsureAudio() {
    if (!tbAudioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) tbAudioCtx = new Ctx();
    }
}
function tbPlayBeep(freq, dur, type) {
    if (!tbSoundEnabled) return;
    try {
        tbEnsureAudio();
        if (!tbAudioCtx) return;
        const osc = tbAudioCtx.createOscillator();
        const gain = tbAudioCtx.createGain();
        osc.type = type || 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.14, tbAudioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, tbAudioCtx.currentTime + dur);
        osc.connect(gain); gain.connect(tbAudioCtx.destination);
        osc.start(); osc.stop(tbAudioCtx.currentTime + dur);
    } catch (e) { /* ticho, když audio nejde */ }
}
function tbSpeak(text) {
    if (!tbSoundEnabled) return;
    try {
        if (!('speechSynthesis' in window)) return;
        const utter = new SpeechSynthesisUtterance(text);
        utter.rate = 1.0; utter.pitch = 1.0;
        const voices = speechSynthesis.getVoices();
        let voice = null;
        if (tbSelectedVoiceURI) voice = voices.find(v => v.voiceURI === tbSelectedVoiceURI);
        if (!voice) voice = voices.find(v => v.lang && v.lang.toLowerCase().startsWith('cs'));
        if (voice) { utter.voice = voice; utter.lang = voice.lang; } else { utter.lang = 'cs-CZ'; }
        speechSynthesis.speak(utter);
    } catch (e) { /* ticho */ }
}
function tbPopulateVoiceList() {
    try {
        const select = document.getElementById('tbVoiceSelect');
        if (!select || !('speechSynthesis' in window)) return;
        const voices = speechSynthesis.getVoices();
        if (!voices.length) return;
        const current = select.value;
        select.innerHTML = '<option value="">Výchozí hlas</option>';
        const sorted = [...voices].sort((a, b) => {
            const aCs = a.lang && a.lang.toLowerCase().startsWith('cs') ? 0 : 1;
            const bCs = b.lang && b.lang.toLowerCase().startsWith('cs') ? 0 : 1;
            if (aCs !== bCs) return aCs - bCs;
            return a.name.localeCompare(b.name);
        });
        sorted.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.voiceURI;
            opt.textContent = `${v.name} (${v.lang})`;
            select.appendChild(opt);
        });
        if (current) select.value = current;
    } catch (e) { /* ticho */ }
}
if ('speechSynthesis' in window) {
    speechSynthesis.onvoiceschanged = tbPopulateVoiceList;
}

function tbPlayGulpSound() {
    if (!tbSoundEnabled) return;
    try {
        tbEnsureAudio();
        if (!tbAudioCtx) return;
        const t0 = tbAudioCtx.currentTime;
        const osc = tbAudioCtx.createOscillator();
        const gain = tbAudioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(190, t0);
        osc.frequency.exponentialRampToValueAtTime(85, t0 + 0.16);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
        osc.connect(gain); gain.connect(tbAudioCtx.destination);
        osc.start(t0); osc.stop(t0 + 0.22);
    } catch (e) { /* ticho */ }
}
function tbPlayClink() {
    if (!tbSoundEnabled) return;
    try {
        tbEnsureAudio();
        if (!tbAudioCtx) return;
        const t0 = tbAudioCtx.currentTime;
        const osc = tbAudioCtx.createOscillator();
        const gain = tbAudioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1500, t0);
        gain.gain.setValueAtTime(0.001, t0);
        gain.gain.exponentialRampToValueAtTime(0.15, t0 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
        osc.connect(gain); gain.connect(tbAudioCtx.destination);
        osc.start(t0); osc.stop(t0 + 0.27);
    } catch (e) { /* ticho */ }
}
function tbPlaySizzle(durationSec) {
    if (!tbSoundEnabled) return;
    try {
        tbEnsureAudio();
        if (!tbAudioCtx) return;
        const bufferSize = Math.floor(tbAudioCtx.sampleRate * durationSec);
        const buffer = tbAudioCtx.createBuffer(1, bufferSize, tbAudioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) { data[i] = (Math.random() * 2 - 1) * 0.6; }
        const noise = tbAudioCtx.createBufferSource();
        noise.buffer = buffer;
        const filter = tbAudioCtx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 3200;
        filter.Q.value = 0.6;
        const gain = tbAudioCtx.createGain();
        const t0 = tbAudioCtx.currentTime;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.045, t0 + 0.3);
        gain.gain.setValueAtTime(0.045, t0 + Math.max(0.3, durationSec - 0.4));
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durationSec);
        noise.connect(filter); filter.connect(gain); gain.connect(tbAudioCtx.destination);
        noise.start(t0); noise.stop(t0 + durationSec);
    } catch (e) { /* ticho */ }
}
async function tbDrinkWithGulps(totalMs, gulps) {
    const interval = totalMs / gulps;
    for (let i = 0; i < gulps; i++) {
        tbPlayGulpSound();
        await tbSleep(interval);
    }
}
function tbPlayReelTick() {
    if (!tbSoundEnabled) return;
    try {
        tbEnsureAudio();
        if (!tbAudioCtx) return;
        const t0 = tbAudioCtx.currentTime;
        const osc = tbAudioCtx.createOscillator();
        const gain = tbAudioCtx.createGain();
        osc.type = 'square';
        osc.frequency.value = 480 + Math.random() * 260;
        gain.gain.setValueAtTime(0.045, t0);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.035);
        osc.connect(gain); gain.connect(tbAudioCtx.destination);
        osc.start(t0); osc.stop(t0 + 0.04);
    } catch (e) { /* ticho */ }
}
function tbPlayLandSound(pitch) {
    tbPlayBeep(pitch, 0.14, 'triangle');
    setTimeout(() => tbPlayBeep(pitch * 1.5, 0.12, 'triangle'), 90);
}

function tbBeerSVG() {
    return `
    <svg class="tb-event-svg" viewBox="0 0 120 140" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="tbBeerGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#ffd873"/>
                <stop offset="100%" stop-color="#e29b1f"/>
            </linearGradient>
            <clipPath id="tbBeerClip"><rect x="20" y="34" width="64" height="92" rx="8"/></clipPath>
        </defs>
        <rect x="18" y="32" width="68" height="96" rx="10" fill="#0c1327" stroke="#2b2b2b" stroke-width="3"/>
        <path d="M86 52 h16 a14 14 0 0 1 0 48 h-16" fill="none" stroke="#2b2b2b" stroke-width="4"/>
        <g clip-path="url(#tbBeerClip)">
            <rect class="tb-beer-liquid" x="20" y="46" width="64" height="80" fill="url(#tbBeerGrad)"/>
            <rect x="34" y="46" width="4" height="80" fill="#fff2c2" opacity="0.35"/>
            <rect x="54" y="46" width="3" height="80" fill="#fff2c2" opacity="0.25"/>
            <rect x="68" y="46" width="4" height="80" fill="#fff2c2" opacity="0.3"/>
            <path class="tb-beer-foam" d="M20 40 Q26 24 34 38 Q42 20 52 38 Q60 22 68 38 Q76 22 84 38 L84 50 L20 50 Z" fill="#fff8ea"/>
        </g>
    </svg>`;
}
function tbBeerSVGCalm() {
    return `
    <svg class="tb-event-svg" viewBox="0 0 120 140" xmlns="http://www.w3.org/2000/svg">
        <rect x="18" y="32" width="68" height="96" rx="10" fill="#0c1327" stroke="#0fbc7c" stroke-width="3"/>
        <path d="M86 52 h16 a14 14 0 0 1 0 48 h-16" fill="none" stroke="#0fbc7c" stroke-width="4"/>
        <rect x="20" y="100" width="64" height="26" fill="#e29b1f" opacity="0.5"/>
        <path d="M20 40 Q26 24 34 38 Q42 20 52 38 Q60 22 68 38 Q76 22 84 38 L84 50 L20 50 Z" fill="#fff8ea" opacity="0.5"/>
    </svg>`;
}
function tbShotSVG() {
    return `
    <svg class="tb-event-svg tb-shot-svg-tip" viewBox="0 0 120 110" xmlns="http://www.w3.org/2000/svg">
        <defs><clipPath id="tbShotClip2"><path d="M20 28 L100 28 L91 98 Q60 108 29 98 Z"/></clipPath></defs>
        <path d="M20 28 L100 28 L91 98 Q60 108 29 98 Z" fill="none" stroke="#111" stroke-width="5"/>
        <g clip-path="url(#tbShotClip2)">
            <rect class="tb-shot-liquid2" x="20" y="30" width="80" height="70" fill="#f2a71b"/>
        </g>
        <rect x="38" y="34" width="6" height="55" fill="#fff" opacity="0.7"/>
        <rect x="54" y="34" width="6" height="55" fill="#fff" opacity="0.5"/>
    </svg>`;
}
function tbShotSVGCalm() {
    return `
    <svg class="tb-event-svg" viewBox="0 0 120 110" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 28 L100 28 L91 98 Q60 108 29 98 Z" fill="none" stroke="#0fbc7c" stroke-width="5"/>
    </svg>`;
}
function tbJointSVG() {
    return `
    <svg class="tb-event-svg" viewBox="0 0 220 60" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="tbPaperGrad3" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#fbf8ee"/>
                <stop offset="50%" stop-color="#e9e3d0"/>
                <stop offset="100%" stop-color="#d6cfb8"/>
            </linearGradient>
            <radialGradient id="tbEmberGrad3" cx="35%" cy="35%" r="65%">
                <stop offset="0%" stop-color="#fff6d0"/>
                <stop offset="30%" stop-color="#ffb347"/>
                <stop offset="65%" stop-color="#e2571c"/>
                <stop offset="100%" stop-color="#7a2408"/>
            </radialGradient>
        </defs>
        <g class="tb-joint-body-group3">
            <path d="M14 30 Q4 30 14 23 L14 37 Q4 30 14 30 Z" fill="#efe9d8" stroke="#a89f86" stroke-width="1"/>
            <rect x="14" y="22" width="160" height="16" rx="8" fill="url(#tbPaperGrad3)" stroke="#a89f86" stroke-width="1.2"/>
            <line x1="45" y1="23.5" x2="45" y2="36.5" stroke="#bdb495" stroke-width="0.8" opacity="0.6"/>
            <line x1="80" y1="23.5" x2="80" y2="36.5" stroke="#bdb495" stroke-width="0.8" opacity="0.6"/>
            <line x1="115" y1="23.5" x2="115" y2="36.5" stroke="#bdb495" stroke-width="0.8" opacity="0.6"/>
            <line x1="150" y1="23.5" x2="150" y2="36.5" stroke="#bdb495" stroke-width="0.8" opacity="0.6"/>
        </g>
        <g class="tb-joint-ember-group3">
            <ellipse class="tb-joint-glow3" cx="182" cy="30" rx="19" ry="17" fill="#ff8a3d" opacity="0.28"/>
            <circle cx="182" cy="30" r="11" fill="#3a2a20"/>
            <circle cx="182" cy="30" r="9" fill="url(#tbEmberGrad3)"/>
            <circle class="tb-joint-flicker3" cx="182" cy="30" r="5" fill="#fff2c2" opacity="0.7"/>
            <circle class="tb-ash-fleck tb-f1" cx="188" cy="42" r="1.4" fill="#8a8a8a"/>
            <circle class="tb-ash-fleck tb-f2" cx="179" cy="44" r="1" fill="#8a8a8a"/>
            <g class="tb-joint-smoke2">
                <path class="tb-smoke-path tb-s1" d="M182 15 q-5 -10 3 -18 q6 -7 -1 -16" fill="none" stroke="#d7dde5" stroke-width="2.4" stroke-linecap="round"/>
                <path class="tb-smoke-path tb-s2" d="M190 17 q6 -9 -3 -17 q-6 -7 2 -15" fill="none" stroke="#d7dde5" stroke-width="1.8" stroke-linecap="round"/>
            </g>
        </g>
    </svg>`;
}
function tbJointSVGCalm() {
    return `
    <svg class="tb-event-svg" viewBox="0 0 220 60" xmlns="http://www.w3.org/2000/svg">
        <rect x="14" y="22" width="160" height="16" rx="8" fill="#efe9d8" stroke="#0fbc7c" stroke-width="1.2"/>
        <ellipse cx="182" cy="30" rx="6" ry="5" fill="#a0aec0"/>
    </svg>`;
}

function tbBeerModalHTML(name, msg) { return `<div class="tb-event-title">🍺 ${escapeHtml(name)} si dává pivo!</div>${tbBeerSVG()}<div class="tb-event-message tb-show" id="tbEventMessage">${escapeHtml(msg)}</div>`; }
function tbBeerModalCalmHTML(name, msg) { return `<div class="tb-event-title">🍺 ${escapeHtml(name)} slaví střízlivost!</div>${tbBeerSVGCalm()}<div class="tb-event-message tb-show" id="tbEventMessage">${escapeHtml(msg)}</div>`; }
function tbShotModalHTML(name, msg) { return `<div class="tb-event-title">🥃 ${escapeHtml(name)} si dává panáka!</div>${tbShotSVG()}<div class="tb-event-message tb-show" id="tbEventMessage">${escapeHtml(msg)}</div>`; }
function tbShotModalCalmHTML(name, msg) { return `<div class="tb-event-title">🥃 ${escapeHtml(name)} nechal panáka být!</div>${tbShotSVGCalm()}<div class="tb-event-message tb-show" id="tbEventMessage">${escapeHtml(msg)}</div>`; }
function tbJointModalHTML(name, msg) { return `<div class="tb-event-title">🍁 ${escapeHtml(name)} si zapaluje jointa!</div>${tbJointSVG()}<div class="tb-event-message tb-show" id="tbEventMessage">${escapeHtml(msg)}</div>`; }
function tbJointModalCalmHTML(name, msg) { return `<div class="tb-event-title">🍁 ${escapeHtml(name)} to uhasil!</div>${tbJointSVGCalm()}<div class="tb-event-message tb-show" id="tbEventMessage">${escapeHtml(msg)}</div>`; }

function tbQueueSubstanceEvent(type, player, before, after, amount) {
    if (tbDraftInProgress) return;
    tbPendingEvents.push({ type, player, before, after, amount });
    if (tbBatchTimer) clearTimeout(tbBatchTimer);
    tbBatchTimer = setTimeout(tbFlushBatch, TB_BATCH_WINDOW);
}

function tbFlushBatch() {
    tbBatchTimer = null;
    const events = tbPendingEvents;
    tbPendingEvents = [];
    if (events.length === 0) return;
    tbEventQueue = tbEventQueue.then(async () => {
        if (events.length === 1) {
            await tbPlaySingleSubstanceEvent(events[0]);
        } else {
            await tbPlayBatchEvent(events);
        }
    });
}

async function tbPlayBatchEvent(events) {
    const overlay = document.getElementById('tbEventOverlay');
    const modal = document.getElementById('tbEventModal');
    if(!overlay || !modal) return;

    const counts = {};
    events.forEach(e => counts[e.type] = (counts[e.type] || 0) + 1);
    let domType = events[0].type, domCount = 0;
    for (const t in counts) { if (counts[t] > domCount) { domCount = counts[t]; domType = t; } }

    let svgHTML, animDuration, titleWord, collectiveMsgs;
    if (domType === 'beers') { svgHTML = tbBeerSVG(); animDuration = 2600; titleWord = '🍺 Skupinová runda piva!'; collectiveMsgs = tbBeerCollectiveMsgs; }
    else if (domType === 'shots') { svgHTML = tbShotSVG(); animDuration = 1300; titleWord = '🥃 Skupinová runda panáků!'; collectiveMsgs = tbShotCollectiveMsgs; }
    else { svgHTML = tbJointSVG(); animDuration = 3400; titleWord = '🍁 Skupinové zapalování!'; collectiveMsgs = tbJointCollectiveMsgs; }

    const uniqueNames = [...new Set(events.map(e => e.player.name))];
    const msg = tbPick(collectiveMsgs).replace('{names}', tbJoinNamesCz(uniqueNames));

    modal.innerHTML = `<div class="tb-event-title">${titleWord}</div>${svgHTML}<div class="tb-event-message tb-show" id="tbEventMessage">${escapeHtml(msg)}</div>`;
    overlay.classList.add('tb-show');
    tbSpeak(msg);

    if (domType === 'beers') {
        await tbDrinkWithGulps(animDuration, 5);
    } else if (domType === 'shots') {
        tbPlayClink();
        await tbSleep(250);
        tbPlayGulpSound();
        await tbSleep(animDuration - 250);
    } else {
        tbPlaySizzle(animDuration / 1000);
        await tbSleep(animDuration);
    }
    await tbSleep(700);

    overlay.classList.remove('tb-show');
    await tbSleep(320);
}

async function tbPlaySingleSubstanceEvent(ev) {
    const { type, player, amount } = ev;
    const overlay = document.getElementById('tbEventOverlay');
    const modal = document.getElementById('tbEventModal');
    if(!overlay || !modal) return;
    const up = amount > 0;
    let animDuration, msgPool;

    if (type === 'beers') { animDuration = up ? 2600 : 500; msgPool = up ? tbBeerUpMsgs : tbBeerDownMsgs; }
    else if (type === 'shots') { animDuration = up ? 1300 : 500; msgPool = up ? tbShotUpMsgs : tbShotDownMsgs; }
    else { animDuration = up ? 3400 : 500; msgPool = up ? tbJointUpMsgs : tbJointDownMsgs; }

    const msg = tbPick(msgPool).replace('{name}', player.name);
    let html;
    if (type === 'beers') html = up ? tbBeerModalHTML(player.name, msg) : tbBeerModalCalmHTML(player.name, msg);
    else if (type === 'shots') html = up ? tbShotModalHTML(player.name, msg) : tbShotModalCalmHTML(player.name, msg);
    else html = up ? tbJointModalHTML(player.name, msg) : tbJointModalCalmHTML(player.name, msg);

    modal.innerHTML = html;
    overlay.classList.add('tb-show');
    tbSpeak(msg);

    if (up && type === 'beers') {
        await tbDrinkWithGulps(animDuration, 5);
    } else if (up && type === 'shots') {
        tbPlayClink();
        await tbSleep(250);
        tbPlayGulpSound();
        await tbSleep(animDuration - 250);
    } else if (up && type === 'joints') {
        tbPlaySizzle(animDuration / 1000);
        await tbSleep(animDuration);
    } else {
        await tbSleep(animDuration);
    }
    await tbSleep(700);

    overlay.classList.remove('tb-show');
    await tbSleep(320);
}

function tbUpdateSubstance(id, type, amount) {
    const player = tbPlayers.find(p => p.id === id);
    if (!player) return;
    const before = tbCalculateCurrentSkill(player);
    player[type] = Math.max(0, player[type] + amount);
    const after = tbCalculateCurrentSkill(player);
    tbRenderPlayers();

    if (before !== after) {
        tbQueueSubstanceEvent(type, player, before, after, amount);
    }

    if (document.querySelectorAll('#tbTeamsResult .tb-team-card').length > 0) {
        tbRecalculateExistingTeams();
    }
}

function tbRecalculateExistingTeams() {
    const teamsDiv = document.getElementById('tbTeamsResult');
    if(!teamsDiv) return;
    const teamCards = teamsDiv.querySelectorAll('.tb-team-card');

    teamCards.forEach(card => {
        const teamHeader = card.querySelector('.tb-team-header');
        const teamId = teamHeader.firstElementChild.innerText;
        const playerRows = card.querySelectorAll('.tb-team-player');

        let totalCurrentSkill = 0;
        let totalBaseSkill = 0;

        playerRows.forEach(row => {
            const playerName = row.firstElementChild.innerText.replace(/^(👑|•)\s*/, '').trim();
            const player = tbPlayers.find(p => p.name === playerName);
            if (player) {
                const current = tbCalculateCurrentSkill(player);
                totalCurrentSkill += current;
                totalBaseSkill += player.baseSkill;
                const cell = row.querySelector('.tb-form-cell');
                if (cell) {
                    cell.innerHTML = `Forma: ${current} (🍺${player.beers} ${TB_SHOT_ICON}${player.shots} ${TB_JOINT_ICON}${player.joints})`;
                }
            }
        });

        let teamHandicap = totalBaseSkill - totalCurrentSkill;

        teamHeader.innerHTML = `
            <span>${escapeHtml(teamId)}</span>
            <span style="font-size: 13px; color: #ff4d4d;">Handicap týmu: -${teamHandicap} b.</span>
            <span>Celkový skill: ${totalCurrentSkill}</span>
        `;
    });
}

function tbRenderPlayers() {
    const listDiv = document.getElementById('tbPlayersList');
    if(!listDiv) return;
    listDiv.innerHTML = '';
    tbPlayers.forEach(p => {
        const currentSkill = tbCalculateCurrentSkill(p);
        listDiv.innerHTML += `
            <div class="tb-player-item">
                <div class="tb-player-info">
                    <div class="tb-player-name">${escapeHtml(p.name)} <button type="button" class="tb-remove-btn" data-tb-remove="${p.id}">❌</button></div>
                    <div class="tb-player-stats">Aktuální Skill: <strong>${currentSkill}</strong> / Základ: ${p.baseSkill}</div>
                </div>
                <div class="tb-substance-controls">
                    <span class="tb-sub-count">🍺 ${p.beers}</span>
                    <button type="button" class="tb-sub-btn" data-tb-sub="${p.id}|beers|1">+</button>
                    <button type="button" class="tb-sub-btn" data-tb-sub="${p.id}|beers|-1">-</button>
                    <span class="tb-sub-count">${TB_SHOT_ICON} ${p.shots}</span>
                    <button type="button" class="tb-sub-btn" data-tb-sub="${p.id}|shots|1">+</button>
                    <button type="button" class="tb-sub-btn" data-tb-sub="${p.id}|shots|-1">-</button>
                    <span class="tb-sub-count">${TB_JOINT_ICON} ${p.joints}</span>
                    <button type="button" class="tb-sub-btn" data-tb-sub="${p.id}|joints|1">+</button>
                    <button type="button" class="tb-sub-btn" data-tb-sub="${p.id}|joints|-1">-</button>
                </div>
            </div>`;
    });
    listDiv.querySelectorAll('[data-tb-remove]').forEach(btn => {
        btn.addEventListener('click', () => tbRemovePlayer(parseFloat(btn.dataset.tbRemove)));
    });
    listDiv.querySelectorAll('[data-tb-sub]').forEach(btn => {
        btn.addEventListener('click', () => {
            const [idStr, type, amountStr] = btn.dataset.tbSub.split('|');
            tbUpdateSubstance(parseFloat(idStr), type, parseInt(amountStr,10));
        });
    });
}

function tbSlotModalHTML(teamId) {
    return `
        <button type="button" class="tb-modal-close-btn" id="tbCancelDraftBtn" title="Zavřít a zrušit losování">✕</button>
        <div class="tb-event-title">🎰 Losování Týmu ${teamId}</div>
        <div class="tb-slot-frame" id="tbSlotFrame">
            <div class="tb-slot-title">MULTICAST</div>
            <div class="tb-slot-subtitle">Ogre Magi rozhoduje o osudu týmu...</div>
            <div class="tb-reels-row">
                <div class="tb-reel-window" id="tbReelWin1"><div class="tb-reel-strip" id="tbReelStrip1"></div></div>
                <div class="tb-reel-window" id="tbReelWin2"><div class="tb-reel-strip" id="tbReelStrip2"></div></div>
                <div class="tb-reel-window" id="tbReelWin3"><div class="tb-reel-strip" id="tbReelStrip3"></div></div>
            </div>
            <div class="tb-reel-labels-row">
                <div class="tb-reel-label">👑 Vůdce</div>
                <div class="tb-reel-label">Člen 1</div>
                <div class="tb-reel-label">Člen 2</div>
            </div>
            <div class="tb-lever-wrap" id="tbLeverWrap">
                <div class="tb-lever-rod"></div>
                <div class="tb-lever-knob"></div>
                <div class="tb-lever-base"></div>
            </div>
        </div>
        <div class="tb-slot-status-line" id="tbSlotStatus">Zatáhni za páku a vylosuj Tým ${teamId}!</div>
        <div class="tb-results-list" id="tbResultsList"></div>
        <div class="tb-slot-actions" id="tbSlotActions">
            <button type="button" class="tb-btn-confirm" id="tbConfirmTeamsBtn">✅ Potvrdit týmy</button>
            <button type="button" class="tb-btn-reroll" id="tbRerollTeamsBtn">🔄 Losovat znovu</button>
        </div>`;
}

function tbBuildReelStrip(stripEl, pool, targetName, loops) {
    const namesPool = pool.length ? pool : [targetName];
    const preFiller = namesPool[Math.floor(Math.random() * namesPool.length)] || targetName;
    const items = [preFiller, targetName];
    for (let i = 0; i < loops; i++) { items.push(...namesPool); }
    stripEl.innerHTML = items.map(n => `<div class="tb-reel-item"><span>${escapeHtml(n)}</span></div>`).join('');
    const targetIndex = 1;
    const startIndex = items.length - 1;
    const startT = (1 - startIndex) * TB_REEL_ITEM_H;
    stripEl.style.transform = `translateY(${startT}px)`;
    return { targetIndex, startIndex };
}

function tbSpinReelPhysics(stripEl, targetIndex, startIndex, durationMs) {
    return new Promise(resolve => {
        const startT = (1 - startIndex) * TB_REEL_ITEM_H;
        const finalT = (1 - targetIndex) * TB_REEL_ITEM_H;
        const distance = finalT - startT;
        stripEl.classList.add('tb-spinning');
        const startTime = performance.now();
        let lastTickStep = -1;
        function frame(now) {
            const t = Math.min((now - startTime) / durationMs, 1);
            const eased = 1 - Math.pow(1 - t, 3);
            const currentT = startT + eased * distance;
            stripEl.style.transform = `translateY(${currentT}px)`;
            const step = Math.floor((currentT - startT) / TB_REEL_ITEM_H);
            if (step !== lastTickStep) { lastTickStep = step; tbPlayReelTick(); }
            if (t < 1) {
                requestAnimationFrame(frame);
            } else {
                stripEl.style.transform = `translateY(${finalT}px)`;
                stripEl.classList.remove('tb-spinning');
                const landedItem = stripEl.children[targetIndex];
                if (landedItem) landedItem.classList.add('tb-landed');
                resolve();
            }
        }
        requestAnimationFrame(frame);
    });
}

function tbStartConstantSpin(stripEl, pool) {
    const namesPool = pool.length ? pool : ['???'];
    const minUnitLen = 8;
    let unit = [];
    while (unit.length < minUnitLen) { unit.push(...tbShuffleArray(namesPool)); }
    const items = [...unit, ...unit];
    stripEl.innerHTML = items.map(n => `<div class="tb-reel-item"><span>${escapeHtml(n)}</span></div>`).join('');
    stripEl.classList.add('tb-spinning');
    const unitHeight = unit.length * TB_REEL_ITEM_H;
    const speed = 0.62;
    let pos = 0;
    let last = performance.now();
    let tickAcc = 0;
    let running = true;
    function frame(now) {
        if (!running) return;
        const dt = now - last; last = now;
        pos = (pos + speed * dt) % unitHeight;
        stripEl.style.transform = `translateY(${pos - unitHeight}px)`;
        tickAcc += dt;
        if (tickAcc > 90) { tickAcc = 0; tbPlayReelTick(); }
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    return { stop() { running = false; } };
}

function tbDecelerateAndLand(stripEl, pool, targetName, durationMs) {
    const r = tbBuildReelStrip(stripEl, pool, targetName, 4);
    return tbSpinReelPhysics(stripEl, r.targetIndex, r.startIndex, durationMs);
}

async function tbSpinCurrentTeam() {
    const draft = tbCurrentDraft;
    const team = draft.teams[draft.index];
    const modal = document.getElementById('tbEventModal');
    const lever = modal.querySelector('#tbLeverWrap');
    const status = modal.querySelector('#tbSlotStatus');
    lever.classList.add('tb-disabled', 'tb-lever-pulled');
    status.textContent = 'Losuje se...';
    tbPlayBeep(200, 0.1, 'sawtooth');
    await tbSleep(280);
    lever.classList.remove('tb-lever-pulled');

    const remainingCol1 = draft.col1Players.slice(draft.index + 1).map(p => p.name);
    const remainingCol2 = draft.col2Players.filter(p => p !== team.middle).map(p => p.name);
    const remainingCol3 = draft.col3Players.filter(p => p !== team.weak).map(p => p.name);

    const strip1 = modal.querySelector('#tbReelStrip1');
    const strip2 = modal.querySelector('#tbReelStrip2');
    const strip3 = modal.querySelector('#tbReelStrip3');

    const spin1 = tbStartConstantSpin(strip1, remainingCol1);
    const spin2 = tbStartConstantSpin(strip2, remainingCol2);
    const spin3 = tbStartConstantSpin(strip3, remainingCol3);
    await tbSleep(900);

    spin1.stop();
    await tbDecelerateAndLand(strip1, remainingCol1, team.leader.name, 1500);
    if (tbDraftCancelled) { spin2.stop(); spin3.stop(); return; }
    tbPlayLandSound(700);

    spin2.stop();
    await tbDecelerateAndLand(strip2, remainingCol2, team.middle ? team.middle.name : '—', 1500);
    if (tbDraftCancelled) { spin3.stop(); return; }
    tbPlayLandSound(600);

    spin3.stop();
    await tbDecelerateAndLand(strip3, remainingCol3, team.weak ? team.weak.name : '—', 1500);
    if (tbDraftCancelled) return;
    tbPlayLandSound(520);

    const resultsList = modal.querySelector('#tbResultsList');
    const names = [team.leader.name, team.middle && team.middle.name, team.weak && team.weak.name].filter(Boolean);
    const line = document.createElement('div');
    line.className = 'tb-result-entry';
    line.textContent = `Tým ${team.id}: ${tbJoinNamesCz(names)}`;
    resultsList.appendChild(line);
    await tbSleep(500);

    await tbAnimatePlayerIntoTeam(team.leader, team, true);
    if (team.middle) await tbAnimatePlayerIntoTeam(team.middle, team, false);
    if (team.weak) await tbAnimatePlayerIntoTeam(team.weak, team, false);

    draft.index++;
    if (draft.index < draft.teams.length) {
        const nextTeam = draft.teams[draft.index];
        modal.querySelector('.tb-event-title').textContent = `🎰 Losování Týmu ${nextTeam.id}`;
        status.textContent = `Zatáhni za páku a vylosuj Tým ${nextTeam.id}!`;
        lever.classList.remove('tb-disabled');
    } else {
        status.textContent = '🏆 Všechny týmy jsou vylosované!';
        lever.classList.add('tb-disabled');
        modal.querySelector('#tbSlotActions').style.display = 'flex';
    }
}

function tbOnLeverClick() {
    if (tbSpinBusy || !tbCurrentDraft) return;
    const lever = document.querySelector('#tbLeverWrap');
    if (lever && lever.classList.contains('tb-disabled')) return;
    tbSpinBusy = true;
    tbSpinCurrentTeam().finally(() => { tbSpinBusy = false; });
}

function tbCancelDraft() {
    tbDraftCancelled = true;
    const overlay = document.getElementById('tbEventOverlay');
    if(overlay) overlay.classList.remove('tb-show');
    tbCurrentDraft = null;
    const btn = document.getElementById('tbGenerateBtn');
    if(btn){ btn.disabled = false; btn.innerText = '⚡ GENEROVAT VYVÁŽENÉ TÝMY ⚡'; }
    tbDraftInProgress = false;
}

function tbConfirmTeams() {
    const overlay = document.getElementById('tbEventOverlay');
    if(overlay) overlay.classList.remove('tb-show');
    tbCurrentDraft = null;
    const btn = document.getElementById('tbGenerateBtn');
    if(btn){ btn.disabled = false; btn.innerText = '⚡ GENEROVAT VYVÁŽENÉ TÝMY ⚡'; }
    tbDraftInProgress = false;
}

function tbRerollTeams() {
    tbStartDraft();
}

async function tbAnimatePlayerIntoTeam(player, team, isLeader) {
    const card = document.getElementById('tb-team-' + team.id);
    if(!card) return;
    const playersDiv = card.querySelector('.tb-team-players');
    const row = document.createElement('div');
    row.className = 'tb-team-player tb-player-enter' + (isLeader ? ' tb-leader-enter' : '');
    row.innerHTML = `<span>${isLeader ? '👑 ' : '• '}${escapeHtml(player.name)}</span><span class="tb-form-cell">Forma: ${player.currentSkill} (🍺${player.beers} ${TB_SHOT_ICON}${player.shots} ${TB_JOINT_ICON}${player.joints})</span>`;
    playersDiv.appendChild(row);
    card.querySelector('.tb-team-header').innerHTML = `<span>Tým ${team.id}</span><span>Celkový skill: ${team.totalSkill}</span>`;
    card.classList.add('tb-leader-glow');
    tbPlayBeep(420, 0.1, 'sine');
    await tbSleep(isLeader ? 400 : 250);
    card.classList.remove('tb-leader-glow');
}

function tbGenerateTeams() {
    if (tbPlayers.length < 3) { alert("Potřebuješ aspoň 3 hráče!"); return; }
    if (tbDraftInProgress) return;
    tbDraftInProgress = true;
    tbStartDraft();
}

function tbStartDraft() {
    tbDraftCancelled = false;
    const btn = document.getElementById('tbGenerateBtn');
    if(btn){ btn.disabled = true; btn.innerText = '🎰 Losování probíhá...'; }

    const processedPlayers = tbPlayers.map(p => ({
        ...p,
        currentSkill: tbCalculateCurrentSkill(p)
    })).sort((a, b) => b.currentSkill - a.currentSkill);

    const numTeams = Math.ceil(processedPlayers.length / 3);

    const col1Players = tbShuffleArray(processedPlayers.slice(0, numTeams));
    const rest1 = processedPlayers.slice(numTeams);
    const col2Players = tbShuffleArray(rest1.slice(0, numTeams));
    const rest2 = rest1.slice(numTeams);
    const col3Players = tbShuffleArray(rest2.slice(0, numTeams));

    const teams = Array.from({ length: numTeams }, (_, i) => ({
        id: i + 1,
        leader: col1Players[i] || null,
        middle: null,
        weak: null,
        totalSkill: 0
    }));

    col2Players.forEach((p, i) => { teams[numTeams - 1 - i].middle = p; });
    col3Players.forEach((p, i) => { teams[i].weak = p; });

    teams.forEach(t => {
        t.totalSkill = (t.leader ? t.leader.currentSkill : 0) + (t.middle ? t.middle.currentSkill : 0) + (t.weak ? t.weak.currentSkill : 0);
    });

    const teamsDiv = document.getElementById('tbTeamsResult');
    teamsDiv.innerHTML = '';
    teams.forEach(t => {
        const card = document.createElement('div');
        card.className = 'tb-team-card tb-team-card-empty';
        card.id = 'tb-team-' + t.id;
        card.innerHTML = `<div class="tb-team-header"><span>Tým ${t.id}</span><span>Celkový skill: 0</span></div><div class="tb-team-players"></div>`;
        teamsDiv.appendChild(card);
    });

    tbCurrentDraft = { teams, col1Players, col2Players, col3Players, index: 0 };

    const overlay = document.getElementById('tbEventOverlay');
    const modal = document.getElementById('tbEventModal');
    modal.innerHTML = tbSlotModalHTML(teams[0].id);
    document.getElementById('tbCancelDraftBtn').addEventListener('click', tbCancelDraft);
    document.getElementById('tbLeverWrap').addEventListener('click', tbOnLeverClick);
    const tbConfirmBtn = document.getElementById('tbConfirmTeamsBtn');
    if(tbConfirmBtn) tbConfirmBtn.addEventListener('click', tbConfirmTeams);
    const tbRerollBtn = document.getElementById('tbRerollTeamsBtn');
    if(tbRerollBtn) tbRerollBtn.addEventListener('click', tbRerollTeams);
    overlay.classList.add('tb-show');
}

function renderTeamDrawTool(container){
  container.innerHTML = `
    <button type="button" class="btn-ghost btn-sm" id="tb-back-btn">← Zpět na seznam turnajů</button>
    <h1 class="headline tb-title" style="font-size:24px; margin-top:14px;">🎰 Losovačka týmů (3v3)</h1>
    <label class="tb-sound-toggle">
      <input type="checkbox" id="tbSoundToggle" checked> 🔊 Zvuky a hlášky
    </label>
    <div class="tb-voice-picker">
      <select id="tbVoiceSelect"><option value="">Výchozí hlas</option></select>
      <button type="button" class="tb-voice-test-btn" id="tbVoiceTestBtn">🔊 Test hlasu</button>
    </div>

    <div class="field" style="max-width:400px;">
      <label>Vzít hráče z přihlášených na akci (nepovinné)</label>
      <select id="tb-event-select">
        <option value="">— vyber akci —</option>
        ${events.map(e=>`<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('')}
      </select>
    </div>
    <div id="tb-registrants-picker" style="margin-bottom:16px; max-width:400px;"></div>

    <button type="button" class="tb-generate-btn" id="tbGenerateBtn">⚡ GENEROVAT VYVÁŽENÉ TÝMY ⚡</button>
    <div class="tb-main-layout">
      <div class="tb-box">
        <h2>Hráči</h2>
        <div class="tb-form-group">
          <input type="text" id="tbPName" placeholder="Jméno hráče (např. Pepa)">
          <input type="number" id="tbPSkill" placeholder="Skill (1-100)" min="1" max="100">
          <button type="button" id="tbAddPlayerBtn">Přidat</button>
        </div>
        <div id="tbPlayersList"></div>
      </div>
      <div class="tb-box">
        <h2>Výsledné Týmy</h2>
        <div id="tbTeamsResult" class="tb-teams-grid"><p style="text-align:center; color:#718096;">Zatím nebyly vygenerovány žádné týmy. Přidej lidi a klikni na tlačítko nahoře.</p></div>
      </div>
    </div>
  `;

  document.getElementById('tb-back-btn').addEventListener('click', () => { turnajDrawToolOpen = false; renderTurnajPage(); });

  document.getElementById('tbSoundToggle').addEventListener('change', (e) => { tbSoundEnabled = e.target.checked; });
  document.getElementById('tbVoiceTestBtn').addEventListener('click', () => tbSpeak('Ahoj, takhle teď zním. Pepa si dává pivo a slibuje, že tohle bylo fakt poslední.'));
  document.getElementById('tbVoiceSelect').addEventListener('change', (e) => { tbSelectedVoiceURI = e.target.value; });
  tbPopulateVoiceList();

  document.getElementById('tb-event-select').addEventListener('change', async (e) => {
    const eventId = e.target.value;
    const pickerBox = document.getElementById('tb-registrants-picker');
    if(!eventId){ pickerBox.innerHTML = ''; return; }
    pickerBox.innerHTML = '<div class="empty">Načítám přihlášené...</div>';
    try{
      const snap = await getDocs(collection(db,'events',eventId,'registrations'));
      const regs = snap.docs.map(d=>d.data()).filter(r=>r.status!=='maybe' && r.nick).sort((a,b)=>(a.nick||'').localeCompare(b.nick||''));
      if(regs.length === 0){ pickerBox.innerHTML = '<div class="empty">Na týhle akci zatím nikdo není přihlášený.</div>'; return; }
      const rows = await Promise.all(regs.map(async r => {
        const savedSkill = await tbLoadSkill(r.nick);
        return { nick: r.nick, skill: savedSkill !== null ? savedSkill : 50 };
      }));
      pickerBox.innerHTML = `
        <div class="tb-registrant-list">
          ${rows.map((r,i) => `
            <label class="tb-registrant-row">
              <input type="checkbox" data-tb-reg-idx="${i}">
              <span style="flex:1;">${escapeHtml(r.nick)}</span>
              <input type="number" min="1" max="100" value="${r.skill}" data-tb-reg-skill-idx="${i}" style="width:60px;">
            </label>
          `).join('')}
        </div>
        <button type="button" class="btn-sm" id="tb-add-checked-btn" style="margin-top:10px;">+ Přidat zaškrtnuté do losování</button>
      `;
      document.getElementById('tb-add-checked-btn').addEventListener('click', () => {
        rows.forEach((r, i) => {
          const cb = pickerBox.querySelector(`[data-tb-reg-idx="${i}"]`);
          if(cb && cb.checked){
            const skillInput = pickerBox.querySelector(`[data-tb-reg-skill-idx="${i}"]`);
            const skill = parseInt(skillInput.value,10) || 50;
            tbAddPlayerObj(r.nick, skill);
          }
        });
      });
    }catch(err){ console.error(err); pickerBox.innerHTML = '<div class="empty">Nepovedlo se načíst.</div>'; }
  });

  document.getElementById('tbAddPlayerBtn').addEventListener('click', () => {
    const nameInput = document.getElementById('tbPName');
    const skillInput = document.getElementById('tbPSkill');
    if (!nameInput.value || !skillInput.value) { alert('Vyplň jméno i skill!'); return; }
    tbAddPlayerObj(nameInput.value.trim(), parseInt(skillInput.value,10));
    nameInput.value = ''; skillInput.value = '';
  });

  document.getElementById('tbGenerateBtn').addEventListener('click', tbGenerateTeams);

  const existingOverlay = document.getElementById('tbEventOverlay');
  if(existingOverlay) existingOverlay.remove();
  const overlay = document.createElement('div');
  overlay.className = 'tb-event-overlay';
  overlay.id = 'tbEventOverlay';
  overlay.innerHTML = '<div class="tb-event-modal" id="tbEventModal"></div>';
  document.body.appendChild(overlay);

  tbRenderPlayers();
}


function isMemberElsewhere(teams, currentIdx, nick){
  return teams.some((tm,i) => i!==currentIdx && tm.members.includes(nick));
}

async function renderTeamEditor(t, container, onSaved){
  const editorWrap = document.createElement('div');
  editorWrap.className = 'tourney-setup-panel';
  editorWrap.innerHTML = `<div class="empty">Načítám přihlášené na akci...</div>`;
  container.appendChild(editorWrap);

  let goingRegs = [];
  if(t.eventId){
    try{
      const snap = await getDocs(collection(db, 'events', t.eventId, 'registrations'));
      goingRegs = snap.docs.map(d => d.data()).filter(r => r.status !== 'maybe').sort((a,b)=>(a.ts||'').localeCompare(b.ts||''));
    }catch(err){ console.error(err); }
  }

  editorWrap.innerHTML = `
    <div class="team-editor" id="team-editor-grid"></div>
    <div style="display:flex; gap:10px; margin-top:14px;">
      <button type="button" id="btn-add-team" class="btn-sm">+ Přidat tým</button>
      <button type="button" id="btn-save-teams">Uložit týmy</button>
    </div>
  `;

  let workingTeams = JSON.parse(JSON.stringify(t.teams || []));

  function renderGrid(){
    const grid = document.getElementById('team-editor-grid');
    grid.innerHTML = workingTeams.map((team, ti) => `
      <div class="team-editor-card">
        <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px; position:relative;">
          <button type="button" class="team-style-btn" data-team-style-toggle="${ti}" style="border-color:${team.color||'var(--line)'};">
            <span style="color:${team.color||'inherit'};">${team.emblem || '🚩'}</span>
          </button>
          <input type="text" class="team-name" data-team-name="${ti}" value="${escapeHtml(team.name)}" style="flex:1; color:${team.color||'inherit'};">
          <div class="team-style-panel" data-team-style-panel="${ti}" style="display:none;">
            <div class="team-style-panel-label">Logo</div>
            <div class="chip-row">
              ${TEAM_EMBLEMS.map(em => `<span class="chip" data-team-emblem="${ti}" data-emblem-val="${em}" style="cursor:pointer; font-size:15px; ${team.emblem===em?'border-color:var(--gold); color:var(--gold);':''}">${em}</span>`).join('')}
            </div>
            <div class="team-style-panel-label">Barva</div>
            <div class="chip-row">
              ${TEAM_COLORS.map(c => `<span class="color-swatch ${team.color===c?'active':''}" data-team-color="${ti}" data-color-val="${c}" style="background:${c};"></span>`).join('')}
            </div>
          </div>
        </div>
        <div class="team-roster-list">
          ${goingRegs.map(r => `
            <label class="team-roster-item">
              <input type="checkbox" data-team-member="${ti}" value="${escapeHtml(r.nick)}" ${team.members.includes(r.nick)?'checked':''}>
              <span>${escapeHtml(r.nick)}${isMemberElsewhere(workingTeams, ti, r.nick) ? ' (hostuje)' : ''}</span>
            </label>
          `).join('')}
          ${team.members.filter(m => !goingRegs.some(r=>r.nick===m)).map(guest => `
            <label class="team-roster-item">
              <input type="checkbox" data-team-guest-remove="${ti}" value="${escapeHtml(guest)}" checked>
              <span>${escapeHtml(guest)} (host)</span>
            </label>
          `).join('')}
        </div>
        <div class="team-guest-row">
          <input type="text" placeholder="Přidat hráče mimo seznam (i neregistrovaného)" data-guest-input="${ti}">
          <button type="button" class="btn-ghost btn-sm" data-guest-add="${ti}">+</button>
        </div>
        ${workingTeams.length > 2 ? `<button type="button" class="btn-ghost btn-sm" data-remove-team="${ti}" style="margin-top:8px; color:var(--crimson); border-color:var(--crimson);">Odebrat tým</button>` : ''}
      </div>
    `).join('');

    grid.querySelectorAll('[data-team-name]').forEach(inp => {
      inp.addEventListener('input', () => { workingTeams[parseInt(inp.dataset.teamName,10)].name = inp.value; });
    });
    grid.querySelectorAll('[data-team-style-toggle]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const ti = btn.dataset.teamStyleToggle;
        grid.querySelectorAll('[data-team-style-panel]').forEach(p => {
          p.style.display = (p.dataset.teamStylePanel === ti && p.style.display === 'none') ? 'flex' : 'none';
        });
      });
    });
    grid.querySelectorAll('[data-team-emblem]').forEach(el => {
      el.addEventListener('click', () => {
        workingTeams[parseInt(el.dataset.teamEmblem,10)].emblem = el.dataset.emblemVal;
        renderGrid();
      });
    });
    grid.querySelectorAll('[data-team-color]').forEach(el => {
      el.addEventListener('click', () => {
        workingTeams[parseInt(el.dataset.teamColor,10)].color = el.dataset.colorVal;
        renderGrid();
      });
    });
    grid.querySelectorAll('[data-team-member]').forEach(cb => {
      cb.addEventListener('change', () => {
        const ti = parseInt(cb.dataset.teamMember,10);
        const nick = cb.value;
        if(cb.checked){ if(!workingTeams[ti].members.includes(nick)) workingTeams[ti].members.push(nick); }
        else{ workingTeams[ti].members = workingTeams[ti].members.filter(m=>m!==nick); }
        renderGrid();
      });
    });
    grid.querySelectorAll('[data-team-guest-remove]').forEach(cb => {
      cb.addEventListener('change', () => {
        if(!cb.checked){
          const ti = parseInt(cb.dataset.teamGuestRemove,10);
          workingTeams[ti].members = workingTeams[ti].members.filter(m=>m!==cb.value);
          renderGrid();
        }
      });
    });
    grid.querySelectorAll('[data-guest-add]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ti = parseInt(btn.dataset.guestAdd,10);
        const input = grid.querySelector(`[data-guest-input="${ti}"]`);
        const val = input.value.trim();
        if(!val) return;
        if(!workingTeams[ti].members.includes(val)) workingTeams[ti].members.push(val);
        renderGrid();
      });
    });
    grid.querySelectorAll('[data-remove-team]').forEach(btn => {
      btn.addEventListener('click', () => {
        workingTeams.splice(parseInt(btn.dataset.removeTeam,10),1);
        renderGrid();
      });
    });
  }
  renderGrid();
  document.addEventListener('click', (e) => {
    if(!e.target.closest('[data-team-style-panel]') && !e.target.closest('[data-team-style-toggle]')){
      document.querySelectorAll('[data-team-style-panel]').forEach(p => { p.style.display = 'none'; });
    }
  });

  document.getElementById('btn-add-team').addEventListener('click', () => {
    workingTeams.push({ name:`Tým ${workingTeams.length+1}`, members:[], emblem:'' });
    renderGrid();
  });

  document.getElementById('btn-save-teams').addEventListener('click', async () => {
    try{
      await updateDoc(doc(db,'tournaments',t.id), { teams: workingTeams });
      if(onSaved) onSaved(); else renderTurnajPage();
    }catch(err){ alert('Uložení týmů se nepovedlo.'); console.error(err); }
  });
}

function computeSwissTournament(t){
  const teams = t.teams || [];
  const n = teams.length;
  const results = t.results || {};
  const swissResults = t.swissResults || {};

  function resolvePair(resObj, key){
    const res = resObj[key];
    if(res && typeof res.a==='number' && typeof res.b==='number' && (res.a>=2||res.b>=2) && res.a!==res.b){
      return { result:res, winnerSide: res.a>res.b ? 'A' : 'B' };
    }
    return { result: res||null, winnerSide: null };
  }

  let round0 = [];
  let wins = new Array(n).fill(0);
  for(let i=0;i<n;i++){
    for(let j=i+1;j<n;j++){
      const key = `RR-${i}-${j}`;
      const { result, winnerSide } = resolvePair(results, key);
      const winnerIdx = winnerSide==='A' ? i : (winnerSide==='B' ? j : null);
      if(winnerIdx!==null) wins[winnerIdx]++;
      round0.push({ key, teamA:i, teamB:j, result, winnerIdx });
    }
  }
  const round0Complete = n >= 2 && round0.every(m => m.winnerIdx !== null);

  let rounds = [round0];
  let placements = [];

  if(round0Complete){
    let currentWins = [...wins];
    let currentActive = teams.map((_,i)=>i);
    let roundIndex = 1;
    let safety = 0;

    while(currentActive.length > 1 && safety < 25){
      safety++;
      const sorted = [...currentActive].sort((a,b) => currentWins[b]-currentWins[a] || a-b);
      const pairs = [];
      for(let i=0;i<sorted.length;i+=2){
        if(i+1 < sorted.length) pairs.push([sorted[i], sorted[i+1]]);
      }
      const leftover = sorted.length % 2 === 1 ? sorted[sorted.length-1] : null;

      const roundMatches = pairs.map(([a,b], idx) => {
        const key = `SR${roundIndex}-${idx}`;
        const { result, winnerSide } = resolvePair(swissResults, key);
        const winnerIdx = winnerSide==='A' ? a : (winnerSide==='B' ? b : null);
        return { key, teamA:a, teamB:b, result, winnerIdx };
      });

      const benched = [...placements.map(p => p.team)];
      if(leftover !== null) benched.push(leftover);
      const exhibitions = [];
      for(let bi = 0; bi + 1 < benched.length; bi += 2){
        const a = benched[bi], b = benched[bi+1];
        const key = `SR${roundIndex}-ex${bi/2}`;
        const { result, winnerSide } = resolvePair(swissResults, key);
        const winnerIdx = winnerSide==='A' ? a : (winnerSide==='B' ? b : null);
        exhibitions.push({ key, teamA:a, teamB:b, result, winnerIdx, exhibition:true });
      }

      rounds.push(exhibitions.length ? [...roundMatches, ...exhibitions] : roundMatches);

      const roundComplete = roundMatches.every(m => m.winnerIdx !== null);
      if(!roundComplete) break;

      roundMatches.forEach(m => { currentWins[m.winnerIdx]++; });

      const resorted = [...currentActive].sort((a,b) => currentWins[b]-currentWins[a] || a-b);
      const leaderIdx = resorted[0];
      const runnerUpIdx = resorted.length > 1 ? resorted[1] : null;

      if(runnerUpIdx !== null && currentWins[leaderIdx] > currentWins[runnerUpIdx]){
        const headToHead = roundMatches.find(m =>
          (m.teamA===leaderIdx && m.teamB===runnerUpIdx) || (m.teamA===runnerUpIdx && m.teamB===leaderIdx)
        );
        if(headToHead && headToHead.winnerIdx === leaderIdx){
          placements.push({ rank: placements.length+1, team: leaderIdx });
          currentActive = currentActive.filter(i => i !== leaderIdx);
        }
      }
      if(currentActive.length === 1){
        placements.push({ rank: placements.length+1, team: currentActive[0] });
        currentActive = [];
      }
      roundIndex++;
    }
  }

  return { round0, round0Complete, rounds, placements, wins };
}

function renderSwissBody(t, swiss, container, compact){
  const wrap = document.createElement('div');
  wrap.className = 'bracket-wrap' + (compact ? ' bracket-compact' : '');
  wrap.style.position = 'relative';
  container.appendChild(wrap);

  swiss.rounds.forEach((roundMatches, ri) => {
    const col = document.createElement('div');
    col.className = 'bracket-round';
    col.dataset.bracketRoundIndex = ri;
    col.innerHTML = `<div class="bracket-round-title">Kolo ${ri+1}</div>`;
    const realMatches = roundMatches.filter(m => !m.exhibition);
    const exMatches = roundMatches.filter(m => m.exhibition);
    const matchesBox = document.createElement('div');
    matchesBox.className = 'bracket-round-matches';
    realMatches.forEach(m => matchesBox.appendChild(renderSwissMatchBox(t, ri===0?'results':'swissResults', m, compact)));
    col.appendChild(matchesBox);
    if(exMatches.length > 0){
      const exBox = document.createElement('div');
      exBox.className = 'bracket-round-exhibitions';
      exMatches.forEach(m => exBox.appendChild(renderSwissMatchBox(t, 'swissResults', m, compact)));
      col.appendChild(exBox);
    }
    wrap.appendChild(col);
  });

  if(!swiss.round0Complete){
    const col = document.createElement('div');
    col.className = 'bracket-round';
    col.innerHTML = `<div class="bracket-round-title">Další kola</div><div class="bracket-slot placeholder">Čeká na dohrání kola 1</div>`;
    wrap.appendChild(col);
  }

  if(!compact) requestAnimationFrame(() => {
    wrap.style.transform = 'none';
    layoutBracketRounds(wrap);
    drawBracketConnectors(wrap);
    fitBracketToScreen(wrap);
  });
}

function aegisSvg(){
  return `<svg viewBox="0 0 100 112" class="aegis-svg" xmlns="http://www.w3.org/2000/svg">
    <path d="M50 4 C78 4 92 20 92 20 L92 54 C92 71 81 87 65 97 C59 101 54 103 50 105 C46 103 41 101 35 97 C19 87 8 71 8 54 L8 20 C8 20 22 4 50 4 Z" fill="currentColor" stroke="#241f14" stroke-width="2.5"/>
    <circle cx="10.5" cy="27" r="4" fill="#241f14" opacity="0.75"/>
    <circle cx="89.5" cy="27" r="4" fill="#241f14" opacity="0.75"/>
    <circle cx="26" cy="92" r="3" fill="#241f14" opacity="0.6"/>
    <circle cx="74" cy="92" r="3" fill="#241f14" opacity="0.6"/>
    <path d="M50 12 C71 12 83 24 83 24 L83 53 C83 67 74 80 61 89 C57 93 53 94 50 96 C47 94 43 93 39 89 C26 80 17 67 17 53 L17 24 C17 24 29 12 50 12 Z" fill="#151312"/>
    <path d="M50 18 C39 18 31 25 31 34 C31 43 39 46 45 50 C51 54 51 60 45 64 C39 68 31 71 31 80 C31 89 39 96 50 96" fill="none" stroke="currentColor" stroke-width="8.5" stroke-linecap="round" opacity="0.95"/>
    <circle cx="50" cy="53" r="10.5" fill="currentColor" stroke="#241f14" stroke-width="1.5"/>
    <circle cx="50" cy="53" r="4.5" fill="#241f14"/>
    <path d="M50 46 L52 51 L57 53 L52 55 L50 60 L48 55 L43 53 L48 51 Z" fill="#fff" opacity="0.5"/>
  </svg>`;
}

function buildPodiumHtml(t, swiss, big){
  const p1 = swiss.placements.find(p=>p.rank===1);
  const p2 = swiss.placements.find(p=>p.rank===2);
  const p3 = swiss.placements.find(p=>p.rank===3);
  const rest = swiss.placements.filter(p=>p.rank>3);
  let html = `<div class="podium-wrap ${big?'podium-wrap-big':''}">`;
  if(p2) html += `<div class="podium-step podium-2"><div class="podium-team">${escapeHtml(teamName(t,p2.team))}</div><div class="aegis-holder">${aegisSvg()}</div></div>`;
  if(p1) html += `<div class="podium-step podium-1"><div class="podium-team">${escapeHtml(teamName(t,p1.team))}</div><div class="aegis-holder">${aegisSvg()}</div></div>`;
  if(p3) html += `<div class="podium-step podium-3"><div class="podium-team">${escapeHtml(teamName(t,p3.team))}</div><div class="aegis-holder">${aegisSvg()}</div></div>`;
  html += `</div>`;
  if(rest.length > 0){
    html += rest.map(p => {
      const isFourth = p.rank === 4;
      return `<div class="bracket-slot" style="margin-top:8px;"><span>${isFourth ? '🥔' : (p.rank+'.')} ${escapeHtml(teamName(t,p.team))}</span></div>`;
    }).join('');
  }
  return html;
}

function openTeamEditorModal(t){
  const backdrop = document.createElement('div');
  backdrop.className = 'score-modal-backdrop';
  backdrop.innerHTML = `
    <div class="score-modal result-modal team-editor-modal">
      <div style="font-size:16px; font-weight:600;">Upravit týmy — ${escapeHtml(t.name)}</div>
      <div id="team-editor-modal-body"></div>
      <button type="button" class="btn-ghost" id="team-editor-modal-close" style="align-self:flex-start;">Zavřít</button>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => { backdrop.remove(); renderTurnajPage(); };
  document.getElementById('team-editor-modal-close').addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if(e.target === backdrop) close(); });
  renderTeamEditor(t, document.getElementById('team-editor-modal-body'), close);
}

function openTournamentResultModal(t, swiss){
  const backdrop = document.createElement('div');
  backdrop.className = 'score-modal-backdrop';
  backdrop.innerHTML = `
    <div class="score-modal result-modal">
      <div style="font-size:18px; font-weight:700; font-family:'Cinzel', serif; color:var(--gold); text-align:center;">🏆 ${escapeHtml(t.name)}</div>
      ${buildPodiumHtml(t, swiss, true)}
      <button type="button" class="btn-ghost" id="result-modal-close" style="margin-top:16px;">Zavřít</button>
    </div>
  `;
  document.body.appendChild(backdrop);
  document.getElementById('result-modal-close').addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', (e) => { if(e.target === backdrop) backdrop.remove(); });
}

function fitBracketToScreen(wrap){
  const container = wrap.parentElement; // .bracket-scale-wrap
  if(!container) return;
  wrap.style.transform = 'none';
  container.style.height = 'auto';
  const naturalWidth = wrap.scrollWidth;
  const naturalHeight = wrap.scrollHeight;
  const availableWidth = container.clientWidth;
  const top = wrap.getBoundingClientRect().top;
  const availableHeight = Math.max(300, window.innerHeight - top - 70);
  let scale = Math.min(1, availableWidth / naturalWidth, availableHeight / naturalHeight);
  if(scale < 1){
    wrap.style.transformOrigin = 'top left';
    wrap.style.transform = `scale(${scale})`;
    container.style.height = (naturalHeight * scale) + 'px';
  }else{
    wrap.style.transform = 'none';
    container.style.height = naturalHeight + 'px';
  }
}

function layoutBracketRounds(wrap){
  const roundCols = Array.from(wrap.querySelectorAll('[data-bracket-round-index]')).sort((a,b) => a.dataset.bracketRoundIndex - b.dataset.bracketRoundIndex);
  if(roundCols.length < 2) return;

  roundCols.forEach(col => { col.style.marginTop = ''; });

  for(let r = 1; r < roundCols.length; r++){
    const prevReal = roundCols[r-1].querySelectorAll('.bracket-round-matches .bracket-match');
    const curMatchesBox = roundCols[r].querySelector('.bracket-round-matches');
    if(prevReal.length === 0 || !curMatchesBox) continue;
    const firstRect = prevReal[0].getBoundingClientRect();
    const lastRect = prevReal[prevReal.length-1].getBoundingClientRect();
    const spanCenterY = (firstRect.top + lastRect.bottom) / 2;
    const boxRect = curMatchesBox.getBoundingClientRect();
    const desiredTop = spanCenterY - boxRect.height/2;
    const marginTop = desiredTop - boxRect.top;
    roundCols[r].style.marginTop = Math.max(0, marginTop) + 'px';
  }
}

function drawBracketConnectors(wrap){
  const old = wrap.querySelector('svg.bracket-connectors');
  if(old) old.remove();
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'bracket-connectors');
  svg.style.position = 'absolute';
  svg.style.left = '0'; svg.style.top = '0';
  svg.style.width = wrap.scrollWidth + 'px';
  svg.style.height = wrap.scrollHeight + 'px';
  svg.style.pointerEvents = 'none';
  svg.style.zIndex = '0';

  const wrapRect = wrap.getBoundingClientRect();
  const roundCols = Array.from(wrap.querySelectorAll('[data-bracket-round-index]')).sort((a,b) => a.dataset.bracketRoundIndex - b.dataset.bracketRoundIndex);

  for(let r = 0; r < roundCols.length - 1; r++){
    const matches = roundCols[r].querySelectorAll('.bracket-match:not(.bracket-match-exhibition)');
    const nextMatches = roundCols[r+1].querySelectorAll('.bracket-match:not(.bracket-match-exhibition)');
    if(nextMatches.length === 0) continue;
    matches.forEach((m, i) => {
      const targetIdx = Math.min(Math.floor(i/2), nextMatches.length-1);
      const target = nextMatches[targetIdx];
      if(!target) return;
      const a = m.getBoundingClientRect();
      const b = target.getBoundingClientRect();
      const x1 = a.right - wrapRect.left;
      const y1 = a.top + a.height/2 - wrapRect.top;
      const x2 = b.left - wrapRect.left;
      const y2 = b.top + b.height/2 - wrapRect.top;
      const midX = x1 + (x2 - x1) / 2;
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'var(--gold-dim)');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('stroke-dasharray', '4 4');
      path.setAttribute('opacity', '0.7');
      svg.appendChild(path);
    });
  }
  wrap.insertBefore(svg, wrap.firstChild);
}

function renderSwissMatchBox(t, resultField, m, compact){
  const div = document.createElement('div');
  div.className = 'bracket-match' + (m.exhibition ? ' bracket-match-exhibition' : '');
  const teamAObj = t.teams[m.teamA], teamBObj = t.teams[m.teamB];
  const labelA = teamName(t, m.teamA), labelB = teamName(t, m.teamB);
  const emblemA = teamAObj?.emblem ? teamAObj.emblem+' ' : '';
  const emblemB = teamBObj?.emblem ? teamBObj.emblem+' ' : '';
  const membersA = (teamAObj?.members||[]).join(' · ');
  const membersB = (teamBObj?.members||[]).join(' · ');
  const curA = m.result ? m.result.a : 0;
  const curB = m.result ? m.result.b : 0;
  const colorA = teamAObj?.color ? `style="color:${teamAObj.color};"` : '';
  const colorB = teamBObj?.color ? `style="color:${teamBObj.color};"` : '';
  const clickable = hasPerm('turnaj') && !compact;
  div.innerHTML = `
    ${m.exhibition ? `<div class="bracket-exhibition-label">Zápas mimo turnaj</div>` : ''}
    <div class="bracket-slot ${m.winnerIdx===m.teamA ? 'winner-slot':''} ${clickable?'bracket-slot-clickable':''}" ${clickable?'data-sw-slot="A"':''} title="${clickable?'Levé tlačítko = přidat výhru, pravé = ubrat':''}">
      <span class="bracket-slot-main"><span class="bracket-team-name" ${colorA}>${emblemA}${escapeHtml(labelA)}</span>${membersA?`<span class="bracket-team-members">${escapeHtml(membersA)}</span>`:''}</span><span class="bracket-slot-score">${curA}</span>
    </div>
    <div class="bracket-slot ${m.winnerIdx===m.teamB ? 'winner-slot':''} ${clickable?'bracket-slot-clickable':''}" ${clickable?'data-sw-slot="B"':''} title="${clickable?'Levé tlačítko = přidat výhru, pravé = ubrat':''}">
      <span class="bracket-slot-main"><span class="bracket-team-name" ${colorB}>${emblemB}${escapeHtml(labelB)}</span>${membersB?`<span class="bracket-team-members">${escapeHtml(membersB)}</span>`:''}</span><span class="bracket-slot-score">${curB}</span>
    </div>
  `;

  if(clickable){
    async function adjust(side, delta){
      let a = curA, b = curB;
      if(side === 'A') a = Math.max(0, Math.min(2, a + delta));
      else b = Math.max(0, Math.min(2, b + delta));
      try{ await updateDoc(doc(db,'tournaments',t.id), { [`${resultField}.${m.key}`]: { a, b } }); }
      catch(err){ console.error(err); }
    }
    const slotA = div.querySelector('[data-sw-slot="A"]');
    const slotB = div.querySelector('[data-sw-slot="B"]');
    slotA.addEventListener('click', () => adjust('A', 1));
    slotA.addEventListener('contextmenu', (e) => { e.preventDefault(); adjust('A', -1); });
    slotB.addEventListener('click', () => adjust('B', 1));
    slotB.addEventListener('contextmenu', (e) => { e.preventDefault(); adjust('B', -1); });
  }

  return div;
}

// ---- Kompaktní zobrazení turnajů v záložce akce ----
function renderTabTurnaj(ev){
  const box = document.getElementById('tab-turnaj');
  const linked = allTournaments.filter(t => t.eventId === ev.id);

  let html = `<div class="section-title" style="font-size:16px;">Turnaj</div>`;
  if(linked.length === 0){
    html += '<div class="empty">K téhle akci zatím není přiřazený žádný turnaj. Založíš ho v horním menu "Turnaj".</div>';
    box.innerHTML = html;
    return;
  }
  html += linked.map(t => {
    const swiss = computeSwissTournament(t);
    const champion = swiss.placements.find(p => p.rank === 1);
    const statusTxt = champion ? `🏆 Vítěz: ${escapeHtml(teamName(t, champion.team))}` : 'Základní část se ještě hraje';
    return `
      <div class="event-card" data-open-tourney-compact="${t.id}" style="margin-top:14px; cursor:pointer;">
        <span class="tag">${(t.teams||[]).length} týmů</span>
        <h3>${escapeHtml(t.name)}</h3>
        <p class="desc">${statusTxt}</p>
        <span class="status-hint">Zobrazit celý pavouk →</span>
      </div>
    `;
  }).join('');
  box.innerHTML = html;
  box.querySelectorAll('[data-open-tourney-compact]').forEach(card => {
    card.addEventListener('click', () => {
      setRoute('#turnaj/' + card.dataset.openTourneyCompact);
    });
  });
}


// ---- Rozvrh ----
function eventDayList(ev){
  const days = [];
  if(!ev.dateStart || ev.dateUnconfirmed) return days;
  let d = new Date(ev.dateStart+'T00:00:00');
  const end = new Date((ev.dateEnd||ev.dateStart)+'T00:00:00');
  while(d <= end){
    days.push(d.toISOString().slice(0,10));
    d.setDate(d.getDate()+1);
  }
  return days;
}

function renderTabRozvrh(ev){
  const box = document.getElementById('tab-rozvrh');
  const days = eventDayList(ev);
  const schedule = ev.schedule || [];

  if(days.length === 0){
    box.innerHTML = '<div class="empty">Rozvrh půjde vyplnit, až bude mít akce potvrzené konkrétní datum.</div>';
    return;
  }

  let html = `<div class="section-title" style="font-size:16px;">Rozvrh</div>`;
  if(hasPerm('turnaj')){
    html += `
      <form class="panel" id="form-schedule-item" style="max-width:480px;">
        <div class="field"><label>Den</label><select id="sch-day">${days.map(d=>`<option value="${d}">${fmtDate(d)}</option>`).join('')}</select></div>
        <div style="display:flex; gap:12px;">
          <div class="field" style="flex:1;"><label>Od</label><input type="time" id="sch-start" required></div>
          <div class="field" style="flex:1;"><label>Do (nepovinné)</label><input type="time" id="sch-end"></div>
        </div>
        <div class="field"><label>Co se bude dít</label><input type="text" id="sch-title" placeholder="Turnaj, oběd, příjezd..." required></div>
        <button type="submit">Přidat do rozvrhu</button>
      </form>
    `;
  }
  html += `<div id="schedule-days"></div>`;
  box.innerHTML = html;

  const formSch = document.getElementById('form-schedule-item');
  if(formSch) formSch.addEventListener('submit', async (e) => {
    e.preventDefault();
    const entry = {
      day: document.getElementById('sch-day').value,
      timeStart: document.getElementById('sch-start').value,
      timeEnd: document.getElementById('sch-end').value || '',
      title: document.getElementById('sch-title').value.trim()
    };
    if(!entry.title || !entry.timeStart) return;
    const newSchedule = [...schedule, entry];
    try{
      await updateDoc(doc(db,'events',ev.id), { schedule: newSchedule });
      formSch.reset();
    }catch(err){ alert('Nepovedlo se přidat.'); console.error(err); }
  });

  const daysBox = document.getElementById('schedule-days');
  daysBox.innerHTML = days.map(d => {
    const items = schedule
      .map((s, idx) => ({ ...s, idx }))
      .filter(s => s.day === d)
      .sort((a,b) => a.timeStart.localeCompare(b.timeStart));
    return `
      <div style="margin-top:20px;">
        <div class="bracket-section-title">${fmtDate(d)}</div>
        ${items.length === 0 ? '<div class="empty">Zatím nic naplánováno.</div>' : items.map(it => `
          <div class="suggestion-row">
            <span class="txt"><b style="color:var(--gold);">${it.timeStart}${it.timeEnd?'–'+it.timeEnd:''}</b> — ${escapeHtml(it.title)}</span>
            ${hasPerm('akce') ? `<button type="button" class="btn-ghost btn-sm" data-remove-sch="${it.idx}" style="color:var(--crimson); border-color:var(--crimson);">Smazat</button>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }).join('');

  daysBox.querySelectorAll('[data-remove-sch]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.removeSch, 10);
      const newSchedule = schedule.filter((_,i) => i !== idx);
      try{ await updateDoc(doc(db,'events',ev.id), { schedule: newSchedule }); }
      catch(err){ console.error(err); }
    });
  });
}

// ---- Foto ----
function renderTabFoto(ev){
  const box = document.getElementById('tab-foto');
  box.innerHTML = `
    <div class="section-title" style="font-size:16px;">Foto</div>
    <p class="lede" style="margin-top:0;">Vlož odkaz na fotku nebo video (např. z Google Photos, Imgur, YouTube...). Adresu ověříme, než se přidá.</p>
    <div class="photo-add-row">
      <div class="field" style="flex:1;"><label>URL fotky nebo videa</label><input type="url" id="photo-url-input" placeholder="https://..."></div>
      <button type="button" id="btn-add-photo" class="btn-sm">Přidat</button>
    </div>
    <div class="photo-upload-progress" id="photo-add-msg"></div>
    <div class="photo-grid" id="photo-grid"></div>
  `;

  document.getElementById('btn-add-photo').addEventListener('click', async () => {
    if(!currentUser || !currentNick){ showView('ucet'); return; }
    const input = document.getElementById('photo-url-input');
    const msg = document.getElementById('photo-add-msg');
    const url = input.value.trim();
    if(!url) return;
    msg.textContent = 'Ověřuju adresu...';
    const kind = await detectMediaKind(url);
    if(!kind){
      msg.textContent = 'Na téhle adrese se nepodařilo najít obrázek ani video. Zkontroluj odkaz.';
      return;
    }
    try{
      await addDoc(collection(db,'events',ev.id,'photos'), { url, kind, author: currentNick, authorEmoji: currentEmoji, uid: currentUser.uid, ts: new Date().toISOString() });
      input.value = '';
      msg.textContent = '';
    }catch(err){ console.error(err); msg.textContent = 'Nepovedlo se přidat.'; }
  });

  renderPhotoGrid(ev);
}

// Ověří, že URL vede na skutečně načitatelný obrázek nebo video (ne na prázdnou/neplatnou adresu).
function detectMediaKind(url){
  return new Promise((resolve) => {
    const lower = url.toLowerCase();
    if(/\.(mp4|webm|ogg|mov)(\?.*)?$/.test(lower)){
      const v = document.createElement('video');
      let done = false;
      v.onloadedmetadata = () => { if(!done){ done=true; resolve('video'); } };
      v.onerror = () => { if(!done){ done=true; resolve(null); } };
      v.src = url;
      setTimeout(() => { if(!done){ done=true; resolve(null); } }, 6000);
      return;
    }
    const img = new Image();
    let done = false;
    img.onload = () => { if(!done){ done=true; resolve('image'); } };
    img.onerror = () => { if(!done){ done=true; resolve(null); } };
    img.src = url;
    setTimeout(() => { if(!done){ done=true; resolve(null); } }, 6000);
  });
}

function renderPhotoGrid(ev){
  const grid = document.getElementById('photo-grid');
  if(!grid) return;
  if(currentPhotos.length === 0){
    grid.innerHTML = '<div class="empty">Zatím žádné fotky.</div>';
    return;
  }
  grid.innerHTML = currentPhotos.map(p => {
    const canDelete = currentUser && (p.uid === currentUser.uid || hasPerm('akce'));
    const mediaHtml = p.kind === 'video'
      ? `<video src="${p.url.replace(/"/g,'&quot;')}" muted controls></video>`
      : `<img src="${p.url.replace(/"/g,'&quot;')}" alt="Foto od ${escapeHtml(p.author)}" loading="lazy">`;
    return `
      <div class="photo-card">
        ${mediaHtml}
        <div class="photo-meta">
          <span>${authorLabel(p.author, p.authorEmoji)}</span>
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
        document.getElementById('auth-phone-field').style.display = 'block';
        setAuthMessage(`Přezdívka "${nick}" je volná — doplň e-mail a založíme ti účet.`);
      }
    }else{
      const email = document.getElementById('auth-email').value.trim();
      const phone = document.getElementById('auth-phone').value.trim();
      if(!email){ setAuthMessage('Doplň prosím e-mail.'); authSubmitBtn.disabled = false; return; }
      suppressAuthStateHandling = true;
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await setDoc(usernameDocRef(pendingNickForRegistration), { uid: cred.user.uid, email });
      await setDoc(doc(db, 'users', cred.user.uid), { nick: pendingNickForRegistration, email, phone, createdAt: new Date().toISOString(), lastLogin: new Date().toISOString() });
      currentUser = cred.user;
      currentNick = pendingNickForRegistration;
      currentPhone = phone;
      currentEmoji = '';
      currentIsAdmin = false;
      currentIsSuperAdmin = false;
      currentPermissions = {};
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

function resetAuthForm(){
  authStep = 1;
  pendingNickForRegistration = null;
  formAuth.reset();
  authEmailField.style.display = 'none';
  document.getElementById('auth-phone-field').style.display = 'none';
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
  const phone = document.getElementById('google-phone-input').value.trim();
  if(!nick || !currentUser) return;
  const btn = document.getElementById('btn-google-nick-submit');
  btn.disabled = true;
  try{
    const existing = await getDoc(usernameDocRef(nick));
    if(existing.exists()){ alert('Tahle přezdívka je už obsazená, zkus jinou.'); btn.disabled = false; return; }
    await setDoc(usernameDocRef(nick), { uid: currentUser.uid, email: currentUser.email });
    await setDoc(doc(db, 'users', currentUser.uid), { nick, email: currentUser.email, phone, createdAt: new Date().toISOString(), lastLogin: new Date().toISOString() });
    currentNick = nick;
    updateAuthUI();
  }catch(err){ console.error(err); alert('Uložení přezdívky se nepovedlo. Zkus to znovu.'); }
  finally{ btn.disabled = false; }
});

document.getElementById('btn-logout').addEventListener('click', async () => { closeContactForm(); closeEventForm(); await signOut(auth); });

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

// ---- Emotikon: změna ----
const EMOJI_PRESETS = ['🎮','🕹️','👾','💻','🖱️','🔥','💀','👑','😎','🍺','🍕','⚡','🌙','🐉','👻','🎲'];
document.getElementById('emoji-preset-row').innerHTML = EMOJI_PRESETS.map(e => `<span class="chip" data-emoji-pick="${e}" style="cursor:pointer; font-size:16px;">${e}</span>`).join('');
document.getElementById('emoji-preset-row').addEventListener('click', (e) => {
  const target = e.target.closest('[data-emoji-pick]');
  if(target) document.getElementById('new-emoji-input').value = target.dataset.emojiPick;
});
document.getElementById('btn-toggle-emoji').addEventListener('click', () => {
  const form = document.getElementById('form-change-emoji');
  const opening = form.style.display === 'none';
  closeAllAccountPanels();
  if(opening){
    document.getElementById('new-emoji-input').value = currentEmoji || '';
    form.style.display = 'flex';
  }
});
document.getElementById('btn-cancel-emoji').addEventListener('click', () => {
  document.getElementById('form-change-emoji').style.display = 'none';
});
document.getElementById('form-change-emoji').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('emoji-change-msg');
  const newEmoji = document.getElementById('new-emoji-input').value.trim();
  if(!currentUser) return;
  msg.textContent = '';
  try{
    await updateDoc(doc(db,'users',currentUser.uid), { emoji: newEmoji });
    currentEmoji = newEmoji;
    document.getElementById('form-change-emoji').style.display = 'none';
    updateAuthUI();
  }catch(err){ console.error(err); msg.textContent = 'Nepovedlo se — zkus to prosím znovu.'; }
});

// ---- Telefon: změna ----
document.getElementById('btn-toggle-phone').addEventListener('click', () => {
  const form = document.getElementById('form-change-phone');
  const opening = form.style.display === 'none';
  closeAllAccountPanels();
  if(opening){
    document.getElementById('new-phone-input').value = currentPhone || '';
    form.style.display = 'flex';
  }
});
document.getElementById('btn-cancel-phone').addEventListener('click', () => {
  document.getElementById('form-change-phone').style.display = 'none';
});
document.getElementById('form-change-phone').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('phone-change-msg');
  const newPhone = document.getElementById('new-phone-input').value.trim();
  if(!currentUser) return;
  msg.textContent = '';
  try{
    await updateDoc(doc(db,'users',currentUser.uid), { phone: newPhone });
    currentPhone = newPhone;
    document.getElementById('form-change-phone').style.display = 'none';
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
  document.getElementById('form-change-phone').style.display = 'none';
  document.getElementById('form-change-emoji').style.display = 'none';
  document.getElementById('pw-reset-panel').style.display = 'none';
}

async function renderUsersList(){
  const box = document.getElementById('users-list');
  if(!box) return;
  box.innerHTML = '<div class="empty">Načítám...</div>';
  try{
    const snap = await getDocs(collection(db, 'users'));
    const users = snap.docs.map(d => ({ uid: d.id, ...d.data() })).sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));
    if(users.length === 0){ box.innerHTML = '<div class="empty">Zatím žádní uživatelé.</div>'; return; }

    const showPerms = currentIsSuperAdmin;
    box.innerHTML = `
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
              <td style="padding:8px 10px; color:var(--text-muted);">${escapeHtml(u.email||'')}</td>
              <td style="padding:8px 10px;"><input type="tel" data-edit-phone="${u.uid}" value="${escapeHtml(u.phone||'')}" placeholder="—" style="width:120px; background:var(--bg-void); border:1px solid var(--line); color:var(--text); padding:4px 6px; font-size:13px;"></td>
              <td style="padding:8px 10px;"><input type="date" data-edit-created="${u.uid}" value="${u.createdAt ? u.createdAt.slice(0,10) : ''}" style="background:var(--bg-void); border:1px solid var(--line); color:var(--text); padding:4px 6px; font-size:13px;"></td>
              <td style="padding:8px 10px; color:var(--text-muted);">${u.lastLogin ? fmtDate(u.lastLogin.slice(0,10)) : '—'}</td>
              <td style="padding:8px 10px;"><button type="button" class="btn-ghost btn-sm" data-save-user="${u.uid}">Uložit</button></td>
              <td style="padding:8px 10px;">${(u.isSuperAdmin || (u.isAdmin && !currentIsSuperAdmin)) ? '' : `<button type="button" class="btn-ghost btn-sm" data-delete-user="${u.uid}" data-delete-nick="${escapeHtml(u.nick||'')}" style="color:var(--crimson); border-color:var(--crimson);">Smazat</button>`}</td>
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
      ${showPerms ? '<p class="lede" style="margin-top:10px; font-size:12px;">Zaškrtnutí oprávnění se ukládá spolu s ostatními údaji tlačítkem "Uložit" u daného uživatele.</p>' : ''}

      <div class="section-title" style="font-size:16px; margin-top:36px;">Přezdívky — duplicity a osamocené záznamy</div>
      <p class="lede" style="margin-top:0;">Tady se zobrazují jen přezdívky, které buď nemají odpovídající účet (osamocené, třeba po nepovedené registraci), nebo jich je pro stejný účet víc (duplicity). Běžné, správně fungující přezdívky se tu nezobrazují.</p>
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
          btn.textContent = 'Uloženo!';
          setTimeout(() => { btn.textContent = 'Uložit'; }, 1200);
        }catch(err){ alert('Uložení se nepovedlo.'); console.error(err); }
      });
    });
    box.querySelectorAll('[data-delete-user]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = btn.dataset.deleteUser;
        const nick = btn.dataset.deleteNick;
        if(!confirm(`Opravdu úplně odstranit uživatele "${nick}"? Smaže se jeho profil i přezdívka. (Přihlašovací údaj ve Firebase zůstane technicky existovat, ale bez profilu se nepřihlásí.) Tohle nejde vrátit zpět.`)) return;
        try{
          await deleteDoc(doc(db,'users',uid));
          if(nick) await deleteDoc(usernameDocRef(nick));
          renderUsersList();
        }catch(err){ alert('Smazání se nepovedlo.'); console.error(err); }
      });
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

function updateAuthUI(){
  const loggedOutBox = document.getElementById('auth-logged-out');
  const loggedInBox = document.getElementById('auth-logged-in');
  const googleNickPrompt = document.getElementById('auth-google-nick-prompt');
  const navLabel = document.getElementById('nav-ucet-label');

  if(currentUser && currentNick){
    loggedOutBox.style.display = 'none';
    loggedInBox.style.display = 'block';
    googleNickPrompt.style.display = 'none';
    document.getElementById('account-nick-display').textContent = currentNick + (currentIsSuperAdmin ? ' (hlavní admin)' : (currentIsAdmin ? ' (admin)' : ''));
    document.getElementById('account-email-display').textContent = currentUser.email || '';
    document.getElementById('account-phone-display').textContent = currentPhone || '—';
    document.getElementById('account-emoji-display').textContent = currentEmoji || '—';
    document.getElementById('reauth-password-field').style.display = hasPasswordProvider(currentUser) ? 'block' : 'none';
    document.getElementById('password-row').style.display = hasPasswordProvider(currentUser) ? 'flex' : 'none';
    navLabel.textContent = 'Účet';
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
  renderContacts();
  if(currentDetailEventId){ renderStatsAndRsvp(); renderAttendees(); }

  document.getElementById('nav-item-uzivatele').style.display = hasPerm('uzivatele') ? 'flex' : 'none';
  document.getElementById('nav-sep-admin').style.display = hasPerm('uzivatele') ? 'block' : 'none';
  if(hasPerm('uzivatele')) renderUsersList();
  if(!hasPerm('uzivatele') && document.getElementById('view-uzivatele').classList.contains('active')){
    showView('akce');
  }

  const accWidget = document.getElementById('topbar-account-widget');
  if(currentUser && currentNick){
    accWidget.innerHTML = `<span class="acc-nick">${escapeHtml(currentNick)}</span><button type="button" class="btn-ghost btn-sm" id="topbar-logout-btn">Odhlásit</button>`;
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
  currentUser = user;
  currentNick = null;
  currentIsAdmin = false;
  currentIsSuperAdmin = false;
  currentPermissions = {};
  currentPhone = '';
  currentEmoji = '';
  if(user){
    try{
      const userDoc = await getDocFromServer(doc(db, 'users', user.uid));
      if(myGen !== authStateGeneration) return; // mezitím se spustila novější kontrola, tuhle zahodíme
      if(userDoc.exists()){
        currentNick = userDoc.data().nick;
        currentIsSuperAdmin = userDoc.data().isSuperAdmin === true || userDoc.data().isSuperAdmin === 'true';
        currentIsAdmin = currentIsSuperAdmin || userDoc.data().isAdmin === true || userDoc.data().isAdmin === 'true';
        currentPermissions = userDoc.data().permissions || {};
        currentPhone = userDoc.data().phone || '';
        currentEmoji = userDoc.data().emoji || '';
        if(userDoc.data().email !== user.email){
          try{
            await updateDoc(doc(db,'users',user.uid), { email: user.email });
            await updateDoc(usernameDocRef(currentNick), { email: user.email });
          }catch(e){ /* tichý fail, není kritické */ }
          if(myGen !== authStateGeneration) return;
        }
        // aktualizace posledního přihlášení běží na pozadí, nečeká se na ni (nesmí blokovat vykreslení)
        updateDoc(doc(db,'users',user.uid), { lastLogin: new Date().toISOString() }).catch(()=>{});
      }
    }catch(err){ console.error(err); }
    if(myGen !== authStateGeneration) return;
    updateAuthUI();
    if(currentNick && pendingEventId){
      const evId = pendingEventId;
      pendingEventId = null;
      setRoute('#event/' + evId);
    }
  }else{
    updateAuthUI();
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
