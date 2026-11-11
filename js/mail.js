// (vyjmuto z app.js, řádky 387-494)
import { getDocs, collection, addDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js";
import { escapeHtml } from "./util.js";
import { S } from "./state.js";
import { ref } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { logAction } from "./audit.js";

// ---------- Okno pro psaní e-mailů ----------
// E-maily se neposílají z prohlížeče: appka pro každého příjemce založí dokument v kolekci `mail`
// a rozšíření Firebase "Trigger Email from Firestore" ho odešle přes SMTP účet nastavený v konzoli Firebase
// (odesílatel = ta jedna reálná adresa, kterou tam nastavíš; heslo se zadává jen tam, nikdy do kódu).
export async function getAllUsersForMail(){
  try{
    const snap = await getDocs(collection(db,'users'));
    return snap.docs.map(d => ({ uid: d.id, nick: d.data().nick || '', email: d.data().email || '' })).filter(u => u.email);
  }catch(err){ console.error(err); return []; }
}
function mailSig(t){ return t.replace(/\s+$/,'') + '\n\nZdar,\nFEEDEEK'; }
export function mailLink(hash){ return `${location.origin}${location.pathname}#${hash}`; }
function mailTextToHtml(text){
  const safe = escapeHtml(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>');
  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;">${safe}</div>`;
}
// presets: [{label, subject, body, recipients:[{uid,nick,email}], hint}]
export function openMailComposer(title, presets){
  const old = document.getElementById('mail-composer-overlay'); if(old) old.remove();
  const overlay = document.createElement('div');
  overlay.id = 'mail-composer-overlay';
  overlay.className = 'score-modal-backdrop';
  overlay.innerHTML = `
    <div class="mail-composer">
      <div class="section-title" style="font-size:16px;margin:0;">✉️ ${escapeHtml(title)}</div>
      <div class="mc-presets" id="mc-presets"></div>
      <div class="mc-hint" id="mc-hint"></div>
      <label class="mc-label">Předmět</label>
      <input type="text" id="mc-subject">
      <label class="mc-label">Zpráva <span class="mc-dim">({nick} se nahradí přezdívkou příjemce)</span></label>
      <textarea id="mc-body" rows="8"></textarea>
      <div class="mc-label">Komu <span class="mc-dim" id="mc-count"></span>
        <button type="button" class="btn-ghost btn-sm" id="mc-all">Všichni</button>
        <button type="button" class="btn-ghost btn-sm" id="mc-none">Nikdo</button>
      </div>
      <div class="mc-recipients" id="mc-recipients"></div>
      <label class="mc-label">Odpovědi chodí na <span class="mc-dim">(Reply-To; odesílatel je adresa nastavená v rozšíření)</span></label>
      <input type="email" id="mc-replyto" value="${escapeHtml(S.currentUser?.email || '')}">
      <div class="mc-status" id="mc-status"></div>
      <div class="mc-actions">
        <button type="button" class="btn-ghost" id="mc-cancel">Zavřít</button>
        <button type="button" class="btn-primary" id="mc-send">Odeslat</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const $ = id => overlay.querySelector('#'+id);
  let cur = 0;
  let checked = new Set();
  const renderRecipients = () => {
    const rec = presets[cur].recipients;
    $('mc-recipients').innerHTML = rec.length ? rec.map((r,i) => `
      <label class="mc-rec"><input type="checkbox" data-i="${i}" ${checked.has(r.uid) ? 'checked' : ''}> ${escapeHtml(r.nick || '?')} <span class="mc-dim">${escapeHtml(r.email)}</span></label>`).join('')
      : '<div class="empty">Nikdo takový není.</div>';
    $('mc-recipients').querySelectorAll('input').forEach(cb => cb.addEventListener('change', () => {
      const r = rec[+cb.dataset.i]; cb.checked ? checked.add(r.uid) : checked.delete(r.uid); updCount();
    }));
    updCount();
  };
  const updCount = () => { $('mc-count').textContent = `(vybráno ${checked.size} z ${presets[cur].recipients.length})`; };
  const loadPreset = (i) => {
    cur = i; const p = presets[i];
    $('mc-subject').value = p.subject; $('mc-body').value = p.noSig ? p.body : mailSig(p.body);
    $('mc-hint').textContent = p.hint || '';
    checked = new Set(p.recipients.map(r => r.uid));
    $('mc-presets').querySelectorAll('button').forEach((b,j) => b.classList.toggle('active', j === i));
    renderRecipients();
  };
  $('mc-presets').innerHTML = presets.length > 1 ? presets.map((p,i) => `<button type="button" class="mc-preset" data-i="${i}">${escapeHtml(p.label)}</button>`).join('') : '';
  $('mc-presets').querySelectorAll('button').forEach(b => b.addEventListener('click', () => loadPreset(+b.dataset.i)));
  $('mc-all').addEventListener('click', () => { presets[cur].recipients.forEach(r => checked.add(r.uid)); renderRecipients(); });
  $('mc-none').addEventListener('click', () => { checked.clear(); renderRecipients(); });
  $('mc-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('mousedown', e => { if(e.target === overlay) overlay.remove(); });
  $('mc-send').addEventListener('click', async () => {
    const subject = $('mc-subject').value.trim();
    const body = $('mc-body').value;
    const replyTo = $('mc-replyto').value.trim();
    const list = presets[cur].recipients.filter(r => checked.has(r.uid));
    if(!subject || !body.trim()){ $('mc-status').textContent = 'Vyplň předmět i zprávu.'; return; }
    if(list.length === 0){ $('mc-status').textContent = 'Vyber aspoň jednoho příjemce.'; return; }
    if(!confirm(`Odeslat e-mail ${list.length} lidem?`)) return;
    $('mc-send').disabled = true; $('mc-status').textContent = 'Zakládám zprávy…';
    const states = {};
    const report = () => {
      const v = Object.values(states);
      const ok = v.filter(x => x === 'SUCCESS').length, err = v.filter(x => x === 'ERROR').length;
      $('mc-status').textContent = `Odesláno: ${ok} z ${list.length}` + (err ? ` · chyba: ${err} (zkontroluj nastavení rozšíření)` : (ok < list.length ? ' …čekám na odeslání' : ' ✓'));
    };
    try{
      for(const r of list){
        const text = body.replace(/\{nick\}/g, r.nick || '');
        const docData = { to: [r.email], message: { subject, text, html: mailTextToHtml(text) }, createdBy: S.currentUser.uid, createdAt: new Date().toISOString() };
        if(replyTo) docData.replyTo = replyTo;
        const ref = await addDoc(collection(db,'mail'), docData);
        states[ref.id] = 'PENDING';
        onSnapshot(ref, snap => { const st = snap.data()?.delivery?.state; if(st){ states[ref.id] = st; report(); } });
      }
      logAction('mail', `odeslal e-mail „${subject}“ (${list.length} příjemců)`);
      report();
    }catch(err){
      console.error(err);
      $('mc-status').textContent = 'Zpráv se nepovedlo založit (chybí oprávnění / pravidla Firestore?).';
      $('mc-send').disabled = false;
    }
  });
  loadPreset(0);
}
