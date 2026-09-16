import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, addDoc, onSnapshot, query, orderBy, doc, getDoc, getDocs, setDoc,
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
  { key:'sun-breakfast', label:'Neděle — Snídaně' },
  { key:'pivo',          label:'Pivo' }
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
  let range = (ev.dateEnd && ev.dateEnd !== ev.dateStart) ? `${fmtDateShort(ev.dateStart)} – ${fmtDate(ev.dateEnd)}` : fmtDate(ev.dateStart);
  if(ev.timeStart) range += `, ${ev.timeStart}${ev.timeEnd ? '–'+ev.timeEnd : ''}`;
  return range;
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
function setupChatEmojiRow(rowId, inputId){
  const row = document.getElementById(rowId);
  if(!row) return;
  row.innerHTML = CHAT_EMOJIS.map(e => `<span class="chip" data-chat-emoji="${e}" style="cursor:pointer; font-size:15px;">${e}</span>`).join('');
  row.querySelectorAll('[data-chat-emoji]').forEach(el => {
    el.addEventListener('click', () => {
      const input = document.getElementById(inputId);
      input.value += el.dataset.chatEmoji;
      input.focus();
    });
  });
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
  closeEventForm();
  showView(n.dataset.view);
}));
document.getElementById('brand-home-link').addEventListener('click', () => {
  closeEventForm();
  showView('home');
});
document.getElementById('btn-back-to-akce').addEventListener('click', () => { showView('akce'); });

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
  document.getElementById('btn-new-contact').style.display = currentIsAdmin ? 'inline-flex' : 'none';
  if(contacts.length === 0){ grid.innerHTML = '<div class="empty">Zatím žádné kontakty.</div>'; return; }
  grid.innerHTML = contacts.map(c => `
    <div class="contact-card">
      <div class="contact-avatar" style="${c.photo ? `background-image:url('${c.photo.replace(/'/g,"")}')` : ''}">${c.photo ? '' : (c.emoji || '👤')}</div>
      <h3>${escapeHtml(c.name)}</h3>
      ${c.role ? `<div class="role">${escapeHtml(c.role)}</div>` : ''}
      ${c.contact ? `<div class="info">${escapeHtml(c.contact)}</div>` : ''}
      ${currentIsAdmin ? `
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
  btnNewEvent.style.display = currentIsAdmin ? 'inline-flex' : 'none';
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
        ${currentIsAdmin ? `
        <div class="row" style="margin-top:14px; max-width:280px;">
          <button type="button" class="btn-ghost btn-sm" data-edit-featured style="flex:1;">Upravit</button>
          <button type="button" class="btn-ghost btn-sm" data-delete-featured style="flex:1; color:var(--crimson); border-color:var(--crimson);">Smazat</button>
        </div>` : ''}
      </div>
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
          ${currentIsAdmin ? `
          <div class="row" style="margin-top:8px; gap:6px;">
            <button type="button" class="btn-ghost btn-sm" data-edit-history style="flex:1;">Upravit</button>
            <button type="button" class="btn-ghost btn-sm" data-delete-history style="flex:1; color:var(--crimson); border-color:var(--crimson);">Smazat</button>
          </div>` : ''}
        </div>
      `;
      card.addEventListener('click', (e) => {
        if(e.target.closest('[data-edit-history]') || e.target.closest('[data-delete-history]')) return;
        openEventDetail(ev.id);
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
  currentTournamentIndex = 0;
  teamEditorOpen = false;
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
  document.querySelectorAll('#ed-tabs .tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === currentTab);
    btn.onclick = () => {
      currentTab = btn.dataset.tab;
      document.querySelectorAll('#ed-tabs .tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      Object.entries(tabPanels).forEach(([key, id]) => {
        document.getElementById(id).style.display = (key === currentTab) ? 'block' : 'none';
      });
      renderActiveTab(ev);
    };
  });

  renderStatsAndRsvp();
  renderAttendees();
  renderActiveTab(ev);
}

function renderActiveTab(ev){
  if(currentTab === 'prehled') renderTabPrehled(ev);
  else if(currentTab === 'rozvrh') renderTabRozvrh(ev);
  else if(currentTab === 'jidlo') renderTabJidlo(ev);
  else if(currentTab === 'turnaj') renderTabTurnaj(ev);
  else renderTabFoto(ev);
}

