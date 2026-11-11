// QR platba (SPAYD): převod čísla účtu na IBAN, variabilní symbol, sestavení QR řetězce a vykreslení osobního QR.
// Samostatný modul bez závislosti na zbytku aplikace (potřebuje jen globální knihovnu QRCode z index.html).
// Převod českého čísla účtu na IBAN podle ISO 13616 / MOD-97-10.
// Ověřeno proti více nezávislým zdrojům (kutac.cz, e-banky.cz, kodbank.cz).
export function czAccountToIban(prefix, account, bankCode){
  const p = String(prefix || '').replace(/\D/g,'').padStart(6, '0');
  const a = String(account || '').replace(/\D/g,'').padStart(10, '0');
  const bank = String(bankCode || '').replace(/\D/g,'').padStart(4, '0');
  if(a === '0000000000' || bank === '0000') return null;
  const bban = bank + p + a; // 20 číslic
  // CZ -> C=12, Z=35, plus dvě nulové kontrolní číslice coby zástupné místo
  const numStr = bban + '123500';
  let remainder = 0n;
  for(const ch of numStr){ remainder = (remainder * 10n + BigInt(ch)) % 97n; }
  const check = (98n - remainder).toString().padStart(2, '0');
  return 'CZ' + check + bban;
}

// Deterministický variabilní symbol (6 číslic) odvozený z UID uživatele - stejný pokaždé, nic se nemusí ukládat.
export function vsFromUid(uid){
  let h = 0;
  for(let i = 0; i < uid.length; i++){ h = (h * 31 + uid.charCodeAt(i)) >>> 0; }
  return String(h % 1000000).padStart(6, '0');
}

// Odstranění diakritiky a nepovolených znaků (SPAYD musí být čisté ASCII, bez hvězdiček)
// Do zprávy QR platby se pustí jen písmena A-Z, číslice, mezera, pomlčka a tečka. Diakritika se převede
// na základní písmeno (Ř -> R), všechno ostatní (emoji, speciální znaky, hvězdičky...) se prostě vynechá,
// protože bankovní appky s takovými znaky QR platbu odmítají.
export function spaydSafe(str){
  return String(str || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 .\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildSpaydString(iban, amount, vs, msg){
  let s = `SPD*1.0*ACC:${iban}*AM:${Number(amount).toFixed(2)}*CC:CZK`;
  if(vs) s += `*X-VS:${vs}`;
  if(msg) s += `*MSG:${spaydSafe(msg).slice(0, 60)}`;
  return s;
}

export function eventHasOwnPaymentAccount(ev){
  return !!(ev.fee && ev.accNumber && ev.accBank);
}

// Vykreslí osobní QR platbu konkrétního uživatele (vlastní variabilní symbol) do daného kontejneru.
export async function renderPersonalPaymentQr(ev, uid, nick, box){
  if(!eventHasOwnPaymentAccount(ev)){ box.innerHTML = ''; return; }
  const iban = czAccountToIban(ev.accPrefix, ev.accNumber, ev.accBank);
  if(!iban){ box.innerHTML = ''; return; }
  const vs = vsFromUid(uid);
  const safeNick = spaydSafe(nick);
  const spayd = buildSpaydString(iban, ev.fee, vs, safeNick ? `LAN-${safeNick}` : 'LAN');
  box.innerHTML = `
    <div class="payment-qr-box payment-qr-box-compact">
      <div id="payment-qr-canvas" class="payment-qr-canvas-wrap"></div>
      <div class="payment-qr-info">VS: <b>${vs}</b></div>
    </div>
  `;
  try{
    if(typeof window.QRCode !== 'function') throw new Error('QR knihovna se nenačetla');
    new window.QRCode(document.getElementById('payment-qr-canvas'), { text: spayd, width: 100, height: 100, correctLevel: window.QRCode.CorrectLevel.M });
  }catch(err){ console.error('QR generování selhalo:', err); box.innerHTML = '<div class="empty">QR kód se nepodařilo vygenerovat.</div>'; }
}
