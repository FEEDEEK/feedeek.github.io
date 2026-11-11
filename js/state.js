// Sdílený stav aplikace (přihlášený uživatel, jeho oprávnění, akce a detail akce). Ostatní moduly ho čtou i mění přes objekt S,
// např. S.currentUser, S.currentNick. (Proměnné se dřív jmenovaly stejně, jen bez "S.".)
import { emptyFoodSchedule } from "./constants.js";

export const S = {
  currentUser: null,
  currentNick: null,
  currentIsAdmin: false,
  currentIsSuperAdmin: false,
  currentPermissions: {},
  currentPhone: '',
  currentEmoji: '',
  currentAvatar: '',
  // --- akce a detail akce ---
  events: [],
  regCounts: {},
  pendingEventId: null,
  currentEventGames: [],
  currentEventFood: emptyFoodSchedule(),
  currentEventFoodVoting: {},
  currentEventDateOptions: [],
  currentDetailEventId: null,
  currentTab: 'prehled',
  detailUnsubs: [],
  currentRegistrationsMap: {},
  currentSuggestions: [],
  pendingSuggestionImage: '',
  currentComments: [],
  currentFoodComments: [],
  currentScheduleComments: [],
  currentPhotos: [],
  usersNickCache: null,
  usersNickLoading: false,
  allTournaments: [],
  gameLogoTargetIdx: null,
  turnajProjectorMode: false,
  tourneySetupStep: null, // null | format | team-draw | ffa-confirm
  tbSoundEnabled: true,
  tbAudioCtx: null,
  tbDraftInProgress: false,
  tbEventQueue: Promise.resolve(),
  tbPendingEvents: [],
  tbBatchTimer: null,
  tbSelectedVoiceURI: "",
  tbCurrentDraft: null,
  tbSpinBusy: false,
  tbDraftCancelled: false,
  handicapCache: {},
  tbDraw: { players: [], teams: null },
  tbSoundUnlocked: false,
  currentTournamentId: null,
};

// Má přihlášený uživatel dané oprávnění (hlavní admin má všechna).
export function hasPerm(area){
  if(!S.currentUser) return false;
  if(S.currentIsSuperAdmin) return true;
  return S.currentIsAdmin && S.currentPermissions[area] === true;
}