function renderEntryFeeBlock(ev){
  let box = document.getElementById('ed-entryfee');
  if(!box){
    box = document.createElement('div');
    box.id = 'ed-entryfee';
    document.getElementById('ed-rsvp').insertAdjacentElement('afterend', box);
  }
  if(!ev.fee && !ev.qrUrl){ box.innerHTML = ''; return; }
  box.className = 'entry-fee-box';
  box.innerHTML = `
    ${ev.fee ? `<div><div class="eyebrow" style="margin-bottom:4px;">Vstupné</div><div style="font-size:20px; font-weight:600; color:var(--gold);">${ev.fee} Kč</div></div>` : ''}
    ${ev.qrUrl ? `<div><div class="eyebrow" style="margin-bottom:4px;">QR platba</div><img class="qr-code-img" src="${ev.qrUrl.replace(/"/g,'&quot;')}" alt="QR kód pro platbu"></div>` : ''}
  `;
}

function renderDateVoteBlock(ev){
  let box = document.getElementById('ed-datevote');
  if(!box){
    box = document.createElement('div');
    box.id = 'ed-datevote';
    document.getElementById('ed-entryfee').insertAdjacentElement('afterend', box);
  }
  const options = ev.dateOptions || [];
  if(options.length === 0 || ev.dateVotingClosed){ box.innerHTML = ''; return; }

  const votes = ev.dateVotes || {};
  const myVote = currentUser ? votes[currentUser.uid] : undefined;
  const deadlinePassedForVote = ev.dateVoteDeadline && todayIso() > ev.dateVoteDeadline;

  box.className = 'panel';
  box.style.maxWidth = '520px';
  box.innerHTML = `
    <div class="section-title" style="font-size:16px;">🗳️ Hlasování o termínu</div>
    ${ev.dateVoteDeadline ? `<p class="lede" style="margin-top:0;">Hlasování otevřené do ${fmtDate(ev.dateVoteDeadline)}.</p>` : ''}
    ${options.map((opt, idx) => {
      const count = Object.values(votes).filter(v => v === idx).length;
      const isMine = myVote === idx;
      return `
        <div class="row" style="margin-top:8px; align-items:center;">
          <span style="flex:1;">${fmtDateShort(opt.start)} – ${fmtDate(opt.end)} <span class="status-hint">(${count} hlasů)</span></span>
          ${currentUser ? `<button type="button" class="btn-sm ${isMine?'btn-active':''}" data-vote-date="${idx}" ${deadlinePassedForVote?'disabled':''}>${isMine?'Tvůj hlas':'Hlasovat'}</button>` : ''}
          ${currentIsAdmin ? `<button type="button" class="btn-ghost btn-sm" data-finalize-date="${idx}">Vybrat tento termín</button>` : ''}
        </div>
      `;
    }).join('')}
  `;

  box.querySelectorAll('[data-vote-date]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if(!currentUser){ showView('ucet'); return; }
      try{ await updateDoc(doc(db,'events',ev.id), { [`dateVotes.${currentUser.uid}`]: parseInt(btn.dataset.voteDate,10) }); }
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
          nick: currentNick, emoji: currentEmoji, uid: currentUser.uid, status: 'going', food: {}, ts: new Date().toISOString()
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
        ? `<span class="coin-icon ${r.paid ? 'paid' : 'unpaid'} ${currentIsAdmin ? 'admin-toggle' : ''}" data-toggle-paid="${currentIsAdmin ? r._docId : ''}" title="${r.paid ? 'Zaplaceno' : 'Nezaplaceno'}">${coinSvg(r.paid)}</span>`
        : '';
      return `
        <div class="attendee-row">
          <span style="display:flex; align-items:center; gap:6px;">${coinHtml}${r.emoji ? escapeHtml(r.emoji)+' ' : ''}${escapeHtml(r.nick || '(bez jména)')}</span>
          <span style="display:flex; align-items:center; gap:6px;">
            ${statusHtml}
            ${(currentIsAdmin && !isSelf) ? `<button type="button" class="btn-ghost btn-sm" data-remove-attendee="${r._docId}" title="Odebrat" style="padding:2px 7px; color:var(--crimson); border-color:var(--crimson);">×</button>` : ''}
          </span>
        </div>
      `;
    }).join('');
  }

  if(currentIsAdmin){
    html += `<div style="margin-top:12px; padding-top:10px; border-top:1px solid var(--line);"><button type="button" id="btn-add-manual-attendee" class="btn-ghost btn-sm" style="width:100%;">+ Přidat účastníka</button></div>`;
  }

  box.innerHTML = html;

  const addManualBtn = document.getElementById('btn-add-manual-attendee');
  if(addManualBtn) addManualBtn.addEventListener('click', async () => {
    const nick = prompt('Přezdívka účastníka:');
    if(!nick || !nick.trim()) return;
    try{
      await addDoc(collection(db, 'events', currentDetailEventId, 'registrations'), {
        nick: nick.trim(), status: 'going', food: {}, ts: new Date().toISOString(), manual: true
      });
    }catch(err){ alert('Přidání se nepovedlo.'); console.error(err); }
  });

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
  const games = [...(ev.games || [])].sort((a,b) => a.localeCompare(b, 'cs'));
  box.innerHTML = `
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:28px;">
      <div>
        <div class="section-title" style="font-size:16px;">Co se bude hrát</div>
        <div class="chip-row" style="flex-direction:column; align-items:flex-start;">${games.length ? games.map(g=>`<span class="chip">${escapeHtml(g)}</span>`).join('') : '<span class="empty">Zatím nic nevypsáno.</span>'}</div>
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
    <div class="chip-row" id="chat-emoji-row-comment" style="margin-top:0;"></div>
    <div class="field" style="max-width:460px; display:flex; flex-direction:row; gap:8px; align-items:flex-end;">
      <div style="flex:1;"><textarea class="discussion-input" id="comment-input" placeholder="Napiš příspěvek do diskuze..."></textarea></div>
      <button type="button" id="btn-add-comment" class="btn-sm">Odeslat</button>
    </div>
    <div id="comments-list" style="margin-top:6px;"></div>
  `;
  setupChatEmojiRow('chat-emoji-row-comment', 'comment-input');

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
    const likers = (s.likeNicks||[]).join(', ');
    const canEdit = currentUser && (s.uid === currentUser.uid || currentIsAdmin);
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
    const canEdit = currentUser && (c.uid === currentUser.uid || currentIsAdmin);
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
    slotsHtml = activeSlots.map(slot => {
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
          ${currentIsAdmin ? `<span class="portion-count">${portionCounts[o]}×</span>` : ''}
        </label>
      `).join('');

      return `
        <div class="meal-slot-block" style="margin-bottom:24px;">
          <b style="font-size:14px;">${slot.label}</b>
          <div style="margin-top:6px;">${myReg ? checkboxesHtml : '<span class="status-hint">Přihlas se na akci, ať můžeš vybrat.</span>'}</div>
        </div>
      `;
    }).join('');
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
    <div class="chip-row" id="chat-emoji-row-food" style="margin-top:0;"></div>
    <div class="field" style="max-width:460px; display:flex; flex-direction:row; gap:8px; align-items:flex-end;">
      <div style="flex:1;"><textarea class="discussion-input" id="food-comment-input" placeholder="Kdo co doveze, návrhy..."></textarea></div>
      <button type="button" id="btn-add-food-comment" class="btn-sm">Odeslat</button>
    </div>
    <div id="food-comments-list" style="margin-top:6px;"></div>
  `;
  setupChatEmojiRow('chat-emoji-row-food', 'food-comment-input');

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
        const canEdit = currentUser && (c.uid === currentUser.uid || currentIsAdmin);
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

// ---- Turnaj: round robin (každý s každým) + tiebreaky + play-off o umístění ----
let currentTournamentIndex = 0;
let teamEditorOpen = false;

// ---- Turnaj: iterativní systém podle pořadí ----
// Kolo 1 = základní část (každý s každým). Další kola: aktuálně nejlepší dva hrají spolu,
// další dva podle pořadí spolu atd. Jakmile lídr porazí svého nejbližšího soupeře a nikdo
// ho už nemůže bodově dohnat, je určeno umístění a pokračuje se s dalšími týmy o zbylá místa.
function teamName(t, idx){ return t.teams[idx] ? t.teams[idx].name : `Tým ${idx+1}`; }

function renderTabTurnaj(ev){
  const box = document.getElementById('tab-turnaj');
  const tournaments = ev.tournaments || [];
  if(currentTournamentIndex >= tournaments.length) currentTournamentIndex = Math.max(0, tournaments.length-1);

  let html = `<div class="section-title" style="font-size:16px;">Turnaj</div><div class="tourney-select-row">`;
  if(tournaments.length > 0){
    html += `<div class="field" style="max-width:240px;"><label>Turnaj</label><select id="tourney-select">${tournaments.map((t,i)=>`<option value="${i}" ${i===currentTournamentIndex?'selected':''}>${escapeHtml(t.name||('Turnaj '+(i+1)))}</option>`).join('')}</select></div>`;
  }
  if(currentIsAdmin) html += `<button type="button" id="btn-new-tourney" class="btn-sm">+ Nový turnaj</button>`;
  if(currentIsAdmin && tournaments.length > 0) html += `<button type="button" id="btn-delete-tourney" class="btn-ghost btn-sm" style="color:var(--crimson); border-color:var(--crimson);">Smazat turnaj</button>`;
  html += `</div>`;
  box.innerHTML = html;

  const selectEl = document.getElementById('tourney-select');
  if(selectEl) selectEl.addEventListener('change', () => { currentTournamentIndex = parseInt(selectEl.value,10); teamEditorOpen=false; renderTabTurnaj(ev); });
  const newBtn = document.getElementById('btn-new-tourney');
  if(newBtn) newBtn.addEventListener('click', () => openNewTournamentForm(ev));
  const deleteBtn = document.getElementById('btn-delete-tourney');
  if(deleteBtn) deleteBtn.addEventListener('click', async () => {
    const tName = tournaments[currentTournamentIndex]?.name || 'tento turnaj';
    if(!confirm(`Opravdu smazat "${tName}"? Tohle nejde vrátit zpět.`)) return;
    const newTournaments = tournaments.filter((_, i) => i !== currentTournamentIndex);
    try{
      await updateDoc(doc(db,'events',ev.id), { tournaments: newTournaments });
      currentTournamentIndex = Math.max(0, currentTournamentIndex - 1);
    }catch(err){ alert('Smazání se nepovedlo.'); console.error(err); }
  });

  if(tournaments.length === 0){
    box.insertAdjacentHTML('beforeend', '<div class="empty">Zatím žádný turnaj nebyl založen.</div>');
    return;
  }

  const t = tournaments[currentTournamentIndex];
  const bodyWrap = document.createElement('div');
  bodyWrap.id = 'tourney-body';
  box.appendChild(bodyWrap);

  if(currentIsAdmin){
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'btn-ghost btn-sm';
    toggleBtn.style.marginBottom = '14px';
    toggleBtn.textContent = teamEditorOpen ? 'Skrýt úpravu týmů' : 'Upravit týmy';
    toggleBtn.addEventListener('click', () => { teamEditorOpen = !teamEditorOpen; renderTabTurnaj(ev); });
    bodyWrap.appendChild(toggleBtn);
    if(teamEditorOpen) renderTeamEditor(ev, t, currentTournamentIndex, bodyWrap);
  }

  const swiss = computeSwissTournament(t);
  renderSwissBody(ev, t, currentTournamentIndex, swiss, bodyWrap);
}

function openNewTournamentForm(ev){
  const box = document.getElementById('tab-turnaj');
  const panel = document.createElement('div');
  panel.className = 'tourney-setup-panel';
  panel.innerHTML = `
    <div class="field" style="max-width:300px;"><label>Název turnaje</label><input type="text" id="new-tourney-name" placeholder="Hlavní Dota turnaj"></div>
    <div class="field" style="max-width:160px;"><label>Počet týmů</label><input type="number" id="new-tourney-count" min="2" value="4"></div>
    <button type="button" id="btn-create-tourney" class="btn-sm">Vytvořit</button>
  `;
  box.appendChild(panel);
  document.getElementById('btn-create-tourney').addEventListener('click', async () => {
    const name = document.getElementById('new-tourney-name').value.trim() || `Turnaj ${(ev.tournaments||[]).length+1}`;
    const count = Math.max(2, parseInt(document.getElementById('new-tourney-count').value,10)||2);
    const teams = [];
    for(let i=0;i<count;i++) teams.push({ name:`Tým ${i+1}`, members:[] });
    const tournaments = [...(ev.tournaments||[]), { name, teams, results:{} }];
    try{
      await updateDoc(doc(db,'events',ev.id), { tournaments });
      currentTournamentIndex = tournaments.length-1;
    }catch(err){ alert('Vytvoření turnaje se nepovedlo.'); console.error(err); }
  });
}

function isMemberElsewhere(teams, currentIdx, nick){
  return teams.some((tm,i) => i!==currentIdx && tm.members.includes(nick));
}

function renderTeamEditor(ev, t, tIndex, container){
  const goingRegs = Object.values(currentRegistrationsMap).filter(r=>r.status!=='maybe').sort((a,b)=>(a.ts||'').localeCompare(b.ts||''));
  const editorWrap = document.createElement('div');
  editorWrap.className = 'tourney-setup-panel';
  editorWrap.innerHTML = `
    <div class="team-editor" id="team-editor-grid"></div>
    <div style="display:flex; gap:10px; margin-top:14px;">
      <button type="button" id="btn-add-team" class="btn-sm">+ Přidat tým</button>
      <button type="button" id="btn-save-teams">Uložit týmy</button>
    </div>
  `;
  container.appendChild(editorWrap);

  let workingTeams = JSON.parse(JSON.stringify(t.teams || []));

  function renderGrid(){
    const grid = document.getElementById('team-editor-grid');
    grid.innerHTML = workingTeams.map((team, ti) => `
      <div class="team-editor-card">
        <input type="text" class="team-name" data-team-name="${ti}" value="${escapeHtml(team.name)}">
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
          <input type="text" placeholder="Přidat hráče mimo seznam" data-guest-input="${ti}">
          <button type="button" class="btn-ghost btn-sm" data-guest-add="${ti}">+</button>
        </div>
        ${workingTeams.length > 2 ? `<button type="button" class="btn-ghost btn-sm" data-remove-team="${ti}" style="margin-top:8px; color:var(--crimson); border-color:var(--crimson);">Odebrat tým</button>` : ''}
      </div>
    `).join('');

    grid.querySelectorAll('[data-team-name]').forEach(inp => {
      inp.addEventListener('input', () => { workingTeams[parseInt(inp.dataset.teamName,10)].name = inp.value; });
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

  document.getElementById('btn-add-team').addEventListener('click', () => {
    workingTeams.push({ name:`Tým ${workingTeams.length+1}`, members:[] });
    renderGrid();
  });

  document.getElementById('btn-save-teams').addEventListener('click', async () => {
    const tournaments = JSON.parse(JSON.stringify(ev.tournaments||[]));
    tournaments[tIndex].teams = workingTeams;
    try{ await updateDoc(doc(db,'events',ev.id), { tournaments }); }
    catch(err){ alert('Uložení týmů se nepovedlo.'); console.error(err); }
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

  // Kolo 1 — základní část, každý s každým
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

      let exhibition = null;
      if(leftover !== null && placements.length > 0){
        const lastLocked = placements[placements.length-1].team;
        const key = `SR${roundIndex}-ex`;
        const { result, winnerSide } = resolvePair(swissResults, key);
        const winnerIdx = winnerSide==='A' ? leftover : (winnerSide==='B' ? lastLocked : null);
        exhibition = { key, teamA:leftover, teamB:lastLocked, result, winnerIdx, exhibition:true };
      }

      rounds.push(exhibition ? [...roundMatches, exhibition] : roundMatches);

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

function renderSwissBody(ev, t, tIndex, swiss, container){
  const wrap = document.createElement('div');
  wrap.className = 'bracket-wrap';
  container.appendChild(wrap);

  swiss.rounds.forEach((roundMatches, ri) => {
    const col = document.createElement('div');
    col.className = 'bracket-round';
    col.innerHTML = `<div class="bracket-round-title">Kolo ${ri+1}</div>`;
    roundMatches.forEach(m => col.appendChild(renderSwissMatchBox(ev, tIndex, ri===0?'results':'swissResults', m, t)));
    wrap.appendChild(col);
  });

  if(!swiss.round0Complete){
    const col = document.createElement('div');
    col.className = 'bracket-round';
    col.innerHTML = `<div class="bracket-round-title">Další kola</div><div class="bracket-slot placeholder">Čeká na dohrání kola 1</div>`;
    wrap.appendChild(col);
  }

  if(swiss.placements.length > 0){
    const col = document.createElement('div');
    col.className = 'bracket-round';
    col.innerHTML = `<div class="bracket-round-title">Výsledek</div>` + swiss.placements.map(p => `
      <div class="bracket-slot ${p.rank===1?'winner-slot':''}"><span>${p.rank}. ${escapeHtml(teamName(t,p.team))}</span></div>
    `).join('');
    wrap.appendChild(col);
  }
}

function renderSwissMatchBox(ev, tIndex, resultField, m, t){
  const div = document.createElement('div');
  div.className = 'bracket-match';
  const labelA = teamName(t, m.teamA), labelB = teamName(t, m.teamB);
  const scoreTxt = m.result ? ` (${m.result.a}:${m.result.b})` : '';
  div.innerHTML = `
    ${m.exhibition ? `<div style="font-size:10px; color:var(--text-muted); margin-bottom:2px;">jen pro zábavu</div>` : ''}
    <div class="bracket-slot ${m.winnerIdx===m.teamA ? 'winner-slot':''}"><span>${escapeHtml(labelA)}</span>${m.winnerIdx===m.teamA?`<span>${scoreTxt}</span>`:''}</div>
    <div class="bracket-slot ${m.winnerIdx===m.teamB ? 'winner-slot':''}"><span>${escapeHtml(labelB)}</span>${m.winnerIdx===m.teamB?`<span>${scoreTxt}</span>`:''}</div>
    ${currentIsAdmin ? `<button type="button" class="bracket-score-btn btn-ghost" data-sw-score>${m.result?'Upravit':'Zadat výsledek'}</button>` : ''}
  `;
  const btn = div.querySelector('[data-sw-score]');
  if(btn) btn.addEventListener('click', () => openScoreModal(ev, tIndex, resultField, m.key, labelA, labelB, m.result));
  return div;
}

function openScoreModal(ev, tIndex, resultField, matchKey, labelA, labelB, existing){
  const backdrop = document.createElement('div');
  backdrop.className = 'score-modal-backdrop';
  backdrop.innerHTML = `
    <div class="score-modal">
      <div style="font-size:14px; font-weight:600;">Zadej výsledek (na 2 vítězné sety)</div>
      <div class="row"><span>${escapeHtml(labelA)}</span><input type="number" id="score-a" min="0" max="2" value="${existing?existing.a:0}"></div>
      <div class="row"><span>${escapeHtml(labelB)}</span><input type="number" id="score-b" min="0" max="2" value="${existing?existing.b:0}"></div>
      <div style="display:flex; gap:8px;">
        <button type="button" id="score-save">Uložit</button>
        <button type="button" class="btn-ghost" id="score-cancel">Zrušit</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  document.getElementById('score-cancel').addEventListener('click', () => backdrop.remove());
  document.getElementById('score-save').addEventListener('click', async () => {
    const a = parseInt(document.getElementById('score-a').value,10)||0;
    const b = parseInt(document.getElementById('score-b').value,10)||0;
    if(a<2 && b<2){ alert('Jeden z týmů musí mít alespoň 2 vítězné sety.'); return; }
    if(a===b){ alert('Skóre nemůže být nerozhodné.'); return; }
    const tournaments = JSON.parse(JSON.stringify(ev.tournaments||[]));
    if(!tournaments[tIndex][resultField]) tournaments[tIndex][resultField] = {};
    tournaments[tIndex][resultField][matchKey] = { a, b };
    try{
      await updateDoc(doc(db,'events',ev.id), { tournaments });
      backdrop.remove();
    }catch(err){ alert('Uložení výsledku se nepovedlo.'); console.error(err); }
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
  if(currentIsAdmin){
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
            ${currentIsAdmin ? `<button type="button" class="btn-ghost btn-sm" data-remove-sch="${it.idx}" style="color:var(--crimson); border-color:var(--crimson);">Smazat</button>` : ''}
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
    const canDelete = currentUser && (p.uid === currentUser.uid || currentIsAdmin);
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
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await setDoc(usernameDocRef(pendingNickForRegistration), { uid: cred.user.uid, email });
      await setDoc(doc(db, 'users', cred.user.uid), { nick: pendingNickForRegistration, email, phone, createdAt: new Date().toISOString(), lastLogin: new Date().toISOString() });
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
    box.innerHTML = `
      <table style="width:100%; max-width:820px; border-collapse:collapse; font-size:14px;">
        <thead><tr style="text-align:left; color:var(--text-muted); font-size:12px;">
          <th style="padding:8px 10px 8px 0;">Přezdívka</th><th style="padding:8px 10px;">E-mail</th><th style="padding:8px 10px;">Telefon</th><th style="padding:8px 10px;">Registrace</th><th style="padding:8px 10px;">Poslední přihlášení</th><th></th>
        </tr></thead>
        <tbody>
          ${users.map(u => `
            <tr style="border-top:1px solid var(--line);" data-user-row="${u.uid}">
              <td style="padding:8px 10px 8px 0;">${escapeHtml(u.nick||'')}${u.isAdmin?' <span style="color:var(--gold); font-size:11px;">(admin)</span>':''}</td>
              <td style="padding:8px 10px; color:var(--text-muted);">${escapeHtml(u.email||'')}</td>
              <td style="padding:8px 10px;"><input type="tel" data-edit-phone="${u.uid}" value="${escapeHtml(u.phone||'')}" placeholder="—" style="width:120px; background:var(--bg-void); border:1px solid var(--line); color:var(--text); padding:4px 6px; font-size:13px;"></td>
              <td style="padding:8px 10px;"><input type="date" data-edit-created="${u.uid}" value="${u.createdAt ? u.createdAt.slice(0,10) : ''}" style="background:var(--bg-void); border:1px solid var(--line); color:var(--text); padding:4px 6px; font-size:13px;"></td>
              <td style="padding:8px 10px; color:var(--text-muted);">${u.lastLogin ? fmtDate(u.lastLogin.slice(0,10)) : '—'}</td>
              <td style="padding:8px 10px;"><button type="button" class="btn-ghost btn-sm" data-save-user="${u.uid}">Uložit</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      ${users.some(u=>u.phone) ? `<button type="button" id="btn-copy-phones" class="btn-sm" style="margin-top:16px;">Kopírovat telefony (pro ruční SMS)</button>` : ''}
    `;
    box.querySelectorAll('[data-save-user]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = btn.dataset.saveUser;
        const phone = box.querySelector(`[data-edit-phone="${uid}"]`).value.trim();
        const createdDate = box.querySelector(`[data-edit-created="${uid}"]`).value;
        const payload = { phone };
        if(createdDate) payload.createdAt = createdDate + 'T12:00:00.000Z';
        try{
          await updateDoc(doc(db,'users',uid), payload);
          btn.textContent = 'Uloženo!';
          setTimeout(() => { btn.textContent = 'Uložit'; }, 1200);
        }catch(err){ alert('Uložení se nepovedlo.'); console.error(err); }
      });
    });
    const copyBtn = document.getElementById('btn-copy-phones');
    if(copyBtn) copyBtn.addEventListener('click', () => {
      const phones = users.filter(u=>u.phone).map(u=>u.phone).join(', ');
      navigator.clipboard.writeText(phones).then(() => { copyBtn.textContent = 'Zkopírováno!'; setTimeout(()=>copyBtn.textContent='Kopírovat telefony (pro ruční SMS)', 1500); });
    });
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
    document.getElementById('account-nick-display').textContent = currentNick + (currentIsAdmin ? ' (admin)' : '');
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

  document.getElementById('nav-item-uzivatele').style.display = currentIsAdmin ? 'flex' : 'none';
  document.getElementById('nav-sep-admin').style.display = currentIsAdmin ? 'block' : 'none';
  if(currentIsAdmin) renderUsersList();

  const accWidget = document.getElementById('topbar-account-widget');
  if(currentUser && currentNick){
    accWidget.innerHTML = `<span class="acc-nick">${escapeHtml(currentNick)}</span><button type="button" class="btn-ghost btn-sm" id="topbar-logout-btn">Odhlásit</button>`;
    document.getElementById('topbar-logout-btn').addEventListener('click', async () => { await signOut(auth); });
  }else{
    accWidget.innerHTML = `<button type="button" class="btn-sm" id="topbar-login-btn">Přihlásit / Registrovat</button>`;
    document.getElementById('topbar-login-btn').addEventListener('click', () => showView('ucet'));
  }
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  currentNick = null;
  currentIsAdmin = false;
  currentPhone = '';
  currentEmoji = '';
  if(user){
    try{
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if(userDoc.exists()){
        currentNick = userDoc.data().nick;
        currentIsAdmin = userDoc.data().isAdmin === true;
        currentPhone = userDoc.data().phone || '';
        currentEmoji = userDoc.data().emoji || '';
        if(userDoc.data().email !== user.email){
          try{
            await updateDoc(doc(db,'users',user.uid), { email: user.email });
            await updateDoc(usernameDocRef(currentNick), { email: user.email });
          }catch(e){ /* tichý fail, není kritické */ }
        }
        try{ await updateDoc(doc(db,'users',user.uid), { lastLogin: new Date().toISOString() }); }catch(e){}
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
