import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, addDoc, onSnapshot, query, orderBy, doc, getDoc, getDocFromServer, getDocs, setDoc,
  updateDoc, deleteDoc, arrayUnion, arrayRemove, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  GoogleAuthProvider, signInWithPopup, signOut, sendPasswordResetEmail,
  EmailAuthProvider, reauthenticateWithCredential, reauthenticateWithPopup, verifyBeforeUpdateEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

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
const storage = getStorage(app);

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
let currentAvatar = '';
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
function avatarTag(avatar, size){
  size = size || 20;
  return `<img src="${avatar.replace(/"/g,'&quot;')}" alt="" style="width:${size}px; height:${size}px; border-radius:50%; object-fit:cover; vertical-align:middle; margin-right:5px; flex-shrink:0;">`;
}
function authorLabel(author, emoji, avatar){
  if(avatar) return `${avatarTag(avatar)}${escapeHtml(author)}`;
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
  const [view, id, sub] = raw.split('/');
  turnajProjectorMode = (view === 'turnaj' && !!id && sub === 'projektor');
  document.body.classList.toggle('projector-mode', turnajProjectorMode);
  if(!turnajProjectorMode) document.querySelectorAll('.tb-unlock-sound').forEach(b => b.remove());
  if(view !== 'turnaj'){ tbStopLive(); tbCloseDrinkModal(); closeTbDevGraphModal(); }

  if(view === 'event' && id){
    currentTournamentId = null;
    openEventDetail(id);
  }else if(view === 'turnaj'){
    currentTournamentId = id || null;
    tourneySetupStep = null;
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
document.getElementById('btn-fetch-contact-avatar').addEventListener('click', async () => {
  const nameInput = document.getElementById('ct-name');
  const photoInput = document.getElementById('ct-photo');
  const name = nameInput.value.trim();
  if(!name){ alert('Nejdřív vyplň jméno kontaktu.'); return; }
  try{
    const unameSnap = await getDoc(usernameDocRef(name));
    if(!unameSnap.exists()){ alert('Žádný registrovaný uživatel s touhle přezdívkou nebyl nalezen.'); return; }
    const uid = unameSnap.data().uid;
    const userSnap = await getDoc(doc(db,'users',uid));
    if(!userSnap.exists() || !userSnap.data().avatar){ alert('Tenhle uživatel nemá nahranou žádnou profilovou fotku.'); return; }
    photoInput.value = userSnap.data().avatar;
  }catch(err){ console.error(err); alert('Nepovedlo se načíst.'); }
});
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
// Zdroj log her: Steam + IGDB kombinovaně (přes vlastní Cloud Run funkci, protože obě blokují přímé volání z prohlížeče)
function gameFieldHtml(existingName, existingImage){
  return `<div class="field" style="position:relative;">
    <label>Hra (nepovinné)</label>
    <div style="display:flex; gap:10px; align-items:center;">
      <div style="flex:1; position:relative;">
        <input type="text" id="new-tourney-game" placeholder="např. Dota 2, Quake 3 Arena, COD4..." autocomplete="off" value="${escapeHtml(existingName||'')}">
        <div id="new-tourney-game-list" class="game-autocomplete-list" style="display:none;"></div>
      </div>
      <img id="new-tourney-game-preview" src="${existingImage ? existingImage.replace(/"/g,'&quot;') : ''}" alt="" style="width:48px; height:48px; object-fit:contain; flex-shrink:0; ${existingImage ? '' : 'display:none;'}">
    </div>
    <small>Podle tohohle appka pozná, jestli u výsledků zobrazit Aegis nebo klasický pohár, a zobrazí se i větší náhled u turnaje.</small>
  </div>`;
}
function setupGameField(existingImage){
  let gameImage = existingImage || '';
  const input = document.getElementById('new-tourney-game');
  const list = document.getElementById('new-tourney-game-list');
  const preview = document.getElementById('new-tourney-game-preview');
  attachGameAutocomplete(input, list, (name, image) => {
    gameImage = image;
    if(image){ preview.src = image; preview.style.display = 'block'; }
    else{ preview.style.display = 'none'; }
  });
  return () => gameImage;
}

const STEAM_SEARCH_FUNCTION_URL = 'https://steam-game-search-632018940301.europe-west3.run.app';

// Znovupoužitelné vyhledávání hry s logem (pole "Hra" u turnajů). onPick(name, image) se zavolá při výběru z nabídky.
function attachGameAutocomplete(inputEl, listEl, onPick){
  let debounceTimer = null;
  inputEl.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    const q = e.target.value.trim();
    if(q.length < 2){ listEl.style.display = 'none'; return; }
    debounceTimer = setTimeout(async () => {
      try{
        const res = await fetch(`${STEAM_SEARCH_FUNCTION_URL}?term=${encodeURIComponent(q)}`);
        const data = await res.json();
        const results = data.items || [];
        if(results.length === 0){ listEl.style.display = 'none'; return; }
        listEl.innerHTML = results.map(r => `
          <div class="game-autocomplete-item" data-pick-game-name="${escapeHtml(r.name)}" data-pick-game-image="${r.image ? r.image.replace(/"/g,'&quot;') : ''}">
            ${r.image ? `<img src="${r.image.replace(/"/g,'&quot;')}" alt="">` : '<div class="game-autocomplete-noimg">🎮</div>'}
            <span>${escapeHtml(r.name)}</span>
          </div>
        `).join('');
        listEl.style.display = 'grid';
        listEl.querySelectorAll('[data-pick-game-name]').forEach(item => {
          item.addEventListener('click', () => {
            inputEl.value = item.dataset.pickGameName;
            listEl.style.display = 'none';
            onPick(item.dataset.pickGameName, item.dataset.pickGameImage || '');
          });
        });
      }catch(err){ console.error(err); listEl.style.display = 'none'; }
    }, 400);
  });
  document.addEventListener('click', (e) => {
    if(!e.target.closest(`#${inputEl.id}`) && !e.target.closest(`#${listEl.id}`)) listEl.style.display = 'none';
  });
}
let gameLogoTargetIdx = null;

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
    li.innerHTML = `${game.image ? `<img src="${game.image.replace(/"/g,'&quot;')}" alt="" class="game-chip-logo">` : ''}<span>${escapeHtml(game.name)}</span>${!game.image ? `<span class="find-logo-btn" data-find-logo="${idx}" title="Najít logo">🔍</span>` : ''}<span class="x" data-remove-game="${idx}">×</span>`;
    list.appendChild(li);
  });
  list.querySelectorAll('[data-remove-game]').forEach(el => {
    el.addEventListener('click', () => {
      currentEventGames.splice(parseInt(el.dataset.removeGame,10), 1);
      renderFormGames();
    });
  });
  list.querySelectorAll('[data-find-logo]').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.findLogo, 10);
      gameLogoTargetIdx = idx;
      const input = document.getElementById('input-add-game');
      input.value = normalizeGame(currentEventGames[idx]).name;
      input.focus();
      input.dispatchEvent(new Event('input'));
    });
  });
}

