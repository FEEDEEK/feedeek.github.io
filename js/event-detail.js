// (vyjmuto z app.js, řádky 709-997)
import { escapeHtml, fmtDateShort, fmtDate, todayIso } from "./util.js";
import { S, hasPerm } from "./state.js";
import { renderStatsAndRsvp, renderAttendees } from "./rsvp.js";
import { fmtDateRange } from "./ui.js";
import { MEAL_SLOTS } from "./constants.js";
import { openFoodEditor } from "./food-editor.js";
import { renderTabPrehled } from "./tab-prehled.js";
import { renderTabRozvrh } from "./schedule.js";
import { renderTabJidlo } from "./tab-jidlo.js";
import { renderTabTurnaj } from "./tab-turnaj.js";
import { renderTabFoto } from "./photos.js";
import { eventHasOwnPaymentAccount } from "./payment.js";
import { updateDoc, doc, arrayUnion } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js";
import { logAction } from "./audit.js";
import { appApi } from "./hooks.js";

// ---- Výrazné "KDY a KDE" s animací ----
function czDays(n){ return n === 1 ? 'DEN' : (n >= 2 && n <= 4 ? 'DNY' : 'DNÍ'); }
function renderWhenWhere(ev){
  const box = document.getElementById('ed-ww');
  if(!box) return;
  const WD = ['neděle','pondělí','úterý','středa','čtvrtek','pátek','sobota'];
  let icon = '📅', big = '—', sub = '', count = '';
  if(ev.dateUnconfirmed){
    icon = '🗳️'; big = 'Termín se vybírá'; sub = 'Hlasuje se o termínu';
  }else if(ev.dateStart){
    const s = new Date(ev.dateStart + 'T00:00:00');
    const e = new Date((ev.dateEnd || ev.dateStart) + 'T00:00:00');
    const multi = e.getTime() !== s.getTime();
    const dm = d => `${d.getDate()}. ${d.getMonth() + 1}.`;
    big = multi
      ? (s.getMonth() === e.getMonth() ? `${s.getDate()}. – ${dm(e)}` : `${dm(s)} – ${dm(e)}`)
      : dm(s);
    big += `<small> ${e.getFullYear()}</small>`;
    const nDays = Math.round((e - s) / 86400000) + 1;
    sub = multi ? `${WD[s.getDay()]} – ${WD[e.getDay()]} · ${nDays} ${nDays >= 5 ? 'dní' : 'dny'}` : WD[s.getDay()];
    if(ev.timeStart) sub += ` · ${ev.timeStart}${ev.timeEnd ? '–' + ev.timeEnd : ''}`;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const toStart = Math.round((s - today) / 86400000);
    if(toStart > 0) count = `<div class="ww-cal"><i>${czDays(toStart)}</i><b data-count="${toStart}">${toStart}</b></div>`;
    else if(today <= e) count = `<div class="ww-cal ww-live"><i>PROBÍHÁ</i><b>🔥</b></div>`;
  }
  const place = ev.place || '';
  const mapUrl = `https://www.google.com/maps?q=${encodeURIComponent(place)}`;
  box.innerHTML = `
    <div class="ww-whenwrap" id="ed-ww-when"><div class="ww-card ww-when">${count ? '' : `<div class="ww-ico">${icon}</div>`}
      <div class="ww-body"><div class="ww-k">KDY</div><div class="ww-big">${big}<span class="ww-flag" title="Výsledky hlasování o termínu (jen pro adminy)"></span></div><div class="ww-sub">${escapeHtml(sub)}</div></div>${count}</div>
      <div class="ww-pop" id="ed-ww-pop"></div></div>
    ${place ? `<a class="ww-card ww-where" href="${mapUrl}" target="_blank" rel="noopener"><div class="ww-pinbox"><i></i><b></b></div>
      <div class="ww-body"><div class="ww-k">KDE</div><div class="ww-big">${escapeHtml(place)}</div><div class="ww-sub">Zobrazit v mapách ↗</div></div></a>`
      : `<div class="ww-card ww-where"><div class="ww-pinbox"><i></i><b></b></div>
      <div class="ww-body"><div class="ww-k">KDE</div><div class="ww-big">Místo upřesníme</div><div class="ww-sub">Zatím není určeno</div></div></div>`}`;
  fillDateVotePopup(ev);
  const ww = document.getElementById('ed-ww-when');
  if(ww) ww.addEventListener('click', (e) => { if(ww.classList.contains('ww-adm') && !e.target.closest('.ww-pop')) ww.classList.toggle('show'); });
  // odpočet se rozjede od nuly
  box.querySelectorAll('[data-count]').forEach(el => {
    const target = parseInt(el.dataset.count, 10), t0 = performance.now(), dur = 900;
    const step = (t) => { const k = Math.min(1, (t - t0) / dur); el.textContent = Math.round(target * (1 - Math.pow(1 - k, 3))); if(k < 1) requestAnimationFrame(step); };
    el.textContent = '0'; requestAnimationFrame(step);
  });
}

