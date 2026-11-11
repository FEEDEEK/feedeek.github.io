// FEEDEEK – upozornění e-mailem na nový komentář k akci (Přehled, Rozvrh, Jídlo).
// Po vytvoření komentáře pošle e-mail všem přihlášeným na akci (kromě autora komentáře).
// Funkce e-maily jen zapíše do kolekce "mail", odesílá je rozšíření "Trigger Email from Firestore".
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
admin.initializeApp();

const REGION = 'europe-west9';                 // region Firestore databáze (Paříž)
const SITE_URL = 'https://feedeek.github.io/'; // adresa webu (s lomítkem na konci)

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function notify(event, partLabel) {
  const c = event.data && event.data.data();
  if (!c || !c.text) return;
  const db = admin.firestore();
  const eventId = event.params.eventId;

  const evSnap = await db.doc(`events/${eventId}`).get();
  if (!evSnap.exists) return;
  const ev = evSnap.data();

  const regs = await db.collection(`events/${eventId}/registrations`).get();
  const uids = regs.docs.map(d => d.id).filter(uid => uid !== c.uid);
  if (!uids.length) return;

  const userSnaps = await Promise.all(uids.map(uid => db.doc(`users/${uid}`).get()));
  const recipients = userSnaps
    .filter(s => s.exists && s.data().email)
    .map(s => ({ email: s.data().email, nick: s.data().nick || '' }));
  if (!recipients.length) return;

  const title = (ev.number ? ev.number + ' — ' : '') + (ev.name || 'akce');
  const author = c.author || 'Někdo';
  const link = `${SITE_URL}#event/${eventId}`;

  const batch = db.batch();
  recipients.forEach(r => {
    const text =
      `Ahoj feedere ${r.nick},\n\n` +
      `na webu FEEDEEK LAN přistál nový komentář od ${author} k akci ${title} v části ${partLabel}:\n\n` +
      `${c.text}\n\n` +
      `Odpovědět na webu: ${link}\n\n` +
      `Feedu zdar`;
    const html =
      `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;">` +
      `Ahoj feedere <b>${esc(r.nick)}</b>,<br><br>` +
      `na webu FEEDEEK LAN přistál nový komentář od <b>${esc(author)}</b> k akci <b>${esc(title)}</b> v části <b>${esc(partLabel)}</b>:<br><br>` +
      `<blockquote style="margin:0;padding:8px 14px;border-left:3px solid #c9a24b;background:#f6f3ea;">${esc(c.text).replace(/\n/g, '<br>')}</blockquote><br>` +
      `<a href="${link}">Odpovědět na webu</a><br><br>Feedu zdar</div>`;
    batch.set(db.collection('mail').doc(), {
      to: [r.email],
      message: { subject: `Nový komentář k akci: ${title} (${partLabel})`, text, html },
      createdBy: 'system-comment-notify',
      createdAt: new Date().toISOString()
    });
  });
  await batch.commit();
}

exports.notifyNewEventComment = onDocumentCreated(
  { document: 'events/{eventId}/comments/{commentId}', region: REGION },
  (event) => notify(event, 'Hlavní')
);
exports.notifyNewScheduleComment = onDocumentCreated(
  { document: 'events/{eventId}/scheduleComments/{commentId}', region: REGION },
  (event) => notify(event, 'Rozvrh')
);
exports.notifyNewFoodComment = onDocumentCreated(
  { document: 'events/{eventId}/foodComments/{commentId}', region: REGION },
  (event) => notify(event, 'Jídlo')
);


// ---------- Ověření e-mailu ----------
// Odkaz pro ověření se pošle z našeho Gmailu (přes kolekci "mail"), ne z obecné adresy Firebase – ta končí u Seznamu často ve filtru.
exports.sendVerificationMail = onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Přihlaš se.');
  const db = admin.firestore();
  const user = await admin.auth().getUser(req.auth.uid);
  if (!user.email) throw new HttpsError('failed-precondition', 'Účet nemá e-mail.');
  if (user.emailVerified) return { already: true };

  const ref = db.doc(`users/${req.auth.uid}`);
  const snap = await ref.get();
  const last = snap.exists ? Number(snap.data().verifyMailAt || 0) : 0;
  if (Date.now() - last < 60 * 1000) throw new HttpsError('resource-exhausted', 'Počkej minutu a zkus to znovu.');
  if (snap.exists) await ref.update({ verifyMailAt: Date.now() });

  const link = await admin.auth().generateEmailVerificationLink(user.email, { url: SITE_URL });
  const nick = snap.exists ? (snap.data().nick || '') : '';
  const text =
    `Ahoj feedere ${nick},\n\n` +
    `pro dokončení registrace na webu FEEDEEK LAN potvrď prosím svůj e-mail kliknutím na tento odkaz:\n\n${link}\n\n` +
    `Pokud ses neregistroval(a), nech tento e-mail být.\n\nFeedu zdar`;
  const html =
    `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;">Ahoj feedere <b>${esc(nick)}</b>,<br><br>` +
    `pro dokončení registrace na webu FEEDEEK LAN potvrď prosím svůj e-mail:<br><br>` +
    `<a href="${link}" style="display:inline-block;padding:10px 18px;background:#c9a24b;color:#14171f;text-decoration:none;font-weight:bold;">Potvrdit e-mail</a><br><br>` +
    `Pokud tlačítko nefunguje, otevři tento odkaz:<br><span style="font-size:12px;word-break:break-all;">${esc(link)}</span><br><br>` +
    `Pokud ses neregistroval(a), nech tento e-mail být.<br><br>Feedu zdar</div>`;
  await db.collection('mail').add({
    to: [user.email],
    message: { subject: 'Potvrď svůj e-mail na FEEDEEK LAN', text, html },
    createdBy: 'system-verify',
    createdAt: new Date().toISOString()
  });
  return { sent: true };
});

async function requireUsersAdmin(req) {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Přihlaš se.');
  const me = await admin.firestore().doc(`users/${req.auth.uid}`).get();
  const d = me.exists ? me.data() : {};
  const ok = d.isSuperAdmin === true || (d.isAdmin === true && d.permissions && d.permissions.uzivatele === true);
  if (!ok) throw new HttpsError('permission-denied', 'Na to nemáš oprávnění.');
}

// Seznam, kdo má ověřený e-mail (pro správu uživatelů)
exports.adminListVerification = onCall({ region: REGION }, async (req) => {
  await requireUsersAdmin(req);
  const out = {};
  let token;
  do {
    const res = await admin.auth().listUsers(1000, token);
    res.users.forEach(u => { out[u.uid] = u.emailVerified === true; });
    token = res.pageToken;
  } while (token);
  return { verified: out };
});

// Ruční ověření e-mailu jedním klikem
exports.adminVerifyUser = onCall({ region: REGION }, async (req) => {
  await requireUsersAdmin(req);
  const uid = req.data && req.data.uid;
  if (!uid || typeof uid !== 'string') throw new HttpsError('invalid-argument', 'Chybí uživatel.');
  await admin.auth().updateUser(uid, { emailVerified: true });
  return { ok: true };
});
