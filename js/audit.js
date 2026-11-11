// Záznam změn: co který admin kdy udělal. Zápis (logAction) a výpis pro správce s oprávněním "zaznam".
// Modul nezná zbytek aplikace – údaje o přihlášeném uživateli mu předá app.js přes initAudit().
import { collection, addDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js";
import { escapeHtml } from "./util.js";

let ctx = { getUser: () => null, getNick: () => '', isAdmin: () => false, hasPerm: () => false };
export function initAudit(c){ ctx = { ...ctx, ...c }; }

export const AUDIT_AREAS = { akce:'Akce', turnaj:'Turnaje', jidlo:'Jídlo', kontakty:'Kontakty', uzivatele:'Uživatelé', mail:'E-maily' };
export function logAction(area, text){
  try{
    const user = ctx.getUser();
    if(!user || !ctx.isAdmin()) return;
    addDoc(collection(db, 'auditLog'), { at: new Date().toISOString(), by: ctx.getNick() || '?', uid: user.uid, area, text }).catch(err => console.error('Záznam změn:', err));
  }catch(e){ /* záznam nikdy nesmí shodit akci */ }
}
let auditUnsub = null, auditEntries = [], auditFilter = 'all';
function renderAuditLog(){
  const box = document.getElementById('audit-list');
  if(!box) return;
  const list = auditEntries.filter(e => auditFilter === 'all' || e.area === auditFilter);
  const fmt = ts => { try{ return new Date(ts).toLocaleString('cs-CZ', { day:'numeric', month:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' }); }catch(e){ return ts || ''; } };
  document.getElementById('audit-filter').innerHTML = ['all', ...Object.keys(AUDIT_AREAS)].map(k => `<button type="button" class="btn-sm ${auditFilter === k ? 'btn-active' : 'btn-ghost'}" data-audit-filter="${k}">${k === 'all' ? 'Vše' : AUDIT_AREAS[k]}</button>`).join(' ');
  document.querySelectorAll('[data-audit-filter]').forEach(b => b.addEventListener('click', () => { auditFilter = b.dataset.auditFilter; renderAuditLog(); }));
  box.innerHTML = list.length ? list.map(e => `<div class="audit-row"><span class="audit-when">${escapeHtml(fmt(e.at))}</span><span class="audit-by">${escapeHtml(e.by || '?')}</span><span class="audit-area">${escapeHtml(AUDIT_AREAS[e.area] || e.area || '')}</span><span class="audit-text">${escapeHtml(e.text || '')}</span></div>`).join('') : '<div class="empty">Zatím žádné záznamy.</div>';
}
export function startAuditListener(){
  if(auditUnsub || !ctx.hasPerm('zaznam')) return;
  auditUnsub = onSnapshot(collection(db, 'auditLog'), snap => {
    auditEntries = snap.docs.map(d => d.data()).sort((x, y) => (y.at || '').localeCompare(x.at || '')).slice(0, 500);
    renderAuditLog();
  }, err => console.error('Záznam změn:', err));
}
export function stopAuditListener(){ if(auditUnsub){ auditUnsub(); auditUnsub = null; } auditEntries = []; }