export function renderEventDetailStatic(ev){
  document.getElementById('ed-title').textContent = (ev.number ? ev.number + ' — ' : '') + ev.name;
  renderWhenWhere(ev);
  document.getElementById('ed-desc').textContent = ev.desc || '';

  const header = document.getElementById('ed-header');
  header.style.backgroundImage = ev.imageUrl ? `url('${ev.imageUrl.replace(/'/g,"")}')` : 'none';

  renderEntryFeeBlock(ev);
  renderDateVoteBlock(ev);

  const mapBox = document.getElementById('ed-map');
  const q = encodeURIComponent(ev.place || '');
  if(!ev.place){
    mapBox.innerHTML = '<div style="display:flex; align-items:center; justify-content:center; height:100%; min-height:200px; text-align:center; padding:20px; color:var(--text-muted);">Místo konání zatím není určeno.<br>Upřesníme ho, jakmile to bude jasné.</div>';
  } else
  mapBox.innerHTML = `<iframe src="https://www.google.com/maps?q=${q}&output=embed" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe><div class="map-ping" aria-hidden="true"><span></span><span></span></div>`;

  const tabPanels = { prehled:'tab-prehled', rozvrh:'tab-rozvrh', jidlo:'tab-jidlo', turnaj:'tab-turnaj', foto:'tab-foto' };
  Object.entries(tabPanels).forEach(([key, id]) => {
    document.getElementById(id).style.display = (key === S.currentTab) ? 'block' : 'none';
  });
  updateHeaderVisibility();
  document.querySelectorAll('#ed-tabs .tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === S.currentTab);
    btn.onclick = () => {
      S.currentTab = btn.dataset.tab;
      document.querySelectorAll('#ed-tabs .tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      Object.entries(tabPanels).forEach(([key, id]) => {
        document.getElementById(id).style.display = (key === S.currentTab) ? 'block' : 'none';
      });
      updateHeaderVisibility();
      renderActiveTab(ev);
    };
  });

  renderStatsAndRsvp();
  renderAttendees();
  renderActiveTab(ev);
}

function updateHeaderVisibility(){
  const onPrehled = S.currentTab === 'prehled';
  document.getElementById('ed-header').style.display = onPrehled ? 'flex' : 'none';
  const grid = document.querySelector('.detail-grid');
  const rightCol = document.querySelector('.detail-col-right');
  if(rightCol) rightCol.style.display = onPrehled ? 'block' : 'none';
  if(grid) grid.classList.toggle('no-sidebar', !onPrehled);
}

