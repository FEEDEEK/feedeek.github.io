// (vyjmuto z app.js, řádky 4591-4647)
import { S } from "./state.js";
import { escapeHtml } from "./util.js";
import { updateDoc, doc, arrayUnion } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js";
import { appApi } from "./hooks.js";

// ---- Kompaktní zobrazení turnajů v záložce akce ----
export function renderTabTurnaj(ev){
  const box = document.getElementById('tab-turnaj');
  const linked = S.allTournaments.filter(t => t.eventId === ev.id);

  let html = `<div class="section-title" style="font-size:16px;">🏆 Turnaje</div>`;
  if(linked.length === 0){
    html += '<div class="empty">K téhle akci zatím není přiřazený žádný turnaj. Založíš ho v horním menu "Turnaje".</div>';
    box.innerHTML = html;
    return;
  }
  html += `<div class="grid tourney-compact-grid" style="margin-top:14px;">` + linked.map(t => {
    let badgeTag = '', statusTxt = '';
    if(t.status === 'signup'){
      badgeTag = `<span class="tag tourney-signup-badge">Přihlášky otevřeny</span>`;
      statusTxt = `${(t.signups||[]).length} přihlášených`;
    }else if(t.format === 'ffa'){
      const standings = appApi.computeFfaStandings(t);
      const champion = standings.placements.find(p => p.rank === 1);
      badgeTag = `<span class="tag">${(t.ffa && t.ffa.participants || []).length} hráčů</span>`;
      statusTxt = champion ? `🏆 Vítěz: ${escapeHtml(champion.name)}` : 'Zatím žádné odehrané kolo';
    }else{
      const swiss = appApi.computeSwissTournament(t);
      const champion = swiss.placements.find(p => p.rank === 1);
      badgeTag = `<span class="tag">${(t.teams||[]).length} týmů</span>`;
      statusTxt = champion ? `🏆 Vítěz: ${escapeHtml(appApi.teamName(t, champion.team))}` : 'Základní část se ještě hraje';
    }
    return `
      <div class="event-card ${t.status === 'signup' ? 'event-card-signup-open' : ''}" data-open-tourney-compact="${t.id}" style="cursor:pointer;">
        ${t.gameImage ? `<div class="tourney-card-banner"><img src="${t.gameImage.replace(/"/g,'&quot;')}" alt=""></div>` : ''}
        <div style="display:flex; align-items:center; gap:10px;">
          ${badgeTag}
        </div>
        <h3>${escapeHtml(t.name)}</h3>
        <p class="desc">${statusTxt}</p>
        ${(t.status === 'signup' && S.currentNick && !(t.signups||[]).includes(S.currentNick)) ? `<button type="button" class="btn-sm" data-quick-signup-compact="${t.id}" style="width:100%; margin-top:4px;">✅ Přihlásit se do turnaje</button>` : ''}
        <span class="status-hint">${t.status === 'signup' ? 'Zobrazit přihlášené →' : 'Zobrazit celý pavouk →'}</span>
      </div>
    `;
  }).join('') + `</div>`;
  box.innerHTML = html;
  box.querySelectorAll('[data-quick-signup-compact]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try{ await updateDoc(doc(db,'tournaments',btn.dataset.quickSignupCompact), { signups: arrayUnion(S.currentNick) }); }
      catch(err){ console.error(err); }
    });
  });
  box.querySelectorAll('[data-open-tourney-compact]').forEach(card => {
    card.addEventListener('click', (e) => {
      if(e.target.closest('[data-quick-signup-compact]')) return;
      appApi.setRoute('#turnaj/' + card.dataset.openTourneyCompact);
    });
  });
}


