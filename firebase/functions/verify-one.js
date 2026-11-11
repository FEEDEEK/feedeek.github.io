// Ručně označí JEDEN účet jako ověřený (když mu potvrzovací e-mail nedorazí).
// Použití:  node verify-one.js jmeno@seznam.cz
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'lan-feedek' });
(async () => {
  const email = (process.argv[2] || '').trim();
  if (!email) { console.log('Zadej e-mail: node verify-one.js jmeno@seznam.cz'); return; }
  const u = await admin.auth().getUserByEmail(email);
  await admin.auth().updateUser(u.uid, { emailVerified: true });
  console.log('Hotovo, ověřeno:', u.email);
})().catch(e => { console.error('CHYBA:', e.message); process.exit(1); });