document.getElementById('btn-add-game').addEventListener('click', () => {
  const input = document.getElementById('input-add-game');
  const val = input.value.trim();
  if(!val) return;
  if(gameLogoTargetIdx !== null){
    // hledání loga ke stávající hře bylo zrušeno - jen zavřít, nepřidávat duplicitně
    gameLogoTargetIdx = null;
    input.value = '';
    document.getElementById('game-autocomplete-list').style.display = 'none';
    return;
  }
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
  if(!STEAM_SEARCH_FUNCTION_URL || q.length < 2){ box.style.display = 'none'; return; }
  gameSearchDebounce = setTimeout(async () => {
    try{
      const res = await fetch(`${STEAM_SEARCH_FUNCTION_URL}?term=${encodeURIComponent(q)}`);
      const data = await res.json();
      const results = data.items || [];
      if(results.length === 0){ box.style.display = 'none'; return; }
      box.innerHTML = results.map(r => `
        <div class="game-autocomplete-item" data-pick-game="${escapeHtml(r.name)}" data-pick-image="${r.image ? r.image.replace(/"/g,'&quot;') : ''}">
          ${r.image ? `<img src="${r.image.replace(/"/g,'&quot;')}" alt="">` : '<div class="game-autocomplete-noimg">🎮</div>'}
          <span>${escapeHtml(r.name)}</span>
        </div>
      `).join('');
      box.style.display = 'grid';
      box.querySelectorAll('[data-pick-game]').forEach(item => {
        item.addEventListener('click', () => {
          if(gameLogoTargetIdx !== null){
            currentEventGames[gameLogoTargetIdx] = { name: item.dataset.pickGame, image: item.dataset.pickImage || '' };
            gameLogoTargetIdx = null;
          }else{
            currentEventGames.push({ name: item.dataset.pickGame, image: item.dataset.pickImage || '' });
          }
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
  gameLogoTargetIdx = null;
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
let pendingSuggestionImage = '';
let currentComments = [];
let currentFoodComments = [];
let currentPhotos = [];

function renderTournamentSignupCta(ev){
  const box = document.getElementById('ed-tourney-cta');
  if(!box) return;
  const list = allTournaments.filter(x => x.eventId === ev.id && x.status === 'signup');
  if(list.length === 0){ box.innerHTML = ''; return; }
  box.innerHTML = `
    <div class="tourney-signup-panel">
      <div class="tourney-signup-panel-title">Otevřené turnaje</div>
      ${list.map(t => `
        <button type="button" class="tourney-signup-cta-btn" data-cta-open="${t.id}">
          <span class="tourney-cta-sparkles"></span>
          ${t.gameImage ? `<img src="${t.gameImage.replace(/"/g,'&quot;')}" alt="" class="tourney-cta-logo">` : ''}
          <span>${escapeHtml(t.name)}</span>
        </button>
      `).join('')}
    </div>
  `;
  box.querySelectorAll('[data-cta-open]').forEach(btn => {
    btn.addEventListener('click', () => setRoute('#turnaj/' + btn.dataset.ctaOpen));
  });
}

function renderEventDetailStatic(ev){
  document.getElementById('ed-title').textContent = (ev.number ? ev.number + ' — ' : '') + ev.name;
  document.getElementById('ed-meta').textContent = fmtDateRange(ev) + ' · ' + ev.place;
  document.getElementById('ed-desc').textContent = ev.desc || '';

  const header = document.getElementById('ed-header');
  header.style.backgroundImage = ev.imageUrl ? `url('${ev.imageUrl.replace(/'/g,"")}')` : 'none';

  renderEntryFeeBlock(ev);
  renderDateVoteBlock(ev);
  renderTournamentSignupCta(ev);

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
      const voteNickMap = ev.dateVoteNicks || {};
      const voterNicks = Object.keys(votes).filter(uid => votesOf(uid).includes(idx)).map(uid => voteNickMap[uid] || currentRegistrationsMap[uid]?.nick || '(neznámý)');
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
      try{ await updateDoc(doc(db,'events',ev.id), { [`dateVotes.${currentUser.uid}`]: newVotes, [`dateVoteNicks.${currentUser.uid}`]: currentNick || '' }); }
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
          nick: currentNick, emoji: currentEmoji, avatar: currentAvatar, uid: currentUser.uid, status: 'going', food: {}, ts: new Date().toISOString()
        });
      }catch(err){ alert('Přihlášení se nepovedlo.'); console.error(err); }
    });
  }else{
    rsvpBox.innerHTML = `<button type="button" class="btn-ghost" id="rsvp-cancel" style="color:var(--crimson); border-color:var(--crimson);" ${deadlinePassed ? 'disabled title="Uzávěrka změn už proběhla"' : ''}>Odhlásit se z akce</button>`;
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
    select.innerHTML = `<option value="">— vyber, nebo napiš vlastní níže —</option>` + options.map(u => `<option value="${u.uid}" data-nick="${escapeHtml(u.nick||'')}" data-emoji="${escapeHtml(u.emoji||'')}" data-avatar="${escapeHtml(u.avatar||'')}">${escapeHtml(u.nick||'')}</option>`).join('');
  }catch(err){ select.innerHTML = `<option value="">(nepovedlo se načíst)</option>`; console.error(err); }

  document.getElementById('add-att-save').addEventListener('click', async () => {
    const msg = document.getElementById('add-att-msg');
    const uid = select.value;
    const customName = document.getElementById('add-att-custom').value.trim();
    try{
      if(uid){
        const opt = select.querySelector(`option[value="${uid}"]`);
        await setDoc(doc(db,'events',eventId,'registrations',uid), {
          nick: opt.dataset.nick, emoji: opt.dataset.emoji || '', avatar: opt.dataset.avatar || '', uid, status:'going', food:{}, ts:new Date().toISOString()
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
          <span style="display:flex; align-items:center; gap:6px;">${coinHtml}${r.avatar ? avatarTag(r.avatar) : (r.emoji ? escapeHtml(r.emoji)+' ' : '')}${escapeHtml(r.nick || '(bez jména)')}</span>
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
        <div class="game-display-grid">${games.length ? games.map(g=>`<div class="game-display-card">${g.image ? `<img src="${g.image.replace(/"/g,'&quot;')}" alt="">` : '<div class="game-display-noimg">🎮</div>'}<span>${escapeHtml(g.name)}</span></div>`).join('') : '<span class="empty">Zatím nic nevypsáno.</span>'}</div>
      </div>
      <div>
        <div class="section-title" style="font-size:16px;">Chtěl by sis zahrát ještě něco jiného?</div>
        <div class="field" style="display:flex; flex-direction:row; gap:8px; align-items:flex-end; position:relative;">
          <div style="flex:1; position:relative;">
            <input type="text" id="suggestion-input" placeholder="Např. HALO" autocomplete="off">
            <div id="sug-autocomplete-list" class="game-autocomplete-list" style="display:none;"></div>
          </div>
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
      await addDoc(collection(db,'events',ev.id,'suggestions'), { text, image: pendingSuggestionImage, author: currentNick, authorEmoji: currentEmoji, authorAvatar: currentAvatar, uid: currentUser.uid, likes: [], likeNicks: [], ts: new Date().toISOString() });
      input.value = '';
      pendingSuggestionImage = '';
      document.getElementById('sug-autocomplete-list').style.display = 'none';
    }catch(err){ console.error(err); }
  });

  let sugSearchDebounce = null;
  document.getElementById('suggestion-input').addEventListener('input', (e) => {
    clearTimeout(sugSearchDebounce);
    pendingSuggestionImage = '';
    const q = e.target.value.trim();
    const box = document.getElementById('sug-autocomplete-list');
    if(q.length < 2){ box.style.display = 'none'; return; }
    sugSearchDebounce = setTimeout(async () => {
      try{
        const res = await fetch(`${STEAM_SEARCH_FUNCTION_URL}?term=${encodeURIComponent(q)}`);
        const data = await res.json();
        const results = data.items || [];
        if(results.length === 0){ box.style.display = 'none'; return; }
        box.innerHTML = results.map(r => `
          <div class="game-autocomplete-item" data-pick-sug="${escapeHtml(r.name)}" data-pick-sug-image="${r.image ? r.image.replace(/"/g,'&quot;') : ''}">
            ${r.image ? `<img src="${r.image.replace(/"/g,'&quot;')}" alt="">` : '<div class="game-autocomplete-noimg">🎮</div>'}
            <span>${escapeHtml(r.name)}</span>
          </div>
        `).join('');
        box.style.display = 'grid';
        box.querySelectorAll('[data-pick-sug]').forEach(item => {
          item.addEventListener('click', () => {
            document.getElementById('suggestion-input').value = item.dataset.pickSug;
            pendingSuggestionImage = item.dataset.pickSugImage || '';
            box.style.display = 'none';
          });
        });
      }catch(err){ console.error(err); box.style.display = 'none'; }
    }, 400);
  });
  document.addEventListener('click', (e) => {
    if(!e.target.closest('#suggestion-input') && !e.target.closest('#sug-autocomplete-list')){
      const box = document.getElementById('sug-autocomplete-list');
      if(box) box.style.display = 'none';
    }
  });

  document.getElementById('btn-add-comment').addEventListener('click', async () => {
    if(!currentUser || !currentNick){ showView('ucet'); return; }
    const input = document.getElementById('comment-input');
    const text = input.value.trim();
    if(!text) return;
    try{
      await addDoc(collection(db,'events',ev.id,'comments'), { text, author: currentNick, authorEmoji: currentEmoji, authorAvatar: currentAvatar, uid: currentUser.uid, ts: new Date().toISOString() });
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
      <span class="txt" data-sug-display="${s.id}">${s.image ? `<img src="${s.image.replace(/"/g,'&quot;')}" alt="" class="game-chip-logo" style="margin-right:6px; vertical-align:middle;">` : ''}Hráč: ${authorLabel(s.author, s.authorEmoji, s.authorAvatar)} — ${escapeHtml(s.text)}</span>
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
      let editPickedImage = sug.image || '';
      display.outerHTML = `
        <span class="txt" style="display:flex; gap:6px; position:relative;">
          <div style="flex:1; position:relative;">
            <input type="text" id="sug-edit-input-${sugId}" value="${escapeHtml(sug.text)}" autocomplete="off" style="width:100%; background:var(--bg-void); border:1px solid var(--line); color:var(--text); padding:4px 8px; box-sizing:border-box;">
            <div id="sug-edit-autocomplete-${sugId}" class="game-autocomplete-list" style="display:none;"></div>
          </div>
          <button type="button" class="btn-sm" data-sug-save="${sugId}">Uložit</button>
        </span>
      `;
      const editInput = document.getElementById(`sug-edit-input-${sugId}`);
      const editBox = document.getElementById(`sug-edit-autocomplete-${sugId}`);
      let editSearchDebounce = null;
      editInput.addEventListener('input', (e) => {
        clearTimeout(editSearchDebounce);
        editPickedImage = '';
        const q = e.target.value.trim();
        if(q.length < 2){ editBox.style.display = 'none'; return; }
        editSearchDebounce = setTimeout(async () => {
          try{
            const res = await fetch(`${STEAM_SEARCH_FUNCTION_URL}?term=${encodeURIComponent(q)}`);
            const data = await res.json();
            const results = data.items || [];
            if(results.length === 0){ editBox.style.display = 'none'; return; }
            editBox.innerHTML = results.map(r => `
              <div class="game-autocomplete-item" data-pick-edit-sug="${escapeHtml(r.name)}" data-pick-edit-sug-image="${r.image ? r.image.replace(/"/g,'&quot;') : ''}">
                ${r.image ? `<img src="${r.image.replace(/"/g,'&quot;')}" alt="">` : '<div class="game-autocomplete-noimg">🎮</div>'}
                <span>${escapeHtml(r.name)}</span>
              </div>
            `).join('');
            editBox.style.display = 'grid';
            editBox.querySelectorAll('[data-pick-edit-sug]').forEach(item => {
              item.addEventListener('click', () => {
                editInput.value = item.dataset.pickEditSug;
                editPickedImage = item.dataset.pickEditSugImage || '';
                editBox.style.display = 'none';
              });
            });
          }catch(err){ console.error(err); editBox.style.display = 'none'; }
        }, 400);
      });
      document.addEventListener('click', (e) => {
        if(!e.target.closest(`#sug-edit-input-${sugId}`) && !e.target.closest(`#sug-edit-autocomplete-${sugId}`)){
          editBox.style.display = 'none';
        }
      });
      row.querySelector(`[data-sug-save="${sugId}"]`).addEventListener('click', async () => {
        const newText = editInput.value.trim();
        if(!newText) return;
        try{ await updateDoc(doc(db,'events',ev.id,'suggestions',sugId), { text: newText, image: editPickedImage }); }
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
      <span class="who">${authorLabel(c.author, c.authorEmoji, c.authorAvatar)}</span><span class="when">${c.ts ? new Date(c.ts).toLocaleDateString('cs-CZ') : ''}</span>
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
          <span class="who">${authorLabel(c.author, c.authorEmoji, c.authorAvatar)}</span><span class="when">${c.ts ? new Date(c.ts).toLocaleDateString('cs-CZ') : ''}</span>
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
      await addDoc(collection(db,'events',ev.id,'foodComments'), { text, author: currentNick, authorEmoji: currentEmoji, authorAvatar: currentAvatar, uid: currentUser.uid, ts: new Date().toISOString() });
      input.value = '';
    }catch(err){ console.error(err); }
  });
}

// ---- Turnaj: samostatná kolekce, propojená s konkrétní akcí přes eventId ----
let allTournaments = [];
let currentTournamentId = null;
let turnajProjectorMode = false;
const TEAM_EMBLEMS = ['🛡️','⚔️','🐺','🦅','🔥','💀','👑','🌙','⭐','🐉','🦁','🍀','🐍','🦂','⚡','🎯'];
const TEAM_COLORS = ['#e8e3d8','#c9a24b','#8b2635','#2f8f8f','#4a90d9','#9b59b6','#e67e22','#2ecc71','#e84393','#95a5a6'];

onSnapshot(collection(db, 'tournaments'), (snap) => {
  allTournaments = snap.docs.map(d => ({ id:d.id, ...d.data() }));
  if(document.getElementById('view-turnaj')?.classList.contains('active')) renderTurnajPage();
  if(currentDetailEventId){
    const ev = events.find(x=>x.id===currentDetailEventId);
    if(ev){
      renderTournamentSignupCta(ev);
      if(currentTab === 'turnaj') renderTabTurnaj(ev);
    }
  }
  tryInitialRoute();
});

function teamName(t, idx){ return t.teams[idx] ? t.teams[idx].name : `Tým ${idx+1}`; }
function teamObj(t, idx){ return t.teams[idx] || { name: `Tým ${idx+1}`, members:[] }; }
function teamCaptain(t, tm){
  let best = null, bestSkill = -1;
  (tm.members || []).forEach(n => {
    const s = tbEffectiveStats(t, n);
    const base = s.base === null ? 0 : s.base;
    if(base > bestSkill){ bestSkill = base; best = n; }
  });
  return best;
}
function teamMembersHtml(t, tm){
  if(!(tm.members || []).length) return '';
  const capt = teamCaptain(t, tm);
  return `<div class="podium-members">${tm.members.map(n => n === capt
    ? `<span class="podium-captain">👑 ${escapeHtml(n)}</span>`
    : `<span>${escapeHtml(n)}</span>`).join('')}</div>`;
}
function trophySvg(rank){
  const cls = rank === 1 ? 'gold' : rank === 2 ? 'silver' : 'bronze';
  return `<svg class="podium-trophy podium-trophy-${cls}" viewBox="0 0 24 26" xmlns="http://www.w3.org/2000/svg">
    <path d="M6 3h12v4a6 6 0 0 1-6 6 6 6 0 0 1-6-6V3Z" fill="currentColor" stroke="#241f14" stroke-width="1"/>
    <path d="M6 4H3a3 3 0 0 0 3 5" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <path d="M18 4h3a3 3 0 0 1-3 5" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <rect x="10.5" y="13" width="3" height="4" fill="currentColor"/>
    <path d="M7 20h10l-1.4-3H8.4L7 20Z" fill="currentColor" stroke="#241f14" stroke-width="1"/>
    <text x="12" y="9.5" font-size="7" font-weight="800" text-anchor="middle" fill="#241f14">${rank}</text>
  </svg>`;
}

// ---------- "Všichni proti všem": kola, skóre, pořadí (s děleným umístěním) ----------
function computeFfaStandings(t){
  const participants = (t.ffa && t.ffa.participants) || [];
  const rounds = (t.ffa && t.ffa.rounds) || [];
  const totals = participants.map(name => {
    const total = rounds.reduce((sum, r) => sum + (Number((r.scores || {})[name]) || 0), 0);
    return { name, total };
  }).sort((a, b) => b.total - a.total);
  let placements = [];
  let rank = 1;
  totals.forEach((row, i) => {
    if(i > 0 && row.total === totals[i-1].total){
      // dělí se o stejné místo jako předchozí
    }else{
      rank = i + 1;
    }
    placements.push({ name: row.name, total: row.total, rank });
  });
  return { placements, rounds };
}

function gameUsesAegis(t){
  const g = (t.game || '').trim().toLowerCase();
  return g === 'dota 2' || g === 'dota2' || g === 'dota';
}
function trophyOrAegisImg(t, rankClass){
  if(gameUsesAegis(t)) return `<img src="AEGIS.png" alt="" class="aegis-img aegis-${rankClass}">`;
  return `<img src="Pohar.png" alt="" class="trophy-img trophy-${rankClass}">`;
}
function podiumCupHtml(t, rankClass, rank, labelName){
  const isAegis = gameUsesAegis(t);
  return `<div class="aegis-holder">
    <div class="aegis-glow aegis-glow-${rankClass}"></div>${rank===1?'<div class="aegis-sparks"></div>':''}
    ${isAegis
      ? trophyOrAegisImg(t, rankClass)
      : `<div class="trophy-podium-img"><img src="Pohar.png" alt="" class="trophy-img trophy-${rankClass}"><div class="trophy-podium-label"><span class="tp-rank">${rank}.</span><span class="tp-name">${escapeHtml(labelName)}</span></div></div>`}
  </div>`;
}

function avatarOrPlaceholder(name){
  const reg = Object.values(currentRegistrationsMap || {}).find(r => r.nick === name);
  const av = reg && reg.avatar;
  return av ? `<img src="${av.replace(/"/g,'&quot;')}" alt="" class="podium-avatar">` : `<div class="podium-avatar podium-avatar-blank">🎮</div>`;
}

function buildFfaPodiumHtml(t, standings, big){
  const byRank = r => standings.placements.filter(p => p.rank === r);
  const p1 = byRank(1), p2 = byRank(2), p3 = byRank(3);
  const rest = standings.placements.filter(p => p.rank > 3);
  const step = (entries, rankClass, rank) => entries.map(p => `
    <div class="podium-step podium-${rank}">
      <div class="podium-team">${trophySvg(rank)}${escapeHtml(p.name)}</div>
      ${podiumCupHtml(t, rankClass, rank, p.name)}
      <div class="podium-members"><span>${p.total} bodů</span></div>
    </div>`).join('');
  let html = `<div class="podium-wrap ${big?'podium-wrap-big':''}">`;
  html += step(p2, 'silver', 2);
  html += step(p1, 'gold', 1);
  html += step(p3, 'bronze', 3);
  html += `</div>`;
  if(rest.length){
    html += rest.map(p => `<div class="bracket-slot" style="margin-top:8px;"><span>${p.rank}. ${escapeHtml(p.name)} — ${p.total} bodů</span></div>`).join('');
  }
  return html;
}

function renderFfaBody(t, box){
  const standings = computeFfaStandings(t);
  const participants = (t.ffa && t.ffa.participants) || [];
  const rounds = (t.ffa && t.ffa.rounds) || [];
  const canEdit = hasPerm('turnaj');
  box.innerHTML = `
    <div class="ffa-rounds-head">
      <div class="section-title" style="font-size:16px; margin-top:0; margin-bottom:0;">Kola / mapy</div>
      ${canEdit ? `<button type="button" class="btn-sm" id="btn-add-ffa-round">+ Přidat kolo</button>` : ''}
    </div>
    ${rounds.length === 0 ? '<p class="empty">Zatím žádné odehrané kolo. Přidej první tlačítkem výše.</p>' : `
      <div style="overflow-x:auto;">
        <table class="ffa-rounds-table">
          <thead><tr><th>Hráč</th>${rounds.map((r,ri) => `<th ${canEdit ? `class="ffa-round-head" data-ffa-rename="${ri}" title="Klikni pro přejmenování"` : ''}>${escapeHtml(r.label || ('Kolo '+(ri+1)))}${canEdit ? ' ✏️' : ''}</th>`).join('')}<th>Celkem</th></tr></thead>
          <tbody>
            ${participants.map(name => `<tr><td>${escapeHtml(name)}</td>${rounds.map((r,ri) => `<td>${canEdit
                ? `<input type="number" value="${(r.scores||{})[name] ?? ''}" data-ffa-score="${ri}|${escapeHtml(name)}">`
                : ((r.scores||{})[name] ?? '0')}</td>`).join('')}<td class="ffa-total">${standings.placements.find(p=>p.name===name)?.total ?? 0}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    `}
    <div class="section-title" style="font-size:16px; margin-top:26px;">Průběžné pořadí</div>
    <div id="ffa-podium-box"></div>
  `;
  document.getElementById('ffa-podium-box').innerHTML = buildFfaPodiumHtml(t, standings, false);

  if(canEdit){
    box.querySelectorAll('[data-ffa-score]').forEach(inp => {
      inp.addEventListener('change', async () => {
        const [ri, name] = inp.dataset.ffaScore.split('|');
        const newRounds = rounds.map((r, i) => i === parseInt(ri,10)
          ? { ...r, scores: { ...(r.scores||{}), [name]: Number(inp.value) || 0 } }
          : r);
        try{ await updateDoc(doc(db,'tournaments',t.id), { 'ffa.rounds': newRounds }); }
        catch(err){ console.error(err); }
      });
    });
    box.querySelectorAll('[data-ffa-rename]').forEach(th => {
      th.addEventListener('click', async () => {
        const ri = parseInt(th.dataset.ffaRename, 10);
        const label = prompt('Nový název kola', rounds[ri].label || `Kolo ${ri+1}`);
        if(label === null || !label.trim()) return;
        const newRounds = rounds.map((r, i) => i === ri ? { ...r, label: label.trim() } : r);
        try{ await updateDoc(doc(db,'tournaments',t.id), { 'ffa.rounds': newRounds }); }
        catch(err){ console.error(err); }
      });
    });
    const addBtn = document.getElementById('btn-add-ffa-round');
    if(addBtn) addBtn.addEventListener('click', async () => {
      const label = prompt('Název kola (např. "Mapa 2")', `Kolo ${rounds.length+1}`);
      if(label === null) return;
      try{ await updateDoc(doc(db,'tournaments',t.id), { 'ffa.rounds': [...rounds, { label: label.trim() || `Kolo ${rounds.length+1}`, scores:{} }] }); }
      catch(err){ console.error(err); }
    });
  }
}


// ---- Horní stránka "Turnaj" (celostránkové zobrazení, správa) ----
function renderTurnajPage(){
  const box = document.getElementById('view-turnaj-content');
  if(!box) return;

  document.querySelectorAll('.tb-unlock-sound').forEach(b => b.remove());
  tbRefreshDrinkModal();

  if(currentTournamentId){
    const t = allTournaments.find(x => x.id === currentTournamentId);
    if(!t){ currentTournamentId = null; tourneySetupStep = null; if(location.hash !== '#turnaj') location.hash = '#turnaj'; renderTurnajPage(); return; }

    if(tourneySetupStep){
      tbStopLive();
      box.innerHTML = `<div id="format-setup-body"></div>`;
      renderTournamentFormatSetup(t, document.getElementById('format-setup-body'));
      return;
    }
    if(t.status === 'signup'){
      tbStopLive();
      box.innerHTML = `<button type="button" class="btn-ghost btn-sm" id="btn-back-tourney-list">← Zpět na seznam turnajů</button><div id="signup-phase-body" style="margin-top:14px;"></div>`;
      document.getElementById('btn-back-tourney-list').addEventListener('click', () => setRoute('#turnaj'));
      renderTournamentSignupPhase(t, document.getElementById('signup-phase-body'));
      return;
    }

    const isFfa = t.format === 'ffa';
    const ev = events.find(x => x.id === t.eventId);
    const swissPreview = isFfa ? null : computeSwissTournament(t);
    const ffaStandings = isFfa ? computeFfaStandings(t) : null;
    box.innerHTML = `
      <div class="tourney-main-row">
        <div class="tourney-bracket-col">
          <div class="tourney-teams-panel" id="tourney-teams-panel"></div>
          <div class="${isFfa ? '' : 'bracket-scale-wrap'}" id="turnaj-detail-body"></div>
        </div>
        <div class="tourney-title-corner">
          <div class="tourney-title-top">
            ${ev ? `<div class="status-hint" style="white-space:nowrap;">${escapeHtml(ev.name)}</div>` : ''}
            ${t.gameImage ? `<img src="${t.gameImage.replace(/"/g,'&quot;')}" alt="" class="tourney-game-image">` : (t.game ? `<div class="status-hint" style="margin-top:4px;">${escapeHtml(t.game)}</div>` : '')}
            <h1 class="headline" style="font-size:22px; margin-top:8px;">${escapeHtml(t.name)}</h1>
            ${t.imageUrl ? `<img src="${t.imageUrl.replace(/"/g,'&quot;')}" alt="" class="tourney-title-image">` : ''}
          </div>
          <div class="tourney-title-result" id="tourney-title-result"></div>
        </div>
      </div>
      <div class="tourney-corner-actions" id="tourney-corner-actions"></div>
    `;

    const cornerActions = document.getElementById('tourney-corner-actions');
    if(location.hash.startsWith('#turnaj')) tbEnsureLive(t);
    if(!isFfa) renderTourneyTeamsPanel(t, document.getElementById('tourney-teams-panel'));

    if(turnajProjectorMode){
      if(!tbSoundUnlocked){
        const unlock = document.createElement('button');
        unlock.type = 'button';
        unlock.className = 'tb-unlock-sound';
        unlock.textContent = '🔊 Klikni pro zapnutí zvuku';
        unlock.addEventListener('click', () => { tbUnlockSound(); unlock.remove(); });
        document.body.appendChild(unlock);
      }
    }else{
      if(hasPerm('turnaj')){
        const drinkBtn = document.createElement('button');
        drinkBtn.type = 'button';
        drinkBtn.className = 'dota-btn';
        drinkBtn.textContent = 'Handicap';
        drinkBtn.addEventListener('click', () => openTbDrinkModal(t));
        cornerActions.appendChild(drinkBtn);

        const graphBtn = document.createElement('button');
        graphBtn.type = 'button';
        graphBtn.className = 'btn-ghost btn-sm';
        graphBtn.textContent = '📈 Vývoj';
        graphBtn.addEventListener('click', () => openTbDevGraphModal(t));
        cornerActions.appendChild(graphBtn);
      }
      const projBtn = document.createElement('button');
      projBtn.type = 'button';
      projBtn.className = 'btn-ghost btn-sm';
      projBtn.textContent = '📺 Projektor';
      projBtn.title = 'Otevře turnaj v samostatném okně pro promítání (aktualizuje se samo)';
      projBtn.addEventListener('click', () => window.open(`${location.origin}${location.pathname}#turnaj/${t.id}/projektor`, '_blank'));
      cornerActions.appendChild(projBtn);
    }

    if(hasPerm('turnaj') && !turnajProjectorMode){
      if(!isFfa){
        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'btn-ghost btn-sm';
        toggleBtn.textContent = 'Upravit týmy';
        toggleBtn.addEventListener('click', () => openTeamEditorModal(t));
        cornerActions.appendChild(toggleBtn);
      }

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn-ghost btn-sm';
      editBtn.textContent = 'Upravit';
      editBtn.addEventListener('click', () => { pendingEditTournamentId = t.id; setRoute('#turnaj'); });
      cornerActions.appendChild(editBtn);

      const revertBtn = document.createElement('button');
      revertBtn.type = 'button';
      revertBtn.className = 'btn-ghost btn-sm';
      revertBtn.textContent = '↩ Zpět na přihlašování';
      revertBtn.title = 'Vrátí turnaj do fáze přihlašování — přidáš další hráče a formát nastavíš znovu';
      revertBtn.addEventListener('click', async () => {
        if(!confirm('Vrátit turnaj do fáze přihlašování? Aktuální týmy / kola a zapsané skóre se tím smažou (seznam přihlášených zůstane zachovaný).')) return;
        try{
          await updateDoc(doc(db,'tournaments',t.id), {
            status:'signup', format:null, teams:[], results:{}, swissResults:{},
            ffa:{ participants:[], rounds:[] }
          });
        }catch(err){ alert('Nepovedlo se vrátit.'); console.error(err); }
      });
      cornerActions.appendChild(revertBtn);

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

    const bodyWrap = document.getElementById('turnaj-detail-body');
    if(isFfa){
      if(ffaStandings.placements.length > 0){
        const resultBtn = document.createElement('button');
        resultBtn.type = 'button';
        resultBtn.className = 'btn-sm tourney-result-btn-big';
        resultBtn.textContent = '🏆 Výsledek turnaje';
        resultBtn.addEventListener('click', () => openTournamentResultModal(t, null, ffaStandings));
        document.getElementById('tourney-title-result').appendChild(resultBtn);
      }
      renderFfaBody(t, bodyWrap);
    }else{
      if(swissPreview.placements.length > 0){
        const resultBtn = document.createElement('button');
        resultBtn.type = 'button';
        resultBtn.className = 'btn-sm tourney-result-btn-big';
        resultBtn.textContent = '🏆 Výsledek turnaje';
        resultBtn.addEventListener('click', () => openTournamentResultModal(t, swissPreview));
        document.getElementById('tourney-title-result').appendChild(resultBtn);
      }
      const swiss = computeSwissTournament(t);
      renderSwissBody(t, swiss, bodyWrap, false);
    }
    return;
  }

  // seznam turnajů
  tbStopLive();
  let html = `<div class="toolbar"><div><h1 class="headline" style="font-size:28px;">Turnaje</h1></div><div style="display:flex; gap:10px;">`;
  html += hasPerm('turnaj') ? `<button type="button" id="btn-new-tourney-page">+ Nový turnaj</button>` : '';
  html += `</div></div><div id="turnaj-form-slot"></div><div class="grid" id="turnaj-list-grid" style="margin-top:24px;"></div>`;
  box.innerHTML = html;

  const newBtn = document.getElementById('btn-new-tourney-page');
  if(newBtn) newBtn.addEventListener('click', () => openNewTournamentForm());

  const grid = document.getElementById('turnaj-list-grid');
  if(allTournaments.length === 0){
    grid.innerHTML = '<div class="empty">Zatím žádný turnaj nebyl založen.</div>';
    return;
  }
  grid.innerHTML = allTournaments.map(t => {
    const ev = events.find(x => x.id === t.eventId);
    let badgeTag = '', statusTxt = '';
    if(t.status === 'signup'){
      badgeTag = `<span class="tag tourney-signup-badge">Přihlášky otevřeny</span>`;
      statusTxt = `${(t.signups||[]).length} přihlášených`;
    }else if(t.format === 'ffa'){
      const standings = computeFfaStandings(t);
      const champion = standings.placements.find(p => p.rank === 1);
      badgeTag = `<span class="tag">${(t.ffa && t.ffa.participants || []).length} hráčů</span>`;
      statusTxt = champion ? `🏆 Vítěz: ${escapeHtml(champion.name)}` : 'Zatím žádné odehrané kolo';
    }else{
      const swiss = computeSwissTournament(t);
      const champion = swiss.placements.find(p => p.rank === 1);
      badgeTag = `<span class="tag">${(t.teams||[]).length} týmů</span>`;
      statusTxt = champion ? `🏆 Vítěz: ${escapeHtml(teamName(t, champion.team))}` : 'Základní část se ještě hraje';
    }
    return `
      <div class="event-card ${t.status === 'signup' ? 'event-card-signup-open' : ''}" data-open-tourney="${t.id}">
        ${t.gameImage ? `<div class="tourney-card-banner"><img src="${t.gameImage.replace(/"/g,'&quot;')}" alt=""></div>` : ''}
        <div style="display:flex; align-items:center; gap:10px;">
          ${!t.gameImage && t.imageUrl ? `<img src="${t.imageUrl.replace(/"/g,'&quot;')}" alt="" style="width:36px; height:36px; object-fit:cover; border-radius:50%; border:1px solid var(--gold-dim); flex-shrink:0;">` : ''}
          ${badgeTag}
        </div>
        <h3>${escapeHtml(t.name)}</h3>
        <div class="meta">${ev ? escapeHtml(ev.name) : 'Bez přiřazené akce'}${t.game ? ' · ' + escapeHtml(t.game) : ''}</div>
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

  if(pendingEditTournamentId){
    const editId = pendingEditTournamentId;
    pendingEditTournamentId = null;
    const t = allTournaments.find(x => x.id === editId);
    if(t) openNewTournamentForm(t);
  }
}

// ---------- Fáze "Přihlašování" ----------
function renderTournamentSignupPhase(t, box){
  const signups = t.signups || [];
  const iAmIn = currentNick && signups.includes(currentNick);
  box.innerHTML = `
    <div class="tourney-title-top" style="margin-bottom:18px;">
      <span class="tag tourney-signup-badge">Přihlášky otevřeny</span>
      <h1 class="headline" style="font-size:26px; margin-top:10px;">${escapeHtml(t.name)}</h1>
      ${t.game ? `<div class="status-hint">${escapeHtml(t.game)}</div>` : ''}
    </div>
    <p class="lede" style="margin-top:0;">Klikni na "Zúčastním se", pokud chceš hrát. Formát (týmy, nebo všichni proti všem) nastaví admin, až se přihlásí dost lidí.</p>
    <div id="signup-cta"></div>
    <div class="section-title" style="font-size:15px;">Přihlášení (${signups.length})</div>
    <div class="signup-list" id="signup-list"></div>
    ${hasPerm('turnaj') ? `
      <div class="tb-draw-addrow" style="max-width:420px;">
        <input type="text" id="signup-manual-name" placeholder="Přidat ručně (jméno)">
        <button type="button" class="btn-sm" id="signup-manual-add">Přidat</button>
      </div>
      <button type="button" id="btn-goto-format" style="margin-top:18px;" ${signups.length < 2 ? 'disabled' : ''}>Nastavit turnaj (${signups.length} hráčů)</button>
      ${signups.length < 2 ? '<small style="display:block; margin-top:6px; color:var(--text-muted);">Potřeba aspoň 2 přihlášení.</small>' : ''}
    ` : ''}
  `;

  const ctaBox = document.getElementById('signup-cta');
  if(!currentUser || !currentNick){
    ctaBox.innerHTML = `<p class="lede" style="margin-top:0;"><a href="#ucet">Přihlas se</a>, abys mohl(a) se přihlásit.</p>`;
  }else{
    const btn = document.createElement('button');
    btn.type = 'button';
    if(iAmIn){
      btn.className = 'btn-ghost';
      btn.style.cssText = 'color:var(--crimson); border-color:var(--crimson);';
      btn.textContent = 'Odhlásit se';
      btn.addEventListener('click', async () => {
        try{ await updateDoc(doc(db,'tournaments',t.id), { signups: arrayRemove(currentNick) }); }
        catch(err){ console.error(err); }
      });
    }else{
      btn.textContent = 'Zúčastním se';
      btn.addEventListener('click', async () => {
        try{ await updateDoc(doc(db,'tournaments',t.id), { signups: arrayUnion(currentNick) }); }
        catch(err){ console.error(err); }
      });
    }
    ctaBox.appendChild(btn);
  }

  const list = document.getElementById('signup-list');
  list.innerHTML = signups.length
    ? signups.map(n => `<div class="signup-row"><span>${escapeHtml(n)}</span>${hasPerm('turnaj') ? `<span class="x" data-signup-remove="${escapeHtml(n)}">×</span>` : ''}</div>`).join('')
    : '<div class="empty">Zatím se nikdo nepřihlásil.</div>';
  list.querySelectorAll('[data-signup-remove]').forEach(el => {
    el.addEventListener('click', async () => {
      try{ await updateDoc(doc(db,'tournaments',t.id), { signups: arrayRemove(el.dataset.signupRemove) }); }
      catch(err){ console.error(err); }
    });
  });

  if(hasPerm('turnaj')){
    document.getElementById('signup-manual-add').addEventListener('click', async () => {
      const input = document.getElementById('signup-manual-name');
      const name = input.value.trim();
      if(!name) return;
      try{ await updateDoc(doc(db,'tournaments',t.id), { signups: arrayUnion(name) }); input.value = ''; }
      catch(err){ console.error(err); }
    });
    const gotoBtn = document.getElementById('btn-goto-format');
    if(gotoBtn) gotoBtn.addEventListener('click', () => { tourneySetupStep = 'format'; renderTurnajPage(); });
  }
}

// ---------- Fáze "Nastavit turnaj" (formát) ----------
let tourneySetupStep = null; // null | 'format' | 'team-draw' | 'ffa-confirm'
let pendingEditTournamentId = null;
let tourneyFormatChoice = null; // 'teams' | 'ffa'

function renderTournamentFormatSetup(t, box){
  if(tourneySetupStep === 'team-draw') return renderTeamFormatSetup(t, box);
  if(tourneySetupStep === 'ffa-confirm') return renderFfaFormatSetup(t, box);

  box.innerHTML = `
    <button type="button" class="btn-ghost btn-sm" id="btn-back-signup">← Zpět na přihlášené</button>
    <h1 class="headline" style="font-size:24px; margin-top:14px;">Nastavit turnaj — ${escapeHtml(t.name)}</h1>
    <p class="lede" style="margin-top:0;">Přihlášeno: ${(t.signups||[]).length} hráčů. Vyber formát.</p>
    <div class="format-choice-row">
      <button type="button" class="format-choice-btn" id="fmt-teams"><b>🛡️ Týmový</b><span>Rozdělit přihlášené do týmů — náhodně, nebo vyváženě podle skillu.</span></button>
      <button type="button" class="format-choice-btn" id="fmt-ffa"><b>🏁 Všichni proti všem</b><span>Bez týmů. Zapisují se výsledky jednotlivých kol/map a appka sečte pořadí.</span></button>
    </div>
  `;
  document.getElementById('btn-back-signup').addEventListener('click', () => { tourneySetupStep = null; renderTurnajPage(); });
  document.getElementById('fmt-teams').addEventListener('click', () => { tourneySetupStep = 'team-draw'; tbDraw = { players: [], teams: null }; renderTurnajPage(); });
  document.getElementById('fmt-ffa').addEventListener('click', () => { tourneySetupStep = 'ffa-confirm'; renderTurnajPage(); });
}

function renderTeamFormatSetup(t, box){
  const signups = t.signups || [];
  if(tbDraw.players.length === 0 && !tbDraw._seeded){
    tbDraw._seeded = true;
    signups.forEach(n => tbAddDrawPlayer(n, 50, { fromEvent:true, persist:false }));
  }
  box.innerHTML = `
    <button type="button" class="btn-ghost btn-sm" id="btn-back-format">← Zpět na výběr formátu</button>
    <h1 class="headline" style="font-size:24px; margin-top:14px;">Týmový turnaj — ${escapeHtml(t.name)}</h1>
    <label class="signup-row" style="max-width:360px; cursor:pointer;">
      <input type="checkbox" id="tb-use-skill" checked>
      <span>Vyvážit podle skillu (jinak čistě náhodně, bez zápisu skillu)</span>
    </label>
    <div class="tb-form-row" style="margin-top:10px;">
      <div class="field"><label>Hráčů v týmu</label><input type="number" id="tb-team-size" min="1" max="6" value="3"></div>
      <div class="field"><label>Počet týmů</label><input type="number" id="tb-team-count" min="2" placeholder="auto"></div>
    </div>
    <div class="tb-draw-section">
      <div class="section-title" style="font-size:15px;">Hráči do losování</div>
      <div class="tb-draw-addrow">
        <input type="text" id="tb-add-name" placeholder="Přidat hráče ručně (jméno)">
        <input type="number" id="tb-add-skill" min="1" max="100" placeholder="Skill (50)">
        <button type="button" class="btn-sm" id="tb-add-btn">Přidat</button>
      </div>
      <div id="tb-draw-players"></div>
      <button type="button" class="btn-ghost" id="tb-draw-btn" style="margin-top:12px;">🎰 Losovat týmy</button>
    </div>
    <div id="tb-drawn-teams"></div>
    <div id="tb-confirm-teams-row" style="margin-top:14px; display:none;">
      <button type="button" id="btn-confirm-team-setup">Potvrdit a spustit turnaj</button>
    </div>
  `;
  document.getElementById('btn-back-format').addEventListener('click', () => { tourneySetupStep = 'format'; renderTurnajPage(); });
  tbRenderDrawPlayers();
  toggleSkillInputsVisibility();

  document.getElementById('tb-use-skill').addEventListener('change', () => { toggleSkillInputsVisibility(); tbInvalidateDraw(); });
  document.getElementById('tb-team-size').addEventListener('input', () => { tbUpdateTeamCountHint(); tbInvalidateDraw(); });
  document.getElementById('tb-team-count').addEventListener('input', () => tbInvalidateDraw());
  document.getElementById('tb-add-btn').addEventListener('click', () => {
    const nameInput = document.getElementById('tb-add-name');
    const skillInput = document.getElementById('tb-add-skill');
    const name = nameInput.value.trim();
    if(!name){ alert('Vyplň jméno hráče.'); return; }
    const skill = Math.min(100, Math.max(1, parseInt(skillInput.value, 10) || 50));
    tbAddDrawPlayer(name, skill, { persist:false });
    nameInput.value = ''; skillInput.value = '';
    tbRenderDrawPlayers();
    tbInvalidateDraw();
  });
  document.getElementById('tb-draw-btn').addEventListener('click', () => {
    const useSkill = document.getElementById('tb-use-skill').checked;
    if(!useSkill){
      // bez skillu: dočasně přiřadit náhodné hodnoty jen kvůli losovacímu automatu, neukládat je
      tbDraw.players.forEach(p => { p._origSkill = p.baseSkill; p.baseSkill = Math.floor(Math.random()*100)+1; });
    }
    tbStartDrawFromFormNoPersist(() => {
      document.getElementById('tb-confirm-teams-row').style.display = 'block';
    });
  });
  document.getElementById('btn-confirm-team-setup').addEventListener('click', async () => {
    const useSkill = document.getElementById('tb-use-skill').checked;
    const teams = tbDraw.teams.map((tm, i) => ({ name: (tm.name || '').trim() || `Tým ${i+1}`, members: tm.members, emblem: tm.emblem || '', ...(tm.color ? { color: tm.color } : {}) }));
    const skills = {};
    if(useSkill) tbDraw.players.forEach(p => { skills[tbKey(p.name)] = p._origSkill !== undefined ? p._origSkill : p.baseSkill; });
    try{
      await updateDoc(doc(db,'tournaments',t.id), { teams, format:'teams', status:'ready', teamSize: tbTeamSizeVal() });
      await seedHandicapSkills(t, skills);
      tourneySetupStep = null; tbDraw = { players: [], teams: null };
    }catch(err){ alert('Uložení se nepovedlo.'); console.error(err); }
  });
}
function toggleSkillInputsVisibility(){
  const on = document.getElementById('tb-use-skill').checked;
  document.querySelectorAll('.tb-draw-skill').forEach(el => el.style.display = on ? '' : 'none');
  const addSkill = document.getElementById('tb-add-skill');
  if(addSkill) addSkill.style.display = on ? '' : 'none';
}
function tbStartDrawFromFormNoPersist(onDone){
  const size = tbTeamSizeVal();
  const P = tbDraw.players.length;
  const minTeams = Math.ceil(P / size);
  const numTeams = parseInt(document.getElementById('tb-team-count').value, 10) || minTeams;
  if(P < 2){ alert('Přidej aspoň 2 hráče.'); return; }
  if(numTeams < 2){ alert('Turnaj potřebuje aspoň 2 týmy — zvyš počet týmů.'); return; }
  if(numTeams < minTeams){ alert(`Na ${P} hráčů po ${size} potřebuješ aspoň ${minTeams} týmů.`); return; }
  if(numTeams > P){ alert('Týmů je víc než hráčů.'); return; }
  tbStartDraft({
    players: tbDraw.players.map(p => ({ name: p.name, baseSkill: p.baseSkill })),
    teamSize: size, numTeams,
    onConfirm: (teams) => {
      tbDraw.teams = teams.map((tm, i) => ({ name: `Tým ${i+1}`, members: tm.members }));
      tbRenderDrawnTeams();
      if(onDone) onDone();
    }
  });
}

function renderFfaFormatSetup(t, box){
  const signups = t.signups || [];
  box.innerHTML = `
    <button type="button" class="btn-ghost btn-sm" id="btn-back-format">← Zpět na výběr formátu</button>
    <h1 class="headline" style="font-size:24px; margin-top:14px;">Všichni proti všem — ${escapeHtml(t.name)}</h1>
    <p class="lede" style="margin-top:0;">Účastníci (${signups.length}) — klidně ještě uprav, koho se to týká.</p>
    <div class="signup-list" id="ffa-participant-list"></div>
    <div class="tb-draw-addrow" style="max-width:420px;">
      <input type="text" id="ffa-manual-name" placeholder="Přidat ručně (jméno)">
      <button type="button" class="btn-sm" id="ffa-manual-add">Přidat</button>
    </div>
    <button type="button" id="btn-confirm-ffa-setup" style="margin-top:16px;" ${signups.length < 2 ? 'disabled' : ''}>Spustit turnaj</button>
  `;
  document.getElementById('btn-back-format').addEventListener('click', () => { tourneySetupStep = 'format'; renderTurnajPage(); });
  let localList = [...signups];
  const renderList = () => {
    const box2 = document.getElementById('ffa-participant-list');
    box2.innerHTML = localList.length
      ? localList.map(n => `<div class="signup-row"><span>${escapeHtml(n)}</span><span class="x" data-ffa-remove="${escapeHtml(n)}">×</span></div>`).join('')
      : '<div class="empty">Nikdo.</div>';
    box2.querySelectorAll('[data-ffa-remove]').forEach(el => el.addEventListener('click', () => {
      localList = localList.filter(n => n !== el.dataset.ffaRemove);
      renderList();
      document.getElementById('btn-confirm-ffa-setup').disabled = localList.length < 2;
    }));
  };
  renderList();
  document.getElementById('ffa-manual-add').addEventListener('click', () => {
    const input = document.getElementById('ffa-manual-name');
    const name = input.value.trim();
    if(!name || localList.includes(name)) return;
    localList.push(name);
    input.value = '';
    renderList();
    document.getElementById('btn-confirm-ffa-setup').disabled = localList.length < 2;
  });
  document.getElementById('btn-confirm-ffa-setup').addEventListener('click', async () => {
    try{
      await updateDoc(doc(db,'tournaments',t.id), { format:'ffa', status:'ready', 'ffa.participants': localList, 'ffa.rounds': [{ label:'Kolo 1', scores:{} }] });
      tourneySetupStep = null;
    }catch(err){ alert('Uložení se nepovedlo.'); console.error(err); }
  });
}

function openNewTournamentForm(existing){
  if(existing){ openEditTournamentForm(existing); return; }
  const slot = document.getElementById('turnaj-form-slot');
  tbDraw = { players: [], teams: null };
  slot.innerHTML = `
    <div class="panel" style="max-width:640px;">
      <div class="section-title" style="font-size:16px; margin-top:0;">Nový turnaj</div>
      <p class="lede" style="margin-top:0;">Chceš nechat lidi se nejdřív přihlásit, nebo rovnou vybrat hráče a nalosovat týmy?</p>
      <div style="display:flex; gap:12px; flex-wrap:wrap;">
        <button type="button" id="btn-mode-signup" class="tourney-mode-btn">
          <b>📝 Otevřít přihlašování</b>
          <span>Lidi se přihlásí sami, formát (týmy / všichni proti všem) nastavíš později.</span>
        </button>
        <button type="button" id="btn-mode-direct" class="tourney-mode-btn">
          <b>🎰 Rovnou nalosovat</b>
          <span>Vybereš hráče z akce nebo ručně a hned je rozdělíš do týmů.</span>
        </button>
      </div>
      <button type="button" class="btn-ghost" id="btn-cancel-new-tourney" style="margin-top:16px;">Zrušit</button>
    </div>
  `;
  slot.scrollIntoView({ behavior:'smooth', block:'start' });
  document.getElementById('btn-cancel-new-tourney').addEventListener('click', () => { slot.innerHTML = ''; });
  document.getElementById('btn-mode-signup').addEventListener('click', () => openSignupTournamentForm());
  document.getElementById('btn-mode-direct').addEventListener('click', () => openDirectDrawTournamentForm());
}

function openSignupTournamentForm(){
  const slot = document.getElementById('turnaj-form-slot');
  const evOptions = [...events].sort((a,b) => (b.dateStart||'').localeCompare(a.dateStart||''));
  slot.innerHTML = `
    <form class="panel" id="form-new-tourney" style="max-width:640px;">
      <div class="section-title" style="font-size:16px; margin-top:0;">Otevřít přihlašování</div>
      <div class="field"><label>Název turnaje</label><input type="text" id="new-tourney-name" placeholder="Turnaj v COD4" required></div>
      ${gameFieldHtml('', '')}
      <div class="field"><label>Akce (nepovinné)</label><select id="new-tourney-event">
        <option value="">— bez přiřazené akce —</option>
        ${evOptions.map(e=>`<option value="${e.id}">${escapeHtml(e.name)}${e.dateEnd < todayIso() ? ' (proběhlo)' : ''}</option>`).join('')}
      </select></div>
      <div class="field"><label>URL obrázku turnaje (nepovinné)</label><input type="url" id="new-tourney-image"></div>
      <div style="display:flex; gap:10px; margin-top:8px;">
        <button type="submit">Otevřít přihlašování</button>
        <button type="button" class="btn-ghost" id="btn-cancel-new-tourney">Zrušit</button>
      </div>
    </form>
  `;
  document.getElementById('btn-cancel-new-tourney').addEventListener('click', () => { slot.innerHTML = ''; });
  const getGameImage1 = setupGameField('');
  document.getElementById('form-new-tourney').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('new-tourney-name').value.trim();
    if(!name) return;
    const payload = {
      name,
      game: document.getElementById('new-tourney-game').value.trim(),
      gameImage: getGameImage1(),
      eventId: document.getElementById('new-tourney-event').value,
      imageUrl: document.getElementById('new-tourney-image').value.trim(),
      status: 'signup', format: null, signups: [],
      teams: [], results:{}, swissResults:{},
      ffa: { participants: [], rounds: [] },
      createdAt: new Date().toISOString()
    };
    try{
      const docRef = await addDoc(collection(db,'tournaments'), payload);
      slot.innerHTML = '';
      setRoute('#turnaj/' + docRef.id);
    }catch(err){ alert('Uložení se nepovedlo.'); console.error(err); }
  });
}

async function seedHandicapSkills(t, skillsMap){
  const entries = Object.entries(skillsMap || {});
  if(!entries.length) return;
  const key = handicapSessionKey(t);
  const payload = {};
  entries.forEach(([k, v]) => { payload[`skills.${k}`] = v; });
  try{ await setDoc(doc(db, 'handicapSessions', key), payload, { merge:true }); }
  catch(err){ console.error('Nepodařilo se uložit počáteční skilly:', err); }
}

function openDirectDrawTournamentForm(){
  const slot = document.getElementById('turnaj-form-slot');
  const evOptions = [...events].sort((a,b) => (b.dateStart||'').localeCompare(a.dateStart||''));
  tbDraw = { players: [], teams: null };
  slot.innerHTML = `
    <form class="panel" id="form-new-tourney" style="max-width:940px;">
      <div class="field"><label>Název turnaje</label><input type="text" id="new-tourney-name" placeholder="Hlavní Dota turnaj" required></div>
      ${gameFieldHtml('', '')}
      <div class="field"><label>Akce (hráči se načtou automaticky)</label><select id="new-tourney-event">
        <option value="">— bez přiřazené akce —</option>
        ${evOptions.map(e=>`<option value="${e.id}">${escapeHtml(e.name)}${e.dateEnd < todayIso() ? ' (proběhlo)' : ''}</option>`).join('')}
      </select><small id="tb-event-msg"></small></div>
      <div class="tb-form-row">
        <div class="field"><label>Hráčů v týmu</label><input type="number" id="tb-team-size" min="1" max="6" value="3"></div>
        <div class="field"><label>Počet týmů</label><input type="number" id="tb-team-count" min="2" placeholder="auto"></div>
      </div>
      <div class="field"><label>URL obrázku turnaje (nepovinné)</label><input type="url" id="new-tourney-image"></div>

      <div class="tb-draw-section">
        <div class="section-title" style="font-size:15px;">Hráči do losování</div>
        <div class="tb-draw-addrow">
          <input type="text" id="tb-add-name" placeholder="Přidat hráče ručně (jméno)">
          <input type="number" id="tb-add-skill" min="1" max="100" placeholder="Skill (50)">
          <button type="button" class="btn-sm" id="tb-add-btn">Přidat</button>
        </div>
        <div id="tb-draw-players"></div>
        <button type="button" class="btn-ghost" id="tb-draw-btn" style="margin-top:12px;">🎰 Losovat týmy</button>
        <small style="display:block; margin-top:6px; color:var(--text-muted);">Losování je nepovinné — bez něj se vytvoří prázdné týmy a hráče do nich přidáš přes "Upravit týmy".</small>
      </div>
      <div id="tb-drawn-teams"></div>

      <div style="display:flex; gap:10px; margin-top:8px;">
        <button type="submit">Vytvořit turnaj</button>
        <button type="button" class="btn-ghost" id="btn-cancel-new-tourney">Zrušit</button>
      </div>
    </form>
  `;
  slot.scrollIntoView({ behavior:'smooth', block:'start' });
  tbRenderDrawPlayers();
  const getGameImage2 = setupGameField('');

  document.getElementById('btn-cancel-new-tourney').addEventListener('click', () => { slot.innerHTML = ''; tbDraw = { players: [], teams: null }; });
  document.getElementById('tb-team-size').addEventListener('input', () => { tbUpdateTeamCountHint(); tbInvalidateDraw(); });
  document.getElementById('tb-team-count').addEventListener('input', () => tbInvalidateDraw());

  document.getElementById('new-tourney-event').addEventListener('change', async (e) => {
    const eventId = e.target.value;
    const msg = document.getElementById('tb-event-msg');
    tbDraw.players = tbDraw.players.filter(p => !p.fromEvent);
    tbInvalidateDraw();
    if(!eventId){ msg.textContent = ''; tbRenderDrawPlayers(); return; }
    msg.textContent = 'Načítám přihlášené...';
    try{
      const snap = await getDocs(collection(db,'events',eventId,'registrations'));
      const regs = snap.docs.map(d=>d.data()).filter(r => r.status !== 'maybe' && r.nick).sort((a,b)=>(a.nick||'').localeCompare(b.nick||''));
      const rows = await Promise.all(regs.map(async r => {
        const saved = await tbLoadSkill(r.nick);
        return { nick: r.nick, skill: saved !== null ? saved : 50 };
      }));
      rows.forEach(r => tbAddDrawPlayer(r.nick, r.skill, { fromEvent:true, persist:false }));
      tbRenderDrawPlayers();
      msg.textContent = rows.length ? `Načteno ${rows.length} hráčů, kteří určitě jedou.` : 'Na téhle akci zatím nikdo určitě nejede.';
    }catch(err){ console.error(err); msg.textContent = 'Nepovedlo se načíst přihlášené.'; }
  });

  document.getElementById('tb-add-btn').addEventListener('click', () => {
    const nameInput = document.getElementById('tb-add-name');
    const skillInput = document.getElementById('tb-add-skill');
    const name = nameInput.value.trim();
    if(!name){ alert('Vyplň jméno hráče.'); return; }
    const skill = Math.min(100, Math.max(1, parseInt(skillInput.value, 10) || 50));
    tbAddDrawPlayer(name, skill);
    nameInput.value = ''; skillInput.value = '';
    tbRenderDrawPlayers();
    tbInvalidateDraw();
  });
  document.getElementById('tb-add-name').addEventListener('keydown', (e) => {
    if(e.key === 'Enter'){ e.preventDefault(); document.getElementById('tb-add-btn').click(); }
  });

  document.getElementById('tb-draw-btn').addEventListener('click', tbStartDrawFromForm);

  document.getElementById('form-new-tourney').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('new-tourney-name').value.trim();
    const eventId = document.getElementById('new-tourney-event').value;
    const imageUrl = document.getElementById('new-tourney-image').value.trim();
    const game = document.getElementById('new-tourney-game').value.trim();
    const gameImage = getGameImage2();
    if(!name) return;
    let teams = [], skills = {};
    if(tbDraw.teams){
      teams = tbDraw.teams.map((t, i) => {
        const team = { name: (t.name || '').trim() || `Tým ${i+1}`, members: t.members, emblem: t.emblem || '' };
        if(t.color) team.color = t.color;
        return team;
      });
      tbDraw.players.forEach(p => { skills[tbKey(p.name)] = p.baseSkill; });
    }else{
      const count = Math.max(2, parseInt(document.getElementById('tb-team-count').value, 10) || 4);
      for(let i = 0; i < count; i++) teams.push({ name: `Tým ${i+1}`, members: [], emblem: '' });
    }
    const createdAt = new Date().toISOString();
    try{
      const docRef = await addDoc(collection(db,'tournaments'), {
        name, game, gameImage, eventId, teams, results:{}, swissResults:{}, imageUrl,
        status:'ready', format:'teams', signups:[], ffa:{ participants:[], rounds:[] },
        teamSize: tbTeamSizeVal(), createdAt
      });
      await seedHandicapSkills({ id:docRef.id, eventId, createdAt }, skills);
      slot.innerHTML = '';
      tbDraw = { players: [], teams: null };
      setRoute('#turnaj/' + docRef.id);
    }catch(err){ alert('Uložení se nepovedlo.'); console.error(err); }
  });
}

