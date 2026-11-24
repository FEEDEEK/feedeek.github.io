// Drobné pomocné funkce bez závislosti na zbytku aplikace (text, datum).

export function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

export function fmtDate(iso){
  if(!iso) return '';
  const d = new Date(iso+'T00:00:00');
  return d.toLocaleDateString('cs-CZ', { day:'numeric', month:'numeric', year:'numeric' });
}

export function fmtDateShort(iso){
  if(!iso) return '';
  const d = new Date(iso+'T00:00:00');
  return d.toLocaleDateString('cs-CZ', { day:'numeric', month:'numeric' });
}

export function todayIso(){ return new Date().toISOString().slice(0,10); }

// Zápis, který může selhat jen proto, že přihlašovací token ještě neví o ověřeném e-mailu: při odmítnutí
// se token obnoví a zápis se zkusí ještě jednou.
export async function retryAfterTokenRefresh(user, fn){
  try{ return await fn(); }
  catch(e){
    if(user && e && (e.code === 'permission-denied' || /permission/i.test(e.message || ''))){
      await user.reload();
      await user.getIdToken(true);
      return await fn();
    }
    throw e;
  }
}