// ---------- E-maily z detailu akce (tlačítko vpravo nahoře, mění se podle záložky) ----------
async function openEventMail(ev){
    const users = await appApi.getAllUsersForMail();
    const body = `Zdar, tady FEEDEEK LAN!\n\nchystá se akce "${ev.name}" (${fmtDateRange(ev)}${ev.place ? ', ' + ev.place : ''}).\n\n${ev.desc ? ev.desc + '\n\n' : ''}Přihlas se tady: ${appApi.mailLink('event/' + ev.id)}`;
    const going = new Set(Object.values(S.currentRegistrationsMap).map(r => r.uid || r._docId));
    appApi.openMailComposer('E-mail k akci', [
      { label:'Nová akce – pozvánka', subject:`Nová akce: ${ev.name}`, body, recipients: users, hint:'Pozvánka pro všechny registrované.' },
      { label:'Připomínka – ještě nejsi přihlášený', subject:`Přihlas se na: ${ev.name}`, body:`Zdar, tady FEEDEEK LAN!\n\nještě jsi se nepřihlásil na akci "${ev.name}" (${fmtDateRange(ev)}). Dej vědět, jestli jedeš:\n\n${appApi.mailLink('event/' + ev.id)}`, recipients: users.filter(u => !going.has(u.uid)), hint:'Jen ti, kdo se na akci ještě nepřihlásili.' }
    ]);
  }
async function openVoteMail(ev){
    const users = await appApi.getAllUsersForMail();
    const regUids = new Set(Object.values(S.currentRegistrationsMap).map(r => r.uid || r._docId));
    const reg = users.filter(u => regUids.has(u.uid));
    const schedule = ev.foodSchedule || {}; const votingSlots = ev.foodVotingSlots || {};
    const activeVotingSlots = MEAL_SLOTS.filter(s => votingSlots[s.key] && schedule[s.key] && schedule[s.key].length > 0);
    const slotKeys = activeVotingSlots.map(s => s.key);
    const voted = (uid) => slotKeys.every(k => { const a = (ev.foodVotes || {})[k]?.[uid]; return Array.isArray(a) && a.length > 0; });
    const link = appApi.mailLink('event/' + ev.id);
    appApi.openMailComposer('E-mail o hlasování', [
      { label:'Nové hlasování', subject:`Hlasování: ${ev.name}`, body:`Zdar, tady FEEDEEK LAN!\n\nu akce "${ev.name}" je otevřené nové hlasování o jídle/pivu. Pojď hlasovat:\n\n${link}`, recipients: reg, hint:'Všichni přihlášení na akci.' },
      { label:'Připomínka – ještě nehlasoval', subject:`Pořád ti chybí hlasování: ${ev.name}`, body:`Zdar, tady FEEDEEK LAN!\n\nještě sis nehlasoval u akce "${ev.name}". Hlasuj prosím co nejdřív:\n\n${link}`, recipients: reg.filter(u => !voted(u.uid)), hint:'Jen přihlášení na akci, kteří ještě nehlasovali.' }
    ]);
  }