function openEditTournamentForm(existing){
  const slot = document.getElementById('turnaj-form-slot');
  const evOptions = [...events].sort((a,b) => (b.dateStart||'').localeCompare(a.dateStart||''));
  slot.innerHTML = `
    <form class="panel" id="form-new-tourney">
      <div class="field"><label>Název turnaje</label><input type="text" id="new-tourney-name" placeholder="Hlavní Dota turnaj" value="${escapeHtml(existing.name)}" required></div>
      ${gameFieldHtml(existing.game || '', existing.gameImage || '')}
      <div class="field"><label>Akce (nepovinné)</label><select id="new-tourney-event">
        <option value="">— bez přiřazené akce —</option>
        ${evOptions.map(e=>`<option value="${e.id}" ${existing.eventId===e.id?'selected':''}>${escapeHtml(e.name)}${e.dateEnd < todayIso() ? ' (proběhlo)' : ''}</option>`).join('')}
      </select></div>
      <div class="field"><label>URL obrázku turnaje (nepovinné)</label><input type="url" id="new-tourney-image" value="${escapeHtml(existing.imageUrl||'')}"></div>
      <div style="display:flex; gap:10px;">
        <button type="submit">Uložit změny</button>
        <button type="button" class="btn-ghost" id="btn-cancel-new-tourney">Zrušit</button>
      </div>
    </form>
  `;
  slot.scrollIntoView({ behavior:'smooth', block:'start' });
  document.getElementById('btn-cancel-new-tourney').addEventListener('click', () => { slot.innerHTML = ''; });
  const getGameImage3 = setupGameField(existing.gameImage || '');
  document.getElementById('form-new-tourney').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('new-tourney-name').value.trim();
    const eventId = document.getElementById('new-tourney-event').value;
    const imageUrl = document.getElementById('new-tourney-image').value.trim();
    const game = document.getElementById('new-tourney-game').value.trim();
    const gameImage = getGameImage3();
    if(!name) return;
    try{
      await updateDoc(doc(db,'tournaments',existing.id), { name, eventId, imageUrl, game, gameImage });
      slot.innerHTML = '';
      renderTurnajPage();
    }catch(err){ alert('Uložení se nepovedlo.'); console.error(err); }
  });
}

