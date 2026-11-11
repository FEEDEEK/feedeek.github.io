// (vyjmuto z app.js, řádky 254-1096)
import { tbRefreshDrinkModal, tbStopLive, computeSwissTournament, tbEnsureLive, renderTourneyTeamsPanel, tbUnlockSound, openTbDrinkModal, openTbDevGraphModal, openTeamEditorModal, openTournamentResultModal, renderSwissBody, tbRenderDrawPlayers, tbInvalidateDraw, tbUpdateTeamCountHint, tbTeamSizeVal, tbStartDraft, tbRenderDrawnTeams, tbStartDrawFromForm } from "./tb-live.js";
import { S, hasPerm } from "./state.js";
import { computeFfaStandings, renderFfaBody, teamName, autoStyle } from "./turnaj-common.js";
import { escapeHtml, todayIso } from "./util.js";
import { updateDoc, doc, deleteDoc, arrayUnion, arrayRemove, addDoc, collection, setDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js";
import { logAction } from "./audit.js";
import { tbAddDrawPlayer, tbKey, handicapSessionKey, tbLoadSkill, tbGetPlayerStats } from "./tb-core.js";
import { gameFieldHtml, setupGameField } from "./games.js";
import { appApi } from "./hooks.js";

// ---- Horní stránka "Turnaj" (celostránkové zobrazení, správa) ----
export function renderTurnajPage(){
  const box = document.getElementById('view-turnaj-content');
  if(!box) return;

  document.querySelectorAll('.tb-unlock-sound').forEach(b => b.remove());
  tbRefreshDrinkModal();

  if(S.currentTournamentId){
    const t = S.allTournaments.find(x => x.id === S.currentTournamentId);
    if(!t){ S.currentTournamentId = null; S.tourneySetupStep = null; if(location.hash !== '#turnaj') location.hash = '#turnaj'; renderTurnajPage(); return; }

    if(S.tourneySetupStep){
      tbStopLive();
      box.innerHTML = `<div id="format-setup-body"></div>`;
      renderTournamentFormatSetup(t, document.getElementById('format-setup-body'));
      return;
    }
    if(t.status === 'signup'){
      tbStopLive();
      box.innerHTML = `<button type="button" class="btn-ghost btn-sm" id="btn-back-tourney-list">← Zpět na seznam turnajů</button><div id="signup-phase-body" style="margin-top:14px;"></div>`;
      document.getElementById('btn-back-tourney-list').addEventListener('click', () => appApi.setRoute('#turnaj'));
      renderTournamentSignupPhase(t, document.getElementById('signup-phase-body'));
      return;
    }

    const isFfa = t.format === 'ffa';
    const ev = S.events.find(x => x.id === t.eventId);
    const swissPreview = isFfa ? null : computeSwissTournament(t);
    const ffaStandings = isFfa ? computeFfaStandings(t) : null;
    box.innerHTML = `
      <div class="tourney-main-row">
        <div class="tourney-bracket-col">
          <div class="tourney-teams-panel" id="tourney-teams-panel"></div>
          <div class="${isFfa ? '' : 'bracket-scale-wrap'}" id="turnaj-detail-body"></div>
        </div>
        <div class="tourney-title-corner">
          <div class="tourney-title-top">
            ${ev ? `<div class="status-hint" style="white-space:nowrap;">${escapeHtml(ev.name)}</div>` : ''}
            ${t.gameImage ? `<img src="${t.gameImage.replace(/"/g,'&quot;')}" alt="" class="tourney-game-image">` : (t.game ? `<div class="status-hint" style="margin-top:4px;">${escapeHtml(t.game)}</div>` : '')}
            <h1 class="headline" style="font-size:22px; margin-top:8px;">${escapeHtml(t.name)}</h1>
            ${t.imageUrl ? `<img src="${t.imageUrl.replace(/"/g,'&quot;')}" alt="" class="tourney-title-image">` : ''}
          </div>
          <div class="tourney-title-result" id="tourney-title-result"></div>
        </div>
      </div>
      <div class="tourney-corner-actions" id="tourney-corner-actions"></div>
    `;

    const cornerActions = document.getElementById('tourney-corner-actions');
    if(location.hash.startsWith('#turnaj')) tbEnsureLive(t);
    if(!isFfa) renderTourneyTeamsPanel(t, document.getElementById('tourney-teams-panel'));

    if(S.turnajProjectorMode){
      if(!S.tbSoundUnlocked){
        const unlock = document.createElement('button');
        unlock.type = 'button';
        unlock.className = 'tb-unlock-sound';
        unlock.textContent = '🔊 Klikni pro zapnutí zvuku';
        unlock.addEventListener('click', () => { tbUnlockSound(); unlock.remove(); });
        document.body.appendChild(unlock);
      }
    }else{
      if(hasPerm('turnaj')){
        const drinkBtn = document.createElement('button');
        drinkBtn.type = 'button';
        drinkBtn.className = 'dota-btn';
        drinkBtn.textContent = 'Handicap';
        drinkBtn.addEventListener('click', () => openTbDrinkModal(t));
        cornerActions.appendChild(drinkBtn);

        const graphBtn = document.createElement('button');
        graphBtn.type = 'button';
        graphBtn.className = 'btn-ghost btn-sm';
        graphBtn.textContent = '📈 Vývoj';
        graphBtn.addEventListener('click', () => openTbDevGraphModal(t));
        cornerActions.appendChild(graphBtn);
      }
      const projBtn = document.createElement('button');
      projBtn.type = 'button';
      projBtn.className = 'btn-ghost btn-sm';
      projBtn.textContent = '📺 Projektor';
      projBtn.title = 'Otevře turnaj v samostatném okně pro promítání (aktualizuje se samo)';
      projBtn.addEventListener('click', () => window.open(`${location.origin}${location.pathname}#turnaj/${t.id}/projektor`, '_blank'));
      cornerActions.appendChild(projBtn);
    }

    if(hasPerm('turnaj') && !S.turnajProjectorMode){
      if(!isFfa){
        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'btn-ghost btn-sm';
        toggleBtn.textContent = 'Upravit týmy';
        toggleBtn.addEventListener('click', () => openTeamEditorModal(t));
        cornerActions.appendChild(toggleBtn);
      }

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn-ghost btn-sm';
      editBtn.textContent = 'Upravit';
      editBtn.addEventListener('click', () => { pendingEditTournamentId = t.id; appApi.setRoute('#turnaj'); });
      cornerActions.appendChild(editBtn);

      const revertBtn = document.createElement('button');
      revertBtn.type = 'button';
      revertBtn.className = 'btn-ghost btn-sm';
      revertBtn.textContent = '↩ Zpět na přihlašování';
      revertBtn.title = 'Vrátí turnaj do fáze přihlašování — přidáš další hráče a formát nastavíš znovu';
      revertBtn.addEventListener('click', async () => {
        if(!confirm('Vrátit turnaj do fáze přihlašování? Aktuální týmy / kola a zapsané skóre se tím smažou (seznam přihlášených zůstane zachovaný).')) return;
        try{
          await updateDoc(doc(db,'tournaments',t.id), {
            status:'signup', format:null, teams:[], results:{}, swissResults:{},
            ffa:{ participants:[], rounds:[] }
          });
          logAction('turnaj', `vrátil turnaj „${t.name}“ do fáze přihlašování`);
        }catch(err){ alert('Nepovedlo se vrátit.'); console.error(err); }
      });
      cornerActions.appendChild(revertBtn);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-ghost btn-sm';
      delBtn.style.cssText = 'color:var(--crimson); border-color:var(--crimson);';
      delBtn.textContent = 'Smazat turnaj';
      delBtn.addEventListener('click', async () => {
        if(!confirm(`Opravdu smazat turnaj "${t.name}"? Tohle nejde vrátit zpět.`)) return;
        try{ await deleteDoc(doc(db,'tournaments',t.id)); logAction('turnaj', `smazal turnaj „${t.name}“`); S.currentTournamentId = null; if(location.hash !== '#turnaj') location.hash = '#turnaj'; }
        catch(err){ alert('Smazání se nepovedlo.'); console.error(err); }
      });
      cornerActions.appendChild(delBtn);
    }

    const bodyWrap = document.getElementById('turnaj-detail-body');
    if(isFfa){
      if(ffaStandings.placements.length > 0){
        const resultBtn = document.createElement('button');
        resultBtn.type = 'button';
        resultBtn.className = 'btn-sm tourney-result-btn-big';
        resultBtn.textContent = '🏆 Výsledek turnaje';
        resultBtn.addEventListener('click', () => openTournamentResultModal(t, null, ffaStandings));
        document.getElementById('tourney-title-result').appendChild(resultBtn);
      }
      renderFfaBody(t, bodyWrap);
    }else{
      if(swissPreview.placements.length > 0){
        const resultBtn = document.createElement('button');
        resultBtn.type = 'button';
        resultBtn.className = 'btn-sm tourney-result-btn-big';
        resultBtn.textContent = '🏆 Výsledek turnaje';
        resultBtn.addEventListener('click', () => openTournamentResultModal(t, swissPreview));
        document.getElementById('tourney-title-result').appendChild(resultBtn);
      }
      const swiss = computeSwissTournament(t);
      renderSwissBody(t, swiss, bodyWrap, false);
    }
    return;
  }

  // seznam turnajů
  tbStopLive();
  let html = `<div class="toolbar"><div><h1 class="headline" style="font-size:28px;">Turnaje</h1></div><div style="display:flex; gap:10px;">`;
  html += hasPerm('turnaj') ? `<button type="button" id="btn-new-tourney-page">+ Nový turnaj</button>` : '';
  html += `</div></div><div id="turnaj-form-slot"></div><div class="grid" id="turnaj-list-grid" style="margin-top:24px;"></div>`;
  box.innerHTML = html;

  const newBtn = document.getElementById('btn-new-tourney-page');
  if(newBtn) newBtn.addEventListener('click', () => openNewTournamentForm());

  const grid = document.getElementById('turnaj-list-grid');
  if(S.allTournaments.length === 0){
    grid.innerHTML = '<div class="empty">Zatím žádný turnaj nebyl založen.</div>';
    return;
  }
  grid.innerHTML = S.allTournaments.map(t => {
    const ev = S.events.find(x => x.id === t.eventId);
    let badgeTag = '', statusTxt = '';
    if(t.status === 'signup'){
      badgeTag = `<span class="tag tourney-signup-badge">Přihlášky otevřeny</span>`;
      statusTxt = `${(t.signups||[]).length} přihlášených`;
    }else if(t.format === 'ffa'){
      const standings = computeFfaStandings(t);
      const champion = standings.placements.find(p => p.rank === 1);
      badgeTag = `<span class="tag">${(t.ffa && t.ffa.participants || []).length} hráčů</span>`;
      statusTxt = champion ? `🏆 Vítěz: ${escapeHtml(champion.name)}` : 'Zatím žádné odehrané kolo';
    }else{
      const swiss = computeSwissTournament(t);
      const champion = swiss.placements.find(p => p.rank === 1);
      badgeTag = `<span class="tag">${(t.teams||[]).length} týmů</span>`;
      statusTxt = champion ? `🏆 Vítěz: ${escapeHtml(teamName(t, champion.team))}` : 'Základní část se ještě hraje';
    }
    return `
      <div class="event-card ${t.status === 'signup' ? 'event-card-signup-open' : ''}" data-open-tourney="${t.id}">
        ${t.gameImage ? `<div class="tourney-card-banner"><img src="${t.gameImage.replace(/"/g,'&quot;')}" alt=""></div>` : ''}
        <div style="display:flex; align-items:center; gap:10px;">
          ${!t.gameImage && t.imageUrl ? `<img src="${t.imageUrl.replace(/"/g,'&quot;')}" alt="" style="width:36px; height:36px; object-fit:cover; border-radius:50%; border:1px solid var(--gold-dim); flex-shrink:0;">` : ''}
          ${badgeTag}
        </div>
        <h3>${escapeHtml(t.name)}</h3>
        <div class="meta">${ev ? escapeHtml(ev.name) : 'Bez přiřazené akce'}${t.game ? ' · ' + escapeHtml(t.game) : ''}</div>
        <p class="desc">${statusTxt}</p>
        ${(t.status === 'signup' && S.currentNick && !(t.signups||[]).includes(S.currentNick)) ? `<button type="button" class="btn-sm" data-quick-signup="${t.id}" style="width:100%; margin-top:4px;">✅ Přihlásit se do turnaje</button>` : ''}
        ${hasPerm('turnaj') ? `
        <div class="row" style="margin-top:2px;">
          <button type="button" class="btn-ghost btn-sm" data-edit-tourney="${t.id}" style="flex:1;">Upravit</button>
          <button type="button" class="btn-ghost btn-sm" data-delete-tourney="${t.id}" style="flex:1; color:var(--crimson); border-color:var(--crimson);">Smazat</button>
        </div>` : ''}
      </div>
    `;
  }).join('');
  grid.querySelectorAll('[data-quick-signup]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try{ await updateDoc(doc(db,'tournaments',btn.dataset.quickSignup), { signups: arrayUnion(S.currentNick) }); }
      catch(err){ console.error(err); }
    });
  });
  grid.querySelectorAll('[data-open-tourney]').forEach(card => {
    card.addEventListener('click', (e) => {
      if(e.target.closest('[data-edit-tourney]') || e.target.closest('[data-delete-tourney]') || e.target.closest('[data-quick-signup]')) return;
      appApi.setRoute('#turnaj/' + card.dataset.openTourney);
    });
  });
  grid.querySelectorAll('[data-edit-tourney]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const t = S.allTournaments.find(x => x.id === btn.dataset.editTourney);
      if(t) openNewTournamentForm(t);
    });
  });
  grid.querySelectorAll('[data-delete-tourney]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const t = S.allTournaments.find(x => x.id === btn.dataset.deleteTourney);
      if(!t) return;
      if(!confirm(`Opravdu smazat turnaj "${t.name}"? Tohle nejde vrátit zpět.`)) return;
      try{ await deleteDoc(doc(db,'tournaments',t.id)); logAction('turnaj', `smazal turnaj „${t.name}“`); }
      catch(err){ alert('Smazání se nepovedlo.'); console.error(err); }
    });
  });

  if(pendingEditTournamentId){
    const editId = pendingEditTournamentId;
    pendingEditTournamentId = null;
    const t = S.allTournaments.find(x => x.id === editId);
    if(t) openNewTournamentForm(t);
  }
}

// ---------- Fáze "Přihlašování" ----------
function renderTournamentSignupPhase(t, box){
  const signups = t.signups || [];
  const iAmIn = S.currentNick && signups.includes(S.currentNick);
  box.innerHTML = `
    <div class="tourney-title-top" style="margin-bottom:18px;">
      <span class="tag tourney-signup-badge">Přihlášky otevřeny</span>
      <h1 class="headline" style="font-size:26px; margin-top:10px;">${escapeHtml(t.name)}</h1>
      ${t.game ? `<div class="status-hint">${escapeHtml(t.game)}</div>` : ''}
    </div>
    <p class="lede" style="margin-top:0;">Klikni na "Zúčastním se", pokud chceš hrát. Formát (týmy, nebo všichni proti všem) nastaví admin, až se přihlásí dost lidí.</p>
    <div id="signup-cta"></div>
    <div class="section-title" style="font-size:15px;">Přihlášení (${signups.length})</div>
    <div class="signup-list" id="signup-list"></div>
    ${hasPerm('turnaj') ? `
      <div class="tb-draw-addrow" style="max-width:420px;">
        <input type="text" id="signup-manual-name" placeholder="Přidat ručně (jméno)">
        <button type="button" class="btn-sm" id="signup-manual-add">Přidat</button>
      </div>
      <button type="button" id="btn-goto-format" style="margin-top:18px;" ${signups.length < 2 ? 'disabled' : ''}>Nastavit turnaj (${signups.length} hráčů)</button>
      ${signups.length < 2 ? '<small style="display:block; margin-top:6px; color:var(--text-muted);">Potřeba aspoň 2 přihlášení.</small>' : ''}
    ` : ''}
  `;

  const ctaBox = document.getElementById('signup-cta');
  if(!S.currentUser || !S.currentNick){
    ctaBox.innerHTML = `<p class="lede" style="margin-top:0;"><a href="#ucet">Přihlas se</a>, abys mohl(a) se přihlásit.</p>`;
  }else{
    const btn = document.createElement('button');
    btn.type = 'button';
    if(iAmIn){
      btn.className = 'btn-ghost';
      btn.style.cssText = 'color:var(--crimson); border-color:var(--crimson);';
      btn.textContent = 'Odhlásit se';
      btn.addEventListener('click', async () => {
        try{ await updateDoc(doc(db,'tournaments',t.id), { signups: arrayRemove(S.currentNick) }); }
        catch(err){ console.error(err); }
      });
    }else{
      btn.textContent = 'Zúčastním se';
      btn.addEventListener('click', async () => {
        try{ await updateDoc(doc(db,'tournaments',t.id), { signups: arrayUnion(S.currentNick) }); }
        catch(err){ console.error(err); }
      });
    }
    ctaBox.appendChild(btn);
  }

  const list = document.getElementById('signup-list');
  list.innerHTML = signups.length
    ? signups.map(n => `<div class="signup-row"><span>${escapeHtml(n)}</span>${hasPerm('turnaj') ? `<span class="x" data-signup-remove="${escapeHtml(n)}">×</span>` : ''}</div>`).join('')
    : '<div class="empty">Zatím se nikdo nepřihlásil.</div>';
  list.querySelectorAll('[data-signup-remove]').forEach(el => {
    el.addEventListener('click', async () => {
      try{ await updateDoc(doc(db,'tournaments',t.id), { signups: arrayRemove(el.dataset.signupRemove) }); }
      catch(err){ console.error(err); }
    });
  });

  if(hasPerm('turnaj')){
    document.getElementById('signup-manual-add').addEventListener('click', async () => {
      const input = document.getElementById('signup-manual-name');
      const name = input.value.trim();
      if(!name) return;
      try{ await updateDoc(doc(db,'tournaments',t.id), { signups: arrayUnion(name) }); input.value = ''; }
      catch(err){ console.error(err); }
    });
    const gotoBtn = document.getElementById('btn-goto-format');
    if(gotoBtn) gotoBtn.addEventListener('click', () => { S.tourneySetupStep = 'format'; renderTurnajPage(); });
  }
}

// ---------- Fáze "Nastavit turnaj" (formát) ----------
 // null | 'format' | 'team-draw' | 'ffa-confirm'
let pendingEditTournamentId = null;
let tourneyFormatChoice = null; // 'teams' | 'ffa'

function renderTournamentFormatSetup(t, box){
  if(S.tourneySetupStep === 'team-draw') return renderTeamFormatSetup(t, box);
  if(S.tourneySetupStep === 'ffa-confirm') return renderFfaFormatSetup(t, box);

  box.innerHTML = `
    <button type="button" class="btn-ghost btn-sm" id="btn-back-signup">← Zpět na přihlášené</button>
    <h1 class="headline" style="font-size:24px; margin-top:14px;">Nastavit turnaj — ${escapeHtml(t.name)}</h1>
    <p class="lede" style="margin-top:0;">Přihlášeno: ${(t.signups||[]).length} hráčů. Vyber formát.</p>
    <div class="format-choice-row">
      <button type="button" class="format-choice-btn" id="fmt-teams"><b>🛡️ Týmový</b><span>Rozdělit přihlášené do týmů — náhodně, nebo vyváženě podle skillu.</span></button>
      <button type="button" class="format-choice-btn" id="fmt-ffa"><b>🏁 Všichni proti všem</b><span>Bez týmů. Zapisují se výsledky jednotlivých kol/map a appka sečte pořadí.</span></button>
    </div>
  `;
  document.getElementById('btn-back-signup').addEventListener('click', () => { S.tourneySetupStep = null; renderTurnajPage(); });
  document.getElementById('fmt-teams').addEventListener('click', () => { S.tourneySetupStep = 'team-draw'; S.tbDraw = { players: [], teams: null }; renderTurnajPage(); });
  document.getElementById('fmt-ffa').addEventListener('click', () => { S.tourneySetupStep = 'ffa-confirm'; renderTurnajPage(); });
}

function renderTeamFormatSetup(t, box){
  const signups = t.signups || [];
  if(S.tbDraw.players.length === 0 && !S.tbDraw._seeded){
    S.tbDraw._seeded = true;
    signups.forEach(n => tbAddDrawPlayer(n, 50, { fromEvent:true, persist:false }));
  }
  box.innerHTML = `
    <button type="button" class="btn-ghost btn-sm" id="btn-back-format">← Zpět na výběr formátu</button>
    <h1 class="headline" style="font-size:24px; margin-top:14px;">Týmový turnaj — ${escapeHtml(t.name)}</h1>
    <label class="signup-row" style="max-width:360px; cursor:pointer;">
      <input type="checkbox" id="tb-use-skill" checked>
      <span>Vyvážit podle skillu (jinak čistě náhodně, bez zápisu skillu)</span>
    </label>
    <div class="tb-form-row" style="margin-top:10px;">
      <div class="field"><label>Hráčů v týmu</label><input type="number" id="tb-team-size" min="1" max="6" value="3"></div>
      <div class="field"><label>Počet týmů</label><input type="number" id="tb-team-count" min="2" placeholder="auto"></div>
    </div>
    <div class="tb-draw-section">
      <div class="section-title" style="font-size:15px;">Hráči do losování</div>
      <div class="tb-draw-addrow">
        <input type="text" id="tb-add-name" placeholder="Přidat hráče ručně (jméno)">
        <input type="number" id="tb-add-skill" min="1" max="100" placeholder="Skill (50)">
        <button type="button" class="btn-sm" id="tb-add-btn">Přidat</button>
      </div>
      <div id="tb-draw-players"></div>
      <button type="button" class="btn-ghost" id="tb-draw-btn" style="margin-top:12px;">🎰 Losovat týmy</button>
    </div>
    <div id="tb-drawn-teams"></div>
    <div id="tb-confirm-teams-row" style="margin-top:14px; display:none;">
      <button type="button" id="btn-confirm-team-setup">Potvrdit a spustit turnaj</button>
    </div>
  `;
  document.getElementById('btn-back-format').addEventListener('click', () => { S.tourneySetupStep = 'format'; renderTurnajPage(); });
  tbRenderDrawPlayers();
  toggleSkillInputsVisibility();

  document.getElementById('tb-use-skill').addEventListener('change', () => { toggleSkillInputsVisibility(); tbInvalidateDraw(); });
  document.getElementById('tb-team-size').addEventListener('input', () => { tbUpdateTeamCountHint(); tbInvalidateDraw(); });
  document.getElementById('tb-team-count').addEventListener('input', () => tbInvalidateDraw());
  document.getElementById('tb-add-btn').addEventListener('click', () => {
    const nameInput = document.getElementById('tb-add-name');
    const skillInput = document.getElementById('tb-add-skill');
    const name = nameInput.value.trim();
    if(!name){ alert('Vyplň jméno hráče.'); return; }
    const skill = Math.min(100, Math.max(1, parseInt(skillInput.value, 10) || 50));
    tbAddDrawPlayer(name, skill, { persist:false });
    nameInput.value = ''; skillInput.value = '';
    tbRenderDrawPlayers();
    tbInvalidateDraw();
  });
  document.getElementById('tb-draw-btn').addEventListener('click', () => {
    const useSkill = document.getElementById('tb-use-skill').checked;
    if(!useSkill){
      // bez skillu: dočasně přiřadit náhodné hodnoty jen kvůli losovacímu automatu, neukládat je
      S.tbDraw.players.forEach(p => { p._origSkill = p.baseSkill; p.baseSkill = Math.floor(Math.random()*100)+1; });
    }
    tbStartDrawFromFormNoPersist(() => {
      document.getElementById('tb-confirm-teams-row').style.display = 'block';
    });
  });
  document.getElementById('btn-confirm-team-setup').addEventListener('click', async () => {
    const useSkill = document.getElementById('tb-use-skill').checked;
    const teams = S.tbDraw.teams.map((tm, i) => ({ name: (tm.name || '').trim() || `Tým ${i+1}`, members: tm.members, emblem: tm.emblem || '', ...(tm.color ? { color: tm.color } : {}) }));
    const skills = {};
    if(useSkill) S.tbDraw.players.forEach(p => { skills[tbKey(p.name)] = p._origSkill !== undefined ? p._origSkill : p.baseSkill; });
    try{
      await updateDoc(doc(db,'tournaments',t.id), { teams, format:'teams', status:'ready', teamSize: tbTeamSizeVal() });
      await seedHandicapSkills(t, skills);
      logAction('turnaj', `vylosoval a potvrdil týmy v turnaji „${t.name}“`);
      S.tourneySetupStep = null; S.tbDraw = { players: [], teams: null };
    }catch(err){ alert('Uložení se nepovedlo.'); console.error(err); }
  });
}
function toggleSkillInputsVisibility(){
  const on = document.getElementById('tb-use-skill').checked;
  document.querySelectorAll('.tb-draw-skill').forEach(el => el.style.display = on ? '' : 'none');
  const addSkill = document.getElementById('tb-add-skill');
  if(addSkill) addSkill.style.display = on ? '' : 'none';
}
function tbStartDrawFromFormNoPersist(onDone){
  const size = tbTeamSizeVal();
  const P = S.tbDraw.players.length;
  const minTeams = Math.ceil(P / size);
  const numTeams = parseInt(document.getElementById('tb-team-count').value, 10) || minTeams;
  if(P < 2){ alert('Přidej aspoň 2 hráče.'); return; }
  if(numTeams < 2){ alert('Turnaj potřebuje aspoň 2 týmy — zvyš počet týmů.'); return; }
  if(numTeams < minTeams){ alert(`Na ${P} hráčů po ${size} potřebuješ aspoň ${minTeams} týmů.`); return; }
  if(numTeams > P){ alert('Týmů je víc než hráčů.'); return; }
  tbStartDraft({
    players: S.tbDraw.players.map(p => ({ name: p.name, baseSkill: p.baseSkill })),
    teamSize: size, numTeams,
    onConfirm: (teams) => {
      S.tbDraw.teams = teams.map((tm, i) => ({ name: `Tým ${i+1}`, members: tm.members, ...autoStyle(i) }));
      tbRenderDrawnTeams();
      if(onDone) onDone();
    }
  });
}

function renderFfaFormatSetup(t, box){
  const signups = t.signups || [];
  box.innerHTML = `
    <button type="button" class="btn-ghost btn-sm" id="btn-back-format">← Zpět na výběr formátu</button>
    <h1 class="headline" style="font-size:24px; margin-top:14px;">Všichni proti všem — ${escapeHtml(t.name)}</h1>
    <p class="lede" style="margin-top:0;">Účastníci (${signups.length}) — klidně ještě uprav, koho se to týká.</p>
    <div class="signup-list" id="ffa-participant-list"></div>
    <div class="tb-draw-addrow" style="max-width:420px;">
      <input type="text" id="ffa-manual-name" placeholder="Přidat ručně (jméno)">
      <button type="button" class="btn-sm" id="ffa-manual-add">Přidat</button>
    </div>
    <button type="button" id="btn-confirm-ffa-setup" style="margin-top:16px;" ${signups.length < 2 ? 'disabled' : ''}>Spustit turnaj</button>
  `;
  document.getElementById('btn-back-format').addEventListener('click', () => { S.tourneySetupStep = 'format'; renderTurnajPage(); });
  let localList = [...signups];
  const renderList = () => {
    const box2 = document.getElementById('ffa-participant-list');
    box2.innerHTML = localList.length
      ? localList.map(n => `<div class="signup-row"><span>${escapeHtml(n)}</span><span class="x" data-ffa-remove="${escapeHtml(n)}">×</span></div>`).join('')
      : '<div class="empty">Nikdo.</div>';
    box2.querySelectorAll('[data-ffa-remove]').forEach(el => el.addEventListener('click', () => {
      localList = localList.filter(n => n !== el.dataset.ffaRemove);
      renderList();
      document.getElementById('btn-confirm-ffa-setup').disabled = localList.length < 2;
    }));
  };
  renderList();
  document.getElementById('ffa-manual-add').addEventListener('click', () => {
    const input = document.getElementById('ffa-manual-name');
    const name = input.value.trim();
    if(!name || localList.includes(name)) return;
    localList.push(name);
    input.value = '';
    renderList();
    document.getElementById('btn-confirm-ffa-setup').disabled = localList.length < 2;
  });
  document.getElementById('btn-confirm-ffa-setup').addEventListener('click', async () => {
    try{
      await updateDoc(doc(db,'tournaments',t.id), { format:'ffa', status:'ready', 'ffa.participants': localList, 'ffa.styles': Object.fromEntries(localList.map((n, i) => [n, autoStyle(i)])), 'ffa.rounds': [{ label:'Kolo 1', scores:{} }] });
      S.tourneySetupStep = null;
    }catch(err){ alert('Uložení se nepovedlo.'); console.error(err); }
  });
}

function openNewTournamentForm(existing){
  if(existing){ openEditTournamentForm(existing); return; }
  const slot = document.getElementById('turnaj-form-slot');
  S.tbDraw = { players: [], teams: null };
  slot.innerHTML = `
    <div class="panel" style="max-width:640px;">
      <div class="section-title" style="font-size:16px; margin-top:0;">Nový turnaj</div>
      <p class="lede" style="margin-top:0;">Chceš nechat lidi se nejdřív přihlásit, nebo rovnou vybrat hráče a nalosovat týmy?</p>
      <div style="display:flex; gap:12px; flex-wrap:wrap;">
        <button type="button" id="btn-mode-signup" class="tourney-mode-btn">
          <b>📝 Otevřít přihlašování</b>
          <span>Lidi se přihlásí sami, formát (týmy / všichni proti všem) nastavíš později.</span>
        </button>
        <button type="button" id="btn-mode-direct" class="tourney-mode-btn">
          <b>🎰 Rovnou nalosovat</b>
          <span>Vybereš hráče z akce nebo ručně a hned je rozdělíš do týmů.</span>
        </button>
      </div>
      <button type="button" class="btn-ghost" id="btn-cancel-new-tourney" style="margin-top:16px;">Zrušit</button>
    </div>
  `;
  slot.scrollIntoView({ behavior:'smooth', block:'start' });
  document.getElementById('btn-cancel-new-tourney').addEventListener('click', () => { slot.innerHTML = ''; });
  document.getElementById('btn-mode-signup').addEventListener('click', () => openSignupTournamentForm());
  document.getElementById('btn-mode-direct').addEventListener('click', () => openDirectDrawTournamentForm());
}

function openSignupTournamentForm(){
  const slot = document.getElementById('turnaj-form-slot');
  const evOptions = [...S.events].sort((a,b) => (b.dateStart||'').localeCompare(a.dateStart||''));
  slot.innerHTML = `
    <form class="panel" id="form-new-tourney" style="max-width:640px;">
      <div class="section-title" style="font-size:16px; margin-top:0;">Otevřít přihlašování</div>
      <div class="field"><label>Název turnaje</label><input type="text" id="new-tourney-name" placeholder="Turnaj v COD4" required></div>
      ${gameFieldHtml('', '')}
      <div class="field"><label>Akce (nepovinné)</label><select id="new-tourney-event">
        <option value="">— bez přiřazené akce —</option>
        ${evOptions.map(e=>`<option value="${e.id}">${escapeHtml(e.name)}${e.dateEnd < todayIso() ? ' (proběhlo)' : ''}</option>`).join('')}
      </select></div>
      <div class="field"><label>URL obrázku turnaje (nepovinné)</label><input type="url" id="new-tourney-image"></div>
      <div style="display:flex; gap:10px; margin-top:8px;">
        <button type="submit">Otevřít přihlašování</button>
        <button type="button" class="btn-ghost" id="btn-cancel-new-tourney">Zrušit</button>
      </div>
    </form>
  `;
  document.getElementById('btn-cancel-new-tourney').addEventListener('click', () => { slot.innerHTML = ''; });
  const getGameImage1 = setupGameField('');
  document.getElementById('form-new-tourney').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('new-tourney-name').value.trim();
    if(!name) return;
    const payload = {
      name,
      game: document.getElementById('new-tourney-game').value.trim(),
      gameImage: getGameImage1(),
      eventId: document.getElementById('new-tourney-event').value,
      imageUrl: document.getElementById('new-tourney-image').value.trim(),
      status: 'signup', format: null, signups: [],
      teams: [], results:{}, swissResults:{},
      ffa: { participants: [], rounds: [] },
      createdAt: new Date().toISOString()
    };
    try{
      const docRef = await addDoc(collection(db,'tournaments'), payload);
      logAction('turnaj', `vytvořil turnaj „${payload.name || ''}“`);
      slot.innerHTML = '';
      appApi.setRoute('#turnaj/' + docRef.id);
    }catch(err){ alert('Uložení se nepovedlo.'); console.error(err); }
  });
}

async function seedHandicapSkills(t, skillsMap){
  const entries = Object.entries(skillsMap || {});
  if(!entries.length) return;
  const key = handicapSessionKey(t);
  const payload = {};
  entries.forEach(([k, v]) => { payload[`skills.${k}`] = v; });
  try{
    await setDoc(doc(db, 'handicapSessions', key), payload, { merge:true });
    // základní skill platí trvale pro turnaj (denní handicap se resetuje, základ ne)
    if(t.id){ const bs = {}; entries.forEach(([k, v]) => { bs[`baseSkills.${k}`] = v; }); await updateDoc(doc(db, 'tournaments', t.id), bs); }
  }
  catch(err){ console.error('Nepodařilo se uložit počáteční skilly:', err); }
}

function openDirectDrawTournamentForm(){
  const slot = document.getElementById('turnaj-form-slot');
  const evOptions = [...S.events].sort((a,b) => (b.dateStart||'').localeCompare(a.dateStart||''));
  S.tbDraw = { players: [], teams: null };
  slot.innerHTML = `
    <form class="panel" id="form-new-tourney" style="max-width:940px;">
      <div class="field"><label>Název turnaje</label><input type="text" id="new-tourney-name" placeholder="Hlavní Dota turnaj" required></div>
      ${gameFieldHtml('', '')}
      <div class="field"><label>Akce (hráči se načtou automaticky)</label><select id="new-tourney-event">
        <option value="">— bez přiřazené akce —</option>
        ${evOptions.map(e=>`<option value="${e.id}">${escapeHtml(e.name)}${e.dateEnd < todayIso() ? ' (proběhlo)' : ''}</option>`).join('')}
      </select><small id="tb-event-msg"></small></div>
      <div class="tb-form-row">
        <div class="field"><label>Hráčů v týmu</label><input type="number" id="tb-team-size" min="1" max="6" value="3"></div>
        <div class="field"><label>Počet týmů</label><input type="number" id="tb-team-count" min="2" placeholder="auto"></div>
      </div>
      <div class="field"><label>URL obrázku turnaje (nepovinné)</label><input type="url" id="new-tourney-image"></div>

      <div class="tb-draw-section">
        <div class="section-title" style="font-size:15px;">Hráči do losování</div>
        <div class="tb-draw-addrow">
          <input type="text" id="tb-add-name" placeholder="Přidat hráče ručně (jméno)">
          <input type="number" id="tb-add-skill" min="1" max="100" placeholder="Skill (50)">
          <button type="button" class="btn-sm" id="tb-add-btn">Přidat</button>
        </div>
        <div id="tb-draw-players"></div>
        <button type="button" class="btn-ghost" id="tb-draw-btn" style="margin-top:12px;">🎰 Losovat týmy</button>
        <small style="display:block; margin-top:6px; color:var(--text-muted);">Losování je nepovinné — bez něj se vytvoří prázdné týmy a hráče do nich přidáš přes "Upravit týmy".</small>
      </div>
      <div id="tb-drawn-teams"></div>

      <div style="display:flex; gap:10px; margin-top:8px;">
        <button type="submit">Vytvořit turnaj</button>
        <button type="button" class="btn-ghost" id="btn-cancel-new-tourney">Zrušit</button>
      </div>
    </form>
  `;
  slot.scrollIntoView({ behavior:'smooth', block:'start' });
  tbRenderDrawPlayers();
  const getGameImage2 = setupGameField('');

  document.getElementById('btn-cancel-new-tourney').addEventListener('click', () => { slot.innerHTML = ''; S.tbDraw = { players: [], teams: null }; });
  document.getElementById('tb-team-size').addEventListener('input', () => { tbUpdateTeamCountHint(); tbInvalidateDraw(); });
  document.getElementById('tb-team-count').addEventListener('input', () => tbInvalidateDraw());

  document.getElementById('new-tourney-event').addEventListener('change', async (e) => {
    const eventId = e.target.value;
    const msg = document.getElementById('tb-event-msg');
    S.tbDraw.players = S.tbDraw.players.filter(p => !p.fromEvent);
    tbInvalidateDraw();
    if(!eventId){ msg.textContent = ''; tbRenderDrawPlayers(); return; }
    msg.textContent = 'Načítám přihlášené...';
    try{
      const snap = await getDocs(collection(db,'events',eventId,'registrations'));
      const regs = snap.docs.map(d=>d.data()).filter(r => r.status !== 'maybe' && r.nick).sort((a,b)=>(a.nick||'').localeCompare(b.nick||''));
      const rows = await Promise.all(regs.map(async r => {
        const saved = await tbLoadSkill(r.nick);
        return { nick: r.nick, skill: saved !== null ? saved : 50, saved: saved !== null };
      }));
      rows.forEach(r => { tbAddDrawPlayer(r.nick, r.skill, { fromEvent:true, persist:false }); if(r.saved){ const pl = S.tbDraw.players.find(p => p.name === r.nick); if(pl) pl.hadBase = true; } });
      tbRenderDrawPlayers();
      msg.textContent = rows.length ? `Načteno ${rows.length} hráčů, kteří určitě jedou.` : 'Na téhle akci zatím nikdo určitě nejede.';
    }catch(err){ console.error(err); msg.textContent = 'Nepovedlo se načíst přihlášené.'; }
  });

  document.getElementById('tb-add-btn').addEventListener('click', () => {
    const nameInput = document.getElementById('tb-add-name');
    const skillInput = document.getElementById('tb-add-skill');
    const name = nameInput.value.trim();
    if(!name){ alert('Vyplň jméno hráče.'); return; }
    const skill = Math.min(100, Math.max(1, parseInt(skillInput.value, 10) || 50));
    tbAddDrawPlayer(name, skill);
    { const np = S.tbDraw.players.find(p => p.name.toLowerCase() === name.toLowerCase()); if(np) np.manual = true; }
    nameInput.value = ''; skillInput.value = '';
    tbRenderDrawPlayers();
    tbInvalidateDraw();
  });
  document.getElementById('tb-add-name').addEventListener('keydown', (e) => {
    if(e.key === 'Enter'){ e.preventDefault(); document.getElementById('tb-add-btn').click(); }
  });

  document.getElementById('tb-draw-btn').addEventListener('click', tbStartDrawFromForm);

  document.getElementById('form-new-tourney').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('new-tourney-name').value.trim();
    const eventId = document.getElementById('new-tourney-event').value;
    const imageUrl = document.getElementById('new-tourney-image').value.trim();
    const game = document.getElementById('new-tourney-game').value.trim();
    const gameImage = getGameImage2();
    if(!name) return;
    let teams = [], skills = {};
    if(S.tbDraw.teams){
      teams = S.tbDraw.teams.map((t, i) => {
        const team = { name: (t.name || '').trim() || `Tým ${i+1}`, members: t.members, emblem: t.emblem || '' };
        if(t.color) team.color = t.color;
        return team;
      });
      S.tbDraw.players.forEach(p => { skills[tbKey(p.name)] = p.baseSkill; });
    }else{
      S.tbDraw.players.forEach(p => { if(p.touched || p.hadBase) skills[tbKey(p.name)] = p.baseSkill; });
      const count = Math.max(2, parseInt(document.getElementById('tb-team-count').value, 10) || 4);
      for(let i = 0; i < count; i++) teams.push({ name: `Tým ${i+1}`, members: [], ...autoStyle(i) });
    }
    const createdAt = new Date().toISOString();
    try{
      const docRef = await addDoc(collection(db,'tournaments'), {
        name, game, gameImage, eventId, teams, results:{}, swissResults:{}, imageUrl,
        status:'ready', format:'teams', signups:[], ffa:{ participants:[], rounds:[] },
        teamSize: tbTeamSizeVal(), createdAt,
        drawExtra: S.tbDraw.players.filter(p => p.manual).map(p => p.name)
      });
      await seedHandicapSkills({ id:docRef.id, eventId, createdAt }, skills);
      logAction('turnaj', `vytvořil turnaj „${name}“` + (teams.length && teams.some(x => (x.members||[]).length) ? ' a vylosoval týmy' : ''));
      slot.innerHTML = '';
      S.tbDraw = { players: [], teams: null };
      appApi.setRoute('#turnaj/' + docRef.id);
    }catch(err){ alert('Uložení se nepovedlo.'); console.error(err); }
  });
}

function openEditTournamentForm(existing){
  const slot = document.getElementById('turnaj-form-slot');
  const evOptions = [...S.events].sort((a,b) => (b.dateStart||'').localeCompare(a.dateStart||''));
  const isTeamFormat = existing.format !== 'ffa';
  const alreadyDrawn = isTeamFormat && (existing.teams||[]).some(t => (t.members||[]).length > 0);

  S.tbDraw = { players: [], teams: null };
  if(isTeamFormat){
    (existing.teams||[]).forEach(t => (t.members||[]).forEach(name => {
      if(!S.tbDraw.players.some(p => p.name === name)){
        const cur = tbGetPlayerStats(existing, name).base;   // aktuální základní skill hráče v tomto turnaji
        tbAddDrawPlayer(name, cur === null ? 50 : cur, { persist:false });
        const pl = S.tbDraw.players.find(p => p.name === name);
        if(pl && cur !== null) pl.hadBase = true;
      }
    }));
  }

  slot.innerHTML = `
    <form class="panel" id="form-new-tourney" style="max-width:940px;">
      <div class="field"><label>Název turnaje</label><input type="text" id="new-tourney-name" placeholder="Hlavní Dota turnaj" value="${escapeHtml(existing.name)}" required></div>
      ${gameFieldHtml(existing.game || '', existing.gameImage || '')}
      <div class="field"><label>Akce (nepovinné)</label><select id="new-tourney-event">
        <option value="">— bez přiřazené akce —</option>
        ${evOptions.map(e=>`<option value="${e.id}" ${existing.eventId===e.id?'selected':''}>${escapeHtml(e.name)}${e.dateEnd < todayIso() ? ' (proběhlo)' : ''}</option>`).join('')}
      </select></div>
      <div class="field"><label>URL obrázku turnaje (nepovinné)</label><input type="url" id="new-tourney-image" value="${escapeHtml(existing.imageUrl||'')}"></div>

      ${isTeamFormat ? `
      <div class="tb-form-row">
        <div class="field"><label>Hráčů v týmu</label><input type="number" id="tb-team-size" min="1" max="6" value="${existing.teamSize || 3}"></div>
        <div class="field"><label>Počet týmů</label><input type="number" id="tb-team-count" min="2" value="${(existing.teams||[]).length || ''}" placeholder="auto"></div>
      </div>
      <div class="tb-draw-section">
        <div class="section-title" style="font-size:15px;">Hráči do losování</div>
        ${alreadyDrawn ? '<small style="display:block; color:var(--text-muted); margin-bottom:8px;">Týmy už jsou vylosované (hráči níž jsou předvyplnění ze současných týmů). Losovat znovu přepíše současné rozdělení.</small>' : ''}
        <div class="tb-draw-addrow">
          <input type="text" id="tb-add-name" placeholder="Přidat hráče ručně (jméno)">
          <input type="number" id="tb-add-skill" min="1" max="100" placeholder="Skill (50)">
          <button type="button" class="btn-sm" id="tb-add-btn">Přidat</button>
        </div>
        <small id="tb-event-msg" style="display:block; color:var(--text-muted); margin-bottom:8px;"></small>
        <div id="tb-draw-players"></div>
        <button type="button" class="btn-ghost" id="tb-draw-btn" style="margin-top:12px;">🎰 ${alreadyDrawn ? 'Losovat týmy znovu' : 'Losovat týmy'}</button>
      </div>
      <div id="tb-drawn-teams"></div>
      ` : ''}

      <div style="display:flex; gap:10px; margin-top:8px;">
        <button type="submit">Uložit změny</button>
        <button type="button" class="btn-ghost" id="btn-cancel-new-tourney">Zrušit</button>
      </div>
    </form>
  `;
  slot.scrollIntoView({ behavior:'smooth', block:'start' });
  document.getElementById('btn-cancel-new-tourney').addEventListener('click', () => { slot.innerHTML = ''; S.tbDraw = { players: [], teams: null }; });
  const getGameImage3 = setupGameField(existing.gameImage || '');

  if(isTeamFormat){
    // ručně přidaní hráči (mimo akci), kteří se uložili při předchozím uložení turnaje
    (existing.drawExtra || []).forEach(n => {
      if(!S.tbDraw.players.some(p => p.name.toLowerCase() === n.toLowerCase())){
        const cur = tbGetPlayerStats(existing, n).base;
        tbAddDrawPlayer(n, cur === null ? 50 : cur, { persist:false });
        const pl = S.tbDraw.players.find(p => p.name === n); if(pl){ pl.manual = true; if(cur !== null) pl.hadBase = true; }
      }
    });
    tbRenderDrawPlayers();
    // přihlášení na akci se načítají stejně jako při tvorbě (a aktualizují se při každém otevření úpravy)
    const loadEventPlayers = async (eventId) => {
      const msg = document.getElementById('tb-event-msg');
      if(!eventId){ if(msg) msg.textContent = ''; return; }
      if(msg) msg.textContent = 'Načítám přihlášené na akci...';
      try{
        const snap = await getDocs(collection(db,'events',eventId,'registrations'));
        const regs = snap.docs.map(d=>d.data()).filter(r => r.status !== 'maybe' && r.nick).sort((x,y)=>(x.nick||'').localeCompare(y.nick||''));
        let added = 0;
        for(const r of regs){
          if(S.tbDraw.players.some(p => p.name.toLowerCase() === r.nick.toLowerCase())) continue;
          let cur = tbGetPlayerStats(existing, r.nick).base;
          if(cur === null){ const saved = await tbLoadSkill(r.nick); cur = saved; }
          tbAddDrawPlayer(r.nick, cur === null || cur === undefined ? 50 : cur, { fromEvent:true, persist:false });
          const pl = S.tbDraw.players.find(p => p.name === r.nick); if(pl && cur !== null && cur !== undefined) pl.hadBase = true;
          added++;
        }
        tbRenderDrawPlayers();
        if(msg) msg.textContent = `Z akce načteno ${regs.length} hráčů${added ? `, nově přidáno ${added}` : ''}.`;
      }catch(err){ console.error(err); if(msg) msg.textContent = 'Nepovedlo se načíst přihlášené.'; }
    };
    loadEventPlayers(existing.eventId || '');
    document.getElementById('new-tourney-event').addEventListener('change', (e) => {
      S.tbDraw.players = S.tbDraw.players.filter(p => !p.fromEvent);
      tbRenderDrawPlayers(); tbInvalidateDraw();
      loadEventPlayers(e.target.value);
    });
    document.getElementById('tb-team-size').addEventListener('input', () => { tbUpdateTeamCountHint(); tbInvalidateDraw(); });
    document.getElementById('tb-team-count').addEventListener('input', () => tbInvalidateDraw());
    document.getElementById('tb-add-btn').addEventListener('click', () => {
      const nameInput = document.getElementById('tb-add-name');
      const skillInput = document.getElementById('tb-add-skill');
      const name = nameInput.value.trim();
      if(!name){ alert('Vyplň jméno hráče.'); return; }
      const skill = Math.min(100, Math.max(1, parseInt(skillInput.value, 10) || 50));
      tbAddDrawPlayer(name, skill, { persist:false });
      { const np = S.tbDraw.players.find(p => p.name.toLowerCase() === name.toLowerCase()); if(np){ np.touched = true; np.manual = true; } }
      nameInput.value = ''; skillInput.value = '';
      tbRenderDrawPlayers();
      tbInvalidateDraw();
    });
    document.getElementById('tb-draw-btn').addEventListener('click', () => {
      if(alreadyDrawn && !S.tbDraw.teams){
        if(!confirm('Týmy už byly vylosované. Opravdu chceš losovat znovu? Přepíše to současné rozdělení.')) return;
      }
      tbStartDrawFromForm();
    });
  }

  document.getElementById('form-new-tourney').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('new-tourney-name').value.trim();
    const eventId = document.getElementById('new-tourney-event').value;
    const imageUrl = document.getElementById('new-tourney-image').value.trim();
    const game = document.getElementById('new-tourney-game').value.trim();
    const gameImage = getGameImage3();
    if(!name) return;
    const update = { name, eventId, imageUrl, game, gameImage };
    let skillsToSeed = {};
    if(isTeamFormat){
      update.teamSize = tbTeamSizeVal();
      update.drawExtra = S.tbDraw.players.filter(p => p.manual).map(p => p.name);
      if(S.tbDraw.teams){
        update.teams = S.tbDraw.teams.map((t, i) => ({ name: (t.name || '').trim() || `Tým ${i+1}`, members: t.members, emblem: t.emblem || '', ...(t.color ? { color: t.color } : {}) }));
        S.tbDraw.players.forEach(p => { skillsToSeed[tbKey(p.name)] = p.baseSkill; });
      }else{
        // týmy se nelosovaly znovu, ale skilly upravené ve formuláři se musí uložit
        S.tbDraw.players.forEach(p => { if(p.touched || p.hadBase) skillsToSeed[tbKey(p.name)] = p.baseSkill; });
      }
    }
    try{
      await updateDoc(doc(db,'tournaments',existing.id), update);
      await seedHandicapSkills(existing, skillsToSeed);
      logAction('turnaj', `upravil turnaj „${name}“` + (update.teams ? ' (nové týmy)' : '') + (Object.keys(skillsToSeed).length ? ' (skilly hráčů)' : ''));
      slot.innerHTML = '';
      S.tbDraw = { players: [], teams: null };
      renderTurnajPage();
    }catch(err){ alert('Uložení se nepovedlo.'); console.error(err); }
  });
}
