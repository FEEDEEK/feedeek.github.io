// (vyjmuto z app.js, řádky 1200-1398)
import { S, hasPerm } from "./state.js";
import { MEAL_SLOTS } from "./constants.js";
import { escapeHtml } from "./util.js";
import { setupChatEmojiRow, authorLabel } from "./ui.js";
import { updateDoc, doc, deleteDoc, addDoc, collection } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js";
import { appApi } from "./hooks.js";

// ---- Jídlo: zaškrtávací výběr + potvrzení + počty porcí pro admina ----
export function renderTabJidlo(ev){
  const box = document.getElementById('tab-jidlo');
  const myReg = S.currentUser ? S.currentRegistrationsMap[S.currentUser.uid] : null;
  const deadlinePassed = appApi.isPastDeadline(ev);
  const schedule = ev.foodSchedule || {};
  const votingSlots = ev.foodVotingSlots || {};
  const foodVotes = ev.foodVotes || {};
  const activeSlots = MEAL_SLOTS.filter(slot => schedule[slot.key] && schedule[slot.key].length > 0);
  const hasFixedSlot = activeSlots.some(slot => !votingSlots[slot.key]);

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
          const shortLabel = slot.label.includes('—') ? slot.label.split('—')[1].trim() : slot.label;
          const isVoting = !!votingSlots[slot.key];

          if(isVoting){
            const votesForSlot = foodVotes[slot.key] || {};
            const myVotesArr = (S.currentUser && Array.isArray(votesForSlot[S.currentUser.uid])) ? votesForSlot[S.currentUser.uid] : [];
            const tally = {};
            options.forEach(o => tally[o] = 0);
            Object.values(votesForSlot).forEach(v => { (Array.isArray(v) ? v : []).forEach(o => { if(tally[o] !== undefined) tally[o]++; }); });
            const voterCount = Object.keys(votesForSlot).length || 1;

            const votingHtml = options.map(o => {
              const count = tally[o];
              const pct = Math.round((count / voterCount) * 100);
              return `
                <label class="food-vote-row ${(!myReg || deadlinePassed) ? 'disabled' : ''}">
                  <span class="food-toggle food-vote-hex ${myVotesArr.includes(o) ? 'checked' : ''}" data-food-vote data-slot="${slot.key}" data-value="${escapeHtml(o)}">
                    <svg viewBox="0 0 26 26" class="food-toggle-svg">
                      <polygon points="6.5,1.5 19.5,1.5 25,13 19.5,24.5 6.5,24.5 1,13"/>
                      <path class="food-check" d="M7.5 13.5l3.3 3.3 7.7-7.7"/>
                    </svg>
                  </span>
                  <span class="food-vote-label">${escapeHtml(o)}</span>
                  <span class="food-vote-bar-wrap"><span class="food-vote-bar" style="width:${pct}%;"></span></span>
                  <span class="food-vote-count">${count}×</span>
                </label>
              `;
            }).join('');

            return `
              <div class="meal-slot-block" style="margin-bottom:18px;">
                <b style="font-size:13px;">🗳️ ${shortLabel}</b>
                <div style="margin-top:6px;">${myReg ? votingHtml : '<span class="status-hint">Přihlas se na akci, ať můžeš hlasovat.</span>'}</div>
              </div>
            `;
          }

          const myChoices = (myReg && myReg.food && Array.isArray(myReg.food[slot.key])) ? myReg.food[slot.key] : [];

          const portionCounts = {};
          options.forEach(o => portionCounts[o] = 0);
          Object.values(S.currentRegistrationsMap).forEach(r => {
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
              <b style="font-size:13px;">${shortLabel}</b>
              <div style="margin-top:6px;">${myReg ? checkboxesHtml : '<span class="status-hint">Přihlas se na akci, ať můžeš vybrat.</span>'}</div>
            </div>
          `;
        }).join('')}
      </div>
    `).join('') + '</div>';
  }

  const activeVotingSlots = MEAL_SLOTS.filter(slot => votingSlots[slot.key] && schedule[slot.key] && schedule[slot.key].length > 0);
  box.innerHTML = `
    <div class="section-title" style="font-size:16px;">🍔 Plán jídla</div>
    <p class="lede" style="margin-top:0;">${escapeHtml(ev.foodPlan || 'Zatím nic naplánováno.')}</p>
    ${deadlinePassed ? '<p class="status-hint">Uzávěrka změn proběhla — výběr už nejde měnit.</p>' : ''}
    ${slotsHtml}
    ${(myReg && hasFixedSlot && !deadlinePassed) ? `
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

  box.querySelectorAll('[data-food-vote]').forEach(el => {
    if(el.closest('.food-vote-row').classList.contains('disabled')) return;
    el.addEventListener('click', async () => {
      if(!S.currentUser) return;
      const slotKey = el.dataset.slot;
      const value = el.dataset.value;
      const current = (foodVotes[slotKey] && Array.isArray(foodVotes[slotKey][S.currentUser.uid])) ? foodVotes[slotKey][S.currentUser.uid] : [];
      const next = current.includes(value) ? current.filter(v => v !== value) : [...current, value];
      try{
        await updateDoc(doc(db,'events',ev.id), { [`foodVotes.${slotKey}.${S.currentUser.uid}`]: next });
      }catch(err){ console.error(err); }
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
      await updateDoc(doc(db,'events',ev.id,'registrations',S.currentUser.uid), { food: newFood });
      document.getElementById('food-confirm-msg').textContent = 'Menu uloženo.';
    }catch(err){
      alert('Nepovedlo se uložit.'); console.error(err);
    }finally{
      confirmBtn.disabled = false;
    }
  });

  const foodCommentsList = document.getElementById('food-comments-list');
  foodCommentsList.innerHTML = S.currentFoodComments.length === 0
    ? '<div class="empty">Zatím žádná diskuze.</div>'
    : S.currentFoodComments.map(c => {
        const canEdit = S.currentUser && (c.uid === S.currentUser.uid || hasPerm('jidlo'));
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
    if(!S.currentUser || !S.currentNick){ appApi.showView('ucet'); return; }
    const input = document.getElementById('food-comment-input');
    const text = input.value.trim();
    if(!text) return;
    try{
      await addDoc(collection(db,'events',ev.id,'foodComments'), { text, author: S.currentNick, authorEmoji: S.currentEmoji, authorAvatar: S.currentAvatar, uid: S.currentUser.uid, ts: new Date().toISOString() });
      input.value = '';
    }catch(err){ console.error(err); }
  });
}

