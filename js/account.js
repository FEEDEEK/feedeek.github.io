// (vyjmuto z app.js, řádky 5153-5299)
import { S } from "./state.js";
import { getDoc, setDoc, deleteDoc, updateDoc, doc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, storage, auth } from "./firebase.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { EmailAuthProvider, reauthenticateWithCredential, reauthenticateWithPopup, GoogleAuthProvider, verifyBeforeUpdateEmail, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { appApi } from "./hooks.js";

document.getElementById('btn-toggle-nick').addEventListener('click', () => {
  const form = document.getElementById('form-change-nick');
  const opening = form.style.display === 'none';
  appApi.closeAllAccountPanels();
  if(opening){
    document.getElementById('new-nick-input').value = S.currentNick || '';
    form.style.display = 'flex';
  }
});
document.getElementById('btn-cancel-nick').addEventListener('click', () => {
  document.getElementById('form-change-nick').style.display = 'none';
});
document.getElementById('form-change-nick').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('nick-change-msg');
  const newNick = document.getElementById('new-nick-input').value.trim();
  if(!newNick || !S.currentUser) return;
  if(newNick.toLowerCase() === (S.currentNick||'').toLowerCase()){
    document.getElementById('form-change-nick').style.display = 'none';
    return;
  }
  msg.textContent = '';
  try{
    const existing = await getDoc(appApi.usernameDocRef(newNick));
    if(existing.exists()){ msg.textContent = 'Tahle přezdívka je už obsazená.'; return; }
    await setDoc(appApi.usernameDocRef(newNick), { uid: S.currentUser.uid, email: S.currentUser.email });
    await deleteDoc(appApi.usernameDocRef(S.currentNick));
    await updateDoc(doc(db,'users',S.currentUser.uid), { nick: newNick });
    S.currentNick = newNick;
    document.getElementById('form-change-nick').style.display = 'none';
    msg.textContent = '';
    appApi.updateAuthUI();
  }catch(err){ console.error(err); msg.textContent = 'Nepovedlo se — zkus to prosím znovu.'; }
});

// ---- Profilová fotka (avatar): nahrání přes Storage, rovnou po výběru souboru ----
document.getElementById('new-avatar-input').addEventListener('change', async (e) => {
  const msg = document.getElementById('avatar-change-msg');
  const file = e.target.files[0];
  if(!S.currentUser || !file) return;
  if(file.size > 5 * 1024 * 1024){ msg.textContent = 'Soubor je moc velký (max 5 MB).'; e.target.value = ''; return; }
  msg.textContent = 'Nahrávám...';
  try{
    const fileRef = ref(storage, `avatars/${S.currentUser.uid}`);
    await uploadBytes(fileRef, file);
    const url = await getDownloadURL(fileRef);
    await updateDoc(doc(db,'users',S.currentUser.uid), { avatar: url });
    S.currentAvatar = url;
    msg.textContent = 'Hotovo!';
    setTimeout(() => { msg.textContent = ''; }, 1500);
    appApi.updateAuthUI();
  }catch(err){ console.error(err); msg.textContent = 'Nahrání se nepovedlo — zkus to prosím znovu.'; }
  e.target.value = '';
});
document.getElementById('btn-remove-avatar').addEventListener('click', async () => {
  if(!S.currentUser) return;
  try{
    await updateDoc(doc(db,'users',S.currentUser.uid), { avatar: '' });
    S.currentAvatar = '';
    appApi.updateAuthUI();
  }catch(err){ console.error(err); }
});

// ---- Telefon: změna ----
document.getElementById('btn-toggle-phone').addEventListener('click', () => {
  const form = document.getElementById('form-change-phone');
  const opening = form.style.display === 'none';
  appApi.closeAllAccountPanels();
  if(opening){
    document.getElementById('new-phone-input').value = S.currentPhone || '';
    form.style.display = 'flex';
  }
});
document.getElementById('btn-cancel-phone').addEventListener('click', () => {
  document.getElementById('form-change-phone').style.display = 'none';
});
document.getElementById('form-change-phone').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('phone-change-msg');
  const newPhone = document.getElementById('new-phone-input').value.trim();
  if(!S.currentUser) return;
  msg.textContent = '';
  try{
    await updateDoc(doc(db,'users',S.currentUser.uid), { phone: newPhone });
    S.currentPhone = newPhone;
    document.getElementById('form-change-phone').style.display = 'none';
    appApi.updateAuthUI();
  }catch(err){ console.error(err); msg.textContent = 'Nepovedlo se — zkus to prosím znovu.'; }
});

// ---- E-mail: změna ----
document.getElementById('btn-toggle-email').addEventListener('click', () => {
  const form = document.getElementById('form-change-email');
  const opening = form.style.display === 'none';
  appApi.closeAllAccountPanels();
  if(opening) form.style.display = 'flex';
});
document.getElementById('btn-cancel-email').addEventListener('click', () => {
  document.getElementById('form-change-email').style.display = 'none';
});
document.getElementById('form-change-email').addEventListener('submit', async (e) => {
  e.preventDefault();
  if(!S.currentUser) return;
  const msg = document.getElementById('email-change-msg');
  const newEmail = document.getElementById('new-email').value.trim();
  if(!newEmail) return;
  msg.textContent = '';
  try{
    if(appApi.hasPasswordProvider(S.currentUser)){
      const pw = document.getElementById('reauth-password').value;
      const cred = EmailAuthProvider.credential(S.currentUser.email, pw);
      await reauthenticateWithCredential(S.currentUser, cred);
    }else{
      await reauthenticateWithPopup(S.currentUser, new GoogleAuthProvider());
    }
    await verifyBeforeUpdateEmail(S.currentUser, newEmail);
    msg.textContent = `Ověřovací odkaz byl odeslán na ${newEmail}. Po kliknutí na něj se e-mail změní.`;
  }catch(err){
    console.error(err);
    if(err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') msg.textContent = 'Nesprávné heslo.';
    else if(err.code === 'auth/email-already-in-use') msg.textContent = 'Tenhle e-mail už používá jiný účet.';
    else msg.textContent = 'Nepovedlo se — zkus to prosím znovu.';
  }
});

// ---- Heslo: potvrzovací panel ----
document.getElementById('btn-toggle-password').addEventListener('click', () => {
  const panel = document.getElementById('pw-reset-panel');
  const opening = panel.style.display === 'none';
  appApi.closeAllAccountPanels();
  if(opening){
    document.getElementById('pw-reset-target-email').textContent = S.currentUser?.email || '';
    panel.style.display = 'flex';
  }
});
document.getElementById('btn-cancel-password').addEventListener('click', () => {
  document.getElementById('pw-reset-panel').style.display = 'none';
  document.getElementById('pw-reset-msg').textContent = '';
});
document.getElementById('btn-change-password').addEventListener('click', async () => {
  if(!S.currentUser || !S.currentUser.email) return;
  const msg = document.getElementById('pw-reset-msg');
  try{
    await sendPasswordResetEmail(auth, S.currentUser.email);
    msg.textContent = `Odkaz pro změnu hesla byl odeslán na ${S.currentUser.email}.`;
  }catch(err){ console.error(err); msg.textContent = 'Nepovedlo se odeslat odkaz. Zkus to znovu.'; }
});