// ==================== LOSOVAČKA TÝMŮ (výherní automat) ====================
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

function tbKey(name){
  return String(name).split('').map(ch => /[A-Za-z0-9]/.test(ch) ? ch : '_' + ch.charCodeAt(0).toString(16) + '_').join('');
}
// Handicap (skill + piva/panáky/jointy) se sdílí mezi turnaji stejné akce založenými stejný den
// (klíč = akce+den), aby druhý turnaj toho dne navazoval na první. Nová akce/den = čistý start.
// Turnaj bez přiřazené akce má handicap jen pro sebe (klíč = ID turnaje).
function handicapSessionKey(t){
  const day = (t.createdAt || '').slice(0, 10);
  return t.eventId ? `ev_${t.eventId}_${day}` : `solo_${t.id}`;
}
let handicapCache = {}; // sessionKey -> { skills:{}, drinks:{} }
function handicapSessionData(t){
  return handicapCache[handicapSessionKey(t)] || { skills:{}, drinks:{} };
}
// "Syrový" handicap bez zadaného skillu - klesá od nuly do mínusu, žádný přepočet na efektivní skill
function tbRawHandicap(beers, shots, joints){
  return beers * 10 + shots * 15 + joints * 20;
}
function tbGetPlayerStats(t, name){
  const k = tbKey(name);
  const session = handicapSessionData(t);
  const base = (session.skills && typeof session.skills[k] === 'number') ? session.skills[k] : null;
  const d = (session.drinks && session.drinks[k]) || {};
  return { base, beers: d.beers || 0, shots: d.shots || 0, joints: d.joints || 0 };
}
function tbEffectiveStats(t, name){
  const s = tbGetPlayerStats(t, name);
  if(s.base === null) return { ...s, eff: null, handicap: tbRawHandicap(s.beers, s.shots, s.joints) };
  const eff = tbCalculateCurrentSkill({ baseSkill: s.base, beers: s.beers, shots: s.shots, joints: s.joints });
  return { ...s, eff, handicap: Math.max(0, s.base - eff) };
}