async function openEventTourneysMail(ev){
  const users = await appApi.getAllUsersForMail();
  const regUids = new Set(Object.values(S.currentRegistrationsMap).map(r => r.uid || r._docId));
  const reg = users.filter(u => regUids.has(u.uid));
  const open = S.allTournaments.filter(t => t.eventId === ev.id && t.status === 'signup');
  const list = open.length ? open.map(t => `• ${t.name}${t.game ? ' (' + t.game + ')' : ''}`).join('\n') : '';
  const link = appApi.mailLink('event/' + ev.id);
  const signed = new Set(open.flatMap(t => (t.signups || []).map(n => String(n).toLowerCase())));
  appApi.openMailComposer('E-mail o turnajích', [
    { label:'Otevřené přihlášky', subject:`Přihlášky do turnajů: ${ev.name}`, body:`Zdar, tady FEEDEEK LAN!\n\nU akce "${ev.name}" jsou otevřené přihlášky do turnajů${list ? ':\n\n' + list : '.'}\n\nPřihlas se tady: ${link}`, recipients: reg, hint:'Všichni přihlášení na akci.' },
    { label:'Připomínka – nejsi nikde přihlášený', subject:`Přihlas se do turnaje: ${ev.name}`, body:`Zdar, tady FEEDEEK LAN!\n\nJeště nejsi přihlášený v žádném otevřeném turnaji u akce "${ev.name}"${list ? ':\n\n' + list : '.'}\n\nPřihlas se tady: ${link}`, recipients: reg.filter(u => !signed.has(String(u.nick).toLowerCase())), hint:'Jen přihlášení na akci, kteří nejsou v žádných přihláškách.' }
  ]);
}
function updateMailSlot(ev){
  const slot = document.getElementById('ed-mail-slot');
  if(!slot) return;
  let label = '', fn = null;
  if(S.currentTab === 'prehled' && hasPerm('akce')){ label = '✉️ Poslat e-mail k akci'; fn = openEventMail; }
  else if(S.currentTab === 'jidlo' && hasPerm('jidlo')){
    const sc = ev.foodSchedule || {}, vs = ev.foodVotingSlots || {};
    if(MEAL_SLOTS.some(m => vs[m.key] && sc[m.key] && sc[m.key].length > 0)){ label = '✉️ Poslat e-mail o hlasování'; fn = openVoteMail; }
  }
  else if(S.currentTab === 'turnaj' && hasPerm('turnaj')){ label = '✉️ Poslat e-mail o turnajích'; fn = openEventTourneysMail; }
  const canEditEv = hasPerm('akce');
  const canEditFood = S.currentTab === 'jidlo' && hasPerm('jidlo');
  if(!fn && !canEditEv && !canEditFood){ slot.innerHTML = ''; return; }
  slot.innerHTML = (canEditFood ? `<button type="button" class="btn-ghost mail-slot-edit mail-slot-food">🍔 Upravit jídlo</button>` : '') + (canEditEv ? `<button type="button" class="btn-ghost mail-slot-edit mail-slot-ev">✏️ Upravit akci</button>` : '') + (fn ? `<button type="button" class="mail-btn">${label}</button>` : '');
  const liveEv = () => S.events.find(x => x.id === ev.id) || ev;
  const editB = slot.querySelector('.mail-slot-ev');
  if(editB) editB.addEventListener('click', () => appApi.startEditEvent(liveEv()));
  const foodB = slot.querySelector('.mail-slot-food');
  if(foodB) foodB.addEventListener('click', () => openFoodEditor(liveEv()));
  const mailB = slot.querySelector('.mail-btn');
  if(mailB) mailB.addEventListener('click', () => fn(liveEv()));
}

export function renderActiveTab(ev){
  updateMailSlot(ev);
  if(S.currentTab === 'prehled') renderTabPrehled(ev);
  else if(S.currentTab === 'rozvrh') renderTabRozvrh(ev);
  else if(S.currentTab === 'jidlo') renderTabJidlo(ev);
  else if(S.currentTab === 'turnaj') renderTabTurnaj(ev);
  else renderTabFoto(ev);
}

