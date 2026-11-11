// (vyjmuto z app.js, řádky 36-106)
import { fmtDate, fmtDateShort, escapeHtml } from "./util.js";

export function fmtDateRange(ev){
  if(ev.dateUnconfirmed) return 'Termín se vybírá hlasováním';
  if(!ev.dateStart) return '';
  const multiDay = ev.dateEnd && ev.dateEnd !== ev.dateStart;
  if(!multiDay){
    let s = fmtDate(ev.dateStart);
    if(ev.timeStart) s += `, ${ev.timeStart}${ev.timeEnd ? '–'+ev.timeEnd : ''}`;
    return s;
  }
  const startPart = fmtDateShort(ev.dateStart) + (ev.timeStart ? ` ${ev.timeStart}` : '');
  const endPart = fmtDate(ev.dateEnd) + (ev.timeEnd ? ` ${ev.timeEnd}` : '');
  return `${startPart} – ${endPart}`;
}
export function avatarTag(avatar, size){
  size = size || 20;
  return `<img src="${avatar.replace(/"/g,'&quot;')}" alt="" style="width:${size}px; height:${size}px; border-radius:50%; object-fit:cover; vertical-align:middle; margin-right:5px; flex-shrink:0;">`;
}
// Emotikon může být krátký textový znak, nebo URL vlastního obrázku (nahraného/vloženého) - v obou
// případech se zobrazí ve stejné standardní velikosti.
export function emojiTag(emoji, size){
  if(!emoji) return '';
  size = size || 18;
  if(/^https?:\/\//i.test(emoji)){
    return `<img src="${emoji.replace(/"/g,'&quot;')}" alt="" style="width:${size}px; height:${size}px; object-fit:cover; border-radius:4px; vertical-align:middle; display:inline-block;">`;
  }
  return `<span style="font-size:${size}px; vertical-align:middle; display:inline-block; line-height:1;">${escapeHtml(emoji)}</span>`;
}
export function authorLabel(author, emoji, avatar){
  if(avatar) return `${avatarTag(avatar)}${escapeHtml(author)}`;
  return `${emoji ? emojiTag(emoji)+' ' : ''}${escapeHtml(author)}`;
}
const CHAT_EMOJIS = ['😀','😂','😎','👍','👎','🔥','🎉','❤️','😢','🤔','🎮','🕹️','👾','💻','🖱️','⌨️','🍕','🍺','🌙','⚡','💀','👑','🐉','🚗'];
export function setupChatEmojiRow(btnId, panelId, inputId){
  const btn = document.getElementById(btnId);
  const panel = document.getElementById(panelId);
  if(!btn || !panel) return;
  panel.innerHTML = CHAT_EMOJIS.map(e => `<span data-chat-emoji="${e}">${e}</span>`).join('');
  panel.style.position = 'fixed';

  function positionPanel(){
    const rect = btn.getBoundingClientRect();
    const panelWidth = panel.offsetWidth || 220;
    let left = rect.right - panelWidth;
    left = Math.max(8, Math.min(left, window.innerWidth - panelWidth - 8));
    panel.style.left = left + 'px';
    panel.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
    panel.style.top = 'auto';
    panel.style.right = 'auto';
    panel.style.marginBottom = '0';
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = panel.style.display === 'none';
    if(opening) positionPanel();
    panel.style.display = opening ? 'grid' : 'none';
  });
  panel.querySelectorAll('[data-chat-emoji]').forEach(el => {
    el.addEventListener('click', () => {
      const input = document.getElementById(inputId);
      input.value += el.dataset.chatEmoji;
      input.focus();
      panel.style.display = 'none';
    });
  });
  document.addEventListener('click', (e) => {
    if(!panel.contains(e.target) && e.target !== btn) panel.style.display = 'none';
  });
  window.addEventListener('resize', () => { if(panel.style.display !== 'none') positionPanel(); });
  window.addEventListener('scroll', () => { if(panel.style.display !== 'none') positionPanel(); }, true);
}
