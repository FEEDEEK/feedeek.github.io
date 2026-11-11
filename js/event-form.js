// (vyjmuto z app.js, řádky 173-632)
import { S, hasPerm } from "./state.js";
import { escapeHtml, fmtDateShort, fmtDate, todayIso } from "./util.js";
import { STEAM_SEARCH_FUNCTION_URL, searchGames } from "./games.js";
import { MEAL_SLOTS, emptyFoodSchedule } from "./constants.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { storage, db } from "./firebase.js";
import { updateDoc, doc, addDoc, collection, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { logAction } from "./audit.js";
import { fmtDateRange } from "./ui.js";
import { appApi } from "./hooks.js";

// ==================== FORMULÁŘ AKCE: hry (tagy) ====================
// Zdroj log her: Steam + IGDB kombinovaně (přes vlastní Cloud Run funkci, protože obě blokují přímé volání z prohlížeče)

export function normalizeGame(g){
  return (typeof g === 'string') ? { name: g, image: '' } : g;
}

export function renderFormGames(){
  const list = document.getElementById('ev-games-list');
  list.innerHTML = '';
  S.currentEventGames.forEach((rawGame, idx) => {
    const game = normalizeGame(rawGame);
    const li = document.createElement('li');
    li.className = 'tag-chip';
    li.innerHTML = `${game.image ? `<img src="${game.image.replace(/"/g,'&quot;')}" alt="" class="game-chip-logo">` : ''}<span>${escapeHtml(game.name)}</span>${!game.image ? `<span class="find-logo-btn" data-find-logo="${idx}" title="Najít logo">🔍</span>` : ''}<span class="x" data-remove-game="${idx}">×</span>`;
    list.appendChild(li);
  });
  list.querySelectorAll('[data-remove-game]').forEach(el => {
    el.addEventListener('click', () => {
      S.currentEventGames.splice(parseInt(el.dataset.removeGame,10), 1);
      renderFormGames();
    });
  });
  list.querySelectorAll('[data-find-logo]').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.findLogo, 10);
      S.gameLogoTargetIdx = idx;
      const input = document.getElementById('input-add-game');
      input.value = normalizeGame(S.currentEventGames[idx]).name;
      input.focus();
      input.dispatchEvent(new Event('input'));
    });
  });
}

