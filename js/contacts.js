// (vyjmuto z app.js, řádky 142-246)
import { onSnapshot, collection, deleteDoc, doc, getDoc, updateDoc, addDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js";
import { hasPerm } from "./state.js";
import { escapeHtml } from "./util.js";
import { logAction } from "./audit.js";
import { appApi } from "./hooks.js";

// ---- Kontakty / Tablo ----
let contacts = [];
let editingContactId = null;
onSnapshot(collection(db, 'contacts'), (snap) => {
  contacts = snap.docs.map(d => ({ id:d.id, ...d.data() }));
  renderContacts();
});

export function renderContacts(){
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
      try{ const cname = (contacts.find(c=>c.id===btn.dataset.deleteContact)||{}).name || ''; await deleteDoc(doc(db,'contacts',btn.dataset.deleteContact)); logAction('kontakty', `smazal kontakt „${cname}“`); }
      catch(err){ alert('Smazání se nepovedlo.'); console.error(err); }
    });
  });
}

const formContact = document.getElementById('form-contact');
export function closeContactForm(){
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
    const unameSnap = await getDoc(appApi.usernameDocRef(name));
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
    if(editingContactId){ await updateDoc(doc(db,'contacts',editingContactId), payload); logAction('kontakty', `upravil kontakt „${payload.name}“`); }
    else{ await addDoc(collection(db,'contacts'), payload); logAction('kontakty', `přidal kontakt „${payload.name}“`); }
    formContact.reset();
    formContact.style.display = 'none';
    editingContactId = null;
  }catch(err){ alert('Uložení se nepovedlo.'); console.error(err); }
});
