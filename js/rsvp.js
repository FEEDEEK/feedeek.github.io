// (vyjmuto z app.js, řádky 996-1199)
import { S, hasPerm } from "./state.js";
import { setDoc, doc, deleteDoc, getDocs, collection, addDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js";
import { renderPersonalPaymentQr } from "./payment.js";
import { escapeHtml } from "./util.js";
import { avatarTag, emojiTag } from "./ui.js";
import { appApi } from "./hooks.js";

// ---- RSVP: dvoukrokové (nejdřív přihlásit, pak určitě/možná v sidebaru) ----
export function renderStatsAndRsvp(){
  const ev = S.events.find(x => x.id === S.currentDetailEventId);
  if(!ev) return;

  const rsvpBox = document.getElementById('ed-rsvp');
  const qrBoxEl = document.getElementById('ed-payment-qr');
  if(!S.currentUser || !S.currentNick){
    rsvpBox.innerHTML = `<button type="button" id="rsvp-login-btn">Přihlásit se na akci</button>`;
    document.getElementById('rsvp-login-btn').addEventListener('click', () => { S.pendingEventId = ev.id; appApi.showView('ucet'); });
    if(qrBoxEl) qrBoxEl.innerHTML = '';
    return;
  }

  const myReg = S.currentRegistrationsMap[S.currentUser.uid];
  const deadlinePassed = appApi.isPastDeadline(ev);
  const counts = S.regCounts[ev.id] || { going:0, maybe:0 };
  const full = counts.going >= ev.cap;

  if(!myReg){
    rsvpBox.innerHTML = `<button type="button" id="rsvp-register-btn" ${full ? 'disabled title="Akce je plně obsazená"' : ''}>Přihlásit se na akci</button>`;
    if(qrBoxEl) qrBoxEl.innerHTML = '';
    const btn = document.getElementById('rsvp-register-btn');
    if(btn) btn.addEventListener('click', async () => {
      try{
        await setDoc(doc(db, 'events', ev.id, 'registrations', S.currentUser.uid), {
          nick: S.currentNick, emoji: S.currentEmoji, avatar: S.currentAvatar, uid: S.currentUser.uid, status: 'going', food: {}, ts: new Date().toISOString()
        });
      }catch(err){ alert('Přihlášení se nepovedlo.'); console.error(err); }
    });
  }else{
    rsvpBox.innerHTML = `<button type="button" class="btn-ghost" id="rsvp-cancel" style="color:var(--crimson); border-color:var(--crimson);" ${deadlinePassed ? 'disabled title="Uzávěrka změn už proběhla"' : ''}>Odhlásit se z akce</button>`;
    const cancelBtn = document.getElementById('rsvp-cancel');
    if(cancelBtn) cancelBtn.addEventListener('click', async () => {
      if(!confirm('Opravdu se chceš z akce odhlásit?')) return;
      try{
        await deleteDoc(doc(db, 'events', ev.id, 'registrations', S.currentUser.uid));
        // nečekat jen na živý listener - rovnou celou stránku znovu vykreslit, ať nic nezůstane neaktuální bez ručního refreshe
        delete S.currentRegistrationsMap[S.currentUser.uid];
        appApi.applyRoute();
      }
      catch(err){ alert('Odhlášení se nepovedlo.'); console.error(err); }
    });
    const qrBox = qrBoxEl;
    if(qrBox) renderPersonalPaymentQr(ev, S.currentUser.uid, S.currentNick, qrBox);
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
  const eventId = S.currentDetailEventId;
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
    const already = new Set(Object.values(S.currentRegistrationsMap).map(r=>r._docId));
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

export function renderAttendees(){
  const box = document.getElementById('ed-attendees');
  const list = Object.values(S.currentRegistrationsMap).sort((a,b)=>(a.ts||'').localeCompare(b.ts||''));
  const going = list.filter(r => r.status !== 'maybe').length;
  const maybe = list.length - going;
  const ev = S.events.find(x => x.id === S.currentDetailEventId);
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
      const isSelf = S.currentUser && r._docId === S.currentUser.uid;
      let statusHtml;
      if(isSelf){
        statusHtml = `
          <button type="button" class="status-pill clickable ${r.status !== 'maybe' ? 'going' : ''}" data-self-status="going">Určitě</button>
          <button type="button" class="status-pill clickable ${r.status === 'maybe' ? 'maybe' : ''}" data-self-status="maybe">Možná</button>
        `;
      }else{
        statusHtml = `<span class="status-pill ${r.status === 'maybe' ? 'maybe' : 'going'}">${r.status === 'maybe' ? 'Možná' : 'Určitě'}</span>`;
      }
      const coinHtml = (ev && ev.fee && hasPerm('akce'))
        ? `<span class="coin-icon ${r.paid ? 'paid' : 'unpaid'} admin-toggle" data-toggle-paid="${r._docId}" title="${r.paid ? 'Zaplaceno' : 'Nezaplaceno'}">${coinSvg(r.paid)}</span>`
        : '';
      return `
        <div class="attendee-row">
          <span style="display:flex; align-items:center; gap:6px;">${coinHtml}${r.avatar ? avatarTag(r.avatar) : (r.emoji ? emojiTag(r.emoji) : '')}${escapeHtml(r.nick || '(bez jména)')}</span>
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
      const r = S.currentRegistrationsMap[el.dataset.togglePaid];
      try{ await updateDoc(doc(db, 'events', S.currentDetailEventId, 'registrations', el.dataset.togglePaid), { paid: !r.paid }); }
      catch(err){ console.error(err); }
    });
  });
  box.querySelectorAll('[data-self-status]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try{
        await updateDoc(doc(db, 'events', S.currentDetailEventId, 'registrations', S.currentUser.uid), { status: btn.dataset.selfStatus });
      }catch(err){ console.error(err); }
    });
  });
  box.querySelectorAll('[data-remove-attendee]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if(!confirm('Odebrat tohoto účastníka z akce?')) return;
      try{ await deleteDoc(doc(db, 'events', S.currentDetailEventId, 'registrations', btn.dataset.removeAttendee)); }
      catch(err){ alert('Odebrání se nepovedlo.'); console.error(err); }
    });
  });
}