// Hráči v losování při zakládání turnaje
let tbDraw = { players: [], teams: null };
let tbDrawSeq = 1;
let tbSoundUnlocked = false;
function tbAddDrawPlayer(name, baseSkill, opts){
  opts = opts || {};
  if(tbDraw.players.some(p => p.name.toLowerCase() === name.toLowerCase())) return;
  tbDraw.players.push({ id: tbDrawSeq++, name, baseSkill, fromEvent: !!opts.fromEvent });
  if(opts.persist !== false) tbSaveSkill(name, baseSkill);
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
    if (tbAudioCtx && tbAudioCtx.state === 'suspended') { tbAudioCtx.resume().catch(() => {}); }
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
function tbPlayMulticastCharge(){
    if (!tbSoundEnabled) return;
    try{
        tbEnsureAudio();
        if(!tbAudioCtx) return;
        const t0 = tbAudioCtx.currentTime;
        const osc = tbAudioCtx.createOscillator();
        const gain = tbAudioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(90, t0);
        osc.frequency.exponentialRampToValueAtTime(520, t0 + 0.5);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.09, t0 + 0.4);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
        osc.connect(gain); gain.connect(tbAudioCtx.destination);
        osc.start(t0); osc.stop(t0 + 0.56);
    }catch(e){ /* ticho */ }
}

