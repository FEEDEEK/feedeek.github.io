// Jednorázově označí STÁVAJÍCÍ uživatele jako s ověřeným e-mailem.
// Nejdřív jen vypíše, koho by se to týkalo:   node verify-existing.js
// Potom to opravdu provede:                    node verify-existing.js --apply
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'lan-feedek' });

(async () => {
  const apply = process.argv.includes('--apply');
  let token, todo = [];
  do {
    const res = await admin.auth().listUsers(1000, token);
    res.users.forEach(u => { if (!u.emailVerified) todo.push(u); });
    token = res.pageToken;
  } while (token);
  console.log(`Neověřených účtů: ${todo.length}`);
  todo.forEach(u => console.log(' -', u.email || '(bez e-mailu)', u.uid));
  if (!apply) { console.log('\nNic se nezměnilo. Pro provedení spusť: node verify-existing.js --apply'); return; }
  for (const u of todo) await admin.auth().updateUser(u.uid, { emailVerified: true });
  console.log(`Hotovo, označeno ${todo.length} účtů jako ověřených.`);
})().catch(e => { console.error('CHYBA:', e.message); process.exit(1); });
