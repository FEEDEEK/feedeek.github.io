// (vyjmuto z app.js, řádky 4750-4900)
import { hasPerm, S } from "./state.js";
import { fmtDate, escapeHtml } from "./util.js";
import { updateDoc, doc, addDoc, collection, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js";
import { logAction } from "./audit.js";
import { setupChatEmojiRow, authorLabel } from "./ui.js";
import { appApi } from "./hooks.js";

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

export function renderTabRozvrh(ev){
  const box = document.getElementById('tab-rozvrh');
  const days = eventDayList(ev);
  const schedule = ev.schedule || [];

  if(days.length === 0){
    box.innerHTML = '<div class="empty">Rozvrh půjde vyplnit, až bude mít akce potvrzené konkrétní datum.</div>' + scheduleDiscussionHtml();
    setupScheduleDiscussion(ev);
    return;
  }

  let html = `<div class="section-title" style="font-size:16px;">🕐 Rozvrh</div>`;
  html += `<div class="rozvrh-layout">`;
  html += `<div class="rozvrh-list-col"><div id="schedule-days"></div></div>`;
  if(hasPerm('turnaj')){
    html += `
      <div class="rozvrh-form-col">
        <form class="panel" id="form-schedule-item">
          <div class="field"><label>Den</label><select id="sch-day">${days.map(d=>`<option value="${d}">${fmtDate(d)}</option>`).join('')}</select></div>
          <div style="display:flex; gap:12px;">
            <div class="field" style="flex:1;"><label>Od (nepovinné)</label><input type="time" id="sch-start"></div>
            <div class="field" style="flex:1;"><label>Do (nepovinné)</label><input type="time" id="sch-end"></div>
          </div>
          <div class="field"><label>Co se bude dít</label><input type="text" id="sch-title" placeholder="Turnaj, oběd, příjezd..." required></div>
          <button type="submit">Přidat do rozvrhu</button>
        </form>
      </div>
    `;
  }
  html += `</div>`;
  html += scheduleDiscussionHtml();
  box.innerHTML = html;
  setupScheduleDiscussion(ev);

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
      logAction('akce', `přidal položku do rozvrhu akce „${ev.name}“`);
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
      try{ await updateDoc(doc(db,'events',ev.id), { schedule: newSchedule }); logAction('akce', `odebral položku z rozvrhu akce „${ev.name}“`); }
      catch(err){ console.error(err); }
    });
  });
}

// ---- Diskuze k rozvrhu ----
function scheduleDiscussionHtml(){
  return `
    <div class="section-title" style="font-size:16px; margin-top:28px;">Diskuze k rozvrhu</div>
    <div class="discussion-block">
      <div class="discussion-list" id="schedule-comments-list"></div>
      <div class="discussion-input-row">
        <div class="discussion-input-wrap">
          <textarea class="discussion-input" id="schedule-comment-input" placeholder="Návrhy na změnu, kdy co začne..."></textarea>
          <button type="button" class="emoji-picker-btn" id="emoji-btn-schedule" title="Vložit emotikon">🙂</button>
          <div class="emoji-picker-panel" id="emoji-panel-schedule" style="display:none;"></div>
        </div>
        <button type="button" id="btn-add-schedule-comment" class="btn-sm">Odeslat</button>
      </div>
    </div>`;
}
function setupScheduleDiscussion(ev){
  setupChatEmojiRow('emoji-btn-schedule', 'emoji-panel-schedule', 'schedule-comment-input');
  renderScheduleComments(ev);
  document.getElementById('btn-add-schedule-comment').addEventListener('click', async () => {
    if(!S.currentUser || !S.currentNick){ appApi.showView('ucet'); return; }
    const input = document.getElementById('schedule-comment-input');
    const text = input.value.trim();
    if(!text) return;
    try{
      await addDoc(collection(db,'events',ev.id,'scheduleComments'), { text, author: S.currentNick, authorEmoji: S.currentEmoji, authorAvatar: S.currentAvatar, uid: S.currentUser.uid, ts: new Date().toISOString() });
      input.value = '';
    }catch(err){ console.error(err); }
  });
}
export function renderScheduleComments(ev){
  const list = document.getElementById('schedule-comments-list');
  if(!list) return;
  list.innerHTML = S.currentScheduleComments.length === 0
    ? '<div class="empty">Zatím žádná diskuze.</div>'
    : S.currentScheduleComments.map(c => {
        const canEdit = S.currentUser && (c.uid === S.currentUser.uid || hasPerm('akce') || hasPerm('turnaj'));
        return `
        <div class="comment-row">
          <span class="who">${authorLabel(c.author, c.authorEmoji, c.authorAvatar)}</span><span class="when">${c.ts ? new Date(c.ts).toLocaleDateString('cs-CZ') : ''}</span>
          <div class="txt">${escapeHtml(c.text)}</div>
          ${canEdit ? `<div class="row-actions"><button type="button" class="btn-ghost btn-sm" data-schedule-comment-delete="${c.id}" style="color:var(--crimson); border-color:var(--crimson);">Smazat</button></div>` : ''}
        </div>`;
      }).join('');
  list.querySelectorAll('[data-schedule-comment-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if(!confirm('Smazat tenhle příspěvek?')) return;
      try{ await deleteDoc(doc(db,'events',ev.id,'scheduleComments',btn.dataset.scheduleCommentDelete)); }
      catch(err){ console.error(err); }
    });
  });
  list.scrollTop = list.scrollHeight;
}

