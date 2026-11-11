// (vyjmuto z app.js, řádky 251-386)
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, auth } from "./firebase.js";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { S } from "./state.js";
import { closeContactForm } from "./contacts.js";
import { closeEventForm } from "./event-form.js";
import { appApi } from "./hooks.js";

// ==================== ÚČET / AUTENTIZACE ====================
export function usernameDocRef(nick){ return doc(db, 'usernames', nick.trim().toLowerCase()); }
function setAuthMessage(msg){ document.getElementById('auth-message').textContent = msg || ''; }

export const formAuth = document.getElementById('form-auth');
const authEmailField = document.getElementById('auth-email-field');
const authSubmitBtn = document.getElementById('auth-submit-btn');
let authStep = 1;
let pendingNickForRegistration = null;

formAuth.addEventListener('submit', async (e) => {
  e.preventDefault();
  const nick = document.getElementById('auth-nick').value.trim();
  const password = document.getElementById('auth-password').value;
  if(!nick || !password) return;
  authSubmitBtn.disabled = true;
  setAuthMessage('');
  try{
    if(authStep === 1){
      // krok 1 = pouze PŘIHLÁŠENÍ; registrace má vlastní tlačítko
      const unameSnap = await getDoc(usernameDocRef(nick));
      if(!unameSnap.exists()){
        setAuthMessage(`Přezdívka "${nick}" neexistuje. Zkontroluj ji, nebo klikni na Registrovat.`);
      }else{
        const { email } = unameSnap.data();
        await signInWithEmailAndPassword(auth, email, password);
      }
    }else{
      const email = document.getElementById('auth-email').value.trim();
      const phone = document.getElementById('auth-phone').value.trim();
      if(!email){ setAuthMessage('Doplň prosím e-mail.'); authSubmitBtn.disabled = false; return; }
      S.suppressAuthStateHandling = true;
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      try{ await appApi.sendVerifyMail(cred.user); }catch(e){ console.error('Ověřovací e-mail:', e); }
      await setDoc(usernameDocRef(pendingNickForRegistration), { uid: cred.user.uid, email });
      await setDoc(doc(db, 'users', cred.user.uid), { nick: pendingNickForRegistration, email, phone, createdAt: new Date().toISOString(), lastLogin: new Date().toISOString() });
      S.currentUser = cred.user;
      S.currentNick = pendingNickForRegistration;
      S.currentPhone = phone;
      S.currentEmoji = '';
      S.currentAvatar = '';
      S.currentIsAdmin = false;
      S.currentIsSuperAdmin = false;
      S.currentPermissions = {};
      S.suppressAuthStateHandling = false;
      appApi.updateAuthUI();
    }
  }catch(err){
    S.suppressAuthStateHandling = false;
    console.error(err);
    if(err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') setAuthMessage('Nesprávné heslo. Zkus to znovu.');
    else if(err.code === 'auth/email-already-in-use') setAuthMessage('Tenhle e-mail už je použitý u jiného účtu.');
    else if(err.code === 'auth/weak-password') setAuthMessage('Heslo musí mít aspoň 6 znaků.');
    else setAuthMessage('Něco se nepovedlo. Zkus to prosím znovu.');
  }finally{
    authSubmitBtn.disabled = false;
  }
});

document.getElementById('auth-register-btn').addEventListener('click', async () => {
  const nick = document.getElementById('auth-nick').value.trim();
  const password = document.getElementById('auth-password').value;
  if(!nick){ setAuthMessage('Vyplň přezdívku.'); return; }
  if(password.length < 6){ setAuthMessage('Heslo musí mít aspoň 6 znaků.'); return; }
  const btn = document.getElementById('auth-register-btn');
  btn.disabled = true;
  try{
    const unameSnap = await getDoc(usernameDocRef(nick));
    if(unameSnap.exists()){ setAuthMessage(`Přezdívka "${nick}" je už obsazená. Pokud je tvoje, klikni na Přihlásit.`); return; }
    authStep = 2;
    pendingNickForRegistration = nick;
    authEmailField.style.display = 'block';
    document.getElementById('auth-phone-field').style.display = 'block';
    document.getElementById('auth-nick').readOnly = true;
    authSubmitBtn.textContent = 'Dokončit registraci';
    btn.style.display = 'none';
    document.getElementById('auth-back-btn').style.display = '';
    setAuthMessage(`Přezdívka "${nick}" je volná — doplň e-mail a založíme ti účet.`);
  }catch(err){ console.error(err); setAuthMessage('Něco se nepovedlo. Zkus to prosím znovu.'); }
  finally{ btn.disabled = false; }
});
document.getElementById('auth-back-btn').addEventListener('click', () => {
  // zpět na přihlášení (přezdívka a heslo zůstanou vyplněné)
  authStep = 1;
  pendingNickForRegistration = null;
  authEmailField.style.display = 'none';
  document.getElementById('auth-phone-field').style.display = 'none';
  document.getElementById('auth-nick').readOnly = false;
  authSubmitBtn.textContent = 'Přihlásit';
  document.getElementById('auth-register-btn').style.display = '';
  document.getElementById('auth-back-btn').style.display = 'none';
  setAuthMessage('');
});

export function resetAuthForm(){
  authStep = 1;
  document.getElementById('auth-register-btn').style.display = '';
  document.getElementById('auth-back-btn').style.display = 'none';
  pendingNickForRegistration = null;
  formAuth.reset();
  authEmailField.style.display = 'none';
  document.getElementById('auth-phone-field').style.display = 'none';
  document.getElementById('auth-nick').readOnly = false;
  authSubmitBtn.textContent = 'Přihlásit';
  setAuthMessage('');
}

document.getElementById('btn-google').addEventListener('click', async () => {
  try{ await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch(err){ console.error(err); setAuthMessage('Přihlášení přes Google se nepovedlo. Zkus to znovu.'); }
});

document.getElementById('btn-google-nick-submit').addEventListener('click', async () => {
  const nick = document.getElementById('google-nick-input').value.trim();
  const phone = document.getElementById('google-phone-input').value.trim();
  if(!nick || !S.currentUser) return;
  const btn = document.getElementById('btn-google-nick-submit');
  btn.disabled = true;
  try{
    const existing = await getDoc(usernameDocRef(nick));
    if(existing.exists()){ alert('Tahle přezdívka je už obsazená, zkus jinou.'); btn.disabled = false; return; }
    await setDoc(usernameDocRef(nick), { uid: S.currentUser.uid, email: S.currentUser.email });
    await setDoc(doc(db, 'users', S.currentUser.uid), { nick, email: S.currentUser.email, phone, createdAt: new Date().toISOString(), lastLogin: new Date().toISOString() });
    S.currentNick = nick;
    appApi.updateAuthUI();
  }catch(err){ console.error(err); alert('Uložení přezdívky se nepovedlo. Zkus to znovu.'); }
  finally{ btn.disabled = false; }
});

document.getElementById('btn-logout').addEventListener('click', async () => { closeContactForm(); closeEventForm(); await signOut(auth); });

export function hasPasswordProvider(user){
  return user.providerData.some(p => p.providerId === 'password');
}

