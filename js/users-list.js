// (vyjmuto z app.js, řádky 502-662)
import { getDocs, collection, updateDoc, doc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, functionsApi } from "./firebase.js";
import { S } from "./state.js";
import { PERMISSION_AREAS } from "./constants.js";
import { escapeHtml, fmtDate } from "./util.js";
import { logAction } from "./audit.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { appApi } from "./hooks.js";

export async function renderUsersList(){
  const box = document.getElementById('users-list');
  if(!box) return;
  box.innerHTML = '<div class="empty">Načítám...</div>';
  try{
    const snap = await getDocs(collection(db, 'users'));
    const users = snap.docs.map(d => ({ uid: d.id, ...d.data() })).sort((a,b) => (a.nick||'').localeCompare(b.nick||'', 'cs', { sensitivity:'base' }));
    if(users.length === 0){ box.innerHTML = '<div class="empty">Zatím žádní uživatelé.</div>'; return; }

    const showPerms = S.currentIsSuperAdmin;
    const allEmails = [...new Set(users.map(u => u.email).filter(Boolean))];
    box.innerHTML = `
      <div class="row" style="margin-bottom:16px; gap:10px;">
        <button type="button" class="btn-ghost btn-sm" id="btn-copy-emails">📋 Kopírovat e-maily (${allEmails.length})</button>
        <button type="button" class="mail-btn" id="btn-mailto-all">✉️ Napsat e-mail všem</button>
        <span class="small-msg" id="copy-emails-msg"></span>
      </div>
      <div style="overflow-x:auto;">
      <table style="width:100%; border-collapse:collapse; font-size:14px;">
        <thead><tr style="text-align:left; color:var(--text-muted); font-size:12px;">
          <th style="padding:8px 10px 8px 0;">Přezdívka</th>
          <th style="padding:8px 10px;">E-mail</th>
          <th style="padding:8px 10px;">Telefon</th>
          <th style="padding:8px 10px;">Registrace</th>
          <th style="padding:8px 10px;">Poslední přihlášení</th>
          <th></th><th></th>
          ${showPerms ? `<th style="padding:8px 10px; width:20px; border-left:1px solid var(--line);"></th><th style="padding:8px 10px;">Admin</th>${PERMISSION_AREAS.map(p=>`<th style="padding:8px 10px;" title="${escapeHtml(p.label)}">${escapeHtml(p.label.split(' ')[0])}</th>`).join('')}` : ''}
        </tr></thead>
        <tbody>
          ${users.map(u => `
            <tr style="border-top:1px solid var(--line);" data-user-row="${u.uid}">
              <td style="padding:8px 10px 8px 0;">${escapeHtml(u.nick||'')}${u.isSuperAdmin?' <span style="color:var(--gold); font-size:11px;">(hlavní admin)</span>':(u.isAdmin?' <span style="color:var(--gold); font-size:11px;">(admin)</span>':'')}</td>
              <td style="padding:8px 10px; color:var(--text-muted);">${escapeHtml(u.email||'')}<span data-verify-cell="${u.uid}"></span> <button type="button" class="btn-ghost btn-sm" data-reset-user="${u.uid}" title="Pošle uživateli na jeho registrační e-mail odkaz pro nové heslo" style="padding:2px 8px; font-size:11px;">Reset hesla</button></td>
              <td style="padding:8px 10px;"><input type="tel" data-edit-phone="${u.uid}" value="${escapeHtml(u.phone||'')}" placeholder="—" style="width:120px; background:var(--bg-void); border:1px solid var(--line); color:var(--text); padding:4px 6px; font-size:13px;"></td>
              <td style="padding:8px 10px;"><input type="date" data-edit-created="${u.uid}" value="${u.createdAt ? u.createdAt.slice(0,10) : ''}" style="background:var(--bg-void); border:1px solid var(--line); color:var(--text); padding:4px 6px; font-size:13px;"></td>
              <td style="padding:8px 10px; color:var(--text-muted);">${u.lastLogin ? fmtDate(u.lastLogin.slice(0,10)) : '—'}</td>
              <td style="padding:8px 10px;"><button type="button" class="btn-ghost btn-sm" data-save-user="${u.uid}">Uložit</button></td>
              <td style="padding:8px 10px;">${(u.isSuperAdmin || (u.isAdmin && !S.currentIsSuperAdmin)) ? '' : `<button type="button" class="btn-ghost btn-sm" data-delete-user="${u.uid}" data-delete-nick="${escapeHtml(u.nick||'')}" style="color:var(--crimson); border-color:var(--crimson);">Smazat</button>`}</td>
              ${showPerms ? (u.isSuperAdmin ? `<td style="border-left:1px solid var(--line);"></td><td colspan="${1+PERMISSION_AREAS.length}" style="padding:8px 10px; color:var(--text-muted); font-style:italic;">má vše automaticky</td>` : `
              <td style="border-left:1px solid var(--line);"></td>
              <td style="padding:8px 10px; text-align:center; background:rgba(201,162,75,0.08);"><input type="checkbox" data-perm-admin="${u.uid}" ${u.isAdmin?'checked':''} style="width:18px; height:18px; accent-color:var(--gold);"></td>
              ${PERMISSION_AREAS.map(p=>`<td style="padding:8px 10px; text-align:center;" data-perm-area-cell="${u.uid}"><input type="checkbox" data-perm-area="${u.uid}" data-area-key="${p.key}" ${(u.permissions&&u.permissions[p.key])?'checked':''} ${u.isAdmin?'':'disabled'}></td>`).join('')}
              `) : ''}
            </tr>
          `).join('')}
        </tbody>
      </table>
      </div>

      <div class="section-title" style="font-size:16px; margin-top:36px;">Přezdívky — duplicity a osamocené záznamy</div>
      <div id="usernames-list" style="margin-top:12px;"></div>
    `;
    if(showPerms){
      box.querySelectorAll('[data-perm-admin]').forEach(cb => {
        cb.addEventListener('change', () => {
          box.querySelectorAll(`[data-perm-area="${cb.dataset.permAdmin}"]`).forEach(areaCb => {
            areaCb.disabled = !cb.checked;
            if(!cb.checked) areaCb.checked = false;
          });
        });
      });
    }
    box.querySelectorAll('[data-save-user]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = btn.dataset.saveUser;
        const phone = box.querySelector(`[data-edit-phone="${uid}"]`).value.trim();
        const createdDate = box.querySelector(`[data-edit-created="${uid}"]`).value;
        const payload = { phone };
        if(createdDate) payload.createdAt = createdDate + 'T12:00:00.000Z';
        if(showPerms){
          const adminCb = box.querySelector(`[data-perm-admin="${uid}"]`);
          if(adminCb){
            payload.isAdmin = adminCb.checked;
            const permissions = {};
            box.querySelectorAll(`[data-perm-area="${uid}"]`).forEach(cb => { permissions[cb.dataset.areaKey] = cb.checked; });
            payload.permissions = permissions;
          }
        }
        try{
          await updateDoc(doc(db,'users',uid), payload);
          { const un = (users.find(u => u.uid === uid) || {}).nick || uid;
            logAction('uzivatele', `upravil uživatele „${un}“` + (payload.permissions ? ` (admin: ${payload.isAdmin ? 'ano' : 'ne'}, oprávnění: ${Object.keys(payload.permissions).filter(k => payload.permissions[k]).join(', ') || 'žádná'})` : '')); }
          btn.textContent = 'Uloženo!';
          setTimeout(() => { btn.textContent = 'Uložit'; }, 1200);
        }catch(err){ alert('Uložení se nepovedlo.'); console.error(err); }
      });
    });
    // e-maily, které nejsou ověřené, jdou ověřit ručně
    httpsCallable(functionsApi, 'adminListVerification')().then(res => {
      const ver = (res.data && res.data.verified) || {};
      box.querySelectorAll('[data-verify-cell]').forEach(cell => {
        const uid = cell.dataset.verifyCell;
        if(ver[uid] !== false) return;
        cell.innerHTML = ` <span style="color:#e0a030; font-size:11px;">⚠ neověřen</span> <button type="button" class="btn-ghost btn-sm" data-verify-user="${uid}" style="padding:2px 8px; font-size:11px;">Ověřit</button>`;
        cell.querySelector('[data-verify-user]').addEventListener('click', async (e) => {
          const b = e.currentTarget; b.disabled = true;
          try{
            await httpsCallable(functionsApi, 'adminVerifyUser')({ uid });
            const un = (users.find(x => x.uid === uid) || {}).nick || uid;
            logAction('uzivatele', `ručně ověřil e-mail uživatele „${un}“`);
            cell.innerHTML = ' <span style="color:var(--gold); font-size:11px;">✓ ověřeno</span>';
          }catch(err){ b.disabled = false; alert('Ověření se nepovedlo.'); console.error(err); }
        });
      });
    }).catch(err => console.warn('Seznam ověření nelze načíst (funkce nenasazená?):', err));
    box.querySelectorAll('[data-reset-user]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = btn.dataset.resetUser;
        const usr = users.find(x => x.uid === uid) || {};
        if(!confirm(`Poslat uživateli „${usr.nick || uid}“ na e-mail ${usr.email || ''} odkaz pro nastavení nového hesla?`)) return;
        btn.disabled = true;
        try{
          await httpsCallable(functionsApi, 'adminSendPasswordReset')({ uid });
          logAction('uzivatele', `poslal uživateli „${usr.nick || uid}“ odkaz pro obnovu hesla`);
          btn.textContent = 'Odesláno ✓';
        }catch(err){
          btn.disabled = false;
          console.error(err);
          alert('Odeslání se nepovedlo (je nasazená funkce adminSendPasswordReset?).');
        }
      });
    });
    box.querySelectorAll('[data-delete-user]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = btn.dataset.deleteUser;
        const nick = btn.dataset.deleteNick;
        if(!confirm(`Opravdu úplně odstranit uživatele "${nick}"? Smaže se jeho profil i přezdívka. (Přihlašovací údaj ve Firebase zůstane technicky existovat, ale bez profilu se nepřihlásí.) Tohle nejde vrátit zpět.`)) return;
        try{
          await deleteDoc(doc(db,'users',uid));
          if(nick) await deleteDoc(appApi.usernameDocRef(nick));
          logAction('uzivatele', `odstranil uživatele „${nick}“`);
          renderUsersList();
        }catch(err){ alert('Smazání se nepovedlo.'); console.error(err); }
      });
    });

    document.getElementById('btn-copy-emails').addEventListener('click', async () => {
      const msg = document.getElementById('copy-emails-msg');
      try{ await navigator.clipboard.writeText(allEmails.join(', ')); msg.textContent = 'Zkopírováno!'; }
      catch(err){ msg.textContent = 'Kopírování se nepovedlo — zkopíruj ručně: ' + allEmails.join(', '); }
    });
    document.getElementById('btn-mailto-all').addEventListener('click', () => {
      const list = users.filter(u => u.email).map(u => ({ uid: u.uid, nick: u.nick || '', email: u.email }));
      appApi.openMailComposer('E-mail uživatelům', [{ label:'Zpráva', subject:'', body:'Zdar, tady FEEDEEK LAN!\n\n', recipients: list, hint:'Libovolná zpráva.' }]);
    });

    const unameBox = document.getElementById('usernames-list');
    try{
      const unameSnap = await getDocs(collection(db,'usernames'));
      const uidSet = new Set(users.map(u=>u.uid));
      const unames = unameSnap.docs.map(d => ({ nickKey:d.id, ...d.data() }));
      const uidCounts = {};
      unames.forEach(u => { uidCounts[u.uid] = (uidCounts[u.uid]||0) + 1; });
      const flagged = unames.filter(u => !uidSet.has(u.uid) || uidCounts[u.uid] > 1);
      if(flagged.length === 0){
        unameBox.innerHTML = '<div class="empty">Žádné duplicity ani osamocené záznamy — vše v pořádku.</div>';
      }else{
        unameBox.innerHTML = flagged.map(u => {
          const orphan = !uidSet.has(u.uid);
          const dup = !orphan && uidCounts[u.uid] > 1;
          const reason = orphan ? 'bez propojeného účtu' : `duplicita (${uidCounts[u.uid]}× stejný účet)`;
          return `<div class="row" style="max-width:600px; padding:6px 0; border-top:1px solid var(--line); align-items:center;">
            <span style="flex:1; font-size:13px; color:var(--crimson);">${escapeHtml(u.nickKey)} — ${reason}</span>
            <button type="button" class="btn-ghost btn-sm" data-delete-uname="${u.nickKey}" style="color:var(--crimson); border-color:var(--crimson);">Smazat</button>
          </div>`;
        }).join('');
        unameBox.querySelectorAll('[data-delete-uname]').forEach(btn => {
          btn.addEventListener('click', async () => {
            if(!confirm(`Smazat přezdívku "${btn.dataset.deleteUname}"?`)) return;
            try{ await deleteDoc(doc(db,'usernames',btn.dataset.deleteUname)); renderUsersList(); }
            catch(err){ alert('Smazání se nepovedlo.'); console.error(err); }
          });
        });
      }
    }catch(err){ console.error(err); unameBox.innerHTML = '<div class="empty">Nepovedlo se načíst.</div>'; }
  }catch(err){ console.error(err); box.innerHTML = '<div class="empty">Nepovedlo se načíst uživatele.</div>'; }
}

