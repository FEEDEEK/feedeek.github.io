// (vyjmuto z app.js, řádky 4513-4582)
import { hasPerm } from "./state.js";
import { emptyFoodSchedule, MEAL_SLOTS } from "./constants.js";
import { escapeHtml } from "./util.js";
import { updateDoc, doc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js";
import { logAction } from "./audit.js";

// ==================== Editor jídla (oprávnění "Jídlo") ====================
// Upravuje jen plán jídla, jídelní bloky a hlasování - ostatní údaje akce zůstávají nedotčené.
export function openFoodEditor(ev){
  if(!hasPerm('jidlo') && !hasPerm('akce')) return;
  const old = document.getElementById('food-editor-overlay'); if(old) old.remove();
  const sched = emptyFoodSchedule();
  MEAL_SLOTS.forEach(s => { if(ev.foodSchedule && Array.isArray(ev.foodSchedule[s.key])) sched[s.key] = [...ev.foodSchedule[s.key]]; });
  const voting = ev.foodVotingSlots ? { ...ev.foodVotingSlots } : {};
  const overlay = document.createElement('div');
  overlay.id = 'food-editor-overlay';
  overlay.className = 'score-modal-backdrop';
  overlay.innerHTML = `
    <div class="mail-composer food-editor">
      <div class="section-title" style="font-size:16px;margin:0;">🍔 Upravit jídlo – ${escapeHtml(ev.name || '')}</div>
      <label class="mc-label">Plán jídla (obecné info / poznámka)</label>
      <textarea id="fe-plan" rows="3" placeholder="Platí se na místě...">${escapeHtml(ev.foodPlan || '')}</textarea>
      <div id="fe-slots"></div>
      <div class="mc-label">Přidat položku</div>
      <div class="tag-input-row">
        <select id="fe-meal">${MEAL_SLOTS.map(s => `<option value="${s.key}">${escapeHtml(s.label)}</option>`).join('')}</select>
        <input type="text" id="fe-input" placeholder="Např. Svíčková" style="flex:1;">
        <button type="button" id="fe-add">Přidat</button>
      </div>
      <div class="mc-status" id="fe-status"></div>
      <div class="mc-actions">
        <button type="button" class="btn-ghost" id="fe-cancel">Zrušit</button>
        <button type="button" class="btn-primary" id="fe-save">Uložit</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const $ = id => overlay.querySelector('#' + id);
  function renderSlots(){
    $('fe-slots').innerHTML = MEAL_SLOTS.map(slot => {
      const items = sched[slot.key] || [];
      const chips = items.length
        ? items.map((f, i) => `<span class="tag-chip">${escapeHtml(f)}<span class="x" data-rm="${slot.key}|${i}">×</span></span>`).join(' ')
        : '<span style="color:var(--text-muted);">Žádné položky</span>';
      return `<div class="meal-slot-block">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <b>${escapeHtml(slot.label)}:</b>
          <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:var(--text-muted); cursor:pointer; white-space:nowrap;">
            <input type="checkbox" data-vote="${slot.key}" ${voting[slot.key] ? 'checked' : ''}> Hlasování místo pevné nabídky
          </label>
        </div>
        <div class="chip-row" style="margin-top:6px;">${chips}</div>
      </div>`;
    }).join('');
    overlay.querySelectorAll('[data-rm]').forEach(el => el.addEventListener('click', () => {
      const [k, i] = el.dataset.rm.split('|'); sched[k].splice(parseInt(i, 10), 1); renderSlots();
    }));
    overlay.querySelectorAll('[data-vote]').forEach(el => el.addEventListener('change', () => { voting[el.dataset.vote] = el.checked; }));
  }
  renderSlots();
  const add = () => {
    const v = $('fe-input').value.trim(); if(!v) return;
    sched[$('fe-meal').value].push(v); $('fe-input').value = ''; renderSlots();
  };
  $('fe-add').addEventListener('click', add);
  $('fe-input').addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); add(); } });
  $('fe-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if(e.target === overlay) overlay.remove(); });
  $('fe-save').addEventListener('click', async () => {
    $('fe-status').textContent = 'Ukládám...';
    try{
      await updateDoc(doc(db, 'events', ev.id), { foodPlan: $('fe-plan').value.trim(), foodSchedule: sched, foodVotingSlots: voting });
      logAction('jidlo', `upravil jídlo u akce „${ev.name}“`);
      overlay.remove();
    }catch(err){ console.error(err); $('fe-status').textContent = 'Uložení se nepovedlo (nemáš oprávnění nebo chybí aktualizovaná pravidla Firestore).'; }
  });
}