document.getElementById('btn-add-game').addEventListener('click', () => {
  const input = document.getElementById('input-add-game');
  const val = input.value.trim();
  if(!val) return;
  if(S.gameLogoTargetIdx !== null){
    // hledání loga ke stávající hře bylo zrušeno - jen zavřít, nepřidávat duplicitně
    S.gameLogoTargetIdx = null;
    input.value = '';
    document.getElementById('game-autocomplete-list').style.display = 'none';
    return;
  }
  S.currentEventGames.push({ name: val, image: '' });
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
      const results = await searchGames(q);
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
          if(S.gameLogoTargetIdx !== null){
            S.currentEventGames[S.gameLogoTargetIdx] = { name: item.dataset.pickGame, image: item.dataset.pickImage || '' };
            S.gameLogoTargetIdx = null;
          }else{
            S.currentEventGames.push({ name: item.dataset.pickGame, image: item.dataset.pickImage || '' });
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
export function renderFormFood(){
  const box = document.getElementById('food-schedule-preview');
  box.innerHTML = MEAL_SLOTS.map(slot => {
    const items = S.currentEventFood[slot.key] || [];
    const isVoting = !!S.currentEventFoodVoting[slot.key];
    const chips = items.length
      ? items.map((food, idx) => `<span class="tag-chip">${escapeHtml(food)}<span class="x" data-remove-food="${slot.key}|${idx}">×</span></span>`).join(' ')
      : '<span style="color:var(--text-muted);">Žádné položky</span>';
    return `<div class="meal-slot-block">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <b>${slot.label}:</b>
        <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:var(--text-muted); cursor:pointer; white-space:nowrap;">
          <input type="checkbox" data-food-voting-toggle="${slot.key}" ${isVoting ? 'checked' : ''}> Hlasování místo pevné nabídky
        </label>
      </div>
      <small style="display:block; color:var(--text-muted); margin-top:2px;">${isVoting ? 'Lidé budou hlasovat, která z položek níž to bude.' : 'Lidé si zaškrtnou, co z nabídky chtějí.'}</small>
      <div class="chip-row" style="margin-top:6px;">${chips}</div>
    </div>`;
  }).join('');
  box.querySelectorAll('[data-remove-food]').forEach(el => {
    el.addEventListener('click', () => {
      const [key, idxStr] = el.dataset.removeFood.split('|');
      S.currentEventFood[key].splice(parseInt(idxStr,10), 1);
      renderFormFood();
    });
  });
  box.querySelectorAll('[data-food-voting-toggle]').forEach(el => {
    el.addEventListener('change', () => {
      S.currentEventFoodVoting[el.dataset.foodVotingToggle] = el.checked;
    });
  });
}
document.getElementById('btn-add-food').addEventListener('click', () => {
  const select = document.getElementById('select-food-meal');
  const input = document.getElementById('input-add-food');
  const val = input.value.trim();
  if(!val) return;
  if(!S.currentEventFood[select.value]) S.currentEventFood[select.value] = [];
  S.currentEventFood[select.value].push(val);
  input.value = '';
  renderFormFood();
});

// ==================== FORMULÁŘ AKCE: termíny k hlasování ====================
function renderFormDateOptions(){
  const list = document.getElementById('ev-dateopts-list');
  list.innerHTML = S.currentEventDateOptions.map((d, idx) => `
    <li class="tag-chip"><span>${fmtDateShort(d.start)} – ${fmtDate(d.end)}</span><span class="x" data-remove-dateopt="${idx}">×</span></li>
  `).join('');
  list.querySelectorAll('[data-remove-dateopt]').forEach(el => {
    el.addEventListener('click', () => {
      S.currentEventDateOptions.splice(parseInt(el.dataset.removeDateopt,10), 1);
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
  S.currentEventDateOptions.push({ start, end });
  startInput.value = ''; endInput.value = '';
  renderFormDateOptions();
});

// ---- Akce: založení / editace / mazání ----
const formEvent = document.getElementById('form-event');
const btnNewEvent = document.getElementById('btn-new-event');
const akceListWrap = document.getElementById('akce-list-wrap');
let editingEventId = null;

function updateEvQrPreview(){
  const url = document.getElementById('ev-qr').value.trim();
  const preview = document.getElementById('ev-qr-preview');
  preview.src = url;
  preview.style.display = url ? 'block' : 'none';
}
document.getElementById('ev-qr').addEventListener('input', updateEvQrPreview);
document.getElementById('ev-qr-file').addEventListener('change', async () => {
  const fileInput = document.getElementById('ev-qr-file');
  const msg = document.getElementById('ev-qr-upload-msg');
  const file = fileInput.files[0];
  if(!file) return;
  if(file.size > 5 * 1024 * 1024){ msg.textContent = 'Soubor je moc velký (max 5 MB).'; return; }
  msg.textContent = 'Nahrávám...';
  try{
    const fileRef = ref(storage, `qr-codes/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`);
    await uploadBytes(fileRef, file);
    const url = await getDownloadURL(fileRef);
    document.getElementById('ev-qr').value = url;
    updateEvQrPreview();
    msg.textContent = 'Nahráno.';
  }catch(err){ console.error(err); msg.textContent = 'Nahrání se nepovedlo.'; }
});

function resetEventFormHelpers(){
  S.currentEventGames = [];
  S.currentEventFood = emptyFoodSchedule();
  S.currentEventFoodVoting = {};
  S.currentEventDateOptions = [];
  S.gameLogoTargetIdx = null;
  document.getElementById('ev-qr-upload-msg').textContent = '';
  updateEvQrPreview();
  renderFormGames();
  renderFormFood();
  renderFormDateOptions();
  document.getElementById('ev-dateopt-deadline').value = '';
}

function openEventForm(){
  formEvent.style.display = 'flex';
  akceListWrap.style.display = 'none';
}
export function closeEventForm(){
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
  const dateOptions = [...S.currentEventDateOptions];

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
    feeNote: document.getElementById('ev-fee-note').value.trim(),
    qrUrl: document.getElementById('ev-qr').value.trim(),
    accPrefix: document.getElementById('ev-acc-prefix').value.trim(),
    accNumber: document.getElementById('ev-acc-number').value.trim(),
    accBank: document.getElementById('ev-acc-bank').value.trim(),
    dateOptions,
    dateVoteDeadline: document.getElementById('ev-dateopt-deadline').value || '',
    games: [...S.currentEventGames],
    foodPlan: document.getElementById('ev-foodplan').value.trim(),
    foodSchedule: JSON.parse(JSON.stringify(S.currentEventFood)),
    foodVotingSlots: JSON.parse(JSON.stringify(S.currentEventFoodVoting)),
    changeDeadline: document.getElementById('ev-deadline').value || ''
  };
  try{
    if(editingEventId){
      await updateDoc(doc(db, 'events', editingEventId), payload);
      logAction('akce', `upravil akci „${payload.name}“`);
    }else{
      await addDoc(collection(db, 'events'), payload);
      logAction('akce', `vytvořil akci „${payload.name}“`);
    }
    closeEventForm();
  }catch(err){
    alert('Akci se nepodařilo uložit. Zkus to prosím znovu.');
    console.error(err);
  }finally{
    submitBtn.disabled = false;
  }
});

export function startEditEvent(ev){
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
  document.getElementById('ev-fee-note').value = ev.feeNote || '';
  document.getElementById('ev-qr').value = ev.qrUrl || '';
  document.getElementById('ev-acc-prefix').value = ev.accPrefix || '';
  document.getElementById('ev-acc-number').value = ev.accNumber || '';
  document.getElementById('ev-acc-bank').value = ev.accBank || '';
  updateEvQrPreview();
  S.currentEventDateOptions = Array.isArray(ev.dateOptions) ? [...ev.dateOptions] : [];
  renderFormDateOptions();
  document.getElementById('ev-dateopt-deadline').value = ev.dateVoteDeadline || '';
  document.getElementById('ev-foodplan').value = ev.foodPlan || '';
  document.getElementById('ev-deadline').value = ev.changeDeadline || '';

  S.currentEventGames = Array.isArray(ev.games) ? [...ev.games] : [];
  S.currentEventFood = emptyFoodSchedule();
  if(ev.foodSchedule){
    MEAL_SLOTS.forEach(slot => {
      S.currentEventFood[slot.key] = Array.isArray(ev.foodSchedule[slot.key]) ? [...ev.foodSchedule[slot.key]] : [];
    });
  }
  S.currentEventFoodVoting = ev.foodVotingSlots ? { ...ev.foodVotingSlots } : {};
  renderFormGames();
  renderFormFood();

  document.getElementById('btn-save-event').textContent = 'Uložit změny';
  appApi.showView('akce');
  openEventForm();
  formEvent.scrollIntoView({ behavior:'smooth', block:'start' });
}

async function deleteEvent(eventId, eventName){
  if(!confirm(`Opravdu smazat akci "${eventName}"? Tohle nejde vrátit zpět.`)) return;
  try{ await deleteDoc(doc(db, 'events', eventId)); logAction('akce', `smazal akci „${eventName}“`); }
  catch(err){ alert('Smazání se nepovedlo.'); console.error(err); }
}

export function renderEvents(){
  btnNewEvent.style.display = hasPerm('akce') ? 'inline-flex' : 'none';
  const featuredWrap = document.getElementById('featured-event-wrap');
  const grid = document.getElementById('events-grid');
  const historyWrap = document.getElementById('history-wrap');
  featuredWrap.innerHTML = '';
  grid.innerHTML = '';
  historyWrap.innerHTML = '';

  if(S.events.length === 0){
    grid.innerHTML = '<div class="empty">Zatím žádné akce.</div>';
    return;
  }

  const upcoming = S.events.filter(e => e.dateEnd >= todayIso());
  const past = S.events.filter(e => e.dateEnd < todayIso()).sort((a,b)=> b.dateStart.localeCompare(a.dateStart));

  if(upcoming.length === 0 && past.length > 0){
    grid.innerHTML = '<div class="empty">Žádná nadcházející akce zatím není vypsaná.</div>';
  }

  if(upcoming.length > 0){
    const featured = upcoming[0];
    const rest = upcoming.slice(1);

    const taken = (S.regCounts[featured.id]?.going) || 0;
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
      appApi.setRoute('#event/' + featured.id);
    });
    const featEditBtn = fc.querySelector('[data-edit-featured]');
    if(featEditBtn) featEditBtn.addEventListener('click', (e) => { e.stopPropagation(); startEditEvent(featured); });
    const featDelBtn = fc.querySelector('[data-delete-featured]');
    if(featDelBtn) featDelBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteEvent(featured.id, featured.name); });
    featuredWrap.appendChild(fc);

    rest.forEach(ev => {
      const t = (S.regCounts[ev.id]?.going) || 0;
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
        appApi.setRoute('#event/' + ev.id);
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
        appApi.setRoute('#event/' + ev.id);
      });
      const editBtn = card.querySelector('[data-edit-history]');
      if(editBtn) editBtn.addEventListener('click', (e) => { e.stopPropagation(); startEditEvent(ev); });
      const delBtn = card.querySelector('[data-delete-history]');
      if(delBtn) delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteEvent(ev.id, ev.name); });
      hgrid.appendChild(card);
    });
  }
}
