// (vyjmuto z app.js, řádky 4897-5012)
import { S, hasPerm } from "./state.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { storage, db } from "./firebase.js";
import { addDoc, collection, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { escapeHtml } from "./util.js";
import { authorLabel } from "./ui.js";
import { appApi } from "./hooks.js";

export function renderTabFoto(ev){
  const box = document.getElementById('tab-foto');
  box.innerHTML = `
    <div class="section-title" style="font-size:16px;">📷 Foto</div>
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
    if(!S.currentUser || !S.currentNick){ appApi.showView('ucet'); return; }
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
        await addDoc(collection(db,'events',ev.id,'photos'), { url, kind, author: S.currentNick, authorEmoji: S.currentEmoji, authorAvatar: S.currentAvatar, uid: S.currentUser.uid, ts: new Date().toISOString() });
      }catch(err){ console.error(err); msg.textContent = `Nahrání souboru "${file.name}" se nepovedlo.`; return; }
    }
    fileInput.value = '';
    msg.textContent = '';
  });

  document.getElementById('btn-add-photo').addEventListener('click', async () => {
    if(!S.currentUser || !S.currentNick){ appApi.showView('ucet'); return; }
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
      await addDoc(collection(db,'events',ev.id,'photos'), { url, kind, author: S.currentNick, authorEmoji: S.currentEmoji, authorAvatar: S.currentAvatar, uid: S.currentUser.uid, ts: new Date().toISOString() });
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
  if(S.currentPhotos.length === 0){
    grid.innerHTML = '<div class="empty">Zatím žádné fotky.</div>';
    return;
  }
  grid.innerHTML = S.currentPhotos.map(p => {
    const canDelete = S.currentUser && (p.uid === S.currentUser.uid || hasPerm('akce'));
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