// Elektrický "multicast" zásah - eskaluje s parametrem stage (1., 2., 3. zásah v jednom kole losování)
function tbPlayMulticastZap(stage, announce){
    if (!tbSoundEnabled) return;
    try{
        tbEnsureAudio();
        if(!tbAudioCtx) return;
        const t0 = tbAudioCtx.currentTime;
        const pitchMul = 1 + (stage - 1) * 0.28;

        // elektrický sestupný "zzzap"
        const zap = tbAudioCtx.createOscillator();
        const zapGain = tbAudioCtx.createGain();
        zap.type = 'sawtooth';
        zap.frequency.setValueAtTime(1900 * pitchMul, t0);
        zap.frequency.exponentialRampToValueAtTime(140 * pitchMul, t0 + 0.32);
        zapGain.gain.setValueAtTime(0.0001, t0);
        zapGain.gain.exponentialRampToValueAtTime(0.2, t0 + 0.018);
        zapGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
        zap.connect(zapGain); zapGain.connect(tbAudioCtx.destination);
        zap.start(t0); zap.stop(t0 + 0.33);

        // magický "crackle" šum
        const bufferSize = Math.floor(tbAudioCtx.sampleRate * 0.28);
        const buffer = tbAudioCtx.createBuffer(1, bufferSize, tbAudioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) { data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2); }
        const noise = tbAudioCtx.createBufferSource();
        noise.buffer = buffer;
        const filter = tbAudioCtx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 2200 * (pitchMul * 0.6 + 0.4);
        const noiseGain = tbAudioCtx.createGain();
        noiseGain.gain.setValueAtTime(0.13, t0);
        noiseGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
        noise.connect(filter); filter.connect(noiseGain); noiseGain.connect(tbAudioCtx.destination);
        noise.start(t0);

        // hluboký magický "impact"
        const boom = tbAudioCtx.createOscillator();
        const boomGain = tbAudioCtx.createGain();
        boom.type = 'sine';
        boom.frequency.setValueAtTime(190 * pitchMul, t0);
        boom.frequency.exponentialRampToValueAtTime(45 * pitchMul, t0 + 0.22);
        boomGain.gain.setValueAtTime(0.0001, t0);
        boomGain.gain.exponentialRampToValueAtTime(0.24, t0 + 0.012);
        boomGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.26);
        boom.connect(boomGain); boomGain.connect(tbAudioCtx.destination);
        boom.start(t0); boom.stop(t0 + 0.27);

        if(announce){
            setTimeout(() => tbSpeak('Multicast!'), 80);
        }
    }catch(e){ /* ticho */ }
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
    // Seskupit podle typu (piva / panáky / jointy) a přehrát postupně, každý typ se svou vlastní hláškou
    const byType = {};
    events.forEach(e => { (byType[e.type] = byType[e.type] || []).push(e); });
    const order = ['beers', 'shots', 'joints'].filter(ty => byType[ty] && byType[ty].length);
    tbEventQueue = tbEventQueue.then(async () => {
        for (const ty of order) {
            const group = byType[ty];
            if (group.length === 1) await tbPlaySingleSubstanceEvent(group[0]);
            else await tbPlayBatchEvent(group);
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
    if (domType === 'beers') { svgHTML = tbBeerSVG(); animDuration = 4400; titleWord = '🍺 Skupinová runda piva!'; collectiveMsgs = tbBeerCollectiveMsgs; }
    else if (domType === 'shots') { svgHTML = tbShotSVG(); animDuration = 2200; titleWord = '🥃 Skupinová runda panáků!'; collectiveMsgs = tbShotCollectiveMsgs; }
    else { svgHTML = tbJointSVG(); animDuration = 5600; titleWord = '🍁 Skupinové zapalování!'; collectiveMsgs = tbJointCollectiveMsgs; }

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

    if (type === 'beers') { animDuration = up ? 4400 : 900; msgPool = up ? tbBeerUpMsgs : tbBeerDownMsgs; }
    else if (type === 'shots') { animDuration = up ? 2200 : 900; msgPool = up ? tbShotUpMsgs : tbShotDownMsgs; }
    else { animDuration = up ? 5600 : 900; msgPool = up ? tbJointUpMsgs : tbJointDownMsgs; }

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

// ---------- Losování týmů: formulář nového turnaje ----------
function tbInvalidateDraw(){
  tbDraw.teams = null;
  const box = document.getElementById('tb-drawn-teams');
  if(box) box.innerHTML = '';
}
function tbTeamSizeVal(){
  const el = document.getElementById('tb-team-size');
  const v = el ? parseInt(el.value, 10) : 3;
  return Math.min(6, Math.max(1, v || 3));
}
function tbAutoTeamCount(){
  return Math.max(1, Math.ceil(tbDraw.players.length / tbTeamSizeVal()));
}
function tbUpdateTeamCountHint(){
  const inp = document.getElementById('tb-team-count');
  if(inp) inp.placeholder = `auto (${tbAutoTeamCount()})`;
}
function tbRenderDrawPlayers(){
  const listDiv = document.getElementById('tb-draw-players');
  if(!listDiv) return;
  if(tbDraw.players.length === 0){
    listDiv.innerHTML = '<div class="empty">Zatím žádní hráči. Vyber akci, nebo někoho přidej ručně.</div>';
  }else{
    listDiv.innerHTML = tbDraw.players.map(p => `
      <div class="tb-draw-player">
        <span class="tb-draw-name">${escapeHtml(p.name)}</span>
        <label class="tb-draw-skill">Skill <input type="number" min="1" max="100" value="${p.baseSkill}" data-tb-dskill="${p.id}"></label>
        <button type="button" class="tb-draw-remove" data-tb-dremove="${p.id}" title="Odebrat">✕</button>
      </div>`).join('');
  }
  listDiv.querySelectorAll('[data-tb-dskill]').forEach(inp => inp.addEventListener('change', () => {
    const pl = tbDraw.players.find(x => String(x.id) === inp.dataset.tbDskill);
    if(!pl) return;
    pl.baseSkill = Math.min(100, Math.max(1, parseInt(inp.value, 10) || 50));
    inp.value = pl.baseSkill;
    tbSaveSkill(pl.name, pl.baseSkill);
    tbInvalidateDraw();
  }));
  listDiv.querySelectorAll('[data-tb-dremove]').forEach(btn => btn.addEventListener('click', () => {
    tbDraw.players = tbDraw.players.filter(x => String(x.id) !== btn.dataset.tbDremove);
    tbRenderDrawPlayers();
    tbInvalidateDraw();
  }));
  tbUpdateTeamCountHint();
}
function tbRenderDrawnTeams(){
  const box = document.getElementById('tb-drawn-teams');
  if(!box) return;
  if(!tbDraw.teams){ box.innerHTML = ''; return; }
  const skillOf = n => (tbDraw.players.find(p => p.name === n) || {}).baseSkill || 0;
  box.innerHTML = `<div class="section-title" style="font-size:15px; margin-top:18px;">Vylosované týmy — název, znak a barvu můžeš změnit</div>
    <div class="tb-drawn-grid">` + tbDraw.teams.map((tm, i) => `
      <div class="tb-drawn-team">
        <div class="tb-drawn-head">
          <button type="button" class="team-style-btn" data-dt-toggle="${i}" style="border-color:${tm.color || 'var(--line)'};">
            <span style="color:${tm.color || 'inherit'};">${tm.emblem || '🚩'}</span>
          </button>
          <input type="text" class="tb-drawn-name" data-tb-tname="${i}" value="${escapeHtml(tm.name)}" style="${tm.color ? `color:${tm.color};` : ''}">
          <div class="team-style-panel" data-dt-panel="${i}" style="display:none;">
            <div class="team-style-panel-label">Logo</div>
            <div class="chip-row">
              ${TEAM_EMBLEMS.map(em => `<span class="chip" data-dt-emblem="${i}" data-val="${em}" style="cursor:pointer; font-size:15px; ${tm.emblem === em ? 'border-color:var(--gold); color:var(--gold);' : ''}">${em}</span>`).join('')}
            </div>
            <div class="team-style-panel-label">Barva</div>
            <div class="chip-row">
              ${TEAM_COLORS.map(c => `<span class="color-swatch ${tm.color === c ? 'active' : ''}" data-dt-color="${i}" data-val="${c}" style="background:${c};"></span>`).join('')}
            </div>
          </div>
        </div>
        ${tm.members.map(n => `<div class="tb-drawn-member"><span>${escapeHtml(n)}</span><span>${skillOf(n)}</span></div>`).join('')}
        <div class="tb-drawn-total">Σ ${tm.members.reduce((a, n) => a + skillOf(n), 0)}</div>
      </div>`).join('') + `</div>`;
  box.querySelectorAll('[data-tb-tname]').forEach(inp => inp.addEventListener('input', () => {
    tbDraw.teams[parseInt(inp.dataset.tbTname, 10)].name = inp.value;
  }));
  box.querySelectorAll('[data-dt-toggle]').forEach(btn => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const i = btn.dataset.dtToggle;
    box.querySelectorAll('[data-dt-panel]').forEach(p => {
      p.style.display = (p.dataset.dtPanel === i && p.style.display === 'none') ? 'flex' : 'none';
    });
  }));
  box.querySelectorAll('[data-dt-emblem]').forEach(el => el.addEventListener('click', () => {
    const tm = tbDraw.teams[parseInt(el.dataset.dtEmblem, 10)];
    tm.emblem = (tm.emblem === el.dataset.val) ? '' : el.dataset.val;
    tbRenderDrawnTeams();
  }));
  box.querySelectorAll('[data-dt-color]').forEach(el => el.addEventListener('click', () => {
    const tm = tbDraw.teams[parseInt(el.dataset.dtColor, 10)];
    tm.color = (tm.color === el.dataset.val) ? '' : el.dataset.val;
    tbRenderDrawnTeams();
  }));
}
if(!window.__tbDtOutside){
  window.__tbDtOutside = true;
  document.addEventListener('click', (e) => {
    if(!e.target.closest('[data-dt-panel]') && !e.target.closest('[data-dt-toggle]')){
      document.querySelectorAll('[data-dt-panel]').forEach(p => { p.style.display = 'none'; });
    }
  });
}
function tbStartDrawFromForm(){
  const size = tbTeamSizeVal();
  const P = tbDraw.players.length;
  const minTeams = Math.ceil(P / size);
  const numTeams = parseInt(document.getElementById('tb-team-count').value, 10) || minTeams;
  if(P < 2){ alert('Přidej aspoň 2 hráče.'); return; }
  if(numTeams < 2){ alert('Turnaj potřebuje aspoň 2 týmy — zvyš počet týmů.'); return; }
  if(numTeams < minTeams){ alert(`Na ${P} hráčů po ${size} potřebuješ aspoň ${minTeams} týmů.`); return; }
  if(numTeams > P){ alert('Týmů je víc než hráčů.'); return; }
  tbStartDraft({
    players: tbDraw.players.map(p => ({ name: p.name, baseSkill: p.baseSkill })),
    teamSize: size,
    numTeams,
    onConfirm: (teams) => {
      tbDraw.players.forEach(p => tbSaveSkill(p.name, p.baseSkill));
      tbDraw.teams = teams.map((t, i) => ({ name: `Tým ${i+1}`, members: t.members }));
      tbRenderDrawnTeams();
    }
  });
}

// ---------- Losovací automat (N válců = hráčů v týmu) ----------
function tbEnsureOverlay(){
  let overlay = document.getElementById('tbEventOverlay');
  if(!overlay){
    overlay = document.createElement('div');
    overlay.className = 'tb-event-overlay';
    overlay.id = 'tbEventOverlay';
    overlay.innerHTML = '<div class="tb-event-modal" id="tbEventModal"></div>';
    document.body.appendChild(overlay);
  }
  return overlay;
}

function tbSlotModalHTML(teamId, N){
  const avail = N > 3 ? 540 : 424;
  const w = Math.min(122, Math.floor((avail - 14 * (N - 1)) / N));
  let reels = '', labels = '';
  for(let k = 0; k < N; k++){
    reels += `<div class="tb-reel-window" style="width:${w}px;"><div class="tb-reel-strip" id="tbReelStrip${k+1}"></div></div>`;
    labels += `<div class="tb-reel-label" style="width:${w}px;">${k === 0 ? '👑 Vůdce' : 'Člen ' + k}</div>`;
  }
  return `
    <button type="button" class="tb-modal-close-btn" id="tbCancelDraftBtn" title="Zavřít a zrušit losování">✕</button>
    <div class="tb-event-title">🎰 Losování Týmu ${teamId}</div>
    <div class="tb-slot-frame ${N > 4 ? 'tb-slot-compact' : ''}" id="tbSlotFrame" style="${N > 3 ? 'max-width:none;' : ''}">
        <div class="tb-slot-title">MULTICAST</div>
        <div class="tb-slot-subtitle">Ogre Magi rozhoduje o osudu týmu...</div>
        <div class="tb-reels-row">${reels}</div>
        <div class="tb-reel-labels-row">${labels}</div>
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
    if(!draft) return;
    const team = draft.teams[draft.index];
    const N = draft.N;
    const modal = document.getElementById('tbEventModal');
    const lever = modal.querySelector('#tbLeverWrap');
    const status = modal.querySelector('#tbSlotStatus');
    lever.classList.add('tb-disabled', 'tb-lever-pulled');
    status.textContent = 'Losuje se...';
    tbPlayMulticastCharge();
    await tbSleep(280);
    lever.classList.remove('tb-lever-pulled');

    const placed = new Set();
    draft.teams.slice(0, draft.index).forEach(tm => tm.members.forEach(m => { if(m) placed.add(m.name); }));
    const strips = [], pools = [];
    for(let k = 0; k < N; k++){
        strips.push(modal.querySelector('#tbReelStrip' + (k + 1)));
        pools.push(draft.tiers[k].filter(p => !placed.has(p.name) && p !== team.members[k]).map(p => p.name));
    }
    const spins = strips.map((s, k) => tbStartConstantSpin(s, pools[k]));
    await tbSleep(900);

    for(let k = 0; k < N; k++){
        spins[k].stop();
        const target = team.members[k] ? team.members[k].name : '—';
        await tbDecelerateAndLand(strips[k], pools[k], target, 1500);
        if(tbDraftCancelled){ for(let j = k + 1; j < N; j++) spins[j].stop(); return; }
        tbPlayMulticastZap(k + 1, k === N - 1 && N > 1);
    }

    const names = team.members.filter(Boolean).map(m => m.name);
    const line = document.createElement('div');
    line.className = 'tb-result-entry';
    line.textContent = `Tým ${team.id}: ${tbJoinNamesCz(names)}`;
    modal.querySelector('#tbResultsList').appendChild(line);
    await tbSleep(700);

    draft.index++;
    if(draft.index < draft.teams.length){
        const nextTeam = draft.teams[draft.index];
        modal.querySelector('.tb-event-title').textContent = `🎰 Losování Týmu ${nextTeam.id}`;
        status.textContent = `Zatáhni za páku a vylosuj Tým ${nextTeam.id}!`;
        lever.classList.remove('tb-disabled');
    }else{
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

function tbCloseOverlay(){
    const overlay = document.getElementById('tbEventOverlay');
    if(overlay) overlay.classList.remove('tb-show');
}
function tbCancelDraft() {
    tbDraftCancelled = true;
    tbCloseOverlay();
    tbCurrentDraft = null;
    tbDraftInProgress = false;
}
function tbConfirmTeams() {
    const draft = tbCurrentDraft;
    if(!draft) return;
    const teams = draft.teams.map(t => ({ members: t.members.filter(Boolean).map(m => m.name) }));
    const cb = draft.cfg.onConfirm;
    tbCloseOverlay();
    tbCurrentDraft = null;
    tbDraftInProgress = false;
    if(cb) cb(teams);
}
function tbRerollTeams() {
    if(tbCurrentDraft) tbStartDraft(tbCurrentDraft.cfg);
}

function tbStartDraft(cfg) {
    tbDraftCancelled = false;
    tbDraftInProgress = true;
    const N = cfg.teamSize, T = cfg.numTeams;
    const sorted = cfg.players.map(p => ({ name: p.name, currentSkill: p.baseSkill })).sort((a, b) => b.currentSkill - a.currentSkill);

    // hadí rozdělení: vrstva k = k-tá nejsilnější skupina hráčů, ve vrstvách se pořadí zamíchá
    const tiers = [];
    for(let k = 0; k < N; k++) tiers.push(tbShuffleArray(sorted.slice(k * T, (k + 1) * T)));
    const teams = Array.from({ length: T }, (_, i) => ({ id: i + 1, members: Array(N).fill(null) }));
    tiers.forEach((tier, k) => tier.forEach((p, i) => { teams[(k % 2 === 0) ? i : (T - 1 - i)].members[k] = p; }));

    tbCurrentDraft = { teams, tiers, N, T, index: 0, cfg };
    const overlay = tbEnsureOverlay();
    const modal = document.getElementById('tbEventModal');
    modal.innerHTML = tbSlotModalHTML(1, N);
    document.getElementById('tbCancelDraftBtn').addEventListener('click', tbCancelDraft);
    document.getElementById('tbLeverWrap').addEventListener('click', tbOnLeverClick);
    document.getElementById('tbConfirmTeamsBtn').addEventListener('click', tbConfirmTeams);
    document.getElementById('tbRerollTeamsBtn').addEventListener('click', tbRerollTeams);
    overlay.classList.add('tb-show');
}

// ---------- Živé události (pití) + pomocné funkce turnaje ----------
// Napojuje se na sdílenou "session" (akce+den, nebo samotný turnaj), ne na turnaj samotný,
// aby dva turnaje stejné akce/dne sdílely piva i skill živě mezi sebou.
let tbLiveUnsub = null, tbLiveDrinkEventsUnsub = null, tbLiveSessionKey = null;
function tbStopLive(){
    if(tbLiveUnsub){ tbLiveUnsub(); tbLiveUnsub = null; }
    if(tbLiveDrinkEventsUnsub){ tbLiveDrinkEventsUnsub(); tbLiveDrinkEventsUnsub = null; }
    tbLiveSessionKey = null;
}
function tbEnsureLive(t){
    const key = handicapSessionKey(t);
    if(tbLiveSessionKey === key) return;
    tbStopLive();
    tbLiveSessionKey = key;
    tbEnsureOverlay();

    tbLiveUnsub = onSnapshot(doc(db, 'handicapSessions', key), (snap) => {
        handicapCache[key] = snap.exists() ? { skills: snap.data().skills || {}, drinks: snap.data().drinks || {} } : { skills:{}, drinks:{} };
        renderTurnajPage();
    }, (err) => console.error('Handicap session:', err));

    let ready = false;
    tbLiveDrinkEventsUnsub = onSnapshot(collection(db, 'handicapSessions', key, 'drinkEvents'), (snap) => {
        if(!ready){ if(!snap.metadata.fromCache) ready = true; return; } // staré události se nepřehrávají
        snap.docChanges().forEach(ch => {
            if(ch.type !== 'added') return;
            const d = ch.doc.data();
            if(!d || !d.name) return;
            if(d.by && d.by === currentNick) return; // vlastní právě potvrzené změny už byly přehrány okamžitě
            tbQueueSubstanceEvent(d.type, { name: d.name }, 0, 0, d.amount || 1);
        });
    }, (err) => console.error('Živé události:', err));
}

async function tbSetSkill(t, name, raw){
    if(!hasPerm('turnaj')) return;
    const v = Math.min(100, Math.max(1, parseInt(raw, 10) || 50));
    try{
        await setDoc(doc(db, 'handicapSessions', handicapSessionKey(t)), { [`skills.${tbKey(name)}`]: v }, { merge: true });
        tbSaveSkill(name, v);
    }catch(err){ console.error(err); }
}

// ---------- Graf "Vývoj" (jak komu ubýval skill podle piv/panáků/jointů v čase) ----------
let tbGraphAllEvents = null; // cache načtených událostí pro aktuálně otevřený graf
let tbGraphTid = null;
let tbGraphTypes = { beers:true, shots:true, joints:true };
let tbGraphPlayers = null; // Set jmen, null = všichni

async function openTbDevGraphModal(t){
  tbGraphTid = t.id;
  tbGraphAllEvents = null;
  tbGraphTypes = { beers:true, shots:true, joints:true };
  tbGraphPlayers = null;
  renderTbDevGraphModal(t, true);
  try{
    const key = handicapSessionKey(t);
    const snap = await getDocs(collection(db, 'handicapSessions', key, 'drinkEvents'));
    tbGraphAllEvents = snap.docs.map(d => d.data()).filter(d => d && d.name && d.ts).sort((a,b) => a.ts.localeCompare(b.ts));
  }catch(err){ console.error(err); tbGraphAllEvents = []; }
  renderTbDevGraphModal(t, false);
}
function closeTbDevGraphModal(){
  tbGraphTid = null;
  const o = document.getElementById('tbGraphOverlay');
  if(o) o.remove();
}

const TB_GRAPH_COLORS = ['#e84393','#4a90d9','#f0c94e','#2ecc71','#9b59b6','#e67e22','#1abc9c','#e74c3c'];

function renderTbDevGraphModal(t, loading){
  let overlay = document.getElementById('tbGraphOverlay');
  if(!overlay){
    overlay = document.createElement('div');
    overlay.id = 'tbGraphOverlay';
    overlay.className = 'tb-drink-overlay';
    overlay.addEventListener('click', (e) => { if(e.target === overlay) closeTbDevGraphModal(); });
    document.body.appendChild(overlay);
  }
  const allNames = [...new Set((tbGraphAllEvents || []).map(e => e.name))].sort((a,b)=>a.localeCompare(b));
  const selectedNames = tbGraphPlayers || new Set(allNames);

  overlay.innerHTML = `<div class="tb-drink-modal" style="width:760px;">
    <button type="button" class="tb-modal-close-btn" data-tbg-close>✕</button>
    <div class="tb-drink-title">📈 Vývoj</div>
    <div class="tb-drink-sub">Jak komu ubýval skill podle piv, panáků a jointů v průběhu turnaje.</div>
    ${loading ? '<p class="empty">Načítám historii...</p>' : renderTbGraphBody(t, allNames, selectedNames)}
  </div>`;
  overlay.querySelector('[data-tbg-close]').addEventListener('click', closeTbDevGraphModal);
  if(loading) return;

  overlay.querySelectorAll('[data-tbg-type]').forEach(cb => cb.addEventListener('change', () => {
    tbGraphTypes[cb.dataset.tbgType] = cb.checked;
    renderTbDevGraphModal(t, false);
  }));
  overlay.querySelectorAll('[data-tbg-player]').forEach(cb => cb.addEventListener('change', () => {
    if(!tbGraphPlayers) tbGraphPlayers = new Set(allNames);
    if(cb.checked) tbGraphPlayers.add(cb.dataset.tbgPlayer); else tbGraphPlayers.delete(cb.dataset.tbgPlayer);
    renderTbDevGraphModal(t, false);
  }));
  const allBtn = overlay.querySelector('[data-tbg-all]');
  if(allBtn) allBtn.addEventListener('click', () => { tbGraphPlayers = new Set(allNames); renderTbDevGraphModal(t, false); });
  const noneBtn = overlay.querySelector('[data-tbg-none]');
  if(noneBtn) noneBtn.addEventListener('click', () => { tbGraphPlayers = new Set(); renderTbDevGraphModal(t, false); });
}

function renderTbGraphBody(t, allNames, selectedNames){
  if(allNames.length === 0){
    return '<p class="empty" style="color:#b89b6a;">Zatím žádná zaznamenaná piva, panáky ani jointy k zobrazení.</p>';
  }
  const typeRow = `
    <div class="tbg-filters">
      <label><input type="checkbox" data-tbg-type="beers" ${tbGraphTypes.beers?'checked':''}> 🍺 Piva</label>
      <label><input type="checkbox" data-tbg-type="shots" ${tbGraphTypes.shots?'checked':''}> ${TB_SHOT_ICON} Panáky</label>
      <label><input type="checkbox" data-tbg-type="joints" ${tbGraphTypes.joints?'checked':''}> ${TB_JOINT_ICON} Jointy</label>
    </div>
    <div class="tbg-players">
      ${allNames.map((n,i) => `<label style="color:${TB_GRAPH_COLORS[i % TB_GRAPH_COLORS.length]};"><input type="checkbox" data-tbg-player="${escapeHtml(n)}" ${selectedNames.has(n)?'checked':''}> ${escapeHtml(n)}</label>`).join('')}
      <button type="button" class="btn-ghost btn-sm" data-tbg-all>Vše</button>
      <button type="button" class="btn-ghost btn-sm" data-tbg-none>Nic</button>
    </div>
  `;
  return typeRow + buildTbGraphSvg(t, allNames, selectedNames);
}

function buildTbGraphSvg(t, allNames, selectedNames){
  const events = (tbGraphAllEvents || []).filter(e => tbGraphTypes[e.type]);
  const names = allNames.filter(n => selectedNames.has(n));
  if(names.length === 0) return '<p class="empty" style="color:#b89b6a;">Vyber aspoň jednoho hráče.</p>';

  const W = 680, H = 260, padL = 40, padR = 16, padT = 16, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  // pro každého hráče spočítat efektivní skill po každé JEHO relevantní události (v čase)
  const series = names.map((name, idx) => {
    const base = tbGetPlayerStats(t, name).base;
    let beers = 0, shots = 0, joints = 0;
    const points = [{ t: 0, y: base === null ? 0 : base }];
    events.filter(e => e.name === name).forEach((e, i) => {
      if(e.type === 'beers') beers = Math.max(0, beers + e.amount);
      if(e.type === 'shots') shots = Math.max(0, shots + e.amount);
      if(e.type === 'joints') joints = Math.max(0, joints + e.amount);
      const y = base === null ? -tbRawHandicap(beers, shots, joints) : tbCalculateCurrentSkill({ baseSkill: base, beers, shots, joints });
      points.push({ t: i + 1, y });
    });
    return { name, color: TB_GRAPH_COLORS[allNames.indexOf(name) % TB_GRAPH_COLORS.length], points, base };
  }).filter(s => s.points.length > 1); // jen hráči, co mají aspoň jednu událost

  if(series.length === 0) return '<p class="empty" style="color:#b89b6a;">Vybraní hráči zatím nemají žádné zaznamenané pití těchhle typů.</p>';

  const maxT = Math.max(1, ...series.map(s => s.points[s.points.length-1].t));
  const allY = series.flatMap(s => s.points.map(p => p.y));
  const minY = Math.min(0, ...allY), maxY = Math.max(10, ...allY);
  const x = tt => padL + (tt / maxT) * plotW;
  const y = yy => padT + plotH - ((yy - minY) / (maxY - minY || 1)) * plotH;

  const gridLines = [];
  for(let i = 0; i <= 4; i++){
    const gy = padT + (plotH / 4) * i;
    const val = Math.round(maxY - ((maxY - minY) / 4) * i);
    gridLines.push(`<line x1="${padL}" y1="${gy}" x2="${W-padR}" y2="${gy}" stroke="#3a281a" stroke-width="1"/><text x="${padL-6}" y="${gy+4}" font-size="10" fill="#8a7550" text-anchor="end">${val}</text>`);
  }

  const linesHtml = series.map(s => {
    const d = s.points.map((p,i) => `${i===0?'M':'L'}${x(p.t).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
    const dots = s.points.map(p => `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.y).toFixed(1)}" r="3" fill="${s.color}"/>`).join('');
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.2"/>${dots}`;
  }).join('');

  return `
    <svg viewBox="0 0 ${W} ${H}" class="tbg-svg" xmlns="http://www.w3.org/2000/svg">
      ${gridLines.join('')}
      ${linesHtml}
    </svg>
    <div class="tbg-legend">${series.map(s => `<span style="color:${s.color};">● ${escapeHtml(s.name)}${s.base===null?' (handicap)':''}</span>`).join('')}</div>
  `;
}

