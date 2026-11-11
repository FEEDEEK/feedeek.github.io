// (vyjmuto z app.js, řádky 1198-1470)
import { MEAL_SLOTS } from "./constants.js";
import { escapeHtml } from "./util.js";
import { setupChatEmojiRow, authorLabel } from "./ui.js";
import { S, hasPerm } from "./state.js";
import { addDoc, collection, updateDoc, doc, arrayRemove, arrayUnion, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js";
import { searchGames } from "./games.js";
import { appApi } from "./hooks.js";

// ---- Přehled: hry + návrhy (editovatelné vlastníkem/adminem) + Diskuze (editovatelná vlastníkem/adminem) ----
export function renderTabPrehled(ev){
  const box = document.getElementById('tab-prehled');
  const games = [...(ev.games || [])].map(appApi.normalizeGame).sort((a,b) => a.name.localeCompare(b.name, 'cs'));
  const schedule = ev.foodSchedule || {};
  const votingSlots = ev.foodVotingSlots || {};
  const activeVotingSlots = MEAL_SLOTS.filter(s => votingSlots[s.key] && schedule[s.key] && schedule[s.key].length > 0);
  const votingAnnounceHtml = activeVotingSlots.length ? `
    <button type="button" class="tourney-signup-cta-btn food-vote-announce" id="food-vote-announce-btn">
      <span class="tourney-cta-sparkles"></span>
      <span>🗳️ V sekci Jídlo probíhá hlasování</span>
    </button>
  ` : '';
  box.innerHTML = `
    <div class="prehled-announce-row">
      ${votingAnnounceHtml}
      <div id="prehled-tourney-cta"></div>
    </div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:28px;">
      <div>
        <div class="section-title" style="font-size:16px;">🎮 Co se bude hrát</div>
        <div class="game-display-grid">${games.length ? games.map(g=>`<div class="game-display-card">${g.image ? `<img src="${g.image.replace(/"/g,'&quot;')}" alt="">` : '<div class="game-display-noimg">🎮</div>'}<span>${escapeHtml(g.name)}</span></div>`).join('') : '<span class="empty">Zatím nic nevypsáno.</span>'}</div>
      </div>
      <div>
        <div class="section-title" style="font-size:16px;">🎲 Chtěl by sis zahrát ještě něco jiného?</div>
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

    <div class="section-title" style="font-size:16px; margin-top:28px;">💬 Diskuze</div>
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
    if(!S.currentUser || !S.currentNick){ appApi.showView('ucet'); return; }
    const input = document.getElementById('suggestion-input');
    const text = input.value.trim();
    if(!text) return;
    try{
      await addDoc(collection(db,'events',ev.id,'suggestions'), { text, image: S.pendingSuggestionImage, author: S.currentNick, authorEmoji: S.currentEmoji, authorAvatar: S.currentAvatar, uid: S.currentUser.uid, likes: [], likeNicks: [], ts: new Date().toISOString() });
      input.value = '';
      S.pendingSuggestionImage = '';
      document.getElementById('sug-autocomplete-list').style.display = 'none';
    }catch(err){ console.error(err); }
  });

  let sugSearchDebounce = null;
  document.getElementById('suggestion-input').addEventListener('input', (e) => {
    clearTimeout(sugSearchDebounce);
    S.pendingSuggestionImage = '';
    const q = e.target.value.trim();
    const box = document.getElementById('sug-autocomplete-list');
    if(q.length < 2){ box.style.display = 'none'; return; }
    sugSearchDebounce = setTimeout(async () => {
      try{
        const results = await searchGames(q);
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
            S.pendingSuggestionImage = item.dataset.pickSugImage || '';
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
    if(!S.currentUser || !S.currentNick){ appApi.showView('ucet'); return; }
    const input = document.getElementById('comment-input');
    const text = input.value.trim();
    if(!text) return;
    try{
      await addDoc(collection(db,'events',ev.id,'comments'), { text, author: S.currentNick, authorEmoji: S.currentEmoji, authorAvatar: S.currentAvatar, uid: S.currentUser.uid, ts: new Date().toISOString() });
      input.value = '';
    }catch(err){ console.error(err); }
  });

  appApi.renderTournamentSignupCta(ev);
  const voteAnnounceBtn = document.getElementById('food-vote-announce-btn');
  if(voteAnnounceBtn) voteAnnounceBtn.addEventListener('click', () => {
    const jidloTabBtn = document.querySelector('#ed-tabs [data-tab="jidlo"]');
    if(jidloTabBtn) jidloTabBtn.click();
  });
}

function renderSuggestions(ev){
  const sugList = document.getElementById('suggestions-list');
  if(!sugList) return;
  if(S.currentSuggestions.length === 0){
    sugList.innerHTML = '<div class="empty">Zatím nikdo nic nenavrhl.</div>';
    return;
  }
  sugList.innerHTML = S.currentSuggestions.map(s => {
    const liked = S.currentUser && (s.likes||[]).includes(S.currentUser.uid);
    const likers = (s.likeNicks||[]).join('\n');
    const canEdit = S.currentUser && (s.uid === S.currentUser.uid || hasPerm('akce'));
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
      if(!S.currentUser || !S.currentNick){ appApi.showView('ucet'); return; }
      const sug = S.currentSuggestions.find(s => s.id === btn.dataset.sugLike);
      const liked = (sug.likes||[]).includes(S.currentUser.uid);
      try{
        await updateDoc(doc(db,'events',ev.id,'suggestions',sug.id), {
          likes: liked ? arrayRemove(S.currentUser.uid) : arrayUnion(S.currentUser.uid),
          likeNicks: liked ? arrayRemove(S.currentNick) : arrayUnion(S.currentNick)
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
      const sug = S.currentSuggestions.find(s => s.id === sugId);
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
            const results = await searchGames(q);
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
  if(S.currentComments.length === 0){
    commentsList.innerHTML = '<div class="empty">Zatím žádná diskuze.</div>';
    return;
  }
  commentsList.innerHTML = S.currentComments.map(c => {
    const canEdit = S.currentUser && (c.uid === S.currentUser.uid || hasPerm('akce'));
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
      const c = S.currentComments.find(x => x.id === cId);
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
