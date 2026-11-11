// Přemostění funkcí, které zatím zůstávají v app.js a potřebují je vyjmuté moduly (např. showView, updateAuthUI).
// app.js je sem při startu zaregistruje (appApi.showView = showView ...). Postupně, jak se funkce samy přesouvají
// do modulů, odpadají odtud a moduly si je importují přímo.
export const appApi = {};