// ---------- Okno "Handicap" (Dota styl) ----------
let tbDrinkModalTid = null;
let tbDrinkPending = {}; // klíč "jméno|typ" -> nepotvrzená změna (+/-), dokud se neklikne na Potvrdit
function tbCloseDrinkModal(){
    tbDrinkModalTid = null;
    tbDrinkPending = {};
    const o = document.getElementById('tbDrinkOverlay');
    if(o) o.remove();
}
function openTbDrinkModal(t){
    tbDrinkModalTid = t.id;
    tbDrinkPending = {};
    tbRenderDrinkModal();
}
function tbRefreshDrinkModal(){
    if(tbDrinkModalTid) tbRenderDrinkModal();
}
function tbPendingCount(){
    return Object.values(tbDrinkPending).reduce((a, d) => a + Math.abs(d), 0);
}
function tbAdjustPending(name, type, delta){
    const key = name + '|' + type;
    tbDrinkPending[key] = (tbDrinkPending[key] || 0) + delta;
    if(tbDrinkPending[key] === 0) delete tbDrinkPending[key];
    tbRenderDrinkModal();
}
async function tbConfirmDrinkChanges(){
    const tid = tbDrinkModalTid;
    const t = allTournaments.find(x => x.id === tid);
    const entries = Object.entries(tbDrinkPending).filter(([,d]) => d !== 0);
    if(!tid || !t || entries.length === 0) return;
    tbDrinkPending = {};
    tbRenderDrinkModal();

    const sessionKey = handicapSessionKey(t);
    // zapsat do sdílené session (ostatním turnajům stejné akce/dne i na projektoru se to objeví přes živé události)
    const writes = entries.map(([key, delta]) => {
        const [name, type] = key.split('|');
        return setDoc(doc(db, 'handicapSessions', sessionKey), { [`drinks.${tbKey(name)}.${type}`]: increment(delta) }, { merge: true })
            .then(() => addDoc(collection(db, 'handicapSessions', sessionKey, 'drinkEvents'), { type, name, amount: delta, by: currentNick || '', ts: new Date().toISOString() }))
            .catch(err => { console.error(err); });
    });

    // vlastní animace přehrát rovnou, bez čekání na debounce (seskupené podle typu, tbFlushBatch to zajistí)
    entries.forEach(([key, delta]) => {
        const [name, type] = key.split('|');
        tbPendingEvents.push({ type, player: { name }, before: 0, after: 0, amount: delta });
    });
    if(tbBatchTimer){ clearTimeout(tbBatchTimer); tbBatchTimer = null; }
    tbFlushBatch();

    await Promise.all(writes);
}
function tbRenderDrinkModal(){
    const t = allTournaments.find(x => x.id === tbDrinkModalTid);
    if(!t){ tbCloseDrinkModal(); return; }
    let overlay = document.getElementById('tbDrinkOverlay');
    if(!overlay){
        overlay = document.createElement('div');
        overlay.id = 'tbDrinkOverlay';
        overlay.className = 'tb-drink-overlay';
        overlay.addEventListener('click', (e) => { if(e.target === overlay) tbCloseDrinkModal(); });
        document.body.appendChild(overlay);
    }
    const prev = overlay.querySelector('.tb-drink-body');
    const prevScroll = prev ? prev.scrollTop : 0;
    const ctrl = (icon, type, name, n, pendingD) => `<span class="tb-drink-ctl${pendingD ? ' tb-drink-ctl-pending' : ''}"><span class="tb-drink-ico">${icon}</span><button type="button" class="tb-sub-btn" data-tbd="${escapeHtml(name)}|${type}|-1">−</button><b>${n}${pendingD ? `<em class="tb-drink-pending-diff">${pendingD > 0 ? '+' : ''}${pendingD}</em>` : ''}</b><button type="button" class="tb-sub-btn" data-tbd="${escapeHtml(name)}|${type}|1">+</button></span>`;
    const body = (t.teams || []).map((tm, i) => {
        const members = tm.members || [];
        if(!members.length) return '';
        return `<div class="tb-drink-team">
            <div class="tb-drink-teamname">${tm.emblem ? escapeHtml(tm.emblem) + ' ' : ''}${escapeHtml(tm.name || `Tým ${i+1}`)}</div>
            ${members.map(n => {
                const pB = tbDrinkPending[n + '|beers'] || 0, pS = tbDrinkPending[n + '|shots'] || 0, pJ = tbDrinkPending[n + '|joints'] || 0;
                const s = tbEffectiveStats(t, n);
                const shownBeers = s.beers + pB, shownShots = s.shots + pS, shownJoints = s.joints + pJ;
                const base = s.base === null ? 0 : s.base;
                const shownEff = s.base === null ? null : tbCalculateCurrentSkill({ baseSkill: base, beers: shownBeers, shots: shownShots, joints: shownJoints });
                const shownHc = shownEff === null ? tbRawHandicap(shownBeers, shownShots, shownJoints) : Math.max(0, base - shownEff);
                return `<div class="tb-drink-row" data-tbd-name="${escapeHtml(n)}">
                    <div class="tb-drink-name">${escapeHtml(n)}</div>
                    <label class="tb-drink-skill">Skill <input type="number" min="1" max="100" placeholder="50" value="${s.base === null ? '' : s.base}" data-tbd-skill></label>
                    <div class="tb-drink-eff">${shownEff !== null ? `→ <b>${shownEff}</b>${shownHc > 0 ? ` <em>−${shownHc}</em>` : ''}` : (shownHc > 0 ? `Handicap <em>−${shownHc}</em>` : '')}</div>
                    ${ctrl('🍺', 'beers', n, shownBeers, pB)}${ctrl(TB_SHOT_ICON, 'shots', n, shownShots, pS)}${ctrl(TB_JOINT_ICON, 'joints', n, shownJoints, pJ)}
                </div>`;
            }).join('')}
        </div>`;
    }).join('') || '<div class="empty" style="color:#b89b6a;">Turnaj zatím nemá žádné hráče v týmech.</div>';
    const pendingN = tbPendingCount();
    overlay.innerHTML = `<div class="tb-drink-modal">
        <button type="button" class="tb-modal-close-btn" data-tbd-close>✕</button>
        <div class="tb-drink-title">Handicap turnaje</div>
        <div class="tb-drink-sub">Naklikej piva, panáky a jointy a potvrď tlačítkem dole — teprve pak se to uloží a spustí se animace všem na stránce.</div>
        <div class="tb-drink-body">${body}</div>
        <div class="tb-drink-footer">
            <button type="button" class="tb-btn-confirm" id="tbd-confirm-btn" ${pendingN ? '' : 'disabled'}>✅ Potvrdit${pendingN ? ` (${pendingN})` : ''}</button>
        </div>
    </div>`;
    const nb = overlay.querySelector('.tb-drink-body');
    if(nb) nb.scrollTop = prevScroll;
    overlay.querySelector('[data-tbd-close]').addEventListener('click', tbCloseDrinkModal);
    overlay.querySelector('#tbd-confirm-btn').addEventListener('click', tbConfirmDrinkChanges);
    overlay.querySelectorAll('.tb-drink-row').forEach(row => {
        const name = row.dataset.tbdName;
        row.querySelectorAll('[data-tbd]').forEach(btn => btn.addEventListener('click', () => {
            const [, type, d] = btn.dataset.tbd.split('|');
            tbAdjustPending(name, type, parseInt(d, 10));
        }));
        const sk = row.querySelector('[data-tbd-skill]');
        sk.addEventListener('change', () => tbSetSkill(t, name, sk.value));
    });
}