export function renderEntryFeeBlock(ev){
  const box = document.getElementById('ed-entryfee');
  if(!ev.fee && !ev.qrUrl && !ev.feeNote){ box.innerHTML = ''; return; }
  const showSharedQr = ev.qrUrl && !eventHasOwnPaymentAccount(ev);
  box.innerHTML = `
    ${showSharedQr ? `<img class="qr-code-img" src="${ev.qrUrl.replace(/"/g,'&quot;')}" alt="QR kód pro platbu" style="margin-bottom:8px;">` : ''}
    ${ev.fee ? `<div style="font-size:28px; font-weight:700; color:var(--gold); text-shadow:0 2px 8px rgba(0,0,0,0.8);">${ev.fee} Kč</div><div style="font-size:13px; font-weight:600; color:var(--gold); text-transform:uppercase; letter-spacing:.08em; text-shadow:0 1px 4px rgba(0,0,0,0.8);">Vstupné</div>` : ''}
    ${ev.feeNote ? `<div style="margin-top:6px; max-width:340px; font-size:13px; font-weight:600; line-height:1.35; color:var(--text); text-shadow:0 1px 4px rgba(0,0,0,0.8);">${escapeHtml(ev.feeNote)}</div>` : ''}
  `;
}

function ensureUsersNickCache(){
  if(S.usersNickCache || S.usersNickLoading || !hasPerm('akce')) return;
  S.usersNickLoading = true;
  appApi.getAllUsersForMail().then(list => {
    S.usersNickCache = {}; list.forEach(u => { S.usersNickCache[u.uid] = u.nick; });
    const ev = S.events.find(x => x.id === S.currentDetailEventId);
    if(ev) renderDateVoteBlock(ev);
  }).finally(() => { S.usersNickLoading = false; });
}
function dateVoterNick(ev, uid){
  return (ev.dateVoteNicks || {})[uid] || S.currentRegistrationsMap[uid]?.nick || (S.usersNickCache && S.usersNickCache[uid]) || '(neznámý)';
}
function fillDateVotePopup(ev){
  const wrap = document.getElementById('ed-ww-when'), pop = document.getElementById('ed-ww-pop');
  if(!wrap || !pop) return;
  const options = ev.dateOptions || [];
  const votes = ev.dateVotes || {};
  const show = options.length > 0 && ev.dateVotingClosed && hasPerm('akce');
  wrap.classList.toggle('ww-adm', !!show);
  if(!show){ pop.innerHTML = ''; return; }
  function votesOf(uid){
    const v = votes[uid];
    if(Array.isArray(v)) return v;
    if(typeof v === 'number') return [v];
    return [];
  }
    const nickMap = ev.dateVoteNicks || {};
    const fmtTs = ts => { try{ return new Date(ts).toLocaleString('cs-CZ', { day:'numeric', month:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' }); }catch(e){ return ts || ''; } };
    const hist = Array.isArray(ev.dateHistory) ? ev.dateHistory : [];
    pop.innerHTML = `
      <div class="section-title" style="font-size:15px;">🗳️ Hlasování o termínu <span class="status-hint">(uzavřeno)</span></div>
      ${options.map((opt, idx) => {
        const nicks = Object.keys(votes).filter(uid => votesOf(uid).includes(idx)).map(uid => dateVoterNick(ev, uid));
        const chosen = ev.dateStart === opt.start && ev.dateEnd === opt.end;
        return `<div style="margin-top:8px; font-size:13px;${chosen ? 'color:var(--gold);' : ''}">
          ${chosen ? '✓ ' : ''}<b>${fmtDateShort(opt.start)} – ${fmtDate(opt.end)}</b> <span class="status-hint">(${nicks.length} hlasů)</span>
          <div class="status-hint" style="font-size:12px;">${nicks.length ? escapeHtml(nicks.join(', ')) : 'nikdo'}</div>
        </div>`;
      }).join('')}
      ${hist.length ? `<div class="mc-label" style="margin-top:12px;">Historie</div>` + hist.slice().reverse().map(h => `<div class="status-hint" style="font-size:12px;">${escapeHtml(fmtTs(h.at))} – ${escapeHtml(h.by || '?')}: ${escapeHtml(h.text || '')}</div>`).join('') : '<div class="status-hint" style="font-size:12px; margin-top:10px;">Historie změn se zapisuje od teď.</div>'}
      <button type="button" class="btn-ghost btn-sm" id="btn-reopen-datevote" style="margin-top:12px;">↩ Znovu otevřít hlasování</button>`;
    pop.querySelector('#btn-reopen-datevote').addEventListener('click', async () => {
      if(!confirm('Znovu otevřít hlasování o termínu? Termín akce se označí jako nepotvrzený, hlasy zůstanou.')) return;
      try{ await updateDoc(doc(db,'events',ev.id), { dateVotingClosed: false, dateUnconfirmed: true, dateHistory: arrayUnion({ at: new Date().toISOString(), by: S.currentNick || '', text: 'hlasování znovu otevřeno' }) }); logAction('akce', `znovu otevřel hlasování o termínu u akce „${ev.name}“`); }
      catch(err){ alert('Nepovedlo se uložit.'); console.error(err); }
    });
}
export function renderDateVoteBlock(ev){
  ensureUsersNickCache();
  const box = document.getElementById('ed-datevote');
  const options = ev.dateOptions || [];
  const votes = ev.dateVotes || {};
  function votesOf(uid){
    const v = votes[uid];
    if(Array.isArray(v)) return v;
    if(typeof v === 'number') return [v];
    return [];
  }
  if(options.length === 0){ box.innerHTML = ''; box.style.display = 'none'; return; }
  if(ev.dateVotingClosed){
    // uzavřené hlasování: výsledky + historie jsou ve vyskakovacím okně u data (jen správce akcí)
    box.innerHTML = ''; box.style.display = 'none';
    fillDateVotePopup(ev);
    return;
  }
  fillDateVotePopup(ev);
  box.style.display = 'block';

  const myVotes = S.currentUser ? votesOf(S.currentUser.uid) : [];
  const deadlinePassedForVote = ev.dateVoteDeadline && todayIso() > ev.dateVoteDeadline;

  box.className = 'panel';
  box.style.cssText = 'flex:0 0 300px; margin-top:0;';
  box.innerHTML = `
    <div class="section-title" style="font-size:15px;">🗳️ Hlasování o termínu</div>
    <p class="lede" style="margin-top:0; font-size:12px;">Můžeš hlasovat pro víc termínů, které ti vyhovují.</p>
    ${ev.dateVoteDeadline ? `<p class="lede" style="margin-top:0; font-size:13px;">Hlasování otevřené do ${fmtDate(ev.dateVoteDeadline)}.</p>` : ''}
    ${options.map((opt, idx) => {
      const voteNickMap = ev.dateVoteNicks || {};
      const voterNicks = Object.keys(votes).filter(uid => votesOf(uid).includes(idx)).map(uid => dateVoterNick(ev, uid));
      const isMine = myVotes.includes(idx);
      const countTitle = hasPerm('akce') ? (voterNicks.length ? voterNicks.join('\n') : 'Zatím nikdo') : '';
      return `
        <div class="row" style="margin-top:8px; align-items:center; flex-wrap:wrap;">
          <span style="flex:1; font-size:13px;">${fmtDateShort(opt.start)} – ${fmtDate(opt.end)} <span class="status-hint" title="${escapeHtml(countTitle)}" style="${hasPerm('akce')?'cursor:help; border-bottom:1px dotted var(--text-muted);':''}">(${voterNicks.length} hlasů)</span></span>
          ${S.currentUser ? `<button type="button" class="btn-sm ${isMine?'btn-active':''}" data-vote-date="${idx}" ${deadlinePassedForVote?'disabled':''}>${isMine?'✓ Hlasováno':'Hlasovat'}</button>` : ''}
          ${hasPerm('akce') ? `<button type="button" class="btn-ghost btn-sm" data-finalize-date="${idx}">Vybrat</button>` : ''}
        </div>
      `;
    }).join('')}
  `;

  box.querySelectorAll('[data-vote-date]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if(!S.currentUser){ appApi.showView('ucet'); return; }
      const idx = parseInt(btn.dataset.voteDate,10);
      const mine = votesOf(S.currentUser.uid);
      const newVotes = mine.includes(idx) ? mine.filter(i=>i!==idx) : [...mine, idx];
      try{ await updateDoc(doc(db,'events',ev.id), { [`dateVotes.${S.currentUser.uid}`]: newVotes, [`dateVoteNicks.${S.currentUser.uid}`]: S.currentNick || '' }); }
      catch(err){ console.error(err); }
    });
  });
  box.querySelectorAll('[data-finalize-date]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.finalizeDate,10);
      const opt = options[idx];
      if(!confirm(`Nastavit termín akce na ${fmtDateShort(opt.start)} – ${fmtDate(opt.end)}?`)) return;
      try{ await updateDoc(doc(db,'events',ev.id), { dateStart: opt.start, dateEnd: opt.end, dateVotingClosed: true, dateUnconfirmed: false, dateHistory: arrayUnion({ at: new Date().toISOString(), by: S.currentNick || '', text: `vybrán termín ${fmtDateShort(opt.start)} – ${fmtDate(opt.end)}` }) }); logAction('akce', `vybral termín ${fmtDateShort(opt.start)} – ${fmtDate(opt.end)} u akce „${ev.name}“`); }
      catch(err){ alert('Nepovedlo se uložit.'); console.error(err); }
    });
  });
}

export function isPastDeadline(ev){
  return !!ev.changeDeadline && todayIso() > ev.changeDeadline;
}
