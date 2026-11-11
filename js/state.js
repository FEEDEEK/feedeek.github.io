// Sdílený stav aplikace (přihlášený uživatel a jeho oprávnění). Ostatní moduly ho čtou i mění přes objekt S,
// např. S.currentUser, S.currentNick. (Proměnné se dřív jmenovaly stejně, jen bez "S.".)
export const S = {
  currentUser: null,
  currentNick: null,
  currentIsAdmin: false,
  currentIsSuperAdmin: false,
  currentPermissions: {},
  currentPhone: '',
  currentEmoji: '',
  currentAvatar: '',
};

// Má přihlášený uživatel dané oprávnění (hlavní admin má všechna).
export function hasPerm(area){
  if(!S.currentUser) return false;
  if(S.currentIsSuperAdmin) return true;
  return S.currentIsAdmin && S.currentPermissions[area] === true;
}