// ---------- Týmy nad pavoukem ----------
function renderTourneyTeamsPanel(t, box){
    if(!box) return;
    const teams = t.teams || [];
    if(!teams.some(tm => (tm.members || []).length)){ box.innerHTML = ''; return; }
    box.innerHTML = teams.map((tm, i) => {
        let sumEff = 0, sumHc = 0, any = false;
        const capt = teamCaptain(t, tm);
        const rows = (tm.members || []).map(n => {
            const s = tbEffectiveStats(t, n);
            if(s.eff !== null){ any = true; sumEff += s.eff; sumHc += s.handicap; }
            const dr = (s.beers || s.shots || s.joints)
                ? `<span class="ttp-drinks">${s.beers ? `🍺${s.beers} ` : ''}${s.shots ? `${TB_SHOT_ICON}${s.shots} ` : ''}${s.joints ? `${TB_JOINT_ICON}${s.joints}` : ''}</span>` : '';
            const isCapt = n === capt;
            return `<div class="ttp-player"><span class="ttp-name ${isCapt ? 'ttp-captain' : ''}">${isCapt ? '👑 ' : ''}${escapeHtml(n)}</span>${dr}<span class="ttp-skill">${s.base !== null ? s.base : '–'}${s.handicap > 0 ? `<em class="ttp-hc">−${s.handicap}</em>` : ''}</span></div>`;
        }).join('');
        const nameStyle = tm.color ? `style="color:${tm.color};"` : '';
        return `<div class="ttp-card">
            <div class="ttp-head"><span ${nameStyle}>${tm.emblem ? escapeHtml(tm.emblem) + ' ' : ''}${escapeHtml(tm.name || `Tým ${i+1}`)}</span>${any ? `<span class="ttp-total"><b>${sumEff}</b>${sumHc > 0 ? ` <em class="ttp-hc">−${sumHc}</em>` : ''}</span>` : ''}</div>
            ${rows}
        </div>`;
    }).join('');
}

function tbUnlockSound(){
    tbSoundUnlocked = true;
    tbSoundEnabled = true;
    try{ tbEnsureAudio(); if(tbAudioCtx && tbAudioCtx.state === 'suspended') tbAudioCtx.resume(); }catch(e){}
    try{
        if('speechSynthesis' in window){
            const u = new SpeechSynthesisUtterance('Zvuk zapnut');
            u.lang = 'cs-CZ';
            speechSynthesis.speak(u);
        }
    }catch(e){}
    tbPlayBeep(880, 0.12, 'triangle');
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

function buildPodiumHtml(t, swiss, big){
  const p1 = swiss.placements.find(p=>p.rank===1);
  const p2 = swiss.placements.find(p=>p.rank===2);
  const p3 = swiss.placements.find(p=>p.rank===3);
  const rest = swiss.placements.filter(p=>p.rank>3);
  const step = (p, idx, rankClass, rank) => {
    const tm = teamObj(t, p.team);
    const nameStyle = tm.color ? `style="color:${tm.color};"` : '';
    return `<div class="podium-step podium-${rank}">
      <div class="podium-team" ${nameStyle}>${trophySvg(rank)}${tm.emblem ? escapeHtml(tm.emblem) + ' ' : ''}${escapeHtml(teamName(t,p.team))}</div>
      ${podiumCupHtml(t, rankClass, rank, teamName(t,p.team))}
      ${teamMembersHtml(t, tm)}
    </div>`;
  };
  let html = `<div class="podium-wrap ${big?'podium-wrap-big':''}">`;
  if(p2) html += step(p2, 2, 'silver', 2);
  if(p1) html += step(p1, 1, 'gold', 1);
  if(p3) html += step(p3, 3, 'bronze', 3);
  html += `</div>`;
  if(rest.length > 0){
    html += rest.map(p => {
      const isFourth = p.rank === 4;
      const tm = teamObj(t, p.team);
      return `<div class="bracket-slot" style="margin-top:8px; flex-direction:column; align-items:flex-start;">
        <span>${isFourth ? '🥔' : (p.rank+'.')} ${tm.emblem ? escapeHtml(tm.emblem) + ' ' : ''}<span ${tm.color?`style=\"color:${tm.color};\"`:''}>${escapeHtml(teamName(t,p.team))}</span></span>
        ${teamMembersHtml(t, tm)}
      </div>`;
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

function openTournamentResultModal(t, swiss, ffaStandings){
  const backdrop = document.createElement('div');
  backdrop.className = 'score-modal-backdrop';
  const podiumHtml = ffaStandings ? buildFfaPodiumHtml(t, ffaStandings, true) : buildPodiumHtml(t, swiss, true);
  backdrop.innerHTML = `
    <div class="score-modal result-modal">
      <div style="font-size:18px; font-weight:700; font-family:'Cinzel', serif; color:var(--gold); text-align:center;">🏆 ${escapeHtml(t.name)}</div>
      ${podiumHtml}
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
  const membersA = '';
  const membersB = '';
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
    html += '<div class="empty">K téhle akci zatím není přiřazený žádný turnaj. Založíš ho v horním menu "Turnaje".</div>';
    box.innerHTML = html;
    return;
  }
  html += `<div class="grid" style="margin-top:14px;">` + linked.map(t => {
    let badgeTag = '', statusTxt = '';
    if(t.status === 'signup'){
      badgeTag = `<span class="tag tourney-signup-badge">Přihlášky otevřeny</span>`;
      statusTxt = `${(t.signups||[]).length} přihlášených`;
    }else if(t.format === 'ffa'){
      const standings = computeFfaStandings(t);
      const champion = standings.placements.find(p => p.rank === 1);
      badgeTag = `<span class="tag">${(t.ffa && t.ffa.participants || []).length} hráčů</span>`;
      statusTxt = champion ? `🏆 Vítěz: ${escapeHtml(champion.name)}` : 'Zatím žádné odehrané kolo';
    }else{
      const swiss = computeSwissTournament(t);
      const champion = swiss.placements.find(p => p.rank === 1);
      badgeTag = `<span class="tag">${(t.teams||[]).length} týmů</span>`;
      statusTxt = champion ? `🏆 Vítěz: ${escapeHtml(teamName(t, champion.team))}` : 'Základní část se ještě hraje';
    }
    return `
      <div class="event-card ${t.status === 'signup' ? 'event-card-signup-open' : ''}" data-open-tourney-compact="${t.id}" style="cursor:pointer;">
        ${t.gameImage ? `<div class="tourney-card-banner"><img src="${t.gameImage.replace(/"/g,'&quot;')}" alt=""></div>` : ''}
        <div style="display:flex; align-items:center; gap:10px;">
          ${badgeTag}
        </div>
        <h3>${escapeHtml(t.name)}</h3>
        <p class="desc">${statusTxt}</p>
        <span class="status-hint">${t.status === 'signup' ? 'Přihlásit se →' : 'Zobrazit celý pavouk →'}</span>
      </div>
    `;
  }).join('') + `</div>`;
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
          <div class="field" style="flex:1;"><label>Od (nepovinné)</label><input type="time" id="sch-start"></div>
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
    if(!entry.title || (!entry.timeStart && !entry.timeEnd)){
      alert('Vyplň aspoň jeden čas (Od nebo Do) a co se bude dít.');
      return;
    }
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
      .sort((a,b) => (a.timeStart || a.timeEnd).localeCompare(b.timeStart || b.timeEnd));
    return `
      <div style="margin-top:20px;">
        <div class="bracket-section-title">${fmtDate(d)}</div>
        ${items.length === 0 ? '<div class="empty">Zatím nic naplánováno.</div>' : items.map(it => `
          <div class="suggestion-row">
            <span class="txt"><b style="color:var(--gold);">${it.timeStart && it.timeEnd ? `${it.timeStart}–${it.timeEnd}` : it.timeStart || it.timeEnd}</b> — ${escapeHtml(it.title)}</span>
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
    <p class="lede" style="margin-top:0;">Nahraj fotky nebo videa přímo ze zařízení (jde vybrat víc najednou), nebo vlož odkaz (např. z YouTube).</p>
    <div class="photo-add-row">
      <div class="field" style="flex:1;"><label>Nahrát ze zařízení</label><input type="file" id="photo-file-input" accept="image/*,video/*" multiple></div>
      <button type="button" id="btn-upload-photo" class="btn-sm">Nahrát</button>
    </div>
    <div class="photo-add-row">
      <div class="field" style="flex:1;"><label>Nebo vlož odkaz (URL)</label><input type="url" id="photo-url-input" placeholder="https://..."></div>
      <button type="button" id="btn-add-photo" class="btn-sm">Přidat odkaz</button>
    </div>
    <div class="photo-upload-progress" id="photo-add-msg"></div>
    <div class="photo-grid" id="photo-grid"></div>
  `;

  document.getElementById('btn-upload-photo').addEventListener('click', async () => {
    if(!currentUser || !currentNick){ showView('ucet'); return; }
    const fileInput = document.getElementById('photo-file-input');
    const msg = document.getElementById('photo-add-msg');
    const files = Array.from(fileInput.files || []);
    if(files.length === 0){ msg.textContent = 'Nejdřív vyber aspoň jeden soubor.'; return; }
    const tooBig = files.find(f => f.size > 15 * 1024 * 1024);
    if(tooBig){ msg.textContent = `Soubor "${tooBig.name}" je moc velký (max 15 MB).`; return; }
    for(let i = 0; i < files.length; i++){
      const file = files[i];
      msg.textContent = `Nahrávám ${i+1}/${files.length}…`;
      try{
        const kind = file.type.startsWith('video/') ? 'video' : 'image';
        const safeName = `${Date.now()}-${i}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
        const fileRef = ref(storage, `event-photos/${ev.id}/${safeName}`);
        await uploadBytes(fileRef, file);
        const url = await getDownloadURL(fileRef);
        await addDoc(collection(db,'events',ev.id,'photos'), { url, kind, author: currentNick, authorEmoji: currentEmoji, authorAvatar: currentAvatar, uid: currentUser.uid, ts: new Date().toISOString() });
      }catch(err){ console.error(err); msg.textContent = `Nahrání souboru "${file.name}" se nepovedlo.`; return; }
    }
    fileInput.value = '';
    msg.textContent = '';
  });

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
      await addDoc(collection(db,'events',ev.id,'photos'), { url, kind, author: currentNick, authorEmoji: currentEmoji, authorAvatar: currentAvatar, uid: currentUser.uid, ts: new Date().toISOString() });
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
          <span>${authorLabel(p.author, p.authorEmoji, p.authorAvatar)}</span>
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
      currentAvatar = '';
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

// ---- Profilová fotka (avatar): nahrání přes Storage, rovnou po výběru souboru ----
document.getElementById('new-avatar-input').addEventListener('change', async (e) => {
  const msg = document.getElementById('avatar-change-msg');
  const file = e.target.files[0];
  if(!currentUser || !file) return;
  if(file.size > 5 * 1024 * 1024){ msg.textContent = 'Soubor je moc velký (max 5 MB).'; e.target.value = ''; return; }
  msg.textContent = 'Nahrávám...';
  try{
    const fileRef = ref(storage, `avatars/${currentUser.uid}`);
    await uploadBytes(fileRef, file);
    const url = await getDownloadURL(fileRef);
    await updateDoc(doc(db,'users',currentUser.uid), { avatar: url });
    currentAvatar = url;
    msg.textContent = 'Hotovo!';
    setTimeout(() => { msg.textContent = ''; }, 1500);
    updateAuthUI();
  }catch(err){ console.error(err); msg.textContent = 'Nahrání se nepovedlo — zkus to prosím znovu.'; }
  e.target.value = '';
});
document.getElementById('btn-remove-avatar').addEventListener('click', async () => {
  if(!currentUser) return;
  try{
    await updateDoc(doc(db,'users',currentUser.uid), { avatar: '' });
    currentAvatar = '';
    updateAuthUI();
  }catch(err){ console.error(err); }
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
    document.getElementById('account-avatar-big').style.display = currentAvatar ? 'block' : 'none';
    document.getElementById('account-avatar-big').src = currentAvatar || '';
    document.getElementById('account-avatar-placeholder').style.display = currentAvatar ? 'none' : 'flex';
    document.getElementById('btn-remove-avatar').style.display = currentAvatar ? 'inline-flex' : 'none';
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
    accWidget.innerHTML = `<span class="acc-nick">${currentAvatar ? avatarTag(currentAvatar, 24) : ''}${escapeHtml(currentNick)}</span><button type="button" class="btn-ghost btn-sm" id="topbar-logout-btn" style="color:var(--crimson); border-color:var(--crimson);">Odhlásit</button>`;
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
  currentAvatar = '';
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
        currentAvatar = userDoc.data().avatar || '';
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
