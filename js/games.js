// Vyhledávání her s logem (Steam + volitelně RAWG pro retro hry) a pole "Hra" u turnajů.
// RAWG: vlož svůj klíč (zdarma na https://rawg.io/apidocs) do RAWG_API_KEY níže.
import { escapeHtml } from './util.js';

export function gameFieldHtml(existingName, existingImage){
  return `<div class="field" style="position:relative;">
    <label>Hra (nepovinné)</label>
    <div style="display:flex; gap:10px; align-items:center;">
      <div style="flex:1; position:relative;">
        <input type="text" id="new-tourney-game" placeholder="např. Dota 2, Quake 3 Arena, COD4..." autocomplete="off" value="${escapeHtml(existingName||'')}">
        <div id="new-tourney-game-list" class="game-autocomplete-list" style="display:none;"></div>
      </div>
      <img id="new-tourney-game-preview" src="${existingImage ? existingImage.replace(/"/g,'&quot;') : ''}" alt="" style="width:48px; height:48px; object-fit:contain; flex-shrink:0; ${existingImage ? '' : 'display:none;'}">
    </div>
    <small>Podle tohohle appka pozná, jestli u výsledků zobrazit Aegis nebo klasický pohár, a zobrazí se i větší náhled u turnaje.</small>
  </div>`;
}
export function setupGameField(existingImage){
  let gameImage = existingImage || '';
  const input = document.getElementById('new-tourney-game');
  const list = document.getElementById('new-tourney-game-list');
  const preview = document.getElementById('new-tourney-game-preview');
  attachGameAutocomplete(input, list, (name, image) => {
    gameImage = image;
    if(image){ preview.src = image; preview.style.display = 'block'; }
    else{ preview.style.display = 'none'; }
  });
  return () => gameImage;
}

export const STEAM_SEARCH_FUNCTION_URL = 'https://steam-game-search-632018940301.europe-west3.run.app';
// Starší / retro hry (Amiga, DOS, konzole...) Steam nezná. Druhý zdroj: RAWG (zdarma, https://rawg.io/apidocs).
// Klíč si vytvoř zdarma na rawg.io/apidocs a vlož sem; prázdný = hledá se jen na Steamu jako dřív.
const RAWG_API_KEY = '';
export function cleanGameQuery(q){
  return q.replace(/\([^)]*\)/g, ' ').replace(/\b(19|20)\d\d\b/g, ' ').replace(/\b(amiga|dos|pc|c64|atari|snes|nes|sega|mega ?drive)\b/gi, ' ').replace(/\s+/g, ' ').trim();
}
export async function searchGames(q){
  const steamP = fetch(`${STEAM_SEARCH_FUNCTION_URL}?term=${encodeURIComponent(q)}`).then(r => r.json()).then(d => d.items || []);
  const cq = cleanGameQuery(q) || q;
  const rawgP = RAWG_API_KEY
    ? fetch(`https://api.rawg.io/api/games?key=${RAWG_API_KEY}&search=${encodeURIComponent(cq)}&page_size=8`).then(r => r.json()).then(d => (d.results || []).map(g => ({ name: g.name, image: g.background_image || '' })))
    : Promise.resolve([]);
  const [s, r] = await Promise.allSettled([steamP, rawgP]);
  const out = [], seen = new Set();
  [...(s.status === 'fulfilled' ? s.value : []), ...(r.status === 'fulfilled' ? r.value : [])].forEach(g => {
    const k = String(g.name || '').toLowerCase();
    if(k && !seen.has(k)){ seen.add(k); out.push(g); }
  });
  return out;
}

// Znovupoužitelné vyhledávání hry s logem (pole "Hra" u turnajů). onPick(name, image) se zavolá při výběru z nabídky.
export function attachGameAutocomplete(inputEl, listEl, onPick){
  let debounceTimer = null;
  inputEl.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    const q = e.target.value.trim();
    if(q.length < 2){ listEl.style.display = 'none'; return; }
    debounceTimer = setTimeout(async () => {
      try{
        const results = await searchGames(q);
        if(results.length === 0){ listEl.style.display = 'none'; return; }
        listEl.innerHTML = results.map(r => `
          <div class="game-autocomplete-item" data-pick-game-name="${escapeHtml(r.name)}" data-pick-game-image="${r.image ? r.image.replace(/"/g,'&quot;') : ''}">
            ${r.image ? `<img src="${r.image.replace(/"/g,'&quot;')}" alt="">` : '<div class="game-autocomplete-noimg">🎮</div>'}
            <span>${escapeHtml(r.name)}</span>
          </div>
        `).join('');
        listEl.style.display = 'grid';
        listEl.querySelectorAll('[data-pick-game-name]').forEach(item => {
          item.addEventListener('click', () => {
            inputEl.value = item.dataset.pickGameName;
            listEl.style.display = 'none';
            onPick(item.dataset.pickGameName, item.dataset.pickGameImage || '');
          });
        });
      }catch(err){ console.error(err); listEl.style.display = 'none'; }
    }, 400);
  });
  document.addEventListener('click', (e) => {
    if(!e.target.closest(`#${inputEl.id}`) && !e.target.closest(`#${listEl.id}`)) listEl.style.display = 'none';
  });
}
