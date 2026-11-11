// (vyjmuto z app.js, řádky 251-442)
import { onSnapshot, collection, updateDoc, doc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js";
import { S, hasPerm } from "./state.js";
import { renderTabPrehled } from "./tab-prehled.js";
import { renderTabTurnaj } from "./tab-turnaj.js";
import { escapeHtml } from "./util.js";
import { appApi } from "./hooks.js";

// ---- Turnaj: samostatná kolekce, propojená s konkrétní akcí přes eventId ----
export const TEAM_EMBLEMS = ['🛡️','⚔️','🐺','🦅','🔥','💀','👑','🌙','⭐','🐉','🦁','🍀','🐍','🦂','⚡','🎯'];
export const TEAM_COLORS = ['#e8e3d8','#c9a24b','#8b2635','#2f8f8f','#4a90d9','#9b59b6','#e67e22','#2ecc71','#e84393','#95a5a6'];
// Automatický výchozí znak a barva podle pořadí, ať jsou týmy/hráči v pavouku hned rozlišitelní
// (tvůrce je může kdykoli změnit). První barva v paletě je neutrální výchozí, ta se nepřiděluje.
export function autoStyle(i){
  const colors = TEAM_COLORS.slice(1);
  return { emblem: TEAM_EMBLEMS[i % TEAM_EMBLEMS.length], color: colors[i % colors.length] };
}

onSnapshot(collection(db, 'tournaments'), (snap) => {
  S.allTournaments = snap.docs.map(d => ({ id:d.id, ...d.data() }));
  if(document.getElementById('view-turnaj')?.classList.contains('active')) appApi.renderTurnajPage();
  if(S.currentDetailEventId){
    const ev = S.events.find(x=>x.id===S.currentDetailEventId);
    if(ev){
      if(S.currentTab === 'prehled') renderTabPrehled(ev);
      if(S.currentTab === 'turnaj') renderTabTurnaj(ev);
    }
  }
  appApi.tryInitialRoute();
});

export function teamName(t, idx){ return t.teams[idx] ? t.teams[idx].name : `Tým ${idx+1}`; }
export function teamObj(t, idx){ return t.teams[idx] || { name: `Tým ${idx+1}`, members:[] }; }
export function teamCaptain(t, tm){
  let best = null, bestSkill = -1;
  (tm.members || []).forEach(n => {
    const s = appApi.tbEffectiveStats(t, n);
    const base = s.base === null ? 0 : s.base;
    if(base > bestSkill){ bestSkill = base; best = n; }
  });
  return best;
}
export function teamMembersHtml(t, tm){
  if(!(tm.members || []).length) return '';
  const capt = teamCaptain(t, tm);
  return `<div class="podium-members">${tm.members.map(n => n === capt
    ? `<span class="podium-captain">👑 ${escapeHtml(n)}</span>`
    : `<span>${escapeHtml(n)}</span>`).join('')}</div>`;
}
export function trophySvg(rank){
  const cls = rank === 1 ? 'gold' : rank === 2 ? 'silver' : 'bronze';
  return `<svg class="podium-trophy podium-trophy-${cls}" viewBox="0 0 24 26" xmlns="http://www.w3.org/2000/svg">
    <path d="M6 3h12v4a6 6 0 0 1-6 6 6 6 0 0 1-6-6V3Z" fill="currentColor" stroke="#241f14" stroke-width="1"/>
    <path d="M6 4H3a3 3 0 0 0 3 5" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <path d="M18 4h3a3 3 0 0 1-3 5" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <rect x="10.5" y="13" width="3" height="4" fill="currentColor"/>
    <path d="M7 20h10l-1.4-3H8.4L7 20Z" fill="currentColor" stroke="#241f14" stroke-width="1"/>
    <text x="12" y="9.5" font-size="7" font-weight="800" text-anchor="middle" fill="#241f14">${rank}</text>
  </svg>`;
}

// ---------- "Všichni proti všem": kola, skóre, pořadí (s děleným umístěním) ----------
export function computeFfaStandings(t){
  const participants = (t.ffa && t.ffa.participants) || [];
  const rounds = (t.ffa && t.ffa.rounds) || [];
  const totals = participants.map(name => {
    const total = rounds.reduce((sum, r) => sum + (Number((r.scores || {})[name]) || 0), 0);
    return { name, total };
  }).sort((a, b) => b.total - a.total);
  let placements = [];
  let rank = 1;
  totals.forEach((row, i) => {
    if(i > 0 && row.total === totals[i-1].total){
      // dělí se o stejné místo jako předchozí
    }else{
      rank = i + 1;
    }
    placements.push({ name: row.name, total: row.total, rank });
  });
  return { placements, rounds };
}

function gameUsesAegis(t){
  const g = (t.game || '').trim().toLowerCase();
  return g === 'dota 2' || g === 'dota2' || g === 'dota';
}
function trophyOrAegisImg(t, rankClass){
  if(gameUsesAegis(t)) return `<img src="assets/img/aegis.webp" alt="" class="aegis-img aegis-${rankClass}">`;
  return `<img src="assets/img/pohar.webp" alt="" class="trophy-img trophy-${rankClass}">`;
}
export function podiumCupHtml(t, rankClass, rank, labelName){
  const isAegis = gameUsesAegis(t);
  return `<div class="aegis-holder">
    <div class="aegis-glow aegis-glow-${rankClass}"></div>${rank===1?'<div class="aegis-sparks"></div>':''}
    ${isAegis
      ? trophyOrAegisImg(t, rankClass)
      : `<div class="trophy-podium-img tpi-${rankClass}"><img src="assets/img/pohar.webp" alt="" class="trophy-img trophy-${rankClass}"><div class="trophy-podium-label"><span class="tp-rank">${rank}</span></div></div>`}
  </div>`;
}

function avatarOrPlaceholder(name){
  const reg = Object.values(S.currentRegistrationsMap || {}).find(r => r.nick === name);
  const av = reg && reg.avatar;
  return av ? `<img src="${av.replace(/"/g,'&quot;')}" alt="" class="podium-avatar">` : `<div class="podium-avatar podium-avatar-blank">🎮</div>`;
}

// Styl (barva + znak) jednotlivce ve "všichni proti všem": uložený při nastavení turnaje,
// jinak se dopočítá podle pořadí hráče (ať fungují i starší turnaje).
function ffaStyleOf(t, name){
  const stored = t.ffa && t.ffa.styles && t.ffa.styles[name];
  if(stored && (stored.color || stored.emblem)) return stored;
  const parts = (t.ffa && t.ffa.participants) || [];
  const idx = parts.indexOf(name);
  return autoStyle(idx < 0 ? 0 : idx);
}
function ffaNameHtml(t, name){
  const st = ffaStyleOf(t, name);
  return `<span style="${st.color ? `color:${st.color};` : ''}">${st.emblem ? escapeHtml(st.emblem) + ' ' : ''}${escapeHtml(name)}</span>`;
}

export function buildFfaPodiumHtml(t, standings, big){
  const byRank = r => standings.placements.filter(p => p.rank === r);
  const p1 = byRank(1), p2 = byRank(2), p3 = byRank(3);
  const rest = standings.placements.filter(p => p.rank > 3);
  const step = (entries, rankClass, rank) => entries.map(p => `
    <div class="podium-step podium-${rank}">
      <div class="podium-team">${trophySvg(rank)}${ffaNameHtml(t, p.name)}</div>
      ${podiumCupHtml(t, rankClass, rank, p.name)}
      <div class="podium-members"><span>${p.total} bodů</span></div>
    </div>`).join('');
  let html = `<div class="podium-wrap ${big?'podium-wrap-big':''}">`;
  html += step(p2, 'silver', 2);
  html += step(p1, 'gold', 1);
  html += step(p3, 'bronze', 3);
  html += `</div>`;
  if(rest.length){
    html += rest.map(p => `<div class="bracket-slot" style="margin-top:8px;"><span>${p.rank}. ${ffaNameHtml(t, p.name)} — ${p.total} bodů</span></div>`).join('');
  }
  return html;
}

export function renderFfaBody(t, box){
  const standings = computeFfaStandings(t);
  const participants = (t.ffa && t.ffa.participants) || [];
  const rounds = (t.ffa && t.ffa.rounds) || [];
  const canEdit = hasPerm('turnaj');
  box.innerHTML = `
    <div class="ffa-rounds-head">
      <div class="section-title" style="font-size:16px; margin-top:0; margin-bottom:0;">Kola / mapy</div>
      ${canEdit ? `<button type="button" class="btn-sm" id="btn-add-ffa-round">+ Přidat kolo</button>` : ''}
    </div>
    ${rounds.length === 0 ? '<p class="empty">Zatím žádné odehrané kolo. Přidej první tlačítkem výše.</p>' : `
      <div style="overflow-x:auto;">
        <table class="ffa-rounds-table">
          <thead><tr><th>Hráč</th>${rounds.map((r,ri) => `<th ${canEdit ? `class="ffa-round-head" data-ffa-rename="${ri}" title="Klikni pro přejmenování"` : ''}>${escapeHtml(r.label || ('Kolo '+(ri+1)))}${canEdit ? ' ✏️' : ''}</th>`).join('')}<th>Celkem</th></tr></thead>
          <tbody>
            ${participants.map(name => `<tr><td>${ffaNameHtml(t, name)}</td>${rounds.map((r,ri) => `<td>${canEdit
                ? `<input type="number" value="${(r.scores||{})[name] ?? ''}" data-ffa-score="${ri}|${escapeHtml(name)}">`
                : ((r.scores||{})[name] ?? '0')}</td>`).join('')}<td class="ffa-total">${standings.placements.find(p=>p.name===name)?.total ?? 0}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    `}
    <div class="section-title" style="font-size:16px; margin-top:26px;">Průběžné pořadí</div>
    <div id="ffa-podium-box"></div>
  `;
  document.getElementById('ffa-podium-box').innerHTML = buildFfaPodiumHtml(t, standings, false);

  if(canEdit){
    box.querySelectorAll('[data-ffa-score]').forEach(inp => {
      inp.addEventListener('change', async () => {
        const [ri, name] = inp.dataset.ffaScore.split('|');
        const newRounds = rounds.map((r, i) => i === parseInt(ri,10)
          ? { ...r, scores: { ...(r.scores||{}), [name]: Number(inp.value) || 0 } }
          : r);
        try{ await updateDoc(doc(db,'tournaments',t.id), { 'ffa.rounds': newRounds }); }
        catch(err){ console.error(err); }
      });
    });
    box.querySelectorAll('[data-ffa-rename]').forEach(th => {
      th.addEventListener('click', async () => {
        const ri = parseInt(th.dataset.ffaRename, 10);
        const label = prompt('Nový název kola', rounds[ri].label || `Kolo ${ri+1}`);
        if(label === null || !label.trim()) return;
        const newRounds = rounds.map((r, i) => i === ri ? { ...r, label: label.trim() } : r);
        try{ await updateDoc(doc(db,'tournaments',t.id), { 'ffa.rounds': newRounds }); }
        catch(err){ console.error(err); }
      });
    });
    const addBtn = document.getElementById('btn-add-ffa-round');
    if(addBtn) addBtn.addEventListener('click', async () => {
      const label = prompt('Název kola (např. "Mapa 2")', `Kolo ${rounds.length+1}`);
      if(label === null) return;
      try{ await updateDoc(doc(db,'tournaments',t.id), { 'ffa.rounds': [...rounds, { label: label.trim() || `Kolo ${rounds.length+1}`, scores:{} }] }); }
      catch(err){ console.error(err); }
    });
  }
}


