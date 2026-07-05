/**
 * LE CLAM — Serveur Express
 *
 * Démarrage : node server.js  (ou: npm start)
 * Dev (auto-reload) : npm run dev
 *
 * Endpoints :
 *   GET  /api/products?category=plaisir|malin|bebe
 *   POST /api/orders
 *   POST /api/admin/products  (import manuel produits)
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });

const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
const crypto     = require('crypto');
const nodemailer = require('nodemailer');
const bcrypt     = require('bcryptjs');
const rateLimit  = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const webpush    = require('web-push');
const PDFDocument = require('pdfkit');

const BCRYPT_ROUNDS = 12;

/* ── VAPID (Web Push) ── */
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC  || 'BA-ReC5q3TOvyb7q4KVA7F89s-5_YQDBmIcBwp0DjVxc-Gnt_w15vchE3dWgdVD5CVseHmyUB4ZFONrXHoFm2sY';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE || null;
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails('mailto:contact@leclam.eu', VAPID_PUBLIC, VAPID_PRIVATE);
} else {
  console.warn('[VAPID] VAPID_PRIVATE non configuré — notifications push désactivées');
}

/* Informations légales du vendeur — utilisées sur les factures PDF */
const SELLER = {
  name:     process.env.SELLER_NAME     || 'Le Clam',
  address:  process.env.SELLER_ADDRESS  || 'À COMPLÉTER',
  zip:      process.env.SELLER_ZIP      || '',
  city:     process.env.SELLER_CITY     || '',
  country:  process.env.SELLER_COUNTRY  || 'France',
  siret:    process.env.SELLER_SIRET    || 'À COMPLÉTER',
  tvaIntra: process.env.SELLER_TVA_INTRA || 'À COMPLÉTER',
};

/* Durées de vie des tokens */
const ACCESS_TOKEN_TTL  = 2  * 60 * 60 * 1000;  // 2 heures
const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60 * 1000; // 30 jours

/* Stripe — chargé uniquement si STRIPE_SECRET_KEY est défini */
const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;

/* ─────────────────────────────────────────
   ANTI-ABUS PAIEMENT — limitation tentatives
   5 tentatives / 15 min par IP → blocage 15 min
   ───────────────────────────────────────── */
const _payAttempts   = new Map(); /* ip → { count, firstAt, blockedUntil } */
const _PAY_MAX       = 5;
const _PAY_WINDOW    = 15 * 60 * 1000;
const _PAY_LOCKOUT   = 15 * 60 * 1000;

function _checkPayLimit(ip) {
  const now = Date.now();
  const r   = _payAttempts.get(ip) || { count: 0, firstAt: now, blockedUntil: 0 };
  if (r.blockedUntil > now)
    return { ok: false, waitSec: Math.ceil((r.blockedUntil - now) / 1000) };
  if (now - r.firstAt > _PAY_WINDOW) {
    _payAttempts.set(ip, { count: 1, firstAt: now, blockedUntil: 0 });
    return { ok: true };
  }
  r.count++;
  if (r.count > _PAY_MAX) {
    r.blockedUntil = now + _PAY_LOCKOUT;
    writeLog && writeLog('security', { event: 'payment_rate_limit', ip, count: r.count });
    _payAttempts.set(ip, r);
    return { ok: false, waitSec: Math.ceil(_PAY_LOCKOUT / 1000) };
  }
  _payAttempts.set(ip, r);
  return { ok: true };
}

function _incPayFailure(ip) {
  const now = Date.now();
  const r   = _payAttempts.get(ip) || { count: 0, firstAt: now, blockedUntil: 0 };
  if (now - r.firstAt > _PAY_WINDOW) { _payAttempts.set(ip, { count: 1, firstAt: now, blockedUntil: 0 }); return; }
  r.count++;
  if (r.count >= _PAY_MAX) r.blockedUntil = now + _PAY_LOCKOUT;
  _payAttempts.set(ip, r);
}

function _releasePayLimit(ip) { _payAttempts.delete(ip); }

/* ─────────────────────────────────────────
   PERSISTANCE — ratings, tokens, users, orders
   ───────────────────────────────────────── */
const DATA_DIR        = path.join(__dirname, 'data');
const LOG_DIR         = path.join(DATA_DIR, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
const RATINGS_FILE    = path.join(DATA_DIR, 'ratings.json');
const TOKENS_FILE     = path.join(DATA_DIR, 'tokens.json');
const USERS_FILE      = path.join(DATA_DIR, 'users.json');
const ORDERS_FILE     = path.join(DATA_DIR, 'orders.json');
const MESSAGES_FILE   = path.join(DATA_DIR, 'messages.json');
const THREADS_FILE    = path.join(DATA_DIR, 'threads.json');
const SESSIONS_FILE     = path.join(DATA_DIR, 'sessions.json');
const MAINTENANCE_FILE  = path.join(DATA_DIR, 'maintenance.json');
const FLASH_SALES_FILE  = path.join(DATA_DIR, 'flash-sales.json');
const BUNDLES_FILE          = path.join(DATA_DIR, 'bundles.json');
const ABANDONED_CARTS_FILE  = path.join(DATA_DIR, 'abandoned-carts.json');
const REFERRALS_FILE        = path.join(DATA_DIR, 'referrals.json');
const BIRTHDAY_CODES_FILE   = path.join(DATA_DIR, 'birthday-codes.json');
const PUSH_SUBS_FILE        = path.join(DATA_DIR, 'push-subscriptions.json');
const INVOICES_FILE         = path.join(DATA_DIR, 'invoices.json');
const INVOICE_COUNTER_FILE  = path.join(DATA_DIR, 'invoice-counter.json');
const INVOICES_DIR          = path.join(DATA_DIR, 'invoices');
const PRODUCTS_OVERRIDES_FILE = path.join(DATA_DIR, 'products-overrides.json');
fs.mkdirSync(INVOICES_DIR, { recursive: true });
const AVOIRS_FILE           = path.join(DATA_DIR, 'avoirs.json');
const AVOIR_COUNTER_FILE    = path.join(DATA_DIR, 'avoir-counter.json');
const PP_PENDING_FILE       = path.join(DATA_DIR, 'paypal-pending.json');

function loadJSON(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let INVOICES  = loadJSON(INVOICES_FILE, []);
let AVOIRS    = loadJSON(AVOIRS_FILE, []);
function persistAvoirs() { saveJSON(AVOIRS_FILE, AVOIRS); }
let RATINGS   = loadJSON(RATINGS_FILE);
let TOKENS    = loadJSON(TOKENS_FILE);
let USERS     = loadJSON(USERS_FILE);   // { email -> { name, email, hash, salt, createdAt } }

/* ── Applique ADMIN_PASSWORD au démarrage si défini dans .env ── */
if (process.env.ADMIN_PASSWORD) {
  (async () => {
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, BCRYPT_ROUNDS);
    const ownerEmail = process.env.OWNER_EMAIL || 'admin@leclam.fr';
    /* Met à jour ou crée le compte owner */
    if (!USERS[ownerEmail]) {
      USERS[ownerEmail] = { name: 'Antoine', email: ownerEmail, role: 'owner', createdAt: new Date().toISOString() };
    }
    USERS[ownerEmail].hash = hash;
    delete USERS[ownerEmail].salt;
    /* Met à jour aussi admin@leclam.fr */
    if (USERS['admin@leclam.fr']) {
      USERS['admin@leclam.fr'].hash = hash;
      delete USERS['admin@leclam.fr'].salt;
    }
    saveJSON(USERS_FILE, USERS);
    console.log(`[AUTH] Mot de passe admin synchronisé depuis .env`);
  })();
}
let MESSAGES  = loadJSON(MESSAGES_FILE); // { email -> [{ id, type, title, text, read, createdAt, ... }] }
let THREADS   = loadJSON(THREADS_FILE, []); // [{ id, userId, userName, subject, status, priority, tags, createdAt, updatedAt, messages:[{id,from,text,at,readByAdmin,readByClient}] }]
/* Sessions persistées — les sessions expirées sont filtrées au démarrage */
const _now0 = Date.now();
const SESSIONS = Object.fromEntries(
  Object.entries(loadJSON(SESSIONS_FILE, {})).filter(([, v]) => v.expiresAt > _now0)
);
const REFRESH_TOKENS = {};  // { refreshToken -> { email, expiresAt } }

function persistRatings()  { saveJSON(RATINGS_FILE,  RATINGS);  }
function persistTokens()   { saveJSON(TOKENS_FILE,   TOKENS);   }
function persistUsers()    { saveJSON(USERS_FILE,    USERS);    }
function persistOrders()   { saveJSON(ORDERS_FILE,   orders);   }
function persistMessages() { saveJSON(MESSAGES_FILE, MESSAGES); }
function persistThreads()  { saveJSON(THREADS_FILE,  THREADS);  }
function persistSessions() { saveJSON(SESSIONS_FILE, SESSIONS); }

/* ── Maintenance ── */
let MAINTENANCE = loadJSON(MAINTENANCE_FILE, { active: false, message: '' });
function persistMaintenance() { saveJSON(MAINTENANCE_FILE, MAINTENANCE); }

/* ── Flash sales ── */
let FLASH_SALES = loadJSON(FLASH_SALES_FILE, []);
function persistFlashSales() { saveJSON(FLASH_SALES_FILE, FLASH_SALES); }

/* ── Bundles ── */
let BUNDLES = loadJSON(BUNDLES_FILE, []);
function persistBundles() { saveJSON(BUNDLES_FILE, BUNDLES); }

/* ── Paniers abandonnés ── { email -> { email, name, items, total, savedAt, reminderSentAt } } */
let ABANDONED_CARTS = loadJSON(ABANDONED_CARTS_FILE, {});
function persistAbandonedCarts() { saveJSON(ABANDONED_CARTS_FILE, ABANDONED_CARTS); }

/* ── Parrainage ── { code -> { ownerEmail, ownerName, uses:[{email,at}], createdAt } } */
let REFERRALS = loadJSON(REFERRALS_FILE, {});
function persistReferrals() { saveJSON(REFERRALS_FILE, REFERRALS); }

/* ── Codes anniversaire ── { email -> { code, sentAt, usedAt } } */
let BIRTHDAY_CODES = loadJSON(BIRTHDAY_CODES_FILE, {});
function persistBirthdayCodes() { saveJSON(BIRTHDAY_CODES_FILE, BIRTHDAY_CODES); }

/* ── Bons de réduction nominatifs ── { [CODE]: { amount, ownerEmail, expiresAt, usedAt, usedInOrder } }
   Couvre les bons PARRAIN/FILLEUL (parrainage) et ANNIV (anniversaire) */
const VOUCHERS_FILE = path.join(DATA_DIR, 'vouchers.json');
let VOUCHERS = loadJSON(VOUCHERS_FILE, {});
function persistVouchers() { saveJSON(VOUCHERS_FILE, VOUCHERS); }

/* ── Abonnements push ── { email -> [PushSubscription, …] } */
let PUSH_SUBS = loadJSON(PUSH_SUBS_FILE, {});
function persistPushSubs() { saveJSON(PUSH_SUBS_FILE, PUSH_SUBS); }

async function sendPushToUser(email, title, body, url) {
  const subs = PUSH_SUBS[email];
  if (!subs || !subs.length) return;
  const payload = JSON.stringify({ title, body, url: url || '/', icon: '/icons/icon-192.png' });
  const dead = [];
  await Promise.all(subs.map(async (sub, i) => {
    try { await webpush.sendNotification(sub, payload); }
    catch (e) {
      if (e.statusCode === 410 || e.statusCode === 404) dead.push(i); /* abonnement expiré */
    }
  }));
  if (dead.length) {
    PUSH_SUBS[email] = subs.filter((_, i) => !dead.includes(i));
    persistPushSubs();
  }
}

function generateReferralCode(name) {
  const slug = (name || 'clam').toLowerCase().replace(/[^a-z]/g, '').slice(0, 6) || 'clam';
  const rand  = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${slug.toUpperCase()}-${rand}`;
}
function generatePromoCode(prefix) {
  return `${prefix}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function addMessage(email, msg) {
  if (!MESSAGES[email]) MESSAGES[email] = [];
  MESSAGES[email].unshift({ ...msg, id: msg.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, read: false, createdAt: msg.createdAt || new Date().toISOString() });
  persistMessages();
  /* Enregistre automatiquement les bons nominatifs dans VOUCHERS pour validation au checkout */
  if (msg.type === 'promo' && msg.promoCode && msg.promoAmount) {
    const code = String(msg.promoCode).toUpperCase();
    if (!VOUCHERS[code]) {
      VOUCHERS[code] = { amount: Number(msg.promoAmount), ownerEmail: email, expiresAt: msg.expiresAt || null, usedAt: null, usedInOrder: null };
      persistVouchers();
    }
  }
}

/* Hachage legacy PBKDF2 — utilisé uniquement pour migrer les anciens comptes */
function _legacyHash(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

/* Vérifie un mot de passe — chaîne bcrypt → PBKDF2 (migration transparente) */
async function verifyPassword(password, user) {
  /* bcrypt */
  if (user.hash.startsWith('$2b$') || user.hash.startsWith('$2a$') || user.hash.startsWith('$argon2')) {
    if (user.hash.startsWith('$argon2')) return false; /* ancien compte argon2 — doit réinitialiser */
    return bcrypt.compare(password, user.hash);
  }
  /* PBKDF2 legacy — migration vers bcrypt */
  const legacy = _legacyHash(password, user.salt);
  if (legacy !== user.hash) return false;
  user.hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  delete user.salt;
  persistUsers();
  return true;
}

/* ─────────────────────────────────────────
   EMAIL — Envoi automatique au fournisseur
   Config via variables d'environnement :
     GMAIL_USER      = ton adresse Gmail
     GMAIL_PASS      = mot de passe d'application Gmail (pas ton vrai mdp)
                       → https://myaccount.google.com/apppasswords
     SUPPLIER_EMAIL  = email de ton fournisseur Alibaba
   ───────────────────────────────────────── */
const mailer = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

/* ─────────────────────────────────────────
   EMAIL — Confirmation client après commande
   ───────────────────────────────────────── */
async function sendOrderConfirmation(order) {
  if (!process.env.GMAIL_USER || !order.email) return;

  const lignes = order.items.map(i =>
    `  ${i.emoji || '📦'} ${i.name} x${i.qty}  →  ${(i.price * i.qty).toFixed(2)} €`
  ).join('\n');

  const shippingLine = order.shipping > 0
    ? `Livraison   : ${order.shipping.toFixed(2)} €\n`
    : `Livraison   : Offerte\n`;

  const domain = process.env.DOMAIN || `http://localhost:${process.env.PORT || 3000}`;

  const isPendingVirement = order.status === 'pending_virement';
  const isPendingCrypto   = order.status === 'pending_crypto';
  const isPending         = isPendingVirement || isPendingCrypto;

  const emailSubject = isPendingVirement
    ? `⏳ Commande reçue — en attente de virement — ${order.id}`
    : isPendingCrypto
      ? `⏳ Commande reçue — en attente de paiement crypto — ${order.id}`
      : `✅ Commande confirmée — ${order.id}`;

  const pendingNote = isPendingVirement
    ? `Votre commande est enregistrée. Elle sera préparée dès réception de votre virement (réf. : ${order.virementRef || order.id}).`
    : isPendingCrypto
      ? `Votre commande est enregistrée. Elle sera préparée dès confirmation de votre paiement crypto sur la blockchain.`
      : `Votre commande est en cours de préparation. Vous serez informé(e) dès son expédition.`;

  const pendingBannerText = isPending
    ? `⏳ En attente de paiement — nous préparerons votre commande dès réception.`
    : `ℹ️ Votre commande est en cours de préparation. Vous recevrez un email dès son expédition.`;
  const pendingBannerStyle = isPending
    ? `background:#fef3c7;border-radius:8px;padding:.85rem 1rem;font-size:.88rem;color:#92400e;margin:1rem 0`
    : `background:#dbeafe;border-radius:8px;padding:.85rem 1rem;font-size:.88rem;color:#1d4ed8;margin:1rem 0`;
  const headlineEmoji = isPending ? '⏳' : '✅';
  const headlineText  = isPending ? 'Commande reçue !' : 'Commande confirmée !';

  await mailer.sendMail({
    from:    `"Le Clam" <${process.env.GMAIL_USER}>`,
    to:      order.email,
    subject: emailSubject,
    text: `
Bonjour,

Merci pour votre commande sur Le Clam ! Voici votre récapitulatif :

──────────────────────────────
N° commande : ${order.id}
Date        : ${new Date(order.createdAt).toLocaleString('fr-FR')}
──────────────────────────────
ARTICLES :
${lignes}
──────────────────────────────
${shippingLine}TOTAL TTC   : ${order.total.toFixed(2)} €
──────────────────────────────

${pendingNote}

Suivez vos commandes sur : ${domain}/mes-commandes.html

Merci pour votre confiance,
L'équipe Le Clam
    `.trim(),
    html: `
<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:560px;margin:2rem auto;color:#222;line-height:1.6">
<div style="background:#3e2a14;padding:1.5rem 2rem;border-radius:12px 12px 0 0;text-align:center">
  <h1 style="color:#d9c4a0;margin:0;font-size:1.4rem;letter-spacing:.04em">Le Clam</h1>
</div>
<div style="border:1.5px solid #e8e0d4;border-top:none;border-radius:0 0 12px 12px;padding:2rem">
  <h2 style="color:#3e2a14;margin-top:0">${headlineEmoji} ${headlineText}</h2>
  <p>Bonjour,<br>Merci pour votre commande ! Voici votre récapitulatif.</p>
  <div style="background:#faf8f5;border-radius:10px;padding:1.2rem;margin:1.2rem 0;border:1px solid #e8e0d4;font-size:.88rem;color:#666">
    N° commande : <strong style="color:#1a1a1a">${order.id}</strong> &nbsp;·&nbsp;
    Date : <strong style="color:#1a1a1a">${new Date(order.createdAt).toLocaleDateString('fr-FR', { day:'numeric', month:'long', year:'numeric' })}</strong>
  </div>
  <div style="background:#faf8f5;border-radius:10px;padding:1.2rem;margin:1.2rem 0;border:1px solid #e8e0d4">
    <table style="width:100%;border-collapse:collapse;font-size:.92rem">
      ${order.items.map(i => `<tr>
        <td style="padding:.35rem 0">${i.emoji || '📦'} ${i.name} <span style="color:#999">×${i.qty}</span></td>
        <td style="text-align:right;font-weight:700">${(i.price * i.qty).toFixed(2)} €</td>
      </tr>`).join('')}
      ${order.shipping > 0 ? `<tr><td style="padding:.35rem 0;color:#666">Livraison</td><td style="text-align:right;color:#666">${order.shipping.toFixed(2)} €</td></tr>` : `<tr><td style="padding:.35rem 0;color:#16a34a">Livraison</td><td style="text-align:right;color:#16a34a">Offerte</td></tr>`}
      <tr style="border-top:1.5px solid #e8e0d4">
        <td style="padding:.5rem 0;font-weight:700">Total TTC</td>
        <td style="text-align:right;font-weight:700;font-size:1.05rem">${order.total.toFixed(2)} €</td>
      </tr>
    </table>
  </div>
  <p style="${pendingBannerStyle}">${pendingBannerText}</p>
  <div style="text-align:center;margin:1.5rem 0">
    <a href="${domain}/mes-commandes.html" style="display:inline-block;background:#3e2a14;color:#d9c4a0;text-decoration:none;padding:.75rem 2rem;border-radius:8px;font-weight:700">Suivre ma commande →</a>
  </div>
  <p style="color:#999;font-size:.85rem;margin:0">Des questions ? Contactez-nous via <a href="${domain}/messages.html" style="color:#3e2a14">notre messagerie</a>.</p>
</div>
</body></html>`,
  });

  console.log(`[EMAIL] Confirmation commande envoyée à ${order.email} — ${order.id}`);
}

/* ─────────────────────────────────────────
   EMAIL — Notification propriétaire à chaque nouvelle commande
   OWNER_EMAIL = gazou2004@gmail.com (ou variable d'env)
   ───────────────────────────────────────── */
async function notifyOwner(order) {
  const ownerEmail = process.env.OWNER_EMAIL || '';
  if (!process.env.GMAIL_USER || !ownerEmail) return;

  const lignes = order.items.map(i =>
    `  ${i.emoji || '📦'} ${i.name} x${i.qty}  →  ${(i.price * i.qty).toFixed(2)} €`
  ).join('\n');

  await mailer.sendMail({
    from:    `"Le Clam" <${process.env.GMAIL_USER}>`,
    to:      ownerEmail,
    subject: `🛒 Nouvelle commande — ${order.id} (${order.total.toFixed(2)} €)`,
    text: `
Nouvelle commande reçue sur Le Clam !

──────────────────────────────
N° commande : ${order.id}
Date        : ${new Date(order.createdAt).toLocaleString('fr-FR')}
Client      : ${order.email || 'non renseigné'}
──────────────────────────────
ARTICLES :
${lignes}
──────────────────────────────
Livraison   : ${order.shipping > 0 ? order.shipping.toFixed(2) + ' €' : 'Offerte'}
TOTAL TTC   : ${order.total.toFixed(2)} €
──────────────────────────────

Voir toutes les commandes : ${process.env.DOMAIN || 'http://localhost:3000'}/admin.html
    `.trim(),
  }).catch(err => console.error('[EMAIL] Erreur notifyOwner :', err.message));

  console.log(`[EMAIL] Notif propriétaire envoyée à ${ownerEmail} — ${order.id}`);
}

async function notifySupplier(order) {
  if (!process.env.GMAIL_USER || !process.env.SUPPLIER_EMAIL) return;

  const lignes = order.items.map(i =>
    `- ${i.name} x${i.qty}  →  ${(i.price * i.qty).toFixed(2)} €`
  ).join('\n');

  await mailer.sendMail({
    from:    `"Le Clam" <${process.env.GMAIL_USER}>`,
    to:      process.env.SUPPLIER_EMAIL,
    subject: `[Nouvelle commande] ${order.id} — ${order.total} €`,
    text: `
Bonjour,

Nouvelle commande reçue sur Le Clam. Merci de préparer l'expédition.

──────────────────────────────
N° commande : ${order.id}
Date        : ${new Date(order.createdAt).toLocaleString('fr-FR')}
Client      : ${order.email || 'non renseigné'}
──────────────────────────────
ARTICLES :
${lignes}
──────────────────────────────
TOTAL : ${order.total} €
──────────────────────────────

Merci,
Le Clam
    `.trim(),
  });

  console.log(`[EMAIL] Commande ${order.id} transmise à ${process.env.SUPPLIER_EMAIL}`);
}

/* ─────────────────────────────────────────
   EMAIL — Expédition / suivi de commande
   Envoyé quand le statut passe à "shipped"
   ───────────────────────────────────────── */
async function sendShippingEmail(order) {
  if (!process.env.GMAIL_USER || !order.email) return;
  const domain  = process.env.DOMAIN || `http://localhost:${process.env.PORT || 3000}`;
  const lignes  = order.items.map(i =>
    `  ${i.emoji || '📦'} ${i.name} ×${i.qty}  →  ${(i.price * i.qty).toFixed(2)} €`
  ).join('\n');
  const trackingText = order.trackingNumber
    ? `\nN° de suivi    : ${order.trackingNumber}\nSuivre le colis: https://www.17track.net/fr?nums=${encodeURIComponent(order.trackingNumber)}\n`
    : '';
  const trackingHtml = order.trackingNumber
    ? `<p>📍 <strong>N° de suivi :</strong> ${order.trackingNumber}<br>
       <a href="https://www.17track.net/fr?nums=${encodeURIComponent(order.trackingNumber)}" style="color:#c0392b;font-weight:700">Suivre mon colis →</a></p>`
    : '';

  await mailer.sendMail({
    from:    `"Le Clam" <${process.env.GMAIL_USER}>`,
    to:      order.email,
    subject: `📦 Votre commande ${order.id} est en route !`,
    text: `
Bonjour,

Bonne nouvelle ! Votre commande a été expédiée et est en chemin.

──────────────────────────────
N° commande : ${order.id}
──────────────────────────────
ARTICLES :
${lignes}
──────────────────────────────
TOTAL TTC   : ${order.total.toFixed(2)} €
──────────────────────────────
${trackingText}
Suivez votre commande : ${domain}/mes-commandes.html

Merci pour votre confiance,
L'équipe Le Clam
    `.trim(),
    html: `
<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:560px;margin:2rem auto;color:#222;line-height:1.6">
<div style="background:#3e2a14;padding:1.5rem 2rem;border-radius:12px 12px 0 0;text-align:center">
  <h1 style="color:#d9c4a0;margin:0;font-size:1.4rem;letter-spacing:.04em">Le Clam</h1>
</div>
<div style="border:1.5px solid #e8e0d4;border-top:none;border-radius:0 0 12px 12px;padding:2rem">
  <h2 style="color:#3e2a14;margin-top:0">📦 Votre commande est en route !</h2>
  <p>Bonjour,<br>Bonne nouvelle — votre commande <strong>${order.id}</strong> a été expédiée.</p>
  <div style="background:#faf8f5;border-radius:10px;padding:1.2rem;margin:1.2rem 0;border:1px solid #e8e0d4">
    <table style="width:100%;border-collapse:collapse;font-size:.92rem">
      ${order.items.map(i => `<tr>
        <td style="padding:.35rem 0">${i.emoji || '📦'} ${i.name} <span style="color:#999">×${i.qty}</span></td>
        <td style="text-align:right;font-weight:700">${(i.price * i.qty).toFixed(2)} €</td>
      </tr>`).join('')}
      <tr style="border-top:1.5px solid #e8e0d4">
        <td style="padding:.5rem 0;font-weight:700">Total TTC</td>
        <td style="text-align:right;font-weight:700;font-size:1.05rem">${order.total.toFixed(2)} €</td>
      </tr>
    </table>
  </div>
  ${trackingHtml}
  <div style="text-align:center;margin:1.5rem 0">
    <a href="${domain}/mes-commandes.html" style="display:inline-block;background:#3e2a14;color:#d9c4a0;text-decoration:none;padding:.75rem 2rem;border-radius:8px;font-weight:700">Suivre ma commande →</a>
  </div>
  <p style="color:#999;font-size:.85rem;margin:0">Des questions ? Contactez-nous via <a href="${domain}/messages.html" style="color:#3e2a14">notre messagerie</a>.</p>
</div>
</body></html>`,
  });
  console.log(`[EMAIL] Suivi expédition envoyé à ${order.email} — ${order.id}`);
}

/* ─────────────────────────────────────────
   EMAIL — Enquête de satisfaction post-livraison
   Appelée manuellement via POST /api/admin/orders/:id/deliver
   ou automatiquement si DELIVERY_DAYS est défini
   ───────────────────────────────────────── */
async function sendSatisfactionEmail(order) {
  if (!process.env.GMAIL_USER || !order.email) return;

  const domain = process.env.DOMAIN || `http://localhost:${process.env.PORT || 3000}`;

  // Générer un token unique par produit commandé
  const productLinks = order.items.map(item => {
    const token = crypto.randomBytes(20).toString('hex');
    TOKENS[token] = {
      orderId:   order.id,
      productId: item.id,
      productName: item.name,
      email:     order.email,
      used:      false,
      createdAt: new Date().toISOString(),
    };
    const url = `${domain}/avis.html?token=${token}`;
    return { name: item.name, emoji: item.emoji || '📦', url };
  });
  persistTokens();

  const lignes = productLinks.map(p =>
    `  ${p.emoji} ${p.name}\n     → ${p.url}`
  ).join('\n\n');

  await mailer.sendMail({
    from:    `"Le Clam" <${process.env.GMAIL_USER}>`,
    to:      order.email,
    subject: `Votre commande ${order.id} est arrivée — donnez votre avis ! ⭐`,
    text: `
Bonjour,

Votre commande est arrivée ! Nous espérons que vous êtes satisfait(e).

Prenez 30 secondes pour noter chaque article — cela aide les autres acheteurs :

${lignes}

Merci pour votre confiance,
L'équipe Le Clam
    `.trim(),
    html: `
<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:520px;margin:auto;color:#222">
<h2 style="color:#c0392b">⭐ Votre avis compte !</h2>
<p>Bonjour,<br>Votre commande <strong>${order.id}</strong> est arrivée. Comment s'est passée votre expérience ?</p>
<p>Notez chaque article en cliquant sur le lien correspondant :</p>
${productLinks.map(p => `
<div style="margin:16px 0;padding:12px 16px;border:1px solid #eee;border-radius:8px">
  <div style="font-weight:600">${p.emoji} ${p.name}</div>
  <a href="${p.url}" style="display:inline-block;margin-top:8px;padding:8px 18px;background:#c0392b;color:#fff;border-radius:20px;text-decoration:none;font-size:.9rem">Donner mon avis ★</a>
</div>`).join('')}
<p style="color:#888;font-size:.8rem;margin-top:24px">Chaque lien est personnel et utilisable une seule fois. Merci !</p>
</body></html>
    `.trim(),
  });

  console.log(`[EMAIL] Enquête satisfaction envoyée à ${order.email} pour commande ${order.id}`);
}

const app  = express();
const PORT = process.env.PORT || 3000;

/* ── Livereload (dev uniquement) ──────────────────────────────────────────
   Surveille public/ et server.js → rafraîchit le navigateur automatiquement.
   Actif seulement quand NODE_ENV !== 'production'.
   ──────────────────────────────────────────────────────────────────────── */
if (process.env.NODE_ENV !== 'production') {
  const livereload      = require('livereload');
  const connectLivereload = require('connect-livereload');
  const lrServer = livereload.createServer({ delay: 200 });
  lrServer.watch([
    path.join(__dirname, 'public'),
    path.join(__dirname, 'server.js'),
  ]);
  app.use(connectLivereload());
}

/* ─────────────────────────────────────────
   LOGS & MONITORING
   ───────────────────────────────────────── */

/* Écrit une ligne JSON dans data/logs/<type>-YYYY-MM-DD.log */
function writeLog(type, data) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const line  = JSON.stringify({ ts: new Date().toISOString(), ...data }) + '\n';
    fs.appendFileSync(path.join(LOG_DIR, `${type}-${today}.log`), line);
  } catch { /* ne jamais crasher sur un log */ }
}

/* Compteur de tentatives d'auth échouées par IP — alertes progressives */
const FAIL_COUNTER = {};
const FAIL_ALERT_LEVELS = [5, 10, 20, 50]; // alerte à chacun de ces seuils

function trackFailedAuth(ip) {
  if (!FAIL_COUNTER[ip]) FAIL_COUNTER[ip] = { count: 0, firstAt: Date.now() };
  FAIL_COUNTER[ip].count++;
  FAIL_COUNTER[ip].lastAt = Date.now();
  const count = FAIL_COUNTER[ip].count;
  writeLog('security', { event: 'auth_fail', ip, count });

  if (FAIL_ALERT_LEVELS.includes(count)) {
    const severity = count >= 20 ? '🚨🚨' : '🚨';
    const msg = `${severity} ${count} tentatives de connexion échouées depuis ${ip}`;
    console.error(`[SECURITY] ${msg}`);
    if (process.env.GMAIL_USER) {
      mailer.sendMail({
        from:    `"Le Clam Security" <${process.env.GMAIL_USER}>`,
        to:      process.env.OWNER_EMAIL || '',
        subject: `${severity} Alerte sécurité — ${count} tentatives suspectes`,
        text:    msg
          + `\n\nPremière tentative : ${new Date(FAIL_COUNTER[ip].firstAt).toLocaleString('fr-FR')}`
          + `\nDernière tentative : ${new Date(FAIL_COUNTER[ip].lastAt).toLocaleString('fr-FR')}`,
      }).catch(err => console.error('[EMAIL] Échec alerte sécu :', err.message));
    }
  }
}

/* Nettoyage du FAIL_COUNTER toutes les heures — évite la fuite mémoire en prod */
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000; // entrées inactives depuis > 1h
  let cleaned = 0;
  for (const ip of Object.keys(FAIL_COUNTER)) {
    if ((FAIL_COUNTER[ip].lastAt || 0) < cutoff) { delete FAIL_COUNTER[ip]; cleaned++; }
  }
  if (cleaned > 0) writeLog('access', { event: 'fail_counter_cleanup', removed: cleaned });
}, 60 * 60 * 1000);

/* Nettoyage de _payAttempts toutes les heures — évite la fuite mémoire */
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  let cleaned = 0;
  for (const [ip, rec] of _payAttempts) {
    if ((rec.firstAt || 0) < cutoff && (rec.blockedUntil || 0) < Date.now()) {
      _payAttempts.delete(ip); cleaned++;
    }
  }
  if (cleaned > 0) console.log(`[PAY] Nettoyage _payAttempts : ${cleaned} IP(s) supprimées`);
}, 60 * 60 * 1000);

/* Nettoyage des sessions expirées toutes les heures — évite la fuite disque dans sessions.json */
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const token of Object.keys(SESSIONS)) {
    if ((SESSIONS[token].expiresAt || 0) < now) { delete SESSIONS[token]; cleaned++; }
  }
  if (cleaned > 0) { persistSessions(); writeLog('access', { event: 'sessions_cleanup', removed: cleaned }); }
}, 60 * 60 * 1000);

/* Rotation des logs — supprime les fichiers de plus de 30 jours */
function rotateLogs() {
  try {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    let deleted = 0;
    for (const f of fs.readdirSync(LOG_DIR)) {
      const full = path.join(LOG_DIR, f);
      if (fs.statSync(full).mtimeMs < cutoff) { fs.unlinkSync(full); deleted++; }
    }
    if (deleted > 0) console.log(`[LOG] Rotation : ${deleted} fichier(s) supprimé(s)`);
  } catch (err) { console.error('[LOG] Erreur rotation :', err.message); }
}
/* Rotation au démarrage puis toutes les 24h */
rotateLogs();
setInterval(rotateLogs, 24 * 60 * 60 * 1000);

/* ─────────────────────────────────────────
   MIDDLEWARE STACK
   ───────────────────────────────────────── */

/* ── Redirection HTTPS (production uniquement) ── */
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    const proto = req.headers['x-forwarded-proto'] || (req.socket?.encrypted ? 'https' : 'http');
    if (proto !== 'https') return res.redirect(301, `https://${req.headers.host}${req.url}`);
  }
  next();
});

/* ── Logger HTTP ── */
app.use((req, res, next) => {
  const start = Date.now();
  const ip    = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
                || req.socket?.remoteAddress || '?';
  res.on('finish', () => {
    const ms   = Date.now() - start;
    const data = { method: req.method, path: req.path, status: res.statusCode, ms, ip };
    if (res.statusCode >= 500) {
      console.error(`[HTTP] ${req.method} ${req.path} ${res.statusCode} ${ms}ms — ${ip}`);
      writeLog('error', data);
    } else if (req.path.startsWith('/api/')) {
      writeLog('access', data);
    }
  });
  next();
});

/* CORS — en production : restreint à l'origine déclarée dans DOMAIN
   en développement : autorise localhost:3000 pour les tests */
const ALLOWED_ORIGINS = process.env.NODE_ENV === 'production'
  ? [process.env.DOMAIN].filter(Boolean)
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];

app.use(cors({
  origin: (origin, cb) => {
    /* Les requêtes same-origin (pas d'en-tête Origin) sont toujours autorisées */
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`Origine non autorisée : ${origin}`));
  },
  credentials: true,          // autorise l'envoi des cookies httpOnly
  methods: ['GET','POST','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-CSRF-Token'],
}));
/* ─────────────────────────────────────────
   STRIPE WEBHOOK — doit être avant express.json() pour recevoir le body brut
   Variable requise : STRIPE_WEBHOOK_SECRET (obtenu sur dashboard.stripe.com)
   ───────────────────────────────────────── */
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) return res.status(400).json({ error: 'Stripe non configuré' });

  const sig           = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[STRIPE WEBHOOK] STRIPE_WEBHOOK_SECRET manquant — webhook refusé');
    writeLog('security', { event: 'webhook_no_secret' });
    return res.status(500).json({ error: 'Configuration webhook manquante' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('[STRIPE WEBHOOK] Signature invalide :', err.message);
    writeLog('security', { event: 'webhook_bad_signature', error: err.message });
    return res.status(400).json({ error: 'Signature webhook invalide' });
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;

    /* Idempotence : commande déjà créée par le client → rien à faire */
    const existing = orders.find(o => o.paymentIntentId === pi.id);
    if (existing) {
      return res.json({ received: true });
    }

    /* Reconstruire la commande depuis les métadonnées du PI */
    const meta     = pi.metadata || {};
    const summary  = (meta.itemsSummary || '').split(',').filter(Boolean);
    const validatedItems = [];
    let subtotal = 0;
    for (const part of summary) {
      const sepIdx = part.lastIndexOf('x');
      if (sepIdx < 1) continue;
      const id  = part.slice(0, sepIdx);
      const qty = Math.max(1, parseInt(part.slice(sepIdx + 1)) || 1);
      let found = null;
      for (const prods of Object.values(PRODUCTS)) { found = prods.find(p => p.id === id); if (found) break; }
      if (!found) continue;
      validatedItems.push({ ...found, qty });
      subtotal += _effectivePrice(found.id, found.price) * qty;
    }

    const shipping      = (parseInt(meta.shippingCents) || 0) / 100;
    const discount      = (parseInt(meta.discountCents) || 0) / 100 || undefined;
    const shippingAddress = {
      rue:     meta.shippingRue     || '',
      zip:     meta.shippingZip     || '',
      city:    meta.shippingCity    || '',
      country: meta.shippingCountry || 'FR',
    };

    const order = {
      id:              `ORDER-${Date.now()}`,
      paymentIntentId: pi.id,
      paymentMethod:   'stripe_card',
      items:           validatedItems,
      total:           pi.amount / 100,
      shipping,
      discount,
      email:           meta.customerEmail || pi.receipt_email || '',
      shippingAddress,
      status:          'confirmed',
      createdAt:       new Date().toISOString(),
      source:          'stripe_webhook',
    };

    if (!order.items.length) {
      console.error('[STRIPE WEBHOOK] Impossible de reconstruire le panier pour PI :', pi.id);
      writeLog('error', { event: 'webhook_empty_cart', piId: pi.id, meta });
    }

    orders.push(order);
    persistOrders();
    writeLog('access', { event: 'order_confirmed_stripe_webhook', orderId: order.id, piId: pi.id, total: order.total });
    console.log(`[STRIPE WEBHOOK] Commande créée : ${order.id} — ${order.total}€`);

    notifyOwner(order).catch(err => console.error('[EMAIL] Webhook notif propriétaire :', err.message));
    notifySupplier(order).catch(err => console.error('[EMAIL] Webhook fournisseur :', err.message));
    sendOrderConfirmation(order).catch(err => console.error('[EMAIL] Webhook confirmation client :', err.message));
    createInvoice(order).catch(err => console.error('[INVOICE] Webhook :', err.message));
    if (meta.parrainCode && order.email) { _registerParrainUse(meta.parrainCode, order.email).catch(() => {}); _markVoucherUsed(meta.parrainCode, order.id); }
  }

  res.json({ received: true });
});

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

/* ── Rate limiting ── */
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Trop de tentatives. Réessayez dans 1 minute.' },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Trop de requêtes.' },
});
app.use('/api/', apiLimiter);

/* ── Headers de sécurité ── */
app.use((req, res, next) => {
  const isProd = process.env.NODE_ENV === 'production';

  /* Autorise le framing uniquement depuis la même origine (pour l'admin multi-panneaux) */
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  /* Empêche le MIME-sniffing : le navigateur respecte le Content-Type déclaré */
  res.setHeader('X-Content-Type-Options', 'nosniff');

  /* Pas de fuite de l'URL complète dans le Referer vers des sites tiers */
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  /* Isole le contexte de navigation (protection cross-origin leak, Spectre, etc.) */
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');

  /* Restreint l'accès aux APIs sensibles du navigateur */
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');

  /* HSTS — force HTTPS pour 1 an, incluant les sous-domaines
     preload uniquement en prod (nécessite une inscription sur hstspreload.org) */
  if (isProd) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  /* Content-Security-Policy — liste blanche stricte des sources autorisées
     'unsafe-inline' requis pour les scripts inline des pages HTML existantes ;
     à migrer vers des nonces si les pages sont refactorisées */
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://www.paypal.com https://www.paypalobjects.com https://js.stripe.com https://*.stripe.com https://accounts.google.com https://appleid.cdn-apple.com https://connect.facebook.net https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https: blob:",
    "connect-src 'self' https://api.zippopotam.us https://www.paypal.com https://api-m.paypal.com https://api.stripe.com https://*.stripe.com https://accounts.google.com https://appleid.apple.com",
    "frame-src 'self' https://www.paypal.com https://js.stripe.com https://hooks.stripe.com https://*.stripe.com https://accounts.google.com https://appleid.apple.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ];
  if (isProd) cspDirectives.push("upgrade-insecure-requests");
  res.setHeader('Content-Security-Policy', cspDirectives.join('; '));

  /* Empêche le cache navigateur sur les routes API (données sensibles) */
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
  }
  /* Pages de paiement : jamais mises en cache (CSP et clés peuvent changer) */
  if (req.path === '/paiement.html' || req.path === '/confirmation.html') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
  }

  next();
});

/* ── Helpers auth ── */
const COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'Strict',
  maxAge:   ACCESS_TOKEN_TTL,
};

const REFRESH_COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'Strict',
  maxAge:   REFRESH_TOKEN_TTL,
  path:     '/api/auth',
};

function createSession(user) {
  const token     = crypto.randomBytes(32).toString('hex');
  const csrfToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + ACCESS_TOKEN_TTL;
  SESSIONS[token] = { email: user.email, name: user.name, role: user.role || 'user', csrfToken, expiresAt };
  persistSessions();
  return { token, csrfToken, expiresAt };
}

function createRefreshToken(email) {
  const token = crypto.randomBytes(40).toString('hex');
  REFRESH_TOKENS[token] = { email, expiresAt: Date.now() + REFRESH_TOKEN_TTL };
  return token;
}

/* Lit la session depuis cookie httpOnly ou header Authorization (fallback) */
function getSession(req) {
  const now = Date.now();
  const cookieToken = req.cookies?.leclam_session;
  if (cookieToken && SESSIONS[cookieToken]) {
    const s = SESSIONS[cookieToken];
    if (s.expiresAt < now) { delete SESSIONS[cookieToken]; }
    else return s;
  }
  const bearerToken = req.headers['authorization']?.replace('Bearer ', '');
  if (bearerToken && SESSIONS[bearerToken]) {
    const s = SESSIONS[bearerToken];
    if (s.expiresAt < now) { delete SESSIONS[bearerToken]; }
    else return s;
  }
  return null;
}

/* Lit la clé admin depuis Authorization header uniquement (pas de query param — évite les fuites dans les logs) */
function getAdminKey(req) {
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  return '';
}
const VALID_ADMIN_KEY = () => process.env.ADMIN_KEY || 'changeme';

/* Vérifie la clé admin en temps constant (anti timing-attack) */
function isValidAdminKey(key) {
  if (!key || typeof key !== 'string') return false;
  const expected = Buffer.from(VALID_ADMIN_KEY());
  try {
    const provided = Buffer.from(key.slice(0, 512));
    if (provided.length !== expected.length) {
      crypto.timingSafeEqual(expected, expected); // dummy pour consommer le même temps
      return false;
    }
    return crypto.timingSafeEqual(expected, provided);
  } catch { return false; }
}

/* Vérifie si la requête a les droits admin (clé API ou session role=admin/owner) */
function isAdmin(req) {
  if (isValidAdminKey(getAdminKey(req))) return true;
  const session = getSession(req);
  return session?.role === 'admin' || session?.role === 'owner';
}

/* Comparaison CSRF en temps constant — évite les timing attacks */
function csrfValid(provided, expected) {
  if (!provided || !expected || provided.length !== expected.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected)); }
  catch { return false; }
}

/* Middleware CSRF — routes nécessitant une session active */
function requireCsrf(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ ok: false, error: 'Non connecté' });
  if (!csrfValid(req.headers['x-csrf-token'], session.csrfToken))
    return res.status(403).json({ ok: false, error: 'Token CSRF invalide' });
  next();
}

/* Middleware CSRF optionnel — vérifie seulement si l'utilisateur est connecté (guest checkout autorisé) */
function requireCsrfIfAuthenticated(req, res, next) {
  const session = getSession(req);
  if (!session) return next();
  if (!csrfValid(req.headers['x-csrf-token'], session.csrfToken))
    return res.status(403).json({ ok: false, error: 'Token CSRF invalide' });
  next();
}

/* Validation email — RFC 5321 simplifié : local@domain.tld (tld ≥ 2 chars, pas de points consécutifs) */
const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

/* Liste noire des mots de passe trop courants */
const WEAK_PASSWORDS = new Set([
  'password','12345678','123456789','motdepasse','password1','azerty123',
  'qwerty123','iloveyou','sunshine','princess','letmein','football',
  'welcome1','monkey123','dragon123','master123','pass1234','pass@1234',
]);

/* Valide la robustesse d'un mot de passe — retourne un message d'erreur ou null */
function validatePassword(password) {
  if (typeof password !== 'string') return 'Mot de passe invalide.';
  if (password.length < 8)   return 'Mot de passe trop court (8 caractères minimum).';
  if (password.length > 128) return 'Mot de passe trop long (128 caractères maximum).';
  if (WEAK_PASSWORDS.has(password.toLowerCase())) return 'Mot de passe trop courant. Choisissez-en un plus original.';
  if (!/[a-zA-Z]/.test(password)) return 'Le mot de passe doit contenir au moins une lettre.';
  if (!/[0-9!@#$%^&*()_+\-=\[\]{};\':"\\|,.<>\/?`~]/.test(password))
    return 'Le mot de passe doit contenir au moins un chiffre ou caractère spécial.';
  return null;
}

/* Nettoie et tronque une chaîne avant stockage */
function sanitize(val, maxLen = 500) {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

/* ─────────────────────────────────────────
   Mode maintenance
   ───────────────────────────────────────── */
const MAINTENANCE_BYPASS = [
  '/maintenance.html', '/api/maintenance',
  '/api/auth/login', '/api/auth/localhost', '/api/auth/me',
  '/css/', '/js/', '/images/', '/favicon',
];

app.use((req, res, next) => {
  if (!MAINTENANCE.active) return next();
  const isAdmin_ = isAdmin(req);
  if (isAdmin_) return next();
  const bypass = MAINTENANCE_BYPASS.some(p => req.path.startsWith(p));
  if (bypass) return next();
  if (req.path.endsWith('.html') || req.path === '/') {
    return res.redirect(302, '/maintenance.html');
  }
  if (req.path.startsWith('/api/')) {
    return res.status(503).json({ ok: false, error: 'Site en maintenance', maintenance: true });
  }
  next();
});

/** GET /api/maintenance — état public */
app.get('/api/maintenance', (req, res) => {
  res.json({ active: MAINTENANCE.active, message: MAINTENANCE.message || '' });
});

/** GET /api/bundles — packs actifs (public) */
app.get('/api/bundles', (req, res) => {
  res.json({ ok: true, bundles: BUNDLES.filter(b => b.active !== false) });
});

/** GET /api/admin/bundles — tous (admin) */
app.get('/api/admin/bundles', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Non autorisé' });
  res.json({ ok: true, bundles: BUNDLES });
});

/** POST /api/admin/bundles — créer (admin) */
app.post('/api/admin/bundles', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Non autorisé' });
  const { name, productIds, discount } = req.body;
  if (!name || !productIds?.length || !discount)
    return res.status(400).json({ ok: false, error: 'Champs manquants' });
  if (discount < 1 || discount > 80)
    return res.status(400).json({ ok: false, error: 'Remise invalide (1–80%)' });
  const bundle = { id: crypto.randomUUID(), name, productIds, discount: Number(discount), active: true, createdAt: new Date().toISOString() };
  BUNDLES.push(bundle);
  persistBundles();
  res.json({ ok: true, bundle });
});

/** PATCH /api/admin/bundles/:id — activer/désactiver (admin) */
app.patch('/api/admin/bundles/:id', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Non autorisé' });
  const b = BUNDLES.find(b => b.id === req.params.id);
  if (!b) return res.status(404).json({ ok: false, error: 'Introuvable' });
  if (typeof req.body.active === 'boolean') b.active = req.body.active;
  persistBundles();
  res.json({ ok: true, bundle: b });
});

/** DELETE /api/admin/bundles/:id — supprimer (admin) */
app.delete('/api/admin/bundles/:id', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Non autorisé' });
  const idx = BUNDLES.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'Introuvable' });
  BUNDLES.splice(idx, 1);
  persistBundles();
  res.json({ ok: true });
});

/* ─────────────────────────────────────────
   PANIERS ABANDONNÉS
   ───────────────────────────────────────── */

/** POST /api/cart/sync — le client synchronise son panier (si connecté) */
app.post('/api/cart/sync', (req, res) => {
  const session = getSession(req);
  if (!session) return res.json({ ok: false }); /* silencieux côté client */
  const { items, total } = req.body;
  if (!items || !Array.isArray(items)) return res.json({ ok: false });

  if (!items.length) {
    /* Panier vidé (après achat ou manuellement) */
    delete ABANDONED_CARTS[session.email];
    persistAbandonedCarts();
    return res.json({ ok: true });
  }

  const existing = ABANDONED_CARTS[session.email];
  ABANDONED_CARTS[session.email] = {
    email: session.email,
    name:  session.name || '',
    items,
    total: total || 0,
    savedAt: new Date().toISOString(),
    /* Réinitialise le flag relance si le panier a changé */
    reminderSentAt: (existing && existing.reminderSentAt && JSON.stringify(existing.items) === JSON.stringify(items))
      ? existing.reminderSentAt : null,
  };
  persistAbandonedCarts();
  res.json({ ok: true });
});

/** GET /api/admin/abandoned-carts — liste (admin) */
app.get('/api/admin/abandoned-carts', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Non autorisé' });
  const DELAY_H = 24;
  const cutoff  = Date.now() - DELAY_H * 3600000;
  const carts   = Object.values(ABANDONED_CARTS)
    .filter(c => new Date(c.savedAt).getTime() < cutoff)
    .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
  res.json({ ok: true, carts, total: Object.keys(ABANDONED_CARTS).length });
});

/* ─────────────────────────────────────────
   PARRAINAGE
   ───────────────────────────────────────── */

/** GET /api/referral/my-code — code de parrainage du compte connecté */
app.get('/api/referral/my-code', (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ ok: false, error: 'Non connecté' });
  const user = USERS[session.email];
  if (!user) return res.status(404).json({ ok: false, error: 'Compte introuvable' });

  /* Crée un code si le compte n'en a pas encore */
  if (!user.referralCode) {
    user.referralCode = generateReferralCode(user.name);
    persistUsers();
  }
  if (!REFERRALS[user.referralCode]) {
    REFERRALS[user.referralCode] = { ownerEmail: user.email, ownerName: user.name, uses: [], createdAt: new Date().toISOString() };
    persistReferrals();
  }
  const ref = REFERRALS[user.referralCode];
  res.json({ ok: true, code: user.referralCode, uses: ref.uses.length });
});

/** POST /api/referral/validate — valide un code parrain à l'inscription / au checkout */
app.post('/api/referral/validate', authLimiter, (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ ok: false, error: 'Code manquant' });
  const ref = REFERRALS[code.toUpperCase().trim()];
  if (!ref) return res.status(404).json({ ok: false, error: 'Code parrain invalide' });
  res.json({ ok: true, ownerName: ref.ownerName });
});

/** POST /api/referral/apply — appliqué à la création de commande (filleul utilise un code parrain) */
app.post('/api/referral/apply', requireCsrfIfAuthenticated, async (req, res) => {
  const session = getSession(req);
  const { code, orderEmail } = req.body;
  if (!code) return res.status(400).json({ ok: false, error: 'Code manquant' });

  const refCode = code.toUpperCase().trim();
  const ref = REFERRALS[refCode];
  if (!ref) return res.status(404).json({ ok: false, error: 'Code invalide' });

  const filleulEmail = session?.email || orderEmail;
  if (!filleulEmail) return res.status(400).json({ ok: false, error: 'Email requis' });
  if (ref.ownerEmail === filleulEmail) return res.status(400).json({ ok: false, error: 'Vous ne pouvez pas utiliser votre propre code.' });

  /* Empêcher le double usage */
  if (ref.uses.find(u => u.email === filleulEmail))
    return res.status(409).json({ ok: false, error: 'Ce code a déjà été utilisé par ce compte.' });

  ref.uses.push({ email: filleulEmail, at: new Date().toISOString() });
  persistReferrals();

  /* Génère un bon de -5 € pour le filleul */
  const filleulCode = generatePromoCode('PARRAIN');
  if (!USERS[filleulEmail]) {
    /* compte invité — on stocke le bon dans un message si le compte est créé plus tard */
  }
  addMessage(filleulEmail, { type: 'promo', title: '🎁 Bon de réduction parrainage', text: `Merci d'être venu via le code parrain de ${ref.ownerName} ! Voici votre bon de -5 € : **${filleulCode}** (valable 30 jours)`, promoCode: filleulCode, promoAmount: 5, expiresAt: new Date(Date.now() + 30*24*3600*1000).toISOString() });

  /* Génère un bon de -5 € pour le parrain */
  const parrainCode = generatePromoCode('FILLEUL');
  addMessage(ref.ownerEmail, { type: 'promo', title: '🎉 Quelqu’un a utilisé votre code parrain !', text: `${filleulEmail} a commandé grâce à votre lien. Voici votre bon de -5 € : **${parrainCode}** (valable 30 jours)`, promoCode: parrainCode, promoAmount: 5, expiresAt: new Date(Date.now() + 30*24*3600*1000).toISOString() });

  /* Envoie un email au parrain si possible */
  sendReferralEmail(ref.ownerEmail, ref.ownerName, filleulEmail, parrainCode).catch(() => {});

  res.json({ ok: true, filleulCode, discount: 5 });
});

/** Retourne le montant du discount parrain (0 si code invalide/propre code) */
function _parrainDiscountAmount(code, email) {
  if (!code) return 0;
  const ref = REFERRALS[String(code).toUpperCase().trim()];
  if (!ref) return 0;
  if (email && ref.ownerEmail === email) return 0;
  if (email && ref.uses.find(u => u.email === email)) return 0; /* code déjà utilisé par ce client */
  return 5;
}

/** Valide un bon PARRAIN/FILLEUL/ANNIV stocké dans VOUCHERS */
function _voucherDiscountAmount(code, email) {
  if (!code) return 0;
  const v = VOUCHERS[String(code).toUpperCase().trim()];
  if (!v) return 0;
  if (v.usedAt) return 0;
  if (v.expiresAt && Date.now() > new Date(v.expiresAt).getTime()) return 0;
  if (v.ownerEmail && email && v.ownerEmail !== email) return 0;
  return v.amount;
}

/** Marque un bon comme utilisé après confirmation de paiement */
function _markVoucherUsed(code, orderId) {
  if (!code) return;
  const v = VOUCHERS[String(code).toUpperCase().trim()];
  if (!v || v.usedAt) return;
  v.usedAt = new Date().toISOString();
  v.usedInOrder = orderId;
  persistVouchers();
}

/** Retourne le prix effectif d'un produit en tenant compte des flash sales actives */
function _effectivePrice(productId, basePrice) {
  const now = Date.now();
  const sale = FLASH_SALES.find(f =>
    Array.isArray(f.productIds) && f.productIds.includes(productId) &&
    new Date(f.start).getTime() <= now && new Date(f.end).getTime() > now
  );
  return sale ? Math.round(basePrice * (1 - sale.discount / 100) * 100) / 100 : basePrice;
}

/** Enregistre l'usage du code parrain et génère les bons filleul + parrain */
async function _registerParrainUse(code, filleulEmail) {
  if (!code || !filleulEmail) return;
  const ref = REFERRALS[String(code).toUpperCase().trim()];
  if (!ref || ref.ownerEmail === filleulEmail) return;
  if (ref.uses.find(u => u.email === filleulEmail)) return;
  ref.uses.push({ email: filleulEmail, at: new Date().toISOString() });
  persistReferrals();
  const filleulCode = generatePromoCode('PARRAIN');
  addMessage(filleulEmail, { type: 'promo', title: '🎁 Bon de réduction parrainage', text: `Merci d'être venu via le code de ${ref.ownerName} ! Votre bon de −5 € : **${filleulCode}** (valable 30 jours)`, promoCode: filleulCode, promoAmount: 5, expiresAt: new Date(Date.now() + 30*24*3600e3).toISOString() });
  const pcCode = generatePromoCode('FILLEUL');
  addMessage(ref.ownerEmail, { type: 'promo', title: '🎉 Votre code parrain a été utilisé !', text: `${filleulEmail} a commandé grâce à votre lien. Votre bon de −5 € : **${pcCode}** (valable 30 jours)`, promoCode: pcCode, promoAmount: 5, expiresAt: new Date(Date.now() + 30*24*3600e3).toISOString() });
  sendReferralEmail(ref.ownerEmail, ref.ownerName, filleulEmail, pcCode).catch(() => {});
}

/** GET /api/admin/referrals — stats parrainage (admin) */
app.get('/api/admin/referrals', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Non autorisé' });
  const list = Object.entries(REFERRALS).map(([code, ref]) => ({
    code, ownerEmail: ref.ownerEmail, ownerName: ref.ownerName, uses: ref.uses.length, createdAt: ref.createdAt,
  })).sort((a, b) => b.uses - a.uses);
  res.json({ ok: true, referrals: list });
});

async function sendReferralEmail(toEmail, toName, filleulEmail, promoCode) {
  if (!process.env.GMAIL_USER) return;
  const domain = process.env.DOMAIN || `http://localhost:${process.env.PORT || 3000}`;
  await mailer.sendMail({
    from:    `"Le Clam" <${process.env.GMAIL_USER}>`,
    to:      toEmail,
    subject: '🎉 Votre filleul a commandé sur Le Clam !',
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Georgia,serif;background:#f5f0e8;margin:0;padding:2rem">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(62,42,20,.1)">
  <div style="background:#3e2a14;padding:1.5rem 2rem;text-align:center"><div style="color:#d9c4a0;font-size:1.5rem;font-weight:700;letter-spacing:2px">LE CLAM</div></div>
  <div style="padding:2rem">
    <p style="font-size:1.1rem;color:#3e2a14;font-weight:700;margin:0 0 .5rem">Bonne nouvelle, ${toName || ''} ! 🎉</p>
    <p style="color:#666;margin:0 0 1.5rem">${filleulEmail} vient de passer sa première commande grâce à votre code parrain. En récompense, voici votre bon de réduction :</p>
    <div style="background:#f5f0e8;border-radius:12px;padding:1.2rem;text-align:center;margin:1rem 0">
      <div style="font-size:.8rem;color:#888;margin-bottom:.3rem">Votre code promo</div>
      <div style="font-size:1.6rem;font-weight:900;color:#3e2a14;letter-spacing:2px">${promoCode}</div>
      <div style="font-size:.82rem;color:#a0856a;margin-top:.3rem">−5 € sur votre prochaine commande · valable 30 jours</div>
    </div>
    <div style="text-align:center;margin-top:1.5rem"><a href="${domain}/paiement.html" style="display:inline-block;background:#3e2a14;color:#d9c4a0;text-decoration:none;padding:.85rem 2.2rem;border-radius:50px;font-weight:700;font-size:.95rem">Utiliser mon bon →</a></div>
  </div>
  <div style="background:#f5f0e8;padding:1rem 2rem;text-align:center;font-size:.75rem;color:#999">Le Clam · <a href="${domain}" style="color:#a0856a">Visiter la boutique</a></div>
</div></body></html>`,
  });
}

/* Email de relance panier abandonné */
async function sendAbandonedCartEmail(cart) {
  if (!process.env.GMAIL_USER || !cart.email) return;
  const domain = process.env.DOMAIN || `http://localhost:${process.env.PORT || 3000}`;
  const lignes = cart.items.map(i => `  ${i.emoji||'📦'} ${i.name} x${i.qty} — ${(i.price*i.qty).toFixed(2)} €`).join('\n');

  await mailer.sendMail({
    from:    `"Le Clam" <${process.env.GMAIL_USER}>`,
    to:      cart.email,
    subject: '🛒 Vous avez oublié quelque chose !',
    text: `Bonjour ${cart.name || ''},\n\nVous avez laissé des articles dans votre panier Le Clam :\n\n${lignes}\n\nTotal : ${cart.total.toFixed(2)} €\n\nRetrouvez votre panier et finalisez votre commande :\n${domain}/paiement.html\n\nÀ bientôt,\nL'équipe Le Clam`,
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Georgia,serif;background:#f5f0e8;margin:0;padding:2rem">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(62,42,20,.1)">
  <div style="background:#3e2a14;padding:1.5rem 2rem;text-align:center">
    <div style="color:#d9c4a0;font-size:1.5rem;font-weight:700;letter-spacing:2px">LE CLAM</div>
  </div>
  <div style="padding:2rem">
    <p style="font-size:1.1rem;color:#3e2a14;font-weight:700;margin:0 0 .5rem">Votre panier vous attend 🛒</p>
    <p style="color:#666;margin:0 0 1.5rem">Bonjour ${cart.name||''},<br>Vous avez laissé des articles dans votre panier :</p>
    ${cart.items.map(i=>`<div style="display:flex;justify-content:space-between;padding:.6rem 0;border-bottom:1px solid #f0ebe3;font-size:.9rem"><span>${i.emoji||'📦'} ${i.name} <span style="color:#bbb">x${i.qty}</span></span><span style="font-weight:700">${(i.price*i.qty).toFixed(2)} €</span></div>`).join('')}
    <div style="display:flex;justify-content:space-between;padding:.8rem 0;font-weight:700;font-size:1rem;color:#3e2a14;border-top:2px solid #d9c4a0;margin-top:.3rem"><span>Total</span><span>${cart.total.toFixed(2)} €</span></div>
    <div style="text-align:center;margin-top:1.5rem">
      <a href="${domain}/paiement.html" style="display:inline-block;background:#3e2a14;color:#d9c4a0;text-decoration:none;padding:.85rem 2.2rem;border-radius:50px;font-weight:700;font-size:.95rem">Finaliser ma commande →</a>
    </div>
  </div>
  <div style="background:#f5f0e8;padding:1rem 2rem;text-align:center;font-size:.75rem;color:#999">Vous recevez cet email car vous avez un compte Le Clam.<br><a href="${domain}/index.html" style="color:#a0856a">Visiter la boutique</a></div>
</div></body></html>`,
  });
}

/* Job automatique — toutes les heures, relance les paniers >24h non relancés */
const ABANDON_DELAY_H = 24;
setInterval(async () => {
  const cutoff = Date.now() - ABANDON_DELAY_H * 3600000;
  for (const cart of Object.values(ABANDONED_CARTS)) {
    if (!cart.items?.length) continue;
    if (cart.reminderSentAt) continue;
    if (new Date(cart.savedAt).getTime() > cutoff) continue;
    try {
      await sendAbandonedCartEmail(cart);
      cart.reminderSentAt = new Date().toISOString();
      writeLog('email', { event: 'abandoned_cart_reminder', email: cart.email });
    } catch (e) { console.error('[PANIER ABANDONNÉ] Erreur email:', e.message); }
  }
  persistAbandonedCarts();
}, 60 * 60 * 1000); /* toutes les heures */

/* ─────────────────────────────────────────
   ANNIVERSAIRE
   ───────────────────────────────────────── */

/** PATCH /api/profile/birthday — enregistre ou met à jour la date de naissance */
app.patch('/api/profile/birthday', requireCsrfIfAuthenticated, (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ ok: false, error: 'Non connecté' });
  const { birthday } = req.body;
  if (!birthday || !/^\d{4}-\d{2}-\d{2}$/.test(birthday) || isNaN(Date.parse(birthday)))
    return res.status(400).json({ ok: false, error: 'Date invalide (format YYYY-MM-DD).' });
  const user = USERS[session.email];
  if (!user) return res.status(404).json({ ok: false, error: 'Compte introuvable.' });
  user.birthday = birthday;
  persistUsers();
  res.json({ ok: true });
});

async function sendBirthdayEmail(user, promoCode) {
  if (!process.env.GMAIL_USER) return;
  const domain = process.env.DOMAIN || `http://localhost:${process.env.PORT || 3000}`;
  await mailer.sendMail({
    from:    `"Le Clam" <${process.env.GMAIL_USER}>`,
    to:      user.email,
    subject: '🎂 Joyeux anniversaire ! Un cadeau vous attend',
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Georgia,serif;background:#f5f0e8;margin:0;padding:2rem">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(62,42,20,.1)">
  <div style="background:#3e2a14;padding:1.5rem 2rem;text-align:center"><div style="color:#d9c4a0;font-size:1.5rem;font-weight:700;letter-spacing:2px">LE CLAM</div></div>
  <div style="padding:2rem;text-align:center">
    <div style="font-size:3rem;margin-bottom:.8rem">🎂</div>
    <p style="font-size:1.2rem;color:#3e2a14;font-weight:700;margin:0 0 .5rem">Joyeux anniversaire, ${user.name?.split(' ')[0] || ''} !</p>
    <p style="color:#666;margin:0 0 1.5rem">Toute l'équipe Le Clam vous souhaite un très beau jour.<br>En cadeau, voici votre bon de réduction :</p>
    <div style="background:#f5f0e8;border-radius:12px;padding:1.4rem;margin:0 auto 1.5rem;max-width:280px">
      <div style="font-size:.78rem;color:#888;margin-bottom:.3rem">Votre code anniversaire</div>
      <div style="font-size:1.7rem;font-weight:900;color:#3e2a14;letter-spacing:3px">${promoCode}</div>
      <div style="font-size:.78rem;color:#a0856a;margin-top:.3rem">−10 € sur votre prochaine commande · valable 15 jours</div>
    </div>
    <a href="${domain}/paiement.html" style="display:inline-block;background:#3e2a14;color:#d9c4a0;text-decoration:none;padding:.85rem 2.2rem;border-radius:50px;font-weight:700;font-size:.95rem">Utiliser mon cadeau →</a>
  </div>
  <div style="background:#f5f0e8;padding:1rem 2rem;text-align:center;font-size:.75rem;color:#999">Le Clam · <a href="${domain}" style="color:#a0856a">Visiter la boutique</a></div>
</div></body></html>`,
  });
}

/* Job anniversaire — tourne une fois par jour à minuit */
function runBirthdayJob() {
  const today = new Date();
  const mmdd  = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  for (const user of Object.values(USERS)) {
    if (!user.birthday || !user.email) continue;
    const userMmdd = user.birthday.slice(5); /* YYYY-MM-DD → MM-DD */
    if (userMmdd !== mmdd) continue;

    /* Déjà envoyé cette année ? */
    const existing = BIRTHDAY_CODES[user.email];
    const thisYear = String(today.getFullYear());
    if (existing && existing.sentAt?.startsWith(thisYear)) continue;

    const code = generatePromoCode('ANNIV');
    BIRTHDAY_CODES[user.email] = { code, sentAt: new Date().toISOString() };
    persistBirthdayCodes();

    addMessage(user.email, { type: 'promo', title: '🎂 Joyeux anniversaire !', text: `Voici votre cadeau : code **${code}** − −10 € sur votre prochaine commande, valable 15 jours.`, promoCode: code, promoAmount: 10, expiresAt: new Date(Date.now() + 15*24*3600*1000).toISOString() });
    sendBirthdayEmail(user, code).catch(e => console.error('[ANNIV] Email échec:', e.message));
    console.log(`[ANNIV] Cadeau envoyé à ${user.email}`);
  }
}

/* Planification quotidienne : première exécution à la prochaine heure ronde, puis toutes les 24h */
const _msToNextHour = (60 - new Date().getMinutes()) * 60 * 1000;
setTimeout(() => {
  runBirthdayJob();
  setInterval(runBirthdayJob, 24 * 60 * 60 * 1000);
}, _msToNextHour);

/* ─────────────────────────────────────────
   NOTIFICATIONS PUSH
   ───────────────────────────────────────── */

/** GET /api/push/vapid-public — clé publique VAPID pour le client */
app.get('/api/push/vapid-public', (req, res) => {
  res.json({ ok: true, publicKey: VAPID_PUBLIC });
});

/** POST /api/push/subscribe — enregistre un abonnement */
app.post('/api/push/subscribe', requireCsrfIfAuthenticated, (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ ok: false, error: 'Non connecté' });
  const { subscription } = req.body;
  if (!subscription?.endpoint) return res.status(400).json({ ok: false, error: 'Abonnement invalide' });

  if (!PUSH_SUBS[session.email]) PUSH_SUBS[session.email] = [];
  const already = PUSH_SUBS[session.email].find(s => s.endpoint === subscription.endpoint);
  if (!already) {
    PUSH_SUBS[session.email].push(subscription);
    persistPushSubs();
  }
  res.json({ ok: true });
});

/** DELETE /api/push/unsubscribe — retire un abonnement */
app.delete('/api/push/unsubscribe', requireCsrfIfAuthenticated, (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ ok: false, error: 'Non connecté' });
  const { endpoint } = req.body;
  if (PUSH_SUBS[session.email]) {
    PUSH_SUBS[session.email] = PUSH_SUBS[session.email].filter(s => s.endpoint !== endpoint);
    persistPushSubs();
  }
  res.json({ ok: true });
});

/** GET /api/flash-sales — ventes flash actives (public) */
app.get('/api/flash-sales', (req, res) => {
  const now    = Date.now();
  const active = FLASH_SALES.filter(f => new Date(f.start).getTime() <= now && new Date(f.end).getTime() > now);
  res.json({ ok: true, sales: active });
});

/** GET /api/admin/flash-sales — toutes (admin) */
app.get('/api/admin/flash-sales', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Non autorisé' });
  res.json({ ok: true, sales: FLASH_SALES });
});

/** POST /api/admin/flash-sales — créer (admin) */
app.post('/api/admin/flash-sales', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Non autorisé' });
  const { name, productIds, discount, start, end } = req.body;
  if (!name || !productIds?.length || !discount || !start || !end)
    return res.status(400).json({ ok: false, error: 'Champs manquants' });
  if (discount < 1 || discount > 90)
    return res.status(400).json({ ok: false, error: 'Remise invalide (1–90%)' });
  const sale = { id: crypto.randomUUID(), name, productIds, discount: Number(discount), start, end, createdAt: new Date().toISOString() };
  FLASH_SALES.push(sale);
  persistFlashSales();
  res.json({ ok: true, sale });
});

/** DELETE /api/admin/flash-sales/:id — supprimer (admin) */
app.delete('/api/admin/flash-sales/:id', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Non autorisé' });
  const idx = FLASH_SALES.findIndex(f => f.id === req.params.id);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'Introuvable' });
  FLASH_SALES.splice(idx, 1);
  persistFlashSales();
  res.json({ ok: true });
});

/** POST /api/admin/maintenance — activer/désactiver (admin) */
app.post('/api/admin/maintenance', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Non autorisé' });
  const { active, message } = req.body;
  if (typeof active === 'boolean') MAINTENANCE.active = active;
  if (typeof message === 'string') MAINTENANCE.message = message.slice(0, 300);
  persistMaintenance();
  res.json({ ok: true, maintenance: MAINTENANCE });
});

/* ─────────────────────────────────────────
   Protection pages réservées admin/owner
   ───────────────────────────────────────── */
const ADMIN_ONLY_PAGES = [
  '/admin.html', '/tva.html', '/frais-paiement.html',
  '/fournisseur.html', '/admin-messages.html', '/promo.html',
  '/logos.html', '/export-colors.html', '/reset-orders.html',
  '/poppers.html', '/corbeille.html', '/flash-sales.html', '/bundle-creator.html',
  '/remises.html', '/referrals-admin.html', '/analytics.html', '/transport.html',
];
app.get(ADMIN_ONLY_PAGES, (req, res, next) => {
  const session = getSession(req);
  if (session && ['admin', 'owner'].includes(session.role)) return next();

  /* Auto-login depuis localhost (dev) — crée une session sans mot de passe */
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
             || req.socket?.remoteAddress || '';
  const isLocal = ['127.0.0.1', '::1', '::ffff:127.0.0.1', ''].includes(ip);
  if (isLocal) {
    const owner = Object.values(USERS).find(u => u.role === 'owner')
               || Object.values(USERS).find(u => u.role === 'admin');
    if (owner) {
      const { token } = createSession(owner);
      const refreshToken = createRefreshToken(owner.email);
      res.cookie('leclam_session', token, COOKIE_OPTS);
      res.cookie('leclam_refresh', refreshToken, REFRESH_COOKIE_OPTS);
      return next();
    }
  }

  return res.redirect(302, '/login.html?redirect=' + encodeURIComponent(req.path));
});

/* ─────────────────────────────────────────
   Locale URL routing : /fr/page.html → serve page.html + cookie hint
   ───────────────────────────────────────── */
const _LOCALE_PREFIXES = ['fr', 'en', 'es', 'de', 'it'];
app.use((req, res, next) => {
  const parts = req.path.split('/').filter(Boolean);
  if (parts.length >= 1 && _LOCALE_PREFIXES.includes(parts[0])) {
    const locale   = parts[0];
    const restPath = '/' + parts.slice(1).join('/');
    res.cookie('leclam_lang_hint', locale, { maxAge: 3600000, httpOnly: false, sameSite: 'lax' });
    req.url = restPath || '/index.html';
  }
  next();
});

/* ─────────────────────────────────────────
   Fichiers statiques (HTML, CSS, JS)
   ───────────────────────────────────────── */
app.get(['/lc-icon.svg', '/lc-favicon.svg'], (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Content-Type', 'image/svg+xml');
  res.sendFile(path.join(__dirname, 'public', 'lc-favicon.svg'));
});
app.use('/data', (req, res) => res.status(403).json({ error: 'Interdit' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ─────────────────────────────────────────
   DONNÉES PRODUITS (mock)
   En production : remplacer par appels API DSers / base de données
   ───────────────────────────────────────── */
const PRODUCTS = {

  plaisir: [
    { id: 'plaisir-1',  name: '3 Plug Anal Acier Inoxydable',                          emoji: '💜', price: 19.90,  oldPrice: 24.90, badge: 'Promo',  tags: ['lots'],                stock: 99, weightG: 750  },
    { id: 'plaisir-2',  name: 'Kit de Contrainte BDSM',                                emoji: '💜', price: 34.90,  oldPrice: null,  badge: null,    tags: ['lots'],                stock: 99, weightG: 280  },
    { id: 'plaisir-3',  name: 'Masseur Baguette Puissant',                             emoji: '💜', price: 27.90,  oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 450  },
    { id: 'plaisir-4',  name: 'Mini Baguette de Massage',                              emoji: '💜', price: 16.90,  oldPrice: 22.90, badge: 'Promo', tags: ['soloclub','petitprix'],stock: 99, weightG: 180  },
    { id: 'plaisir-5',  name: 'Plug Anal Électrique Silicone',                         emoji: '💜', price: 29.90,  oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 350  },
    { id: 'plaisir-6',  name: 'Stimulateur Sexuel Rose',                               emoji: '💜', price: 21.90,  oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 900  },
    { id: 'plaisir-7',  name: 'Stimulation Clitoridienne',                             emoji: '💜', price: 24.90,  oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 220  },
    { id: 'plaisir-8',  name: 'Vibrateur Tête de Lapin',                               emoji: '💜', price: 32.90,  oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 280  },
    { id: 'plaisir-9',  name: 'Vibrateur Portable Télécommande',                       emoji: '💜', price: 37.90,  oldPrice: null,  badge: null,    tags: ['soloclub','duo'],      stock: 99, weightG: 150  },
    { id: 'plaisir-10', name: 'Vibromasseur Culotte Point G',                          emoji: '💜', price: 26.90,  oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 130  },
    { id: 'plaisir-11', name: 'Masturbateur Masculin Électrique',                      emoji: '💜', price: 23.90,  oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 380  },
    { id: 'plaisir-22', name: 'Duet Bullet Vibrator by Je Joue',                       emoji: '💜', price: 85.00,  oldPrice: null,  badge: null,    tags: ['indispensable'],       stock: 99, weightG: 95   },
    { id: 'plaisir-23', name: 'MIO — Anneau pénien vibrant par Je Joue',               emoji: '💜', price: 132.00, oldPrice: null,  badge: null,    tags: ['duo'],                 stock: 99, weightG: 120  },
    { id: 'plaisir-24', name: 'Personal Massager',                                     emoji: '💜', price: 50.00,  oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 190  },
    { id: 'plaisir-25', name: 'Vibrating Diamond Noir — Édition 10e anniversaire',     emoji: '💜', price: 50.00,  oldPrice: null,  badge: null,    tags: ['indispensable'],       stock: 99, weightG: 75   },
    { id: 'plaisir-26', name: 'KAI The Dual Dildo & Clitoral Vibrator',                emoji: '💜', price: 84.99,  oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 260  },
    { id: 'plaisir-27', name: 'JESSE Clitoral Suction Vibrator',                       emoji: '💜', price: 81.99,  oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 210  },
    { id: 'plaisir-28', name: 'PULSE SOLO ESSENTIAL — Masturbateur vibrant pour pénis',emoji: '💜', price: 119.99, oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 490  },
    { id: 'plaisir-29', name: 'PleX with Flex — Plug anal vibrant télécommandé',       emoji: '💜', price: 99.95,  oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 310  },
    { id: 'plaisir-30', name: 'Pucker Up Purple — Stimulateur Clitoridien',            emoji: '💜', price: 12.00,  oldPrice: 18.00, badge: 'Promo', tags: ['soloclub','petitprix'],stock: 99, weightG: 85   },
    { id: 'plaisir-31', name: 'Love Nest Pink Remote Rechargeable Love Egg',           emoji: '💜', price: 47.00,  oldPrice: null,  badge: null,    tags: ['soloclub','duo'],      stock: 99, weightG: 110  },
    { id: 'plaisir-32', name: 'Womanizer Pro Lilac — Clitoral Suction Stimulator',     emoji: '💜', price: 45.00,  oldPrice: null,  badge: null,    tags: ['indispensable'],       stock: 99, weightG: 175  },
    { id: 'plaisir-33', name: 'We-Vibe Touch X — Rechargeable Clitoral Vibrator',      emoji: '💜', price: 100.00, oldPrice: null,  badge: null,    tags: ['indispensable'],       stock: 99, weightG: 240  },
    { id: 'plaisir-34', name: 'Lovehoney Red Silicone Mini Wand Vibrator',             emoji: '💜', price: 37.00,  oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 145  },
    { id: 'plaisir-35', name: 'Fifty Shades of Grey Black Rose — Clitoral Suction Stimulator', emoji: '💜', price: 55.00, oldPrice: null, badge: null, tags: ['soloclub'],     stock: 99, weightG: 160  },
    { id: 'plaisir-36', name: 'SONA 3 CRUISE — Stimulateur clitoridien',               emoji: '💜', price: 135.20, oldPrice: null,  badge: null,    tags: ['indispensable'],       stock: 99, weightG: 295  },
    { id: 'plaisir-37', name: 'ENIGMA DOUBLE SONIC — Sextoy Point G',                  emoji: '💜', price: 247.79, oldPrice: null,  badge: null,    tags: ['indispensable'],       stock: 99, weightG: 380  },
    { id: 'plaisir-38', name: 'TIANI DUO — Sextoys pour couple',                       emoji: '💜', price: 145.27, oldPrice: null,  badge: null,    tags: ['duo'],                 stock: 99, weightG: 165  },
    { id: 'plaisir-39', name: 'SONA — Stimulateur clitoridien',                        emoji: '💜', price: 89.00,  oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 200  },
    { id: 'plaisir-40', name: 'INA 3 — Sextoy Rabbit',                                emoji: '💜', price: 179.00, oldPrice: null,  badge: null,    tags: ['indispensable'],       stock: 99, weightG: 320  },
    { id: 'plaisir-41', name: 'F2S — Masturbateur Homme',                              emoji: '💜', price: 149.25, oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 580  },
    { id: 'plaisir-42', name: 'AMORELIE Joy Shake Vibrateur lapin',                    emoji: '💜', price: 29.99,  oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 185  },
    { id: 'plaisir-43', name: 'AMORELIE Joy x Satisfyer Flicker',                      emoji: '💜', price: 34.99,  oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 135  },
    { id: 'plaisir-44', name: 'Easy Choice — Ensemble vibrateurs de couple + lubrifiant',emoji: '💜', price: 44.99, oldPrice: null, badge: null,    tags: ['duo','lots'],          stock: 99, weightG: 280  },
    { id: 'plaisir-45', name: 'AMORELIE Joy Fly — Plug anal avec vibration',           emoji: '💜', price: 19.99,  oldPrice: null,  badge: null,    tags: ['soloclub','petitprix'],stock: 99, weightG: 105  },
    { id: 'plaisir-46', name: 'EasyToys Diamant S Analplug',                           emoji: '💜', price: 8.99,   oldPrice: null,  badge: null,    tags: ['petitprix'],           stock: 99, weightG: 65   },
    { id: 'plaisir-47', name: 'EasyToys Argent S Plug anal en métal',                  emoji: '💜', price: 11.99,  oldPrice: null,  badge: null,    tags: ['petitprix'],           stock: 99, weightG: 95   },
    { id: 'plaisir-48', name: 'EasyToys Mini Vibrateur Mural — Noir',                  emoji: '💜', price: 24.99,  oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 155  },
    { id: 'plaisir-49', name: 'Real Fantasy — Mason Gode vibrant, chaud',              emoji: '💜', price: 54.99,  oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 430  },
    { id: 'plaisir-50', name: 'AMORELIE Oh to Go 2.0 — Oeuf vibro avec télécommande', emoji: '💜', price: 49.99,  oldPrice: null,  badge: null,    tags: ['soloclub','duo'],      stock: 99, weightG: 125  },
    { id: 'plaisir-51', name: 'Womanizer Pro — Vibrateur à ondes de pression',         emoji: '💜', price: 39.99,  oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 170  },
    { id: 'plaisir-52', name: 'EasyToys Spitzer S Plug anal',                          emoji: '💜', price: 7.99,   oldPrice: null,  badge: null,    tags: ['petitprix'],           stock: 99, weightG: 80   },
    { id: 'plaisir-53', name: 'EasyToys Jelly Passion Vibrateur réaliste',             emoji: '💜', price: 19.99,  oldPrice: null,  badge: null,    tags: ['soloclub','petitprix'],stock: 99, weightG: 220  },
    { id: 'plaisir-54', name: 'Real Fantasy Dylan — Dildo réaliste 23cm',              emoji: '💜', price: 24.99,  oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 310  },
    { id: 'plaisir-55', name: 'Gode EasyToys Realist',                                emoji: '💜', price: 19.99,  oldPrice: null,  badge: null,    tags: ['soloclub','petitprix'],stock: 99, weightG: 245  },
    { id: 'plaisir-56', name: 'SVAKOM Sam Neo 2 — Masturbateur interactif',            emoji: '💜', price: 71.99,  oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 520  },
    { id: 'plaisir-57', name: "AMORELIE Joy Shimmer — Boules d'amour connectées",      emoji: '💜', price: 39.99,  oldPrice: null,  badge: null,    tags: ['soloclub','duo'],      stock: 99, weightG: 115  },
    { id: 'plaisir-58', name: 'SVAKOM Evil Elva — Oeuf vibrant avec télécommande',     emoji: '💜', price: 54.99,  oldPrice: null,  badge: null,    tags: ['soloclub','duo'],      stock: 99, weightG: 100  },
    { id: 'plaisir-59', name: 'Wonderlove — Oeuf Vibrant Double Stimulation',          emoji: '💜', price: 99.99,  oldPrice: null,  badge: null,    tags: ['duo'],                 stock: 99, weightG: 120  },
    { id: 'plaisir-60', name: 'Wonderlover — Oeuf Vibrant',                            emoji: '💜', price: 149.99, oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 140  },
    { id: 'plaisir-61', name: 'Coco — Vibromasseur Puissante',                         emoji: '💜', price: 119.00, oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 350  },
    { id: 'plaisir-62', name: 'Mini Coco — Stimulateur Clitoridien',                   emoji: '💜', price: 89.00,  oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 185  },
    { id: 'plaisir-63', name: 'Toupie — Vibromasseur Clitoridien Puissante',           emoji: '💜', price: 59.00,  oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 160  },
    { id: 'plaisir-64', name: 'DINO — Vibromasseur Point G avec Succion',              emoji: '💜', price: 99.00,  oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 230  },
    { id: 'plaisir-65', name: 'JUNO — Vibromasseur pour Couples',                      emoji: '💜', price: 109.00, oldPrice: null,  badge: null,    tags: ['duo'],                 stock: 99, weightG: 280  },
    { id: 'plaisir-66', name: 'SEXTRA — Vibromasseur Chauffant',                       emoji: '💜', price: 79.00,  oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 290  },
    { id: 'plaisir-67', name: 'SELENE — Vibromasseur Soie du Corbeau',                 emoji: '💜', price: 44.00,  oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 95   },
    { id: 'plaisir-68', name: 'Gesha Therapy — Boules de Geisha',                      emoji: '💜', price: 39.00,  oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 110  },
    { id: 'plaisir-69', name: 'Swap — Stimulateur Clitoridien & Vibromasseur',         emoji: '💜', price: 69.99,  oldPrice: null,  badge: null,    tags: ['duo'],                 stock: 99, weightG: 175  },
    { id: 'plaisir-70', name: 'Witty — Vibromasseur Double Stimulation',               emoji: '💜', price: 64.99,  oldPrice: null,  badge: null,    tags: ['duo'],                 stock: 99, weightG: 195  },
    { id: 'plaisir-71', name: 'Touch Me — Stimulateur Clitoridien',                    emoji: '💜', price: 29.99,  oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 80   },
    { id: 'plaisir-72', name: 'Itsy Bitsy — Mini Wand',                                emoji: '💜', price: 39.99,  oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 175  },
    { id: 'plaisir-73', name: 'Secret Panty 2 — Culotte Vibrante',                     emoji: '💜', price: 59.99,  oldPrice: null,  badge: null,    tags: ['duo'],                 stock: 99, weightG: 130  },
    { id: 'plaisir-74', name: 'Please Me — Masturbateur & Vibromasseur',               emoji: '💜', price: 69.99,  oldPrice: null,  badge: null,    tags: ['duo'],                 stock: 99, weightG: 145  },
    { id: 'plaisir-75', name: 'Twinny Bud — Plug Anal Vibrant',                        emoji: '💜', price: 39.99,  oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 90   },
    { id: 'plaisir-76', name: 'Bing Bang — Chapelet Anal',                             emoji: '💜', price: 12.99,  oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 60   },
    { id: 'plaisir-77', name: 'BONAI 8 Piles AAA Rechargeables 1100 mAh',             emoji: '🔋', price: 11.99,  oldPrice: null,  badge: null,    tags: ['indispensable'],       stock: 99, weightG: 100  },
    { id: 'plaisir-78', name: 'BONAI Chargeur Piles Universel 8 Slots',               emoji: '🔋', price: 25.99,  oldPrice: null,  badge: null,    tags: ['indispensable'],       stock: 99, weightG: 200  },
    { id: 'plaisir-79', name: 'BONAI Lot 2 Piles AA + 2 AAA avec Chargeur',           emoji: '🔋', price: 12.99,  oldPrice: null,  badge: null,    tags: ['indispensable'],       stock: 99, weightG: 150  },
    { id: 'plaisir-80', name: 'BONAI 8 Piles AA Rechargeables 2800 mAh',              emoji: '🔋', price: 15.99,  oldPrice: null,  badge: null,    tags: ['indispensable'],       stock: 99, weightG: 160  },
    { id: 'plaisir-81', name: 'Satisfyer INTENSE — Air Pulse Vibrator',                emoji: '💜', price: 38.95,  oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 130  },
    { id: 'plaisir-82', name: 'BOOTIE FEM — Analplug pour Femme',                      emoji: '💜', price: 12.95,  oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 80   },
    { id: 'plaisir-83', name: 'CHARME — Auflegevibrator Clitoridien',                  emoji: '💜', price: 29.95,  oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 100  },
    { id: 'plaisir-84', name: 'VIM — Wand Vibrant Flexible',                           emoji: '💜', price: 66.95,  oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 200  },
    { id: 'plaisir-85', name: 'MANTA — Vibrateur Pénis Premium',                       emoji: '💜', price: 48.95,  oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 150  },
    { id: 'plaisir-86', name: 'MAGNUM — Dildo Silicone',                               emoji: '💜', price: 33.95,  oldPrice: null,  badge: null,    tags: ['soloclub'],            stock: 99, weightG: 120  },
  ],

  malin: [
    { id: 'malin-24', name: 'Presse-Fruits Portable — 10 lames USB',      emoji: '🍹', price: 9.79,  oldPrice: 13.99, badge: 'Promo', tags: ['maison'], stock: 99, weightG: 450,  img: '/malin/imgs/malin-24.jpg' },
    { id: 'malin-25', name: 'Fer à Repasser Vapeur — 1500W',              emoji: '👔', price: 20.06, oldPrice: null,  badge: null,    tags: ['maison'], stock: 99, weightG: 1200, img: '/malin/imgs/malin-25.jpg' },
    { id: 'malin-26', name: 'Ensemble Balai & Pelle Magnétique 2-en-1',   emoji: '🧹', price: 1.96,  oldPrice: null,  badge: null,    tags: ['maison'], stock: 99, weightG: 320,  img: '/malin/imgs/malin-26.jpg' },
    { id: 'malin-27', name: '16 Flacons de Voyage Silicone Rechargeables',emoji: '🧴', price: 0.92,  oldPrice: null,  badge: null,    tags: ['maison'], stock: 99, weightG: 85,   img: '/malin/imgs/malin-27.jpg' },
  ],

  bebe: [
    { id: 'bebe-1',  name: 'Jouet Éducatif 3 en 1',                          emoji: '🧒', price: 16.90, oldPrice: 21.90, badge: 'Promo', tags: ['jouets'],            stock: 99, weightG: 80   },
    { id: 'bebe-2',  name: 'Livre Calme Tout-Petits',                        emoji: '📚', price: 13.90, oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 350  },
    { id: 'bebe-3',  name: 'Puzzle Magnétique Bois',                         emoji: '🧩', price: 21.90, oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 120  },
    { id: 'bebe-8',  name: 'Blocs de construction éducatifs — 130 pièces',   emoji: '🧱', price: 24.90, oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 1400 },
    { id: 'bebe-9',  name: 'Formes géométriques en bois Montessori',         emoji: '🔷', price: 19.90, oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 650  },
    { id: 'bebe-10', name: "Vélo d'équilibre Boso — Aluminium",              emoji: '🚲', price: 49.90, oldPrice: null,  badge: null,    tags: ['mobilite'],          stock: 99, weightG: 4800 },
    { id: 'bebe-28', name: 'Pingouin Musical Rampant',                       emoji: '🐧', price: 8.01,  oldPrice: 11.99, badge: 'Promo', tags: ['jouets'],            stock: 99, weightG: 280  },
    { id: 'bebe-29', name: 'Jouets Cuisine — Simulation Dessert',            emoji: '🍰', price: 3.29,  oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 200  },
    { id: 'bebe-30', name: "Ensemble de Thé Après-Midi en Bois",             emoji: '🍵', price: 4.99,  oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 320  },
    { id: 'bebe-31', name: 'Jouet Grille-Pain en Bois',                      emoji: '🍞', price: 8.04,  oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 450  },
    { id: 'bebe-32', name: 'Service à Thé en Bois — Wooden Tea Set 15 pcs', emoji: '🍵', price: 7.39,  oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 380  },
    { id: 'bebe-33', name: 'Ensemble Jouets Cuisine — 59 pièces',            emoji: '🍳', price: 5.49,  oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 480  },
    { id: 'bebe-34', name: 'Tasse de Paille en Silicone Bébé',               emoji: '🥤', price: 0.99,  oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 60   },
    { id: 'bebe-35', name: 'BiSantos — Sucette Silicone Nouveau-Né',         emoji: '🍼', price: 0.99,  oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 20   },
    { id: 'bebe-36', name: 'Jouet Crabe Électronique',                       emoji: '🦀', price: 8.69,  oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 180  },
    { id: 'bebe-37', name: 'Moniteur Bébé WiFi 4MP — 360°',                  emoji: '📷', price: 20.19, oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 350  },
    { id: 'bebe-38', name: 'Anneau Dentition Fleur Bois CAJA',               emoji: '🌸', price: 8.00,  oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 45   },
    { id: 'bebe-39', name: 'Anneau Dentition Réfrigérant Suavinex',          emoji: '❄️', price: 6.49,  oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 55   },
    { id: 'bebe-40', name: 'Anneau Dentition Étoile Silicone',               emoji: '⭐', price: 0.99,  oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 30   },
    { id: 'bebe-41', name: 'Cartes Cognitives Françaises Enfants',           emoji: '🃏', price: 4.99,  oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 120  },
    { id: 'bebe-42', name: 'Crayons Doigts 3D Sécurité Maternelle',          emoji: '✏️', price: 3.69,  oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 90   },
    { id: 'bebe-43', name: 'Jouet Dentition Dinosaure Silicone',             emoji: '🦕', price: 0.99,  oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 35   },
    { id: 'bebe-44', name: 'Lot 8 Assiettes Bol Silicone Sevrage',           emoji: '🍽️', price: 17.99, oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 420  },
    { id: 'bebe-45', name: "Lunii Ma Fabrique à Histoires",                  emoji: '📖', price: 69.90, oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 380  },
    { id: 'bebe-46', name: 'Mon Petit Morphée Boîte Histoires',              emoji: '🌙', price: 72.11, oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 260  },
    { id: 'bebe-47', name: 'Set Alimentation Silicone BPA Free',             emoji: '🥄', price: 3.79,  oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 50   },
    { id: 'bebe-48', name: 'Veilleuse Baleine Pabobo Aqua Dream',            emoji: '🐋', price: 44.26, oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 480  },
    { id: 'bebe-70', name: 'Hochet Sensoriel Balle Loyzico',                 emoji: '🎾', price: 9.02,  oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 80   },
    { id: 'bebe-71', name: 'Oball Balle Flexible Bright Starts',             emoji: '🎾', price: 7.09,  oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 65   },
    { id: 'bebe-72', name: 'Jouet Bain Pieuvre Nuby',                        emoji: '🐙', price: 9.99,  oldPrice: null,  badge: null,    tags: ['bain','jouets'],     stock: 99, weightG: 220  },
    { id: 'bebe-73', name: 'Croc Dentiste Hasbro',                           emoji: '🐊', price: 16.08, oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 310  },
    { id: 'bebe-74', name: 'Bouée Natation Bébé Thedttoy',                   emoji: '🏊', price: 22.79, oldPrice: null,  badge: null,    tags: ['bain'],              stock: 99, weightG: 500  },
    { id: 'bebe-75', name: 'Minuterie Visuelle GeeRic',                      emoji: '⏱️', price: 9.98,  oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 150  },
    { id: 'bebe-76', name: 'Livre Miroir Bébé Vicloon',                      emoji: '📚', price: 11.99, oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 130  },
    { id: 'bebe-77', name: 'Jouet Ventouse Montessori AiTuiTui',             emoji: '🧩', price: 17.99, oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 200  },
    { id: 'bebe-78', name: 'Cube Manipulation Bébé Ludi',                    emoji: '🎲', price: 12.99, oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 270  },
    { id: 'bebe-79', name: 'Trieur Formes Sensoriel Bébé',                   emoji: '🔷', price: 19.99, oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 240  },
    { id: 'bebe-80', name: 'Jeu Pêche Magnétique Bois',                      emoji: '🎣', price: 11.99, oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 180  },
    { id: 'bebe-81', name: 'Jouet 4en1 Bus Montessori Sundaymot',            emoji: '🚌', price: 15.69, oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 350  },
    { id: 'bebe-82', name: "Coffret Bain VTech Empilo Rigol'Eau",            emoji: '🛁', price: 12.99, oldPrice: null,  badge: null,    tags: ['bain'],              stock: 99, weightG: 290  },
    { id: 'bebe-83', name: 'Spirale Activités Poussette Nuby',               emoji: '🌀', price: 14.99, oldPrice: null,  badge: null,    tags: ['mobilite'],          stock: 99, weightG: 110  },
    { id: 'bebe-84', name: 'Jouet 5en1 Montessori Almaxi',                   emoji: '🧩', price: 37.04, oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 420  },
    { id: 'bebe-85', name: 'Busy Board Ferme Montessori Almaxi',             emoji: '🐄', price: 20.99, oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 280  },
    { id: 'bebe-86', name: 'Porte-bébé Ergonomique Momcozy',                 emoji: '👶', price: 61.00, oldPrice: null,  badge: null,    tags: ['mobilite'],          stock: 99, weightG: 480  },
    { id: 'bebe-87', name: 'Bouteille Flottante Sensorielle Petit Boum',     emoji: '🫧', price: 11.91, oldPrice: null,  badge: null,    tags: ['bain','jouets'],     stock: 99, weightG: 160  },
    { id: 'bebe-88', name: 'Blocs Mousse Motricité Banasuper',               emoji: '🧱', price: 98.99, oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 3200 },
    { id: 'bebe-89', name: 'Premiers Crayons Coffret Crea lign',             emoji: '✏️', price: 17.95, oldPrice: null,  badge: null,    tags: ['jouets'],            stock: 99, weightG: 130  },
  ],
};

/* Overrides admin persistés — { id: { champ: valeur, ... } } */
let PRODUCTS_OVERRIDES = {};
try { PRODUCTS_OVERRIDES = JSON.parse(fs.readFileSync(PRODUCTS_OVERRIDES_FILE, 'utf8')); } catch {}

/* Applique les overrides au démarrage */
for (const prods of Object.values(PRODUCTS)) {
  for (const p of prods) {
    if (PRODUCTS_OVERRIDES[p.id]) Object.assign(p, PRODUCTS_OVERRIDES[p.id]);
  }
}

function persistProductOverrides() { saveJSON(PRODUCTS_OVERRIDES_FILE, PRODUCTS_OVERRIDES); }

/* Tranches de frais de port selon le poids total du panier */
/* ── Configuration livraison (tranches × zones) ── */
const SHIPPING_CONFIG_FILE = path.join(DATA_DIR, 'shipping-config.json');

const SHIPPING_ZONES_DEF = [
  { key: 'fr',  label: 'France métro.' },
  { key: 'dom', label: 'DOM-TOM'       },
  { key: 'eu',  label: 'Europe (UE)'   },
  { key: 'int', label: 'International' },
];

const DEFAULT_FLAT_RATES      = [4.90, 8.90, 9.90, 14.90];
const DEFAULT_FREE_THRESHOLDS = [50,   null, null,  null ];

const _rawShipCfg = loadJSON(SHIPPING_CONFIG_FILE, {});
let flatRates      = Array.isArray(_rawShipCfg.flatRates)      ? _rawShipCfg.flatRates      : DEFAULT_FLAT_RATES;
let freeThresholds = Array.isArray(_rawShipCfg.freeThresholds) ? _rawShipCfg.freeThresholds : DEFAULT_FREE_THRESHOLDS;
if (flatRates.length      !== SHIPPING_ZONES_DEF.length) flatRates      = DEFAULT_FLAT_RATES;
if (freeThresholds.length !== SHIPPING_ZONES_DEF.length) freeThresholds = DEFAULT_FREE_THRESHOLDS;

function _saveShipCfg() {
  saveJSON(SHIPPING_CONFIG_FILE, { flatRates, freeThresholds });
}

function _zoneIndex(country) {
  if (!country) return 0;
  const c = country.toUpperCase().replace(/[^A-Z]/g, '');
  const DOM_TOM = ['GP','MQ','GF','RE','PM','YT','NC','PF','WF','BL','MF'];
  if (c === 'FR' || c === 'FRANCE') return 0;
  if (DOM_TOM.includes(c)) return 1;
  const EU = ['DE','AT','BE','BG','CY','HR','DK','ES','EE','FI','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','CZ','RO','SK','SI','SE'];
  if (EU.includes(c)) return 2;
  return 3;
}

function calcShipping(country, subtotal) {
  const zi = _zoneIndex(country);
  const threshold = freeThresholds[zi];
  if (threshold !== null && subtotal !== undefined && subtotal >= threshold) return 0;
  return flatRates[zi] ?? 4.90;
}

/* Commandes — chargées depuis orders.json (persistées sur disque) */
let orders = loadJSON(ORDERS_FILE, []);

/* ─────────────────────────────────────────
   API ROUTES
   ───────────────────────────────────────── */

/** GET /api/shipping-config — matrice complète tranches × zones */
app.get('/api/shipping-config', (_req, res) => {
  res.json({ ok: true, zones: SHIPPING_ZONES_DEF, flatRates, freeThresholds });
});

/** PATCH /api/shipping-config — met à jour tarifs et seuils (admin) */
app.patch('/api/shipping-config', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Non autorisé' });
  const { flatRates: fr, freeThresholds: ft } = req.body;
  if (!Array.isArray(fr) || fr.length !== SHIPPING_ZONES_DEF.length ||
      !fr.every(v => typeof v === 'number' && isFinite(v) && v >= 0))
    return res.status(400).json({ ok: false, error: 'Tarifs invalides' });
  if (!Array.isArray(ft) || ft.length !== SHIPPING_ZONES_DEF.length ||
      !ft.every(v => v === null || (typeof v === 'number' && isFinite(v) && v >= 0)))
    return res.status(400).json({ ok: false, error: 'Seuils invalides' });
  flatRates      = fr.map(v => Math.round(v * 100) / 100);
  freeThresholds = ft;
  _saveShipCfg();
  writeLog('access', { event: 'shipping_config_updated' });
  res.json({ ok: true, zones: SHIPPING_ZONES_DEF, flatRates, freeThresholds });
});

/** GET /api/products?category=plaisir */
app.get('/api/products', (req, res) => {
  const { category } = req.query;
  if (!category) {
    // Retourner tous les produits si pas de catégorie
    const all = Object.entries(PRODUCTS).flatMap(([cat, prods]) =>
      prods.map(p => ({ ...p, category: cat }))
    );
    return res.json({ ok: true, products: all, total: all.length });
  }
  const prods = PRODUCTS[category];
  if (!prods) return res.status(404).json({ ok: false, error: `Catégorie inconnue: ${category}` });
  res.json({ ok: true, products: prods.map(p => ({ ...p, category })), total: prods.length });
});

/** GET /api/products/overrides — overrides admin pour le frontend */
app.get('/api/products/overrides', (req, res) => {
  res.json(PRODUCTS_OVERRIDES);
});

/** GET /api/products/:id */
app.get('/api/products/:id', (req, res) => {
  const { id } = req.params;
  for (const [cat, prods] of Object.entries(PRODUCTS)) {
    const product = prods.find(p => p.id === id);
    if (product) return res.json({ ok: true, product: { ...product, category: cat } });
  }
  res.status(404).json({ ok: false, error: 'Produit introuvable' });
});

/**
 * POST /api/orders
 * Body: { items: [{id, name, price, qty, emoji}], customerEmail?: string }
 *
 * En production :
 * 1. Valider les items et recalculer les prix côté serveur
 * 2. Pour AliExpress/DSers : déclencher la commande via DSers API
 *    POST https://openapi.dsers.com/openapi/v1/order/create
 * 4. Notifier le client par email à la commande
 */
app.post('/api/orders', requireCsrfIfAuthenticated, (req, res) => {
  const { items, customerEmail, shippingAddress } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ ok: false, error: 'Panier vide ou invalide' });
  if (items.length > 50)
    return res.status(400).json({ ok: false, error: 'Panier limité à 50 références' });
  if (customerEmail && !EMAIL_RE.test(customerEmail))
    return res.status(400).json({ ok: false, error: 'Email invalide' });

  /* Sanitize adresse de livraison — jamais stocker les données brutes du client */
  const safeAddr = shippingAddress ? {
    rue:     sanitize(shippingAddress.rue     || shippingAddress.street || '', 200),
    zip:     sanitize(shippingAddress.zip     || shippingAddress.postalCode || '', 20),
    city:    sanitize(shippingAddress.city    || '', 100),
    country: sanitize(shippingAddress.country || '', 60),
  } : null;

  /* Recalcul des prix côté serveur — le frontend n'est pas une source de confiance */
  let total = 0;
  const validatedItems = [];
  for (const item of items) {
    if (typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(item.id))
      return res.status(400).json({ ok: false, error: 'ID produit invalide' });
    let found = null;
    for (const prods of Object.values(PRODUCTS)) {
      found = prods.find(p => p.id === item.id);
      if (found) break;
    }
    if (!found) return res.status(400).json({ ok: false, error: `Produit introuvable: ${item.id}` });
    const qty = Math.max(1, Math.min(Math.floor(Number(item.qty) || 1), 99, found.stock));
    total += _effectivePrice(found.id, found.price) * qty;
    validatedItems.push({ ...found, qty });
  }

  const shipping  = calcShipping(safeAddr?.country, total);
  const grandTotal = Math.round((total + shipping) * 100) / 100;

  const order = {
    id:              `ORDER-${Date.now()}`,
    items:           validatedItems,
    total:           grandTotal,
    shipping,
    email:           customerEmail ? sanitize(customerEmail, 200) : null,
    shippingAddress: safeAddr,
    status:          'confirmed',
    createdAt:       new Date().toISOString(),
  };

  orders.push(order);
  persistOrders();
  console.log(`[ORDER] ${order.id} — ${order.total}€ (livraison ${shipping}€) — ${validatedItems.length} article(s)`);

  notifyOwner(order).catch(err => console.error('[EMAIL] Échec notif propriétaire:', err.message));
  notifySupplier(order).catch(err => console.error('[EMAIL] Échec envoi fournisseur:', err.message));
  sendOrderConfirmation(order).catch(err => console.error('[EMAIL] Échec confirmation client:', err.message));
  createInvoice(order).catch(err => console.error('[INVOICE] Erreur:', err.message));

  res.json({ ok: true, orderId: order.id, total: order.total, shipping });
});


/* ─────────────────────────────────────────
   AUTH API
   ───────────────────────────────────────── */

/** POST /api/auth/register */
app.post('/api/auth/register', authLimiter, async (req, res) => {
  const { name, email, password, address, birthday } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ ok: false, error: 'Tous les champs sont requis.' });
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100)
    return res.status(400).json({ ok: false, error: 'Nom invalide (2–100 caractères).' });
  if (!EMAIL_RE.test(email) || email.length > 254)
    return res.status(400).json({ ok: false, error: 'Email invalide.' });
  const pwdErr = validatePassword(password);
  if (pwdErr) return res.status(400).json({ ok: false, error: pwdErr });
  if (USERS[email.toLowerCase()])
    return res.status(409).json({ ok: false, error: 'Un compte existe déjà avec cet e-mail.' });

  const safeAddr = address ? {
    rue:     sanitize(address.rue     || '', 200),
    zip:     sanitize(address.zip     || '', 20),
    city:    sanitize(address.city    || '', 100),
    country: sanitize(address.country || '', 60),
  } : null;

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  /* Valide le format YYYY-MM-DD sans stocker de données brutes non vérifiées */
  const safeBirthday = (birthday && /^\d{4}-\d{2}-\d{2}$/.test(birthday) && !isNaN(Date.parse(birthday)))
    ? birthday : null;

  const user = {
    name:      sanitize(name, 100),
    email:     email.toLowerCase().trim(),
    hash,
    address:   safeAddr,
    birthday:  safeBirthday,
    createdAt: new Date().toISOString(),
  };
  USERS[email.toLowerCase()] = user;
  persistUsers();

  const { token, csrfToken } = createSession(user);
  const refreshToken = createRefreshToken(user.email);
  res.cookie('leclam_session', token, COOKIE_OPTS);
  res.cookie('leclam_refresh', refreshToken, REFRESH_COOKIE_OPTS);
  const regIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '?';
  writeLog('security', { event: 'register_ok', email: user.email, ip: regIp });
  console.log(`[AUTH] Nouveau compte : ${user.name} <${user.email}>`);
  res.json({ ok: true, token, csrfToken, expiresIn: ACCESS_TOKEN_TTL, user: { name: user.name, email: user.email, role: 'user' } });
});

/** POST /api/auth/login */
app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ ok: false, error: 'E-mail et mot de passe requis.' });
  if (typeof email !== 'string' || typeof password !== 'string')
    return res.status(400).json({ ok: false, error: 'Données invalides.' });

  const ip   = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
               || req.socket?.remoteAddress || '?';
  const user = USERS[email.toLowerCase().trim()];

  /* Délai constant pour éviter l'énumération de comptes par timing */
  if (!user) {
    await bcrypt.compare(password, '$2b$12$invalidhashpaddingtomatchtime000000000000000000000');
    trackFailedAuth(ip);
    writeLog('security', { event: 'login_fail', reason: 'unknown_email', ip });
    return res.status(401).json({ ok: false, error: 'Identifiants incorrects.' });
  }

  const valid = await verifyPassword(password, user);
  if (!valid) {
    trackFailedAuth(ip);
    writeLog('security', { event: 'login_fail', reason: 'bad_password', ip });
    return res.status(401).json({ ok: false, error: 'Identifiants incorrects.' });
  }

  const { token, csrfToken } = createSession(user);
  const refreshToken = createRefreshToken(user.email);
  res.cookie('leclam_session', token, COOKIE_OPTS);
  res.cookie('leclam_refresh', refreshToken, REFRESH_COOKIE_OPTS);
  writeLog('security', { event: 'login_ok', email: user.email, ip });
  console.log(`[AUTH] Connexion : ${user.name} <${user.email}>`);
  res.json({ ok: true, token, csrfToken, expiresIn: ACCESS_TOKEN_TTL, user: { name: user.name, email: user.email, role: user.role || 'user' } });
});

/** GET /api/auth/localhost — auto-login sans mot de passe (localhost uniquement, désactivé en prod) */
app.get('/api/auth/localhost', (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).json({ ok: false, error: 'Non disponible.' });
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
             || req.socket?.remoteAddress || '';
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === '';
  if (!isLocal) return res.status(403).json({ ok: false, error: 'Localhost uniquement.' });

  const owner = Object.values(USERS).find(u => u.role === 'owner') || Object.values(USERS).find(u => u.role === 'admin');
  if (!owner) return res.status(404).json({ ok: false, error: 'Aucun compte owner trouvé.' });

  const { token, csrfToken } = createSession(owner);
  const refreshToken = createRefreshToken(owner.email);
  res.cookie('leclam_session', token, COOKIE_OPTS);
  res.cookie('leclam_refresh', refreshToken, REFRESH_COOKIE_OPTS);
  res.json({ ok: true, token, csrfToken, user: { name: owner.name, email: owner.email, role: owner.role } });
});

/** GET /api/auth/me */
app.get('/api/auth/me', (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ ok: false, error: 'Non connecté.' });
  res.json({ ok: true, user: session });
});

/** GET /api/auth/csrf — retourne le CSRF token de la session active (après rechargement de page) */
app.get('/api/auth/csrf', (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ ok: false, error: 'Non connecté.' });
  res.json({ ok: true, csrfToken: session.csrfToken });
});

/** POST /api/auth/logout */
app.post('/api/auth/logout', requireCsrf, (req, res) => {
  const cookieToken  = req.cookies?.leclam_session;
  const bearerToken  = req.headers['authorization']?.replace('Bearer ', '');
  const refreshToken = req.cookies?.leclam_refresh;
  if (cookieToken)  delete SESSIONS[cookieToken];
  if (bearerToken)  delete SESSIONS[bearerToken];
  if (refreshToken) delete REFRESH_TOKENS[refreshToken];
  persistSessions();
  res.clearCookie('leclam_session');
  res.clearCookie('leclam_refresh', { path: '/api/auth' });
  res.json({ ok: true });
});

/** POST /api/admin/preview-client — crée une session client temporaire pour l'aperçu admin */
app.post('/api/admin/preview-client', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Non autorisé' });
  const adminSession = getSession(req);
  const previewUser = {
    email: `preview+${adminSession.email}`,
    name:  'Client (aperçu)',
    role:  'user',
  };
  const { token, csrfToken } = createSession(previewUser);
  /* Remplace le cookie session par le token client → maintenance s'applique comme pour un vrai client */
  res.cookie('leclam_session', token, COOKIE_OPTS);
  res.json({ ok: true, token, csrfToken, user: previewUser });
});

/** POST /api/admin/restore-admin — restaure le cookie session admin après aperçu client */
app.post('/api/admin/restore-admin', (req, res) => {
  const bearerToken = req.headers['authorization']?.replace('Bearer ', '');
  const now = Date.now();
  const adminSession = bearerToken ? SESSIONS[bearerToken] : null;
  if (!adminSession || adminSession.expiresAt < now) {
    return res.status(401).json({ ok: false, error: 'Non autorisé' });
  }
  if (adminSession.role !== 'admin' && adminSession.role !== 'owner') {
    return res.status(401).json({ ok: false, error: 'Non autorisé' });
  }
  res.cookie('leclam_session', bearerToken, COOKIE_OPTS);
  res.json({ ok: true });
});

/** POST /api/auth/admin-login — authentification admin via clé secrète */
app.post('/api/auth/admin-login', authLimiter, async (req, res) => {
  const { key } = req.body;
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
             || req.socket?.remoteAddress || '?';

  if (!key || typeof key !== 'string') {
    return res.status(400).json({ ok: false, error: 'Clé requise.' });
  }

  if (!isValidAdminKey(key)) {
    trackFailedAuth(ip);
    writeLog('security', { event: 'admin_login_fail', ip });
    await new Promise(r => setTimeout(r, 400 + Math.random() * 200));
    return res.status(401).json({ ok: false, error: 'Clé incorrecte.' });
  }

  const adminUser = { name: 'Admin', email: process.env.OWNER_EMAIL || 'admin@leclam.fr', role: 'admin' };
  const { token, csrfToken } = createSession(adminUser);
  const refreshToken = createRefreshToken(adminUser.email);
  res.cookie('leclam_session', token, COOKIE_OPTS);
  res.cookie('leclam_refresh', refreshToken, REFRESH_COOKIE_OPTS);
  writeLog('security', { event: 'admin_login_ok', ip });
  console.log(`[AUTH] Connexion admin depuis ${ip}`);
  res.json({ ok: true, token, csrfToken, expiresIn: ACCESS_TOKEN_TTL, user: adminUser });
});

/* ── Helpers HTTPS interne (pas de dépendance externe) ── */
function _httpGetJson(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = require('https').get(url, (r) => {
      let buf = '';
      r.on('data', c => buf += c);
      r.on('end', () => { try { resolve(JSON.parse(buf)); } catch { reject(new Error('JSON invalide')); } });
    }).on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('Timeout réseau')); });
  });
}

/* Cache JWKS Apple — TTL 1h pour éviter un appel réseau à chaque login */
let _appleJwksCache = null;
let _appleJwksCacheAt = 0;
async function _getAppleJwks() {
  if (_appleJwksCache && (Date.now() - _appleJwksCacheAt) < 60 * 60 * 1000) return _appleJwksCache;
  _appleJwksCache = await _httpGetJson('https://appleid.apple.com/auth/keys');
  _appleJwksCacheAt = Date.now();
  return _appleJwksCache;
}

async function _verifySocialGoogle(idToken) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID non configuré');
  const info = await _httpGetJson(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  if (info.error) throw new Error(info.error_description || info.error);
  if (info.aud !== clientId) throw new Error('audience mismatch');
  return { email: info.email, name: info.name || info.email.split('@')[0] };
}

async function _verifySocialApple(idToken, clientName, clientEmail) {
  try {
    const parts = idToken.split('.');
    if (parts.length !== 3) throw new Error('JWT malformé');

    const header  = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));

    const clientId = process.env.APPLE_CLIENT_ID;
    if (!clientId) throw new Error('APPLE_CLIENT_ID non configuré');
    if (payload.iss !== 'https://appleid.apple.com') throw new Error('iss invalide');
    if (payload.aud !== clientId) throw new Error('aud invalide');
    if (!payload.sub) throw new Error('sub manquant');
    if (Math.floor(Date.now() / 1000) > (payload.exp || 0)) throw new Error('Token expiré');

    /* Vérification de signature via les clés publiques Apple (JWKS, mis en cache 1h) */
    const jwks = await _getAppleJwks();
    const key = (jwks.keys || []).find(k => k.kid === header.kid);
    if (!key) throw new Error('Clé publique Apple introuvable (kid=' + header.kid + ')');

    const pubKey = crypto.createPublicKey({ key: { kty: key.kty, n: key.n, e: key.e }, format: 'jwk' });
    const verifier = crypto.createVerify('SHA256');
    verifier.update(`${parts[0]}.${parts[1]}`);
    if (!verifier.verify(pubKey, Buffer.from(parts[2], 'base64url')))
      throw new Error('Signature Apple invalide');

    return {
      email: payload.email || clientEmail || '',
      name:  clientName || (payload.email || '').split('@')[0],
    };
  } catch (err) {
    throw new Error('Apple JWT invalide : ' + err.message);
  }
}

async function _verifySocialFacebook(accessToken, clientName, clientEmail) {
  const appId     = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  if (!appId || !appSecret) throw new Error('Facebook non configuré');
  const debug = await _httpGetJson(`https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(appId + '|' + appSecret)}`);
  if (!debug.data?.is_valid || debug.data.app_id !== appId) throw new Error('Token Facebook invalide');
  const me = await _httpGetJson(`https://graph.facebook.com/me?fields=name,email&access_token=${encodeURIComponent(accessToken)}`);
  return { email: me.email || clientEmail || '', name: me.name || clientName || '' };
}

/** GET /api/auth/social-config.js — expose les client IDs OAuth au frontend */
app.get('/api/auth/social-config.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send([
    `window._GOOGLE_CLIENT_ID=${JSON.stringify(process.env.GOOGLE_CLIENT_ID  || '')};`,
    `window._APPLE_CLIENT_ID =${JSON.stringify(process.env.APPLE_CLIENT_ID   || '')};`,
    `window._FACEBOOK_APP_ID =${JSON.stringify(process.env.FACEBOOK_APP_ID   || '')};`,
  ].join('\n'));
});

/** POST /api/auth/social — échange un token OAuth contre une session Le Clam */
app.post('/api/auth/social', authLimiter, async (req, res) => {
  const { provider, token, name: clientName, email: clientEmail } = req.body;
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '?';

  if (!provider || !token || typeof token !== 'string')
    return res.status(400).json({ ok: false, error: 'Paramètres manquants.' });

  let userInfo;
  try {
    if (provider === 'google')   userInfo = await _verifySocialGoogle(token);
    else if (provider === 'apple')    userInfo = await _verifySocialApple(token, clientName, clientEmail);
    else if (provider === 'facebook') userInfo = await _verifySocialFacebook(token, clientName, clientEmail);
    else return res.status(400).json({ ok: false, error: 'Fournisseur inconnu.' });
  } catch (err) {
    writeLog('security', { event: 'social_auth_fail', provider, ip, error: err.message });
    return res.status(401).json({ ok: false, error: 'Authentification invalide.' });
  }

  if (!userInfo?.email)
    return res.status(401).json({ ok: false, error: 'Email introuvable chez le fournisseur.' });

  const email = userInfo.email.toLowerCase().trim();
  const isNew = !USERS[email];
  if (isNew) {
    USERS[email] = {
      name:      sanitize(userInfo.name || email.split('@')[0], 100),
      email,
      hash:      null,
      provider,
      role:      'user',
      createdAt: new Date().toISOString(),
    };
    persistUsers();
    console.log(`[AUTH] Nouveau compte social (${provider}) : ${USERS[email].name} <${email}>`);
  }

  const user = USERS[email];
  const { token: sessionTok, csrfToken } = createSession(user);
  const refreshToken = createRefreshToken(email);
  res.cookie('leclam_session', sessionTok, COOKIE_OPTS);
  res.cookie('leclam_refresh', refreshToken, REFRESH_COOKIE_OPTS);
  writeLog('security', { event: 'social_login_ok', provider, email, ip });

  res.json({
    ok: true, token: sessionTok, csrfToken, expiresIn: ACCESS_TOKEN_TTL,
    user: { name: user.name, email: user.email, role: user.role || 'user', isNew },
  });
});

/** POST /api/auth/refresh — renouvelle silencieusement le token d'accès */
app.post('/api/auth/refresh', (req, res) => {
  const refreshToken = req.cookies?.leclam_refresh;
  if (!refreshToken)
    return res.status(401).json({ ok: false, error: 'Refresh token absent.' });

  const rt = REFRESH_TOKENS[refreshToken];
  if (!rt || rt.expiresAt < Date.now()) {
    delete REFRESH_TOKENS[refreshToken];
    res.clearCookie('leclam_refresh', { path: '/api/auth' });
    return res.status(401).json({ ok: false, error: 'Session expirée. Veuillez vous reconnecter.' });
  }

  const user = USERS[rt.email];
  if (!user) {
    delete REFRESH_TOKENS[refreshToken];
    res.clearCookie('leclam_refresh', { path: '/api/auth' });
    return res.status(401).json({ ok: false, error: 'Compte introuvable.' });
  }

  /* Rotation : invalider l'ancien, émettre un nouveau */
  delete REFRESH_TOKENS[refreshToken];
  const { token, csrfToken } = createSession(user);
  const newRefresh = createRefreshToken(user.email);
  res.cookie('leclam_session', token, COOKIE_OPTS);
  res.cookie('leclam_refresh', newRefresh, REFRESH_COOKIE_OPTS);
  res.json({ ok: true, token, csrfToken, expiresIn: ACCESS_TOKEN_TTL, user: { name: user.name, email: user.email, role: user.role || 'user' } });
});

/** GET /api/auth/export — RGPD art. 20 : droit à la portabilité des données */
app.get('/api/auth/export', requireCsrf, (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ ok: false, error: 'Non connecté.' });

  const user    = USERS[session.email];
  const myOrders = orders
    .filter(o => o.email === session.email)
    .map(o => ({
      id:              o.id,
      createdAt:       o.createdAt,
      status:          o.status,
      total:           o.total,
      shipping:        o.shipping,
      shippingAddress: o.shippingAddress,
      items:           (o.items || []).map(i => ({ id: i.id, name: i.name, qty: i.qty, price: i.price })),
    }));

  const export_data = {
    exportedAt:  new Date().toISOString(),
    profile: {
      name:      user?.name,
      email:     session.email,
      address:   user?.address,
      createdAt: user?.createdAt,
    },
    orders:   myOrders,
    messages: (MESSAGES[session.email] || []).map(m => ({
      id: m.id, type: m.type, title: m.title, text: m.text, read: m.read, createdAt: m.createdAt,
    })),
  };

  writeLog('access', { event: 'data_export', email: session.email });
  res.setHeader('Content-Disposition', `attachment; filename="leclam-mes-donnees-${Date.now()}.json"`);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json(export_data);
});

/** DELETE /api/auth/account — RGPD art. 17 : droit à la suppression */
app.delete('/api/auth/account', requireCsrf, (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ ok: false, error: 'Non connecté.' });
  const email = session.email;

  /* Anonymiser les commandes (obligations comptables = conserver 10 ans, anonymiser le reste) */
  orders.forEach(o => {
    if (o.email === email) {
      o.email           = '[supprimé]';
      o.shippingAddress = o.shippingAddress?.country
        ? { country: o.shippingAddress.country }
        : null;
    }
  });

  /* Supprimer messages, tokens d'avis et compte */
  delete MESSAGES[email];
  Object.keys(TOKENS).forEach(t => { if (TOKENS[t].email === email) delete TOKENS[t]; });
  delete USERS[email];

  /* Invalider toutes les sessions de cet utilisateur */
  Object.keys(SESSIONS).forEach(t => { if (SESSIONS[t].email === email) delete SESSIONS[t]; });
  res.clearCookie('leclam_session');

  persistOrders(); persistUsers(); persistTokens(); persistMessages(); persistSessions();
  console.log(`[RGPD] Compte supprimé : ${email}`);
  res.json({ ok: true, message: 'Compte et données personnelles supprimés.' });
});

/* ─────────────────────────────────────────
   RATINGS API
   ───────────────────────────────────────── */

/** GET /api/ratings — toutes les notes (pour le frontend) */
app.get('/api/ratings', (req, res) => {
  const out = {};
  for (const [id, r] of Object.entries(RATINGS)) {
    out[id] = {
      rating:  r.count > 0 ? Math.round((r.sum / r.count) * 10) / 10 : 0,
      reviews: r.count,
    };
  }
  res.json({ ok: true, ratings: out });
});

/** GET /api/ratings/:productId */
app.get('/api/ratings/:productId', (req, res) => {
  const r = RATINGS[req.params.productId];
  if (!r) return res.json({ ok: true, rating: 0, reviews: 0 });
  res.json({
    ok:      true,
    rating:  r.count > 0 ? Math.round((r.sum / r.count) * 10) / 10 : 0,
    reviews: r.count,
  });
});

/** GET /api/review/check?token=XXX — valide le token avant affichage du formulaire */
app.get('/api/review/check', (req, res) => {
  const { token } = req.query;
  if (typeof token !== 'string' || !/^[0-9a-f]{40}$/.test(token))
    return res.status(400).json({ ok: false, error: 'Token invalide.' });
  const t = TOKENS[token];
  if (!t)      return res.status(404).json({ ok: false, error: 'Lien invalide.' });
  if (t.used)  return res.status(410).json({ ok: false, error: 'Cet avis a déjà été soumis.' });
  res.json({ ok: true, productId: t.productId, productName: t.productName });
});

/** POST /api/review — soumission d'un avis */
app.post('/api/review', (req, res) => {
  const { token, rating, comment } = req.body;

  /* Validation stricte du format du token (40 hex chars) */
  if (typeof token !== 'string' || !/^[0-9a-f]{40}$/.test(token))
    return res.status(400).json({ ok: false, error: 'Token invalide.' });

  const t = TOKENS[token];
  if (!t)     return res.status(404).json({ ok: false, error: 'Lien invalide.' });
  if (t.used) return res.status(410).json({ ok: false, error: 'Cet avis a déjà été soumis.' });

  const note = parseInt(rating);
  if (!note || note < 1 || note > 5) {
    return res.status(400).json({ ok: false, error: 'Note invalide (1–5).' });
  }

  // Initialiser la clé produit si elle n'existe pas encore
  if (!RATINGS[t.productId]) {
    RATINGS[t.productId] = { sum: 0, count: 0, reviews: [] };
  }

  RATINGS[t.productId].sum   += note;
  RATINGS[t.productId].count += 1;
  RATINGS[t.productId].reviews.push({
    rating:    note,
    comment:   (comment || '').trim().slice(0, 500),
    createdAt: new Date().toISOString(),
  });

  t.used = true;
  persistRatings();
  persistTokens();

  const newRating = Math.round((RATINGS[t.productId].sum / RATINGS[t.productId].count) * 10) / 10;
  console.log(`[AVIS] ${t.productId} — note ${note}/5 — moyenne désormais ${newRating} (${RATINGS[t.productId].count} avis)`);

  res.json({ ok: true, newRating, totalReviews: RATINGS[t.productId].count });
});

/** POST /api/admin/orders/:id/deliver — marquer comme livré → envoyer email satisfaction */
app.post('/api/admin/orders/:id/deliver', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Non autorisé' });

  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ ok: false, error: 'Commande introuvable' });

  order.status      = 'delivered';
  order.deliveredAt = new Date().toISOString();
  persistOrders();

  /* Créer les messages de demande d'avis dans la boîte de l'utilisateur */
  if (order.email) {
    order.items.forEach(item => {
      const token = crypto.randomBytes(20).toString('hex');
      TOKENS[token] = { orderId: order.id, productId: item.id, productName: item.name, email: order.email, used: false, createdAt: new Date().toISOString() };
      addMessage(order.email, {
        type:    'review',
        title:   `Donnez votre avis — ${item.name}`,
        text:    `Votre commande ${order.id} est arrivée ! Comment s'est passée votre expérience avec ${item.emoji || '📦'} ${item.name} ? Votre avis aide les autres acheteurs.`,
        token,
        orderId: order.id,
        productId: item.id,
        email:   order.email,
      });
    });
    persistTokens();

    /* Message de confirmation livraison */
    addMessage(order.email, {
      type:  'order',
      title: `Commande ${order.id} livrée ✅`,
      text:  `Votre commande est arrivée ! Profitez bien de vos articles. N'hésitez pas à nous laisser un avis.`,
      orderId: order.id,
      email: order.email,
    });
  }

  try {
    await sendSatisfactionEmail(order);
    res.json({ ok: true, message: `Email satisfaction envoyé à ${order.email || '(pas d\'email)'}` });
  } catch (err) {
    console.error('[EMAIL] Erreur satisfaction:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * PATCH /api/admin/orders/:id/status — mettre à jour le statut d'une commande
 * Body : { status: 'processing'|'shipped'|'delivered'|'cancelled', trackingNumber?: string }
 * → envoie automatiquement l'email d'expédition (shipped) ou de satisfaction (delivered)
 */
app.patch('/api/admin/orders/:id/status', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Accès refusé.' });

  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ ok: false, error: 'Commande introuvable.' });

  const allowed = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
  const { status, trackingNumber } = req.body;
  if (!allowed.includes(status)) return res.status(400).json({ ok: false, error: 'Statut invalide.' });

  const prevStatus = order.status;
  order.status = status;
  if (trackingNumber) order.trackingNumber = trackingNumber;
  if (status === 'shipped'   && !order.shippedAt)   order.shippedAt   = new Date().toISOString();
  if (status === 'delivered' && !order.deliveredAt) order.deliveredAt = new Date().toISOString();
  persistOrders();

  /* Générer la facture et enregistrer le parrainage quand paiement confirmé (pending → confirmed ou processing) */
  if (['confirmed', 'processing'].includes(status) && ['pending_virement', 'pending_crypto', 'pending_payment'].includes(prevStatus)) {
    createInvoice(order).catch(err => console.error('[INVOICE] Erreur virement/crypto:', err.message));
    if (order.parrainCode && order.email) {
      _registerParrainUse(order.parrainCode, order.email).catch(() => {});
      _markVoucherUsed(order.parrainCode, order.id);
    }
  }

  /* Email + push expédition */
  if (status === 'shipped' && prevStatus !== 'shipped') {
    sendShippingEmail(order).catch(err => console.error('[EMAIL] Erreur suivi expédition:', err.message));
    if (order.email) {
      const trackUrl = order.trackingNumber
        ? `/tracking.html?num=${encodeURIComponent(order.trackingNumber)}`
        : '/mes-commandes.html';
      sendPushToUser(order.email,
        '📦 Votre commande est expédiée !',
        `${order.id} est en route. ${order.trackingNumber ? 'N° ' + order.trackingNumber : ''}`.trim(),
        trackUrl
      ).catch(() => {});
    }
  }

  /* Push livraison */
  if (status === 'delivered' && prevStatus !== 'delivered' && order.email) {
    sendPushToUser(order.email,
      '🏠 Commande livrée !',
      `Votre commande ${order.id} a été livrée. Donnez votre avis !`,
      '/mes-commandes.html'
    ).catch(() => {});
  }

  /* Email satisfaction + demandes d'avis */
  if (status === 'delivered' && prevStatus !== 'delivered' && order.email) {
    order.items.forEach(item => {
      const token = crypto.randomBytes(20).toString('hex');
      TOKENS[token] = { orderId: order.id, productId: item.id, productName: item.name, email: order.email, used: false, createdAt: new Date().toISOString() };
      addMessage(order.email, {
        type: 'review', title: `Donnez votre avis — ${item.name}`,
        text: `Votre commande ${order.id} est arrivée ! Comment s'est passée votre expérience avec ${item.emoji || '📦'} ${item.name} ?`,
        token, orderId: order.id, productId: item.id, email: order.email,
      });
    });
    persistTokens(); persistMessages();
    addMessage(order.email, {
      type: 'order', title: `Commande ${order.id} livrée ✅`,
      text: `Votre commande est arrivée ! Profitez bien de vos articles.`,
      orderId: order.id, email: order.email,
    });
    sendSatisfactionEmail(order).catch(err => console.error('[EMAIL] Erreur satisfaction:', err.message));
  }

  res.json({ ok: true, order });
});

/** POST /api/admin/orders/:id/tracking — enregistre le numéro de suivi */
app.post('/api/admin/orders/:id/tracking', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Accès refusé.' });
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ ok: false, error: 'Commande introuvable.' });
  const { trackingNumber } = req.body;
  if (!trackingNumber || typeof trackingNumber !== 'string')
    return res.status(400).json({ ok: false, error: 'trackingNumber requis.' });
  order.trackingNumber = sanitize(trackingNumber, 100);
  persistOrders();
  writeLog('access', { event: 'tracking_updated', orderId: order.id, trackingNumber: order.trackingNumber });
  res.json({ ok: true, order });
});

/**
 * POST /api/admin/products
 * Import manuel de produits pour la catégorie Bébé
 * En prod : protéger avec un middleware d'authentification admin
 */
app.post('/api/admin/products', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Non autorisé' });

  const { category, product } = req.body;
  if (!PRODUCTS[category]) return res.status(400).json({ ok: false, error: 'Catégorie invalide' });
  if (!product || typeof product !== 'object')
    return res.status(400).json({ ok: false, error: 'Produit invalide' });

  const name = sanitize(product.name || '', 200);
  if (!name) return res.status(400).json({ ok: false, error: 'Nom de produit requis' });

  const price = parseFloat(product.price);
  if (!isFinite(price) || price < 0 || price > 100000)
    return res.status(400).json({ ok: false, error: 'Prix invalide' });

  const newProduct = {
    id:        `${category}-${Date.now()}`,
    name,
    emoji:     sanitize(product.emoji || '📦', 8),
    price,
    oldPrice:  isFinite(parseFloat(product.oldPrice)) ? parseFloat(product.oldPrice) : null,
    badge:     product.badge ? sanitize(product.badge, 50) : null,
    tags:      Array.isArray(product.tags) ? product.tags.map(t => sanitize(t, 50)).filter(Boolean) : [],
    stock:     Math.max(0, Math.floor(Number(product.stock) || 1)),
    weightG:   Math.max(0, Math.floor(Number(product.weightG) || 200)),
    source:    'admin',
    createdAt: new Date().toISOString(),
  };
  PRODUCTS[category].push(newProduct);
  writeLog('access', { event: 'product_added', category, id: newProduct.id, name: newProduct.name });
  res.json({ ok: true, product: newProduct });
});

/**
 * PATCH /api/admin/products/:id
 * Modifie les champs d'un produit existant (weightG, price, stock, badge…)
 */
app.patch('/api/admin/products/:id', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Non autorisé' });

  const { id } = req.params;
  if (!/^[a-zA-Z0-9_-]+$/.test(id))
    return res.status(400).json({ ok: false, error: 'ID invalide' });

  let found = null;
  for (const prods of Object.values(PRODUCTS)) {
    found = prods.find(p => p.id === id);
    if (found) break;
  }
  if (!found) return res.status(404).json({ ok: false, error: 'Produit introuvable' });

  const { weightG, price, oldPrice, stock, badge, name, emoji, images, desc } = req.body;
  const changed = {};

  if (weightG !== undefined) {
    const w = Math.floor(Number(weightG));
    if (!isFinite(w) || w < 0 || w > 100000)
      return res.status(400).json({ ok: false, error: 'Poids invalide (0–100 000 g)' });
    found.weightG = w; changed.weightG = w;
  }
  if (price !== undefined) {
    const p = parseFloat(price);
    if (!isFinite(p) || p < 0 || p > 100000)
      return res.status(400).json({ ok: false, error: 'Prix invalide' });
    found.price = p; changed.price = p;
  }
  if (oldPrice !== undefined) {
    const op = isFinite(parseFloat(oldPrice)) ? parseFloat(oldPrice) : null;
    found.oldPrice = op; changed.oldPrice = op;
  }
  if (stock !== undefined) {
    const s = stock === null ? null : Math.max(0, Math.floor(Number(stock) || 0));
    found.stock = s; changed.stock = s;
  }
  if (badge !== undefined) {
    const b = badge ? sanitize(badge, 50) : null;
    found.badge = b; changed.badge = b;
  }
  if (name !== undefined) {
    const n = sanitize(name, 200);
    if (!n) return res.status(400).json({ ok: false, error: 'Nom requis' });
    found.name = n; found.name_fr = n; changed.name = n; changed.name_fr = n;
  }
  if (emoji !== undefined) {
    const e = sanitize(emoji, 8);
    found.emoji = e; changed.emoji = e;
  }
  if (images !== undefined && Array.isArray(images)) {
    found.images = images; changed.images = images;
  }
  if (desc !== undefined) {
    const d = sanitize(desc, 2000);
    found.desc = d; changed.desc = d;
  }

  /* Persiste les changements */
  if (!PRODUCTS_OVERRIDES[id]) PRODUCTS_OVERRIDES[id] = {};
  Object.assign(PRODUCTS_OVERRIDES[id], changed);
  persistProductOverrides();

  writeLog('access', { event: 'product_updated', id, fields: Object.keys(req.body) });
  res.json({ ok: true, product: found });
});

/**
 * POST /api/admin/products/:id/upload
 * Upload une image produit encodée en base64 → sauvegarde dans public/uploads/
 */
app.post('/api/admin/products/:id/upload', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Non autorisé' });
  const { id } = req.params;
  if (!/^[a-zA-Z0-9_-]+$/.test(id))
    return res.status(400).json({ ok: false, error: 'ID invalide' });

  const { data, mimeType } = req.body;
  if (!data || typeof data !== 'string')
    return res.status(400).json({ ok: false, error: 'Image manquante (base64)' });

  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const mime = mimeType || 'image/jpeg';
  if (!allowed.includes(mime))
    return res.status(400).json({ ok: false, error: 'Type non autorisé' });

  const ext = mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : mime === 'image/gif' ? '.gif' : '.jpg';
  const base64Data = data.replace(/^data:image\/[a-z+]+;base64,/, '');
  let buffer;
  try { buffer = Buffer.from(base64Data, 'base64'); } catch {
    return res.status(400).json({ ok: false, error: 'Données base64 invalides' });
  }
  if (buffer.length > 8 * 1024 * 1024)
    return res.status(400).json({ ok: false, error: 'Image trop grande (max 8 Mo)' });

  const uploadsDir = path.join(__dirname, 'public', 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  const safeName = `${id}_${Date.now()}${ext}`;
  try { fs.writeFileSync(path.join(uploadsDir, safeName), buffer); } catch {
    return res.status(500).json({ ok: false, error: 'Erreur sauvegarde fichier' });
  }

  writeLog('access', { event: 'image_uploaded', id, file: safeName, size: buffer.length });
  res.json({ ok: true, url: `/uploads/${safeName}` });
});

/**
 * POST /api/admin/products/:id/fetch-image
 * Télécharge une image depuis une URL externe → sauvegarde dans public/uploads/
 */
app.post('/api/admin/products/:id/fetch-image', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Non autorisé' });
  const { id } = req.params;
  if (!/^[a-zA-Z0-9_-]+$/.test(id))
    return res.status(400).json({ ok: false, error: 'ID invalide' });

  const { url } = req.body;
  if (!url || typeof url !== 'string')
    return res.status(400).json({ ok: false, error: 'URL manquante' });

  let parsed;
  try { parsed = new URL(url); } catch {
    return res.status(400).json({ ok: false, error: 'URL invalide' });
  }
  if (!['http:', 'https:'].includes(parsed.protocol))
    return res.status(400).json({ ok: false, error: 'Protocole non autorisé' });
  const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
  if (blockedHosts.includes(parsed.hostname))
    return res.status(400).json({ ok: false, error: 'Hôte non autorisé' });

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return res.status(400).json({ ok: false, error: `HTTP ${response.status} depuis l'URL` });

    const contentType = response.headers.get('content-type') || '';
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const mimeMatch = allowed.find(m => contentType.includes(m));
    if (!mimeMatch) return res.status(400).json({ ok: false, error: 'L\'URL ne pointe pas vers une image valide' });

    const ext = mimeMatch === 'image/png' ? '.png' : mimeMatch === 'image/webp' ? '.webp' : mimeMatch === 'image/gif' ? '.gif' : '.jpg';
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length > 8 * 1024 * 1024)
      return res.status(400).json({ ok: false, error: 'Image trop grande (max 8 Mo)' });

    const uploadsDir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    const safeName = `${id}_${Date.now()}${ext}`;
    fs.writeFileSync(path.join(uploadsDir, safeName), buffer);

    writeLog('access', { event: 'image_fetched', id, url, file: safeName, size: buffer.length });
    res.json({ ok: true, url: `/uploads/${safeName}` });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Impossible de télécharger l\'image : ' + e.message });
  }
});

/* ─────────────────────────────────────────
   MESSAGES API
   ───────────────────────────────────────── */

/** GET /api/messages/mine */
app.get('/api/messages/mine', (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ ok: false, error: 'Non connecté' });
  const msgs = MESSAGES[session.email] || [];
  res.json({ ok: true, messages: msgs });
});

/** POST /api/messages/:id/read */
app.post('/api/messages/:id/read', requireCsrf, (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ ok: false, error: 'Non connecté' });
  const msgs = MESSAGES[session.email] || [];
  const msg  = msgs.find(m => m.id === req.params.id);
  if (msg) { msg.read = true; persistMessages(); }
  res.json({ ok: true });
});

/** POST /api/messages/read-all */
app.post('/api/messages/read-all', requireCsrf, (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ ok: false, error: 'Non connecté' });
  (MESSAGES[session.email] || []).forEach(m => { m.read = true; });
  persistMessages();
  res.json({ ok: true });
});

/** POST /api/messages/broadcast — admin: envoyer un message à tous les utilisateurs */
app.post('/api/messages/broadcast', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Non autorisé' });

  const { title, text, type = 'product', href } = req.body;
  if (!title || !text) return res.status(400).json({ ok: false, error: 'Titre et texte requis.' });

  const safeTitle = sanitize(title, 200);
  const safeText  = sanitize(text,  2000);
  const safeHref  = href ? sanitize(href, 500) : undefined;
  if (!safeTitle || !safeText)
    return res.status(400).json({ ok: false, error: 'Titre et texte ne peuvent pas être vides.' });

  Object.keys(USERS).forEach(email => {
    addMessage(email, { type, title: safeTitle, text: safeText, href: safeHref, email });
  });
  writeLog('access', { event: 'broadcast', recipients: Object.keys(USERS).length });
  res.json({ ok: true, sent: Object.keys(USERS).length });
});

/* ═══════════════════════════════════════════════════════════════════
   THREADS — Messagerie privée client ↔ admin
   ─────────────────────────────────────────────────────────────────
   Modèle : threads.json → tableau de Thread
   Thread  : { id, userId, userName, subject, status, priority, tags,
               createdAt, updatedAt,
               messages:[{id, from, text, at, readByAdmin, readByClient}] }
   ─────────────────────────────────────────────────────────────────
   Côté CLIENT (session obligatoire) :
     GET  /api/threads              → ses propres threads uniquement
     POST /api/threads              → ouvrir un nouveau thread
     POST /api/threads/:id/reply    → répondre dans un thread
     PATCH /api/threads/:id/read    → marquer les messages admin comme lus
   Côté ADMIN (admin auth obligatoire) :
     GET  /api/admin/threads              → tous les threads
     POST /api/admin/threads/:id/reply    → répondre à un client
     POST /api/admin/threads/send         → créer un thread pour 1 client
     POST /api/admin/threads/send-bulk    → créer des threads privés pour N clients
     PATCH /api/admin/threads/:id         → modifier status / priority / tags
     DELETE /api/admin/threads/:id        → supprimer un thread
═══════════════════════════════════════════════════════════════════ */

function threadUid() {
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
}
function msgUid() {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
}
function nowIso() { return new Date().toISOString(); }

/* ── CLIENT : GET /api/threads ── */
app.get('/api/threads', (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ ok: false, error: 'Non connecté' });
  const mine = THREADS.filter(t => t.userId === session.email)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  res.json({ ok: true, threads: mine });
});

/* ── CLIENT : POST /api/threads/upload ── joindre une photo (demande sur mesure, etc.) */
app.post('/api/threads/upload', requireCsrf, (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ ok: false, error: 'Non connecté' });

  const { data, mimeType } = req.body;
  if (!data || typeof data !== 'string')
    return res.status(400).json({ ok: false, error: 'Image manquante (base64)' });

  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const mime = mimeType || 'image/jpeg';
  if (!allowed.includes(mime))
    return res.status(400).json({ ok: false, error: 'Type non autorisé' });

  const ext = mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : mime === 'image/gif' ? '.gif' : '.jpg';
  const base64Data = data.replace(/^data:image\/[a-z+]+;base64,/, '');
  let buffer;
  try { buffer = Buffer.from(base64Data, 'base64'); } catch {
    return res.status(400).json({ ok: false, error: 'Données base64 invalides' });
  }
  if (buffer.length > 8 * 1024 * 1024)
    return res.status(400).json({ ok: false, error: 'Image trop grande (max 8 Mo)' });

  const uploadsDir = path.join(__dirname, 'public', 'uploads', 'threads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  const safeName = `thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
  try { fs.writeFileSync(path.join(uploadsDir, safeName), buffer); } catch {
    return res.status(500).json({ ok: false, error: 'Erreur sauvegarde fichier' });
  }

  writeLog('access', { event: 'thread_photo_uploaded', user: session.email, file: safeName, size: buffer.length });
  res.json({ ok: true, url: `/uploads/threads/${safeName}` });
});

/* ── CLIENT : POST /api/threads ── ouvrir un nouveau thread */
app.post('/api/threads', requireCsrf, (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ ok: false, error: 'Non connecté' });
  const subject = sanitize(req.body.subject || '', 200).trim();
  const text    = sanitize(req.body.text    || '', 4000).trim();
  if (!subject || !text) return res.status(400).json({ ok: false, error: 'Sujet et message requis.' });
  const now = nowIso();
  const thread = {
    id: threadUid(), userId: session.email, userName: session.name || session.email,
    subject, status: 'open', priority: 'normal', tags: [],
    createdAt: now, updatedAt: now,
    messages: [{ id: msgUid(), from: 'client', text, at: now, readByAdmin: false, readByClient: true }]
  };
  THREADS.push(thread);
  persistThreads();
  res.json({ ok: true, thread });
});

/* ── CLIENT : POST /api/threads/:id/reply ── */
app.post('/api/threads/:id/reply', requireCsrf, (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ ok: false, error: 'Non connecté' });
  const thread = THREADS.find(t => t.id === req.params.id && t.userId === session.email);
  if (!thread) return res.status(404).json({ ok: false, error: 'Conversation introuvable.' });
  if (thread.status === 'closed') return res.status(400).json({ ok: false, error: 'Cette conversation est fermée.' });
  const text = sanitize(req.body.text || '', 4000).trim();
  if (!text) return res.status(400).json({ ok: false, error: 'Message vide.' });
  const now = nowIso();
  const msg = { id: msgUid(), from: 'client', text, at: now, readByAdmin: false, readByClient: true };
  thread.messages.push(msg);
  thread.updatedAt = now;
  persistThreads();
  res.json({ ok: true, message: msg });
});

/* ── CLIENT : PATCH /api/threads/:id/read ── marquer messages admin comme lus */
app.patch('/api/threads/:id/read', requireCsrf, (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ ok: false, error: 'Non connecté' });
  const thread = THREADS.find(t => t.id === req.params.id && t.userId === session.email);
  if (!thread) return res.status(404).json({ ok: false, error: 'Conversation introuvable.' });
  thread.messages.forEach(m => { if (m.from === 'admin') m.readByClient = true; });
  persistThreads();
  res.json({ ok: true });
});

/* ── ADMIN : GET /api/admin/threads ── tous les threads */
app.get('/api/admin/threads', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Accès refusé.' });
  const sorted = [...THREADS].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  res.json({ ok: true, threads: sorted });
});

/* ── ADMIN : POST /api/admin/threads/:id/reply ── */
app.post('/api/admin/threads/:id/reply', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Accès refusé.' });
  const thread = THREADS.find(t => t.id === req.params.id);
  if (!thread) return res.status(404).json({ ok: false, error: 'Conversation introuvable.' });
  const text = sanitize(req.body.text || '', 4000).trim();
  if (!text) return res.status(400).json({ ok: false, error: 'Message vide.' });
  const now = nowIso();
  const msg = { id: msgUid(), from: 'admin', text, at: now, readByAdmin: true, readByClient: false };
  thread.messages.push(msg);
  thread.updatedAt = now;
  if (thread.status === 'closed') thread.status = 'open';
  persistThreads();
  res.json({ ok: true, message: msg });
});

/* ── ADMIN : POST /api/admin/threads/send ── créer un thread pour 1 client */
app.post('/api/admin/threads/send', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Accès refusé.' });
  const userId   = sanitize(req.body.userId   || '', 254).trim().toLowerCase();
  const userName = sanitize(req.body.userName || '', 100).trim();
  const subject  = sanitize(req.body.subject  || '', 200).trim();
  const text     = sanitize(req.body.text     || '', 4000).trim();
  if (!userId || !subject || !text) return res.status(400).json({ ok: false, error: 'userId, sujet et message requis.' });
  const now = nowIso();
  const thread = {
    id: threadUid(), userId, userName: userName || userId,
    subject, status: 'open', priority: 'normal', tags: [],
    createdAt: now, updatedAt: now,
    messages: [{ id: msgUid(), from: 'admin', text, at: now, readByAdmin: true, readByClient: false }]
  };
  THREADS.push(thread);
  persistThreads();
  res.json({ ok: true, thread });
});

/* ── ADMIN : POST /api/admin/threads/send-bulk ── thread privé par client */
app.post('/api/admin/threads/send-bulk', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Accès refusé.' });
  const userIds = (req.body.userIds || []).slice(0, 500);
  const subject = sanitize(req.body.subject || '', 200).trim();
  const text    = sanitize(req.body.text    || '', 4000).trim();
  if (!userIds.length || !subject || !text)
    return res.status(400).json({ ok: false, error: 'userIds, sujet et message requis.' });
  const now = nowIso();
  const created = [];
  userIds.forEach(rawId => {
    const userId = sanitize(String(rawId), 254).trim().toLowerCase();
    if (!userId) return;
    const existing = THREADS.find(t => t.userId === userId);
    const thread = {
      id: threadUid(), userId, userName: existing?.userName || userId,
      subject, status: 'open', priority: 'normal', tags: [],
      createdAt: now, updatedAt: now,
      messages: [{ id: msgUid(), from: 'admin', text, at: now, readByAdmin: true, readByClient: false }]
    };
    THREADS.push(thread);
    created.push(thread.id);
  });
  persistThreads();
  res.json({ ok: true, created: created.length });
});

/* ── ADMIN : PATCH /api/admin/threads/:id ── modifier status / priority / tags */
app.patch('/api/admin/threads/:id', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Accès refusé.' });
  const thread = THREADS.find(t => t.id === req.params.id);
  if (!thread) return res.status(404).json({ ok: false, error: 'Conversation introuvable.' });
  if (req.body.status   !== undefined) thread.status   = ['open','closed'].includes(req.body.status) ? req.body.status : thread.status;
  if (req.body.priority !== undefined) thread.priority = ['normal','urgent'].includes(req.body.priority) ? req.body.priority : thread.priority;
  if (Array.isArray(req.body.tags))    thread.tags     = req.body.tags.map(t => sanitize(String(t), 30)).slice(0, 10);
  thread.updatedAt = nowIso();
  persistThreads();
  res.json({ ok: true, thread });
});

/* ── ADMIN : DELETE /api/admin/threads/:id ── supprimer */
app.delete('/api/admin/threads/:id', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Accès refusé.' });
  const idx = THREADS.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'Conversation introuvable.' });
  THREADS.splice(idx, 1);
  persistThreads();
  res.json({ ok: true });
});

/* ── ADMIN : PATCH /api/admin/threads/:id/read ── marquer messages client comme lus */
app.patch('/api/admin/threads/:id/read', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Accès refusé.' });
  const thread = THREADS.find(t => t.id === req.params.id);
  if (!thread) return res.status(404).json({ ok: false, error: 'Conversation introuvable.' });
  thread.messages.forEach(m => { if (m.from === 'client') m.readByAdmin = true; });
  persistThreads();
  res.json({ ok: true });
});

/** POST /api/aide — demande de produit spécifique */
app.post('/api/aide', (req, res) => {
  const { name, email, category, description, budget } = req.body;

  if (!name || !email || !description)
    return res.status(400).json({ ok: false, error: 'Nom, email et description sont requis.' });
  if (!EMAIL_RE.test(email) || email.length > 254)
    return res.status(400).json({ ok: false, error: 'Email invalide.' });

  const safe = {
    name:        sanitize(name, 100),
    email:       sanitize(email, 254).toLowerCase(),
    category:    sanitize(category || '', 50),
    description: sanitize(description, 1000),
    budget:      sanitize(String(budget || ''), 50),
  };

  writeLog('aide', safe);
  console.log(`[AIDE] Demande de ${safe.name} <${safe.email}> — ${safe.category} — ${safe.description.slice(0, 80)}`);
  res.json({ ok: true });
});

/** GET /api/admin/tokens (admin) — pour la page de test */
app.get('/api/admin/tokens', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Non autorisé' });
  res.json({ ok: true, tokens: TOKENS });
});

/** GET /api/orders (admin) */
app.get('/api/orders', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Non autorisé' });
  res.json({ ok: true, orders, total: orders.length });
});

/** GET /api/orders/mine — commandes de l'utilisateur connecté */
app.get('/api/orders/mine', (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ ok: false, error: 'Non connecté' });
  const mine = orders.filter(o => o.email === session.email);
  res.json({ ok: true, orders: mine });
});

/** GET /api/orders/:id — détail d'une commande (propriétaire ou admin) */
app.get('/api/orders/:id', (req, res) => {
  const session = getSession(req);
  const order   = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ ok: false, error: 'Commande introuvable' });
  if (isAdmin(req)) return res.json({ ok: true, order });
  if (!session || (order.email && order.email !== session.email)) {
    return res.status(403).json({ ok: false, error: 'Non autorisé' });
  }
  res.json({ ok: true, order });
});

/** POST /api/orders/:id/cancel — annuler une commande */
app.post('/api/orders/:id/cancel', requireCsrf, (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ ok: false, error: 'Non connecté' });

  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ ok: false, error: 'Commande introuvable' });
  if (order.email && order.email !== session.email)
    return res.status(403).json({ ok: false, error: 'Non autorisé' });
  const CANCELLABLE = ['pending_payment', 'pending_virement', 'pending_crypto', 'confirmed'];
  if (!CANCELLABLE.includes(order.status))
    return res.status(400).json({ ok: false, error: 'Cette commande ne peut plus être annulée' });

  order.status       = 'cancelled';
  order.cancelledAt  = new Date().toISOString();
  const { reason } = req.body;
  if (reason) order.cancelReason = sanitize(String(reason), 200);
  persistOrders();
  writeLog('access', { event: 'order_cancelled', orderId: order.id, reason: order.cancelReason || null });
  res.json({ ok: true });
});

/* ─────────────────────────────────────────
   STRIPE
   ───────────────────────────────────────── */

/** GET /api/stripe/config — retourne la clé publique (safe to expose) */
app.get('/api/stripe/config', (req, res) => {
  if (!process.env.STRIPE_PUBLISHABLE_KEY)
    return res.json({ ok: false, configured: false });
  res.json({ ok: true, publishableKey: process.env.STRIPE_PUBLISHABLE_KEY });
});

/**
 * POST /api/create-payment-intent
 * Valide le panier côté serveur, crée un PaymentIntent Stripe.
 * Retourne uniquement le client_secret (opaque côté serveur).
 * Aucune donnée carte ne transite ici.
 */
app.post('/api/create-payment-intent', requireCsrfIfAuthenticated, async (req, res) => {
  if (!stripe)
    return res.status(501).json({ ok: false, error: 'Stripe non configuré. Définissez STRIPE_SECRET_KEY et STRIPE_PUBLISHABLE_KEY dans votre .env.' });

  /* ── Anti-abus : limite 5 tentatives / 15 min par IP ── */
  const rateCheck = _checkPayLimit(req.ip);
  if (!rateCheck.ok) {
    const waitMin = Math.ceil(rateCheck.waitSec / 60);
    writeLog('security', { event: 'payment_intent_blocked', ip: req.ip, waitSec: rateCheck.waitSec });
    return res.status(429).json({ ok: false, error: `Trop de tentatives de paiement. Réessayez dans ${waitMin} minute(s).`, waitSec: rateCheck.waitSec });
  }

  const { items, customerEmail, shippingAddress, parrainCode, originalOrderId } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ ok: false, error: 'Panier vide ou invalide' });
  if (items.length > 50)
    return res.status(400).json({ ok: false, error: 'Panier limité à 50 références' });
  if (customerEmail && !EMAIL_RE.test(customerEmail))
    return res.status(400).json({ ok: false, error: 'Email invalide' });

  /* Recalcul côté serveur — le client ne fixe jamais le prix */
  let subtotal = 0;
  const validatedItems = [];
  for (const item of items) {
    if (typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(item.id))
      return res.status(400).json({ ok: false, error: 'ID produit invalide' });
    let found = null;
    for (const prods of Object.values(PRODUCTS)) {
      found = prods.find(p => p.id === item.id);
      if (found) break;
    }
    if (!found) return res.status(400).json({ ok: false, error: `Produit introuvable: ${item.id}` });
    const qty = Math.max(1, Math.min(Math.floor(Number(item.qty) || 1), 99, found.stock));
    subtotal += _effectivePrice(found.id, found.price) * qty;
    validatedItems.push({ ...found, qty });
  }

  const shipping     = calcShipping(shippingAddress?.country, subtotal);
  const discount     = _parrainDiscountAmount(parrainCode, customerEmail) || _voucherDiscountAmount(parrainCode, customerEmail);
  const total        = Math.round(Math.max(0, subtotal + shipping - discount) * 100) / 100;
  const amountCents  = Math.round(total * 100);

  try {
    const pi = await stripe.paymentIntents.create({
      amount:   amountCents,
      currency: 'eur',
      automatic_payment_methods: { enabled: true },
      receipt_email: customerEmail || undefined,
      /* ── Stripe Radar — données contextuelles pour la détection de fraude ── */
      metadata: {
        customerEmail:  sanitize(customerEmail || '', 200),
        itemCount:      String(validatedItems.length),
        shippingCents:  String(Math.round(shipping * 100)),
        discountCents:  String(Math.round(discount * 100)),
        parrainCode:      parrainCode ? String(parrainCode).toUpperCase().trim() : '',
        itemsSummary:     validatedItems.map(i => `${i.id}x${i.qty}`).join(',').slice(0, 500),
        clientIp:         req.ip || '',
        userAgent:        (req.headers['user-agent'] || '').slice(0, 200),
        shippingCountry:  shippingAddress?.country || 'FR',
        shippingRue:      sanitize(shippingAddress?.rue  || '', 200).slice(0, 500),
        shippingZip:      sanitize(shippingAddress?.zip  || '', 20),
        shippingCity:     sanitize(shippingAddress?.city || '', 100),
        originalOrderId:  originalOrderId ? String(originalOrderId).slice(0, 50) : '',
      },
      /* ── 3D Secure / SCA — demandé automatiquement par Stripe Radar ── */
      payment_method_options: {
        card: {
          request_three_d_secure: 'automatic',
          /* Stripe affiche la CVV comme obligatoire (déjà par défaut, explicite ici) */
        },
      },
      /* Descriptor sur le relevé bancaire du client */
      statement_descriptor_suffix: 'LE CLAM',
    });

    writeLog('access', { event: 'payment_intent_created', piId: pi.id, amountCents, ip: req.ip });
    res.json({ ok: true, clientSecret: pi.client_secret, amount: total, shipping });
  } catch (err) {
    console.error('[STRIPE] Erreur PaymentIntent:', err.message);
    writeLog('error', { event: 'payment_intent_failed', error: err.message, ip: req.ip });
    res.status(500).json({ ok: false, error: 'Erreur lors de la création du paiement.' });
  }
});

/**
 * POST /api/orders/confirm
 * Vérifie le PaymentIntent avec l'API Stripe (status === 'succeeded'),
 * puis crée la commande. Seule façon valide d'enregistrer une commande carte.
 * Idempotent : renvoie la commande existante si le PI a déjà été traité.
 */
app.post('/api/orders/confirm', requireCsrfIfAuthenticated, async (req, res) => {
  if (!stripe)
    return res.status(501).json({ ok: false, error: 'Stripe non configuré.' });

  const { paymentIntentId, items, customerEmail, shippingAddress, parrainCode: bodyParrainCode } = req.body;

  if (typeof paymentIntentId !== 'string' || !/^pi_[a-zA-Z0-9_]+$/.test(paymentIntentId))
    return res.status(400).json({ ok: false, error: 'paymentIntentId invalide.' });

  /* Idempotence : éviter les doublons si confirmation.html est rechargé */
  const existing = orders.find(o => o.paymentIntentId === paymentIntentId);
  if (existing)
    return res.json({ ok: true, orderId: existing.id, total: existing.total, shipping: existing.shipping, alreadyRecorded: true });

  /* Vérifier avec Stripe que le paiement est bien réussi */
  let pi;
  try {
    pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  } catch {
    return res.status(400).json({ ok: false, error: 'PaymentIntent introuvable.' });
  }
  if (pi.status !== 'succeeded')
    return res.status(402).json({ ok: false, error: `Paiement non finalisé (statut : ${pi.status})` });

  /* Revalider les articles et recalculer le montant */
  if (!items || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ ok: false, error: 'Panier vide ou invalide' });

  let subtotal = 0;
  const validatedItems = [];
  for (const item of items) {
    if (typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(item.id))
      return res.status(400).json({ ok: false, error: 'ID produit invalide' });
    let found = null;
    for (const prods of Object.values(PRODUCTS)) {
      found = prods.find(p => p.id === item.id);
      if (found) break;
    }
    if (!found) return res.status(400).json({ ok: false, error: `Produit introuvable: ${item.id}` });
    const qty = Math.max(1, Math.min(Math.floor(Number(item.qty) || 1), 99, found.stock));
    subtotal += _effectivePrice(found.id, found.price) * qty;
    validatedItems.push({ ...found, qty });
  }

  const shipping      = calcShipping(shippingAddress?.country, subtotal);
  /* Récupère le code parrain depuis le body OU depuis les métadonnées du PI */
  const parrainCode     = pi.metadata?.parrainCode || bodyParrainCode || null; /* PI metadata = source de confiance serveur */
  const originalOrderId = pi.metadata?.originalOrderId || req.body.originalOrderId || null;
  const discount      = _parrainDiscountAmount(parrainCode, customerEmail) || _voucherDiscountAmount(parrainCode, customerEmail);
  const total         = Math.round(Math.max(0, subtotal + shipping - discount) * 100) / 100;
  const expectedCents = Math.round(total * 100);

  /* Vérification croisée du montant — détecte toute manipulation */
  if (pi.amount !== expectedCents) {
    console.error(`[STRIPE] Incohérence montant: PI=${pi.amount}cts, attendu=${expectedCents}cts | items=${JSON.stringify(items.map(i=>({id:i.id,qty:i.qty})))} | country=${shippingAddress?.country||'?'} | subtotal=${subtotal} | shipping=${shipping} | discount=${discount}`);
    writeLog('security', { event: 'amount_mismatch', piId: paymentIntentId, piAmount: pi.amount, expected: expectedCents });
    return res.status(400).json({ ok: false, error: 'Incohérence de montant. Contactez le support.' });
  }

  const safeAddr = shippingAddress ? {
    rue:     sanitize(shippingAddress.rue     || '', 200),
    zip:     sanitize(shippingAddress.zip     || '', 20),
    city:    sanitize(shippingAddress.city    || '', 100),
    country: sanitize(shippingAddress.country || '', 60),
  } : null;

  const order = {
    id:              `ORDER-${Date.now()}`,
    paymentIntentId,
    paymentMethod:   'stripe_card',
    items:           validatedItems,
    total,
    shipping,
    discount:        discount || undefined,
    email:           customerEmail ? sanitize(customerEmail, 200) : null,
    shippingAddress: safeAddr,
    status:          'confirmed',
    createdAt:       new Date().toISOString(),
    originalOrderId: originalOrderId || undefined,
  };

  orders.push(order);
  persistOrders();
  _releasePayLimit(req.ip); /* succès → on réinitialise le compteur anti-abus pour cette IP */
  writeLog('access', { event: 'order_confirmed_stripe', orderId: order.id, piId: paymentIntentId, total });
  console.log(`[ORDER] ${order.id} — ${order.total}€ — Stripe ${paymentIntentId}`);

  notifyOwner(order).catch(err => console.error('[EMAIL] Notif propriétaire:', err.message));
  notifySupplier(order).catch(err => console.error('[EMAIL] Fournisseur:', err.message));
  sendOrderConfirmation(order).catch(err => console.error('[EMAIL] Confirmation client:', err.message));
  createInvoice(order).catch(err => console.error('[INVOICE] Erreur:', err.message));
  if (parrainCode) { _registerParrainUse(parrainCode, customerEmail).catch(() => {}); _markVoucherUsed(parrainCode, order.id); }

  res.json({ ok: true, orderId: order.id, total: order.total, shipping });
});

/* ─────────────────────────────────────────
   ADMIN — SÉCURITÉ
   ───────────────────────────────────────── */

/**
 * POST /api/admin/sessions/purge
 * Invalide toutes les sessions actives (utile après une fuite de tokens)
 */
app.post('/api/admin/sessions/purge', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Non autorisé' });
  const count        = Object.keys(SESSIONS).length;
  const countRefresh = Object.keys(REFRESH_TOKENS).length;
  Object.keys(SESSIONS).forEach(k => delete SESSIONS[k]);
  Object.keys(REFRESH_TOKENS).forEach(k => delete REFRESH_TOKENS[k]);
  persistSessions();
  console.error(`[SECURITY] Purge forcée : ${count} session(s), ${countRefresh} refresh token(s) invalidé(s)`);
  writeLog('security', { event: 'sessions_purged', count, countRefresh });
  res.json({ ok: true, invalidated: count, invalidatedRefresh: countRefresh });
});

/* ─────────────────────────────────────────
   ADMIN — LOGS
   ───────────────────────────────────────── */

/**
 * GET /api/admin/logs?type=security&date=2026-05-06&lines=100
 * Retourne les N dernières lignes d'un fichier de log.
 * type   : access | security | error | aide  (défaut : security)
 * date   : YYYY-MM-DD (défaut : aujourd'hui)
 * lines  : nombre de lignes (max 500, défaut : 100)
 */
app.get('/api/admin/logs', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Non autorisé' });

  const type  = /^[a-z]+$/.test(req.query.type || '') ? (req.query.type || 'security') : 'security';
  const date  = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : new Date().toISOString().slice(0, 10);
  const lines = Math.min(500, Math.max(1, parseInt(req.query.lines) || 100));

  const file = path.join(LOG_DIR, `${type}-${date}.log`);
  if (!fs.existsSync(file)) return res.json({ ok: true, entries: [], file: `${type}-${date}.log` });

  try {
    const raw     = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
    const entries = raw.slice(-lines).map(l => { try { return JSON.parse(l); } catch { return { raw: l }; } });
    res.json({ ok: true, entries: entries.reverse(), total: raw.length, file: `${type}-${date}.log` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/admin/logs/files — liste tous les fichiers de logs disponibles
 */
app.get('/api/admin/logs/files', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Non autorisé' });
  try {
    const files = fs.readdirSync(LOG_DIR)
      .filter(f => f.endsWith('.log'))
      .map(f => {
        const stat = fs.statSync(path.join(LOG_DIR, f));
        return { name: f, size: stat.size, modified: stat.mtime };
      })
      .sort((a, b) => new Date(b.modified) - new Date(a.modified));
    res.json({ ok: true, files });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ─────────────────────────────────────────
   PROPOSITIONS SOURCING
   ───────────────────────────────────────── */
const SOURCING_FILE     = path.join(__dirname, 'data/sourcing-proposals.json');
const PRODUCTS_DATA_FILE = path.join(__dirname, 'public/js/products-data.js');
let _sourcingData = JSON.parse(fs.readFileSync(SOURCING_FILE, 'utf8'));
const getSourcing   = () => _sourcingData.proposals;
const persistSourcing = () => fs.writeFileSync(SOURCING_FILE, JSON.stringify(_sourcingData, null, 2));

/* Synchronise un produit validé dans products-data.js (ou le retire) */
function syncProductsData(proposal) {
  const raw = fs.readFileSync(PRODUCTS_DATA_FILE, 'utf8');
  const start = raw.indexOf('window.PRODUCTS_DATA = ') + 'window.PRODUCTS_DATA = '.length;
  const end   = raw.lastIndexOf('};') + 1;
  const header = raw.slice(0, start);
  let data;
  try { data = JSON.parse(raw.slice(start, end)); } catch { return; }

  /* categorie peut être une string ou un tableau pour le multi-famille */
  const cats = Array.isArray(proposal.categorie) ? proposal.categorie : [proposal.categorie];

  for (const cat of cats) {
    if (!data[cat]) continue;

    /* Toujours retirer l'ancienne entrée (si elle existait) */
    data[cat] = data[cat].filter(p => p.id !== proposal.id);

    /* Si validé → insérer en tête de catégorie */
    if (proposal.status === 'validated') {
      const entry = {
        id:         proposal.id,
        price:      proposal.prixVente,
        filter:     (proposal.filtres || []).join(','),
        images:     proposal.images || [],
        desc:       proposal.description || '',
        name_fr:    proposal.nom,
        sub_fr:     [proposal.subfamille, proposal.fournisseur].filter(Boolean).join(' · '),
        subfamille: proposal.subfamille || '',
      };
      if (proposal.prixFournisseur) entry.oldPrice = null;
      data[cat].unshift(entry);
    }
  }

  fs.writeFileSync(PRODUCTS_DATA_FILE, header + JSON.stringify(data, null, 2) + ';');
}

app.get('/api/admin/sourcing-proposals', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Non autorisé' });
  const { status, categorie } = req.query;
  let proposals = getSourcing();
  if (status) proposals = proposals.filter(p => p.status === status);
  if (categorie) proposals = proposals.filter(p => {
    const cats = Array.isArray(p.categorie) ? p.categorie : [p.categorie];
    return cats.includes(categorie);
  });
  res.json({ ok: true, proposals });
});

/* ── Proxy image (contourne hotlink protection AliExpress/CDN) ── */
app.get('/api/img-proxy', async (req, res) => {
  const url = req.query.url;
  if (!url || !/^https?:\/\//i.test(url)) return res.status(400).end();
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://www.aliexpress.com/',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return res.status(r.status).end();
    const ct = r.headers.get('content-type') || 'image/jpeg';
    res.set('Content-Type', ct);
    res.set('Cache-Control', 'public, max-age=86400');
    const buf = await r.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch (e) {
    res.status(502).end();
  }
});

app.patch('/api/admin/sourcing-proposals/:id', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Non autorisé' });
  const p = getSourcing().find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ ok: false, error: 'Proposition introuvable' });
  const allowed = ['status', 'rejectReason', 'validatedAt', 'rejectedAt', 'images'];
  allowed.forEach(key => { if (req.body[key] !== undefined) p[key] = req.body[key]; });
  persistSourcing();
  try { syncProductsData(p); } catch (e) { console.error('[sourcing sync]', e.message); }
  if (req.body.status === 'validated') {
    lauraGenerate(p).catch(e => console.error('[Laura] Erreur génération:', e.message));
  }
  res.json({ ok: true, proposal: p });
});

/* ─────────────────────────────────────────
   LAURA — Génération automatique quand produit validé
   ───────────────────────────────────────── */

async function lauraGenerate(proposal) {
  const key = process.env.GROQ_API_KEY;
  if (!key) { console.log('[Laura] GROQ_API_KEY absent — génération ignorée'); return; }

  const univers   = Array.isArray(proposal.categorie) ? proposal.categorie[0] : proposal.categorie;
  const univLbl   = { plaisir: 'Plaisir (bien-être intime)', malin: 'Malin (gadgets tendance)', bebe: 'Bébé (jouets & seconde main)' }[univers] || univers;
  const now       = new Date().toISOString().replace('T', ' ').slice(0, 16);
  const posts     = getSocialPosts();
  const nextNum   = (posts.filter(p => p.univers === univers).length + 1).toString().padStart(2, '0');
  const postId    = `post-${univers[0]}${nextNum}-val`;

  const prompt = `Tu es Laura, responsable marketing de Le Clam (e-commerce français).
Antoine vient de valider ce produit pour l'univers ${univLbl} :
- Nom : ${proposal.nom}
- Description sourcing : ${proposal.description || ''}
- Prix de vente : ${proposal.prixVente}€
- Raison du choix : ${proposal.raisonVente || ''}

Génère en une seule réponse JSON avec DEUX parties :

{
  "descriptionSite": "Description marketing du produit pour la page web — 2-3 phrases, bénéfice-first, ton Le Clam (chaleureux, direct, pas trop commercial). NE PAS mentionner de prix.",
  "post": {
    "id": "${postId}",
    "univers": "${univers}",
    "plateforme": "TikTok ou Instagram ou Les deux",
    "titre": "Titre accrocheur du post",
    "concept": "Ce qu'on filme ou photographie en 1-2 phrases concrètes",
    "legende": "Légende complète avec emojis et hashtags prête à copier-coller${univers === 'plaisir' ? ' — JAMAIS les mots sextoy/vibromasseur, utiliser masseur personnel/bien-être intime' : ''}",
    "cta": "Call-to-action",
    "dateCreation": "${now}",
    "statut": "pending",
    "source": "validation-antoine"
  }
}

Réponds UNIQUEMENT avec ce JSON valide, rien d'autre.`;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 1024, temperature: 0.6, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}`);
  const data  = await res.json();
  const text  = data.choices[0].message.content.trim();

  let parsed;
  try { parsed = JSON.parse(text); }
  catch { const m = text.match(/\{[\s\S]*\}/); if (!m) throw new Error('JSON invalide'); parsed = JSON.parse(m[0]); }

  /* Mettre à jour la description du produit sur le site */
  if (parsed.descriptionSite) {
    proposal.description = parsed.descriptionSite;
    persistSourcing();
    try { syncProductsData(proposal); } catch {}
    console.log(`[Laura] Description site mise à jour pour ${proposal.id}`);
  }

  /* Ajouter le post social */
  if (parsed.post) {
    const sd = getSocialData();
    const imageUrl = proposal.images && proposal.images[0] ? proposal.images[0] : null;
    sd.posts.push({ ...parsed.post, imageUrl, produitId: proposal.id, produitNom: proposal.nom });
    persistSocial(sd);
    console.log(`[Laura] Post ${parsed.post.id} créé pour ${proposal.nom}`);
  }
}

/* ─────────────────────────────────────────
   LAURA — Posts TikTok/Instagram
   ───────────────────────────────────────── */
const SOCIAL_FILE = path.join(__dirname, 'data/social-posts.json');
const getSocialData    = () => fs.existsSync(SOCIAL_FILE) ? JSON.parse(fs.readFileSync(SOCIAL_FILE, 'utf8')) : { posts: [] };
const getSocialPosts   = () => getSocialData().posts;
const persistSocial    = (data) => fs.writeFileSync(SOCIAL_FILE, JSON.stringify(data, null, 2));

app.get('/api/admin/social-posts', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Non autorisé' });
  const { statut, univers, plateforme } = req.query;
  let posts = getSocialPosts();
  if (statut)     posts = posts.filter(p => (p.statut||'pending') === statut);
  if (univers)    posts = posts.filter(p => p.univers === univers);
  if (plateforme) posts = posts.filter(p => p.plateforme === plateforme);
  res.json({ ok: true, posts });
});

app.patch('/api/admin/social-posts/:id', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Non autorisé' });
  const sd = getSocialData();
  const p = sd.posts.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ ok: false, error: 'Post introuvable' });
  const allowed = ['statut', 'posteAt', 'datePostSuggere'];
  allowed.forEach(key => { if (req.body[key] !== undefined) p[key] = req.body[key]; });
  persistSocial(sd);
  res.json({ ok: true, post: p });
});

/* ─────────────────────────────────────────
   Fallback → index.html (SPA-like)
   ───────────────────────────────────────── */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ─────────────────────────────────────────
   STRIPE CHECKOUT (redirection)
   ───────────────────────────────────────── */

/** POST /api/stripe/checkout — crée une Checkout Session et retourne l'URL de redirection */
app.post('/api/stripe/checkout', requireCsrfIfAuthenticated, async (req, res) => {
  if (!stripe)
    return res.status(501).json({ ok: false, error: 'Stripe non configuré. Définissez STRIPE_SECRET_KEY dans votre .env.' });

  const { items, customerEmail, shippingAddress } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ ok: false, error: 'Panier vide ou invalide' });
  if (customerEmail && !EMAIL_RE.test(customerEmail))
    return res.status(400).json({ ok: false, error: 'Email invalide' });

  let subtotal = 0;
  const lineItems = [];
  for (const item of items) {
    if (typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(item.id))
      return res.status(400).json({ ok: false, error: 'ID produit invalide' });
    let found = null;
    for (const prods of Object.values(PRODUCTS)) { found = prods.find(p => p.id === item.id); if (found) break; }
    if (!found) return res.status(400).json({ ok: false, error: `Produit introuvable: ${item.id}` });
    const qty = Math.max(1, Math.min(Math.floor(Number(item.qty) || 1), 99));
    subtotal += _effectivePrice(found.id, found.price) * qty;
    lineItems.push({ price_data: { currency: 'eur', product_data: { name: found.name || found.id }, unit_amount: Math.round(_effectivePrice(found.id, found.price) * 100) }, quantity: qty });
  }

  const shipping    = calcShipping(shippingAddress?.country, subtotal);
  const domain      = process.env.DOMAIN || 'http://localhost:3000';

  try {
    const sessionParams = {
      mode:           'payment',
      customer_email: customerEmail || undefined,
      line_items:     lineItems,
      success_url:    `${domain}/confirmation.html?stripe_session={CHECKOUT_SESSION_ID}`,
      cancel_url:     `${domain}/paiement.html`,
      metadata:       { shippingAddr: JSON.stringify(shippingAddress || {}).slice(0, 500) },
    };
    if (shipping > 0) {
      sessionParams.shipping_options = [{ shipping_rate_data: { type: 'fixed_amount', fixed_amount: { amount: Math.round(shipping * 100), currency: 'eur' }, display_name: 'Livraison', delivery_estimate: { minimum: { unit: 'business_day', value: 3 }, maximum: { unit: 'business_day', value: 7 } } } }];
    }
    const session = await stripe.checkout.sessions.create(sessionParams);
    writeLog('access', { event: 'stripe_checkout_created', sessionId: session.id });
    res.json({ ok: true, url: session.url });
  } catch (err) {
    console.error('[STRIPE] Checkout Session error:', err.message);
    res.status(500).json({ ok: false, error: 'Erreur Stripe : ' + err.message });
  }
});

/** POST /api/stripe/verify-session — vérifie la session après retour Stripe, crée la commande */
app.post('/api/stripe/verify-session', requireCsrfIfAuthenticated, async (req, res) => {
  if (!stripe) return res.status(501).json({ ok: false, error: 'Stripe non configuré' });
  const { sessionId } = req.body;
  if (!sessionId || typeof sessionId !== 'string') return res.status(400).json({ ok: false, error: 'sessionId requis' });
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['line_items'] });
    if (session.payment_status !== 'paid') return res.json({ ok: false, error: 'Paiement non finalisé' });
    const existing = orders.find(o => o.stripeSessionId === sessionId);
    if (existing) return res.json({ ok: true, orderId: existing.id, total: existing.total, alreadyCreated: true });
    const orderId  = 'STR-' + Date.now().toString(36).toUpperCase();
    const total    = session.amount_total / 100;
    const shipping = (session.shipping_cost?.amount_total || 0) / 100;
    let shippingAddress = {};
    try { shippingAddress = JSON.parse(session.metadata?.shippingAddr || '{}'); } catch {}
    const order = { id: orderId, email: session.customer_email || '', total, shipping, items: [], shippingAddress, paymentMethod: 'stripe_card', stripeSessionId: sessionId, status: 'processing', createdAt: new Date().toISOString() };
    orders.push(order);
    persistOrders();
    writeLog('access', { event: 'order_confirmed_stripe_checkout', orderId, total });
    res.json({ ok: true, orderId, total });
  } catch (err) {
    console.error('[STRIPE] verify-session error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** POST /api/stripe/report-failure — client signale un échec de paiement (carte refusée, 3DS échoué, etc.)
 *  Incrémente le compteur anti-abus pour cette IP. Aucune donnée carte ne transite ici. */
app.post('/api/stripe/report-failure', authLimiter, (req, res) => {
  const { error: errMsg, code } = req.body || {};
  _incPayFailure(req.ip);
  const rec  = _payAttempts.get(req.ip) || {};
  const now  = Date.now();
  writeLog('security', { event: 'stripe_payment_failed', ip: req.ip, error: String(errMsg || '').slice(0, 200), code: String(code || '').slice(0, 50) });
  res.json({ ok: true, attempts: rec.count || 1, blocked: (rec.blockedUntil || 0) > now, waitSec: rec.blockedUntil > now ? Math.ceil((rec.blockedUntil - now) / 1000) : 0 });
});

/* ─────────────────────────────────────────
   PAYPAL CHECKOUT (redirection)
   Variables requises : PAYPAL_CLIENT_ID, PAYPAL_SECRET
   PAYPAL_ENV=sandbox (défaut) ou production
   ───────────────────────────────────────── */

/* Ordres PayPal en attente — persistés pour survivre aux redémarrages serveur */
const _ppPending = (() => {
  const raw = loadJSON(PP_PENDING_FILE, {});
  /* Purge les entrées de plus de 3h (expiration PayPal order) */
  const cutoff = Date.now() - 3 * 60 * 60 * 1000;
  for (const k of Object.keys(raw)) { if (new Date(raw[k].createdAt).getTime() < cutoff) delete raw[k]; }
  return raw;
})();
function _persistPpPending() { saveJSON(PP_PENDING_FILE, _ppPending); }

const PAYPAL_BASE = (process.env.PAYPAL_ENV === 'production')
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

/* Validation au démarrage */
(function _checkPaypalConfig() {
  const id  = process.env.PAYPAL_CLIENT_ID;
  const sec = process.env.PAYPAL_SECRET;
  const env = process.env.PAYPAL_ENV || 'sandbox';
  if (!id || !sec) {
    console.warn('[PAYPAL] ⚠  Non configuré — ajoutez PAYPAL_CLIENT_ID et PAYPAL_SECRET dans .env');
  } else {
    const mode = env === 'production' ? 'LIVE (production)' : 'SANDBOX (test)';
    console.log(`[PAYPAL] ✓ Configuré — mode ${mode} → ${PAYPAL_BASE}`);
  }
})();

async function _paypalAccessToken() {
  const id  = process.env.PAYPAL_CLIENT_ID;
  const sec = process.env.PAYPAL_SECRET;
  if (!id || !sec) throw new Error('PAYPAL_CLIENT_ID / PAYPAL_SECRET manquants dans .env');
  const creds = Buffer.from(`${id}:${sec}`).toString('base64');
  return new Promise((resolve, reject) => {
    const body = 'grant_type=client_credentials';
    const opts = {
      method: 'POST',
      headers: { 'Authorization': 'Basic ' + creds, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': body.length },
    };
    const req = require('https').request(PAYPAL_BASE + '/v1/oauth2/token', opts, r => {
      let buf = '';
      r.on('data', c => buf += c);
      r.on('end', () => {
        try {
          const data = JSON.parse(buf);
          if (!data.access_token) {
            const detail = data.error_description || data.message || JSON.stringify(data);
            console.error(`[PAYPAL] Auth échouée (HTTP ${r.statusCode}) : ${detail}`);
            reject(new Error(`PayPal auth échouée (${r.statusCode}) : ${detail}`));
          } else {
            resolve(data.access_token);
          }
        } catch {
          reject(new Error(`PayPal token invalide — réponse non-JSON (HTTP ${r.statusCode})`));
        }
      });
    });
    req.on('error', e => { console.error('[PAYPAL] Réseau :', e.message); reject(e); });
    req.write(body); req.end();
  });
}

async function _paypalPost(path, body, token) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const opts = {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    };
    const req = require('https').request(PAYPAL_BASE + path, opts, r => {
      let buf = '';
      r.on('data', c => buf += c);
      r.on('end', () => {
        try {
          const parsed = JSON.parse(buf);
          if (r.statusCode >= 400) {
            const detail = parsed.message || parsed.name || parsed.details?.[0]?.description || JSON.stringify(parsed);
            console.error(`[PAYPAL] ${path} → HTTP ${r.statusCode} : ${detail}`);
            reject(new Error(`PayPal ${r.statusCode} : ${detail}`));
          } else {
            resolve(parsed);
          }
        } catch {
          reject(new Error(`PayPal réponse invalide (HTTP ${r.statusCode})`));
        }
      });
    });
    req.on('error', e => { console.error('[PAYPAL] Réseau :', e.message); reject(e); });
    req.write(data); req.end();
  });
}

/** POST /api/paypal/create-order — crée un ordre PayPal et retourne l'URL d'approbation */
app.post('/api/paypal/create-order', requireCsrfIfAuthenticated, async (req, res) => {
  const { items, customerEmail, shippingAddress, parrainCode } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ ok: false, error: 'Panier vide ou invalide' });

  let subtotal = 0;
  const itemDetails = [];
  for (const item of items) {
    if (typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(item.id))
      return res.status(400).json({ ok: false, error: 'ID produit invalide' });
    let found = null;
    for (const prods of Object.values(PRODUCTS)) { found = prods.find(p => p.id === item.id); if (found) break; }
    if (!found) return res.status(400).json({ ok: false, error: `Produit introuvable: ${item.id}` });
    const qty = Math.max(1, Math.min(Math.floor(Number(item.qty) || 1), 99));
    subtotal += _effectivePrice(found.id, found.price) * qty;
    itemDetails.push({ name: (found.name || found.id).slice(0, 127), quantity: String(qty), unit_amount: { currency_code: 'EUR', value: found.price.toFixed(2) } });
  }

  const shipping  = calcShipping(shippingAddress?.country, subtotal);
  const discount  = _parrainDiscountAmount(parrainCode, customerEmail) || _voucherDiscountAmount(parrainCode, customerEmail);
  const total     = Math.max(0, subtotal + shipping - discount).toFixed(2);
  const domain    = process.env.DOMAIN || 'http://localhost:3000';

  try {
    const token = await _paypalAccessToken();
    const order = await _paypalPost('/v2/checkout/orders', {
      intent: 'CAPTURE',
      purchase_units: [{ amount: { currency_code: 'EUR', value: total, breakdown: { item_total: { currency_code: 'EUR', value: subtotal.toFixed(2) }, shipping: { currency_code: 'EUR', value: shipping.toFixed(2) }, discount: discount > 0 ? { currency_code: 'EUR', value: discount.toFixed(2) } : undefined } }, items: itemDetails }],
      application_context: { brand_name: 'Le Clam', locale: 'fr-FR', landing_page: 'LOGIN', user_action: 'PAY_NOW', return_url: `${domain}/confirmation.html?paypal=1`, cancel_url: `${domain}/paiement.html` },
    }, token);

    const approveLink = (order.links || []).find(l => l.rel === 'approve')?.href;
    if (!approveLink) return res.status(500).json({ ok: false, error: 'Lien PayPal introuvable' });

    _ppPending[order.id] = { paypalOrderId: order.id, items, shippingAddress, customerEmail, subtotal, shipping: Number(shipping.toFixed(2)), discount, parrainCode: parrainCode || null, total: Number(total), createdAt: new Date().toISOString() };
    _persistPpPending();
    writeLog('access', { event: 'paypal_order_created', paypalOrderId: order.id });
    res.json({ ok: true, url: approveLink });
  } catch (err) {
    const notConfigured = err.message.includes('manquants dans .env');
    console.error('[PAYPAL] create-order :', err.message);
    res.status(notConfigured ? 503 : 500).json({
      ok: false,
      error: notConfigured
        ? 'PayPal non configuré sur ce serveur. Choisissez une autre méthode de paiement.'
        : 'Erreur PayPal : ' + err.message,
    });
  }
});

/** POST /api/paypal/capture-order — capture après approbation utilisateur */
app.post('/api/paypal/capture-order', requireCsrfIfAuthenticated, async (req, res) => {
  const { token: paypalOrderId } = req.body;
  if (!paypalOrderId || typeof paypalOrderId !== 'string') return res.status(400).json({ ok: false, error: 'token PayPal requis' });
  try {
    const accessToken = await _paypalAccessToken();
    const capture = await _paypalPost(`/v2/checkout/orders/${paypalOrderId}/capture`, {}, accessToken);
    if (capture.status !== 'COMPLETED') return res.json({ ok: false, error: 'Paiement PayPal non finalisé : ' + capture.status });

    const pending = _ppPending[paypalOrderId] || {};
    delete _ppPending[paypalOrderId];
    _persistPpPending();
    const existing = orders.find(o => o.paypalOrderId === paypalOrderId);
    if (existing) return res.json({ ok: true, orderId: existing.id, total: existing.total, alreadyCreated: true });

    /* Vérification croisée du montant réellement capturé vs attendu */
    const capturedAmount = parseFloat(capture.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value || 0);
    const expectedTotal  = pending.total || 0;
    if (expectedTotal > 0 && Math.abs(capturedAmount - expectedTotal) > 0.02) {
      writeLog('security', { event: 'paypal_amount_mismatch', paypalOrderId, expected: expectedTotal, captured: capturedAmount });
      console.error(`[PAYPAL] Incohérence montant: capturé=${capturedAmount}€ attendu=${expectedTotal}€`);
      return res.status(400).json({ ok: false, error: 'Incohérence de montant PayPal. Contactez le support.' });
    }

    const orderId = 'PP-' + Date.now().toString(36).toUpperCase();
    const order = { id: orderId, email: pending.customerEmail || capture.payer?.email_address || '', total: pending.total || 0, shipping: pending.shipping || 0, discount: pending.discount || undefined, items: pending.items || [], shippingAddress: pending.shippingAddress || {}, paymentMethod: 'paypal', paypalOrderId, status: 'confirmed', createdAt: new Date().toISOString() };
    orders.push(order);
    persistOrders();
    writeLog('access', { event: 'order_confirmed_paypal', orderId, total: order.total });
    notifyOwner(order).catch(err => console.error('[EMAIL] Notif propriétaire PayPal:', err.message));
    notifySupplier(order).catch(err => console.error('[EMAIL] Fournisseur PayPal:', err.message));
    sendOrderConfirmation(order).catch(err => console.error('[EMAIL] Confirmation client PayPal:', err.message));
    createInvoice(order).catch(err => console.error('[INVOICE] Erreur PayPal:', err.message));
    if (pending.parrainCode) { _registerParrainUse(pending.parrainCode, order.email).catch(() => {}); _markVoucherUsed(pending.parrainCode, orderId); }
    res.json({ ok: true, orderId, total: order.total });
  } catch (err) {
    const notConfigured = err.message.includes('manquants dans .env');
    console.error('[PAYPAL] capture-order :', err.message);
    res.status(notConfigured ? 503 : 500).json({
      ok: false,
      error: notConfigured
        ? 'PayPal non configuré sur ce serveur. Choisissez une autre méthode de paiement.'
        : 'Erreur PayPal : ' + err.message,
    });
  }
});

/* ─────────────────────────────────────────
   COORDONNÉES BANCAIRES (virement)
   Variables requises : BANK_IBAN, BANK_BIC (optionnel : BANK_NAME)
   ───────────────────────────────────────── */

/** GET /api/payment/bank-details — retourne l'IBAN/BIC depuis les variables d'environnement */
app.get('/api/payment/bank-details', (req, res) => {
  res.json({
    ok:    true,
    iban:  process.env.BANK_IBAN  || 'FR76 XXXX XXXX XXXX XXXX XXXX XXX',
    bic:   process.env.BANK_BIC   || 'XXXXXXXX',
    bank:  process.env.BANK_NAME  || 'Crédit Agricole',
    owner: 'Le Clam',
  });
});

/* ─────────────────────────────────────────
   VIREMENT BANCAIRE — commande côté serveur
   ───────────────────────────────────────── */

/** POST /api/orders/virement — enregistre une commande par virement (statut pending_virement) */
app.post('/api/orders/virement', requireCsrfIfAuthenticated, async (req, res) => {
  const { items, customerEmail, shippingAddress, virementRef, parrainCode, originalOrderId } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    console.error('[VIREMENT] 400 — panier vide. Body reçu:', JSON.stringify({ items, virementRef, customerEmail }));
    return res.status(400).json({ ok: false, error: 'Panier vide ou invalide' });
  }
  if (!virementRef || typeof virementRef !== 'string' || !/^CLAM-[A-Z0-9]+$/.test(virementRef)) {
    console.error('[VIREMENT] 400 — ref invalide. virementRef reçu:', JSON.stringify(virementRef));
    return res.status(400).json({ ok: false, error: 'Référence virement invalide' });
  }
  /* Déduplication : évite les doubles soumissions avec la même référence */
  const dupVirement = orders.find(o => o.virementRef === virementRef);
  if (dupVirement) return res.json({ ok: true, orderId: dupVirement.id, total: dupVirement.total, shipping: dupVirement.shipping, alreadyRecorded: true });
  if (customerEmail && !EMAIL_RE.test(customerEmail)) {
    console.error('[VIREMENT] 400 — email invalide:', customerEmail);
    return res.status(400).json({ ok: false, error: 'Email invalide' });
  }

  let subtotal = 0;
  const validatedItems = [];
  for (const item of items) {
    if (typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(item.id)) {
      console.error('[VIREMENT] 400 — ID invalide:', item.id);
      return res.status(400).json({ ok: false, error: 'ID produit invalide' });
    }
    let found = null;
    for (const prods of Object.values(PRODUCTS)) { found = prods.find(p => p.id === item.id); if (found) break; }
    if (!found) {
      console.error('[VIREMENT] 400 — produit introuvable:', item.id);
      return res.status(400).json({ ok: false, error: `Produit introuvable: ${item.id}` });
    }
    const qty = Math.max(1, Math.min(Math.floor(Number(item.qty) || 1), 99, found.stock));
    subtotal += _effectivePrice(found.id, found.price) * qty;
    validatedItems.push({ ...found, qty });
  }

  const shipping  = calcShipping(shippingAddress?.country, subtotal);
  const discount  = _parrainDiscountAmount(parrainCode, customerEmail) || _voucherDiscountAmount(parrainCode, customerEmail);
  const total     = Math.round(Math.max(0, subtotal + shipping - discount) * 100) / 100;
  const safeAddr  = shippingAddress ? { rue: sanitize(shippingAddress.rue || '', 200), zip: sanitize(shippingAddress.zip || '', 20), city: sanitize(shippingAddress.city || '', 100), country: sanitize(shippingAddress.country || '', 60) } : null;

  const order = {
    id:              'VIR-' + Date.now().toString(36).toUpperCase(),
    paymentMethod:   'virement',
    virementRef:     sanitize(virementRef, 40),
    items:           validatedItems,
    total,
    shipping,
    discount:        discount || undefined,
    parrainCode:     parrainCode ? String(parrainCode).toUpperCase().trim() : undefined,
    email:           customerEmail ? sanitize(customerEmail, 200) : null,
    shippingAddress: safeAddr,
    status:          'pending_virement',
    createdAt:       new Date().toISOString(),
    originalOrderId: originalOrderId || undefined,
  };

  orders.push(order);
  persistOrders();
  writeLog('access', { event: 'order_virement', orderId: order.id, total, virementRef });
  console.log(`[ORDER] ${order.id} — ${total}€ — Virement ${virementRef}`);

  notifyOwner(order).catch(err => console.error('[EMAIL] Notif propriétaire:', err.message));
  notifySupplier(order).catch(err => console.error('[EMAIL] Fournisseur virement:', err.message));
  sendOrderConfirmation(order).catch(err => console.error('[EMAIL] Confirmation client:', err.message));
  /* createInvoice et _registerParrainUse appelés à la confirmation admin (PATCH /status → processing) */

  res.json({ ok: true, orderId: order.id, total, shipping });
});

/* ─────────────────────────────────────────
   CRYPTO — commande côté serveur
   ───────────────────────────────────────── */

const SUPPORTED_COINS = new Set(['BTC', 'ETH', 'USDT', 'SOL']);

/** POST /api/orders/crypto — enregistre une commande crypto (statut pending_crypto) */
app.post('/api/orders/crypto', requireCsrfIfAuthenticated, async (req, res) => {
  const { items, customerEmail, shippingAddress, coin, txHash, parrainCode, originalOrderId } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ ok: false, error: 'Panier vide ou invalide' });
  if (!coin || !SUPPORTED_COINS.has(coin))
    return res.status(400).json({ ok: false, error: 'Crypto non supportée (BTC, ETH, USDT, SOL)' });
  if (customerEmail && !EMAIL_RE.test(customerEmail))
    return res.status(400).json({ ok: false, error: 'Email invalide' });

  let subtotal = 0;
  const validatedItems = [];
  for (const item of items) {
    if (typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(item.id))
      return res.status(400).json({ ok: false, error: 'ID produit invalide' });
    let found = null;
    for (const prods of Object.values(PRODUCTS)) { found = prods.find(p => p.id === item.id); if (found) break; }
    if (!found) return res.status(400).json({ ok: false, error: `Produit introuvable: ${item.id}` });
    const qty = Math.max(1, Math.min(Math.floor(Number(item.qty) || 1), 99, found.stock));
    subtotal += _effectivePrice(found.id, found.price) * qty;
    validatedItems.push({ ...found, qty });
  }

  const shipping  = calcShipping(shippingAddress?.country, subtotal);
  const discount  = _parrainDiscountAmount(parrainCode, customerEmail) || _voucherDiscountAmount(parrainCode, customerEmail);
  const total     = Math.round(Math.max(0, subtotal + shipping - discount) * 100) / 100;
  const safeAddr  = shippingAddress ? { rue: sanitize(shippingAddress.rue || '', 200), zip: sanitize(shippingAddress.zip || '', 20), city: sanitize(shippingAddress.city || '', 100), country: sanitize(shippingAddress.country || '', 60) } : null;

  const order = {
    id:              'CRYPTO-' + Date.now().toString(36).toUpperCase(),
    paymentMethod:   'crypto_' + coin,
    coin,
    txHash:          txHash ? sanitize(String(txHash), 100) : null,
    items:           validatedItems,
    total,
    shipping,
    discount:        discount || undefined,
    parrainCode:     parrainCode ? String(parrainCode).toUpperCase().trim() : undefined,
    email:           customerEmail ? sanitize(customerEmail, 200) : null,
    shippingAddress: safeAddr,
    status:          'pending_crypto',
    createdAt:       new Date().toISOString(),
    originalOrderId: originalOrderId || undefined,
  };

  orders.push(order);
  persistOrders();
  writeLog('access', { event: 'order_crypto', orderId: order.id, total, coin });
  console.log(`[ORDER] ${order.id} — ${total}€ — Crypto ${coin}`);

  notifyOwner(order).catch(err => console.error('[EMAIL] Notif propriétaire:', err.message));
  notifySupplier(order).catch(err => console.error('[EMAIL] Fournisseur crypto:', err.message));
  sendOrderConfirmation(order).catch(err => console.error('[EMAIL] Confirmation client crypto:', err.message));
  /* createInvoice et _registerParrainUse appelés à la confirmation admin (PATCH /status → processing) */

  res.json({ ok: true, orderId: order.id, total, shipping });
});

/* ─────────────────────────────────────────
   APPLE PAY
   Variables requises (production uniquement) :
     APPLE_MERCHANT_ID   — ex: merchant.fr.leclam
     APPLE_CERT_PATH     — chemin vers le cert PEM (sans extension) :
                           APPLE_CERT_PATH=/certs/apple-pay → lit /certs/apple-pay.pem + /certs/apple-pay-key.pem
   En développement, l'endpoint répond 501 si non configuré.
   ───────────────────────────────────────── */

/** POST /api/apple-pay/validate — validation du marchand côté Apple */
app.post('/api/apple-pay/validate', async (req, res) => {
  const { validationURL } = req.body;
  if (!validationURL || typeof validationURL !== 'string')
    return res.status(400).json({ ok: false, error: 'validationURL requis' });

  /* Vérifier que l'URL appartient bien à Apple (prévient les SSRF) */
  let parsedURL;
  try { parsedURL = new URL(validationURL); } catch { return res.status(400).json({ ok: false, error: 'URL invalide' }); }
  if (!parsedURL.hostname.endsWith('.apple.com'))
    return res.status(400).json({ ok: false, error: 'URL de validation Apple invalide' });

  const merchantId = process.env.APPLE_MERCHANT_ID;
  const certPath   = process.env.APPLE_CERT_PATH;

  if (!merchantId || !certPath)
    return res.status(501).json({ ok: false, error: 'Apple Pay non configuré sur ce serveur. Utilisez carte bancaire ou PayPal.' });

  let cert, key;
  try {
    cert = fs.readFileSync(certPath + '.pem');
    key  = fs.readFileSync(certPath + '-key.pem');
  } catch {
    return res.status(500).json({ ok: false, error: 'Certificat Apple Pay introuvable. Contactez le support.' });
  }

  const domain = (process.env.DOMAIN || 'localhost').replace(/^https?:\/\//, '').split('/')[0];
  const body   = JSON.stringify({ merchantIdentifier: merchantId, displayName: 'Le Clam', initiative: 'web', initiativeContext: domain });

  try {
    const merchantSession = await new Promise((resolve, reject) => {
      const data = Buffer.from(body);
      const opts = { method: 'POST', hostname: parsedURL.hostname, path: parsedURL.pathname + parsedURL.search, cert, key, headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } };
      const r = require('https').request(opts, resp => {
        let buf = '';
        resp.on('data', c => buf += c);
        resp.on('end', () => { try { resolve(JSON.parse(buf)); } catch { reject(new Error('Réponse Apple invalide')); } });
      });
      r.on('error', reject);
      r.write(data);
      r.end();
    });
    writeLog('access', { event: 'apple_pay_validated' });
    res.json({ ok: true, merchantSession });
  } catch (err) {
    console.error('[APPLE PAY] validation error:', err.message);
    res.status(500).json({ ok: false, error: 'Validation Apple Pay échouée : ' + err.message });
  }
});

/** POST /api/orders/apple-pay — enregistre une commande Apple Pay après autorisation */
app.post('/api/orders/apple-pay', requireCsrfIfAuthenticated, async (req, res) => {
  const { items, customerEmail, shippingAddress, parrainCode, originalOrderId } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ ok: false, error: 'Panier vide ou invalide' });

  let subtotal = 0;
  const validatedItems = [];
  for (const item of items) {
    if (typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(item.id))
      return res.status(400).json({ ok: false, error: 'ID produit invalide' });
    let found = null;
    for (const prods of Object.values(PRODUCTS)) { found = prods.find(p => p.id === item.id); if (found) break; }
    if (!found) return res.status(400).json({ ok: false, error: `Produit introuvable: ${item.id}` });
    const qty = Math.max(1, Math.min(Math.floor(Number(item.qty) || 1), 99, found.stock));
    subtotal += _effectivePrice(found.id, found.price) * qty;
    validatedItems.push({ ...found, qty });
  }

  const shipping  = calcShipping(shippingAddress?.country, subtotal);
  const discount  = _parrainDiscountAmount(parrainCode, customerEmail) || _voucherDiscountAmount(parrainCode, customerEmail);
  const total     = Math.round(Math.max(0, subtotal + shipping - discount) * 100) / 100;
  const safeAddr  = shippingAddress ? { rue: sanitize(shippingAddress.rue || '', 200), zip: sanitize(shippingAddress.zip || '', 20), city: sanitize(shippingAddress.city || '', 100), country: sanitize(shippingAddress.country || '', 60) } : null;

  const order = {
    id:              'AP-' + Date.now().toString(36).toUpperCase(),
    paymentMethod:   'apple_pay',
    items:           validatedItems,
    total,
    shipping,
    discount:        discount || undefined,
    email:           customerEmail ? sanitize(customerEmail, 200) : null,
    shippingAddress: safeAddr,
    status:          'confirmed',
    originalOrderId: originalOrderId || undefined,
    createdAt:       new Date().toISOString(),
  };

  orders.push(order);
  persistOrders();
  writeLog('access', { event: 'order_apple_pay', orderId: order.id, total });
  console.log(`[ORDER] ${order.id} — ${total}€ — Apple Pay`);

  notifyOwner(order).catch(err => console.error('[EMAIL] Notif propriétaire:', err.message));
  notifySupplier(order).catch(err => console.error('[EMAIL] Fournisseur Apple Pay:', err.message));
  sendOrderConfirmation(order).catch(err => console.error('[EMAIL] Confirmation client:', err.message));
  createInvoice(order).catch(err => console.error('[INVOICE] Erreur Apple Pay:', err.message));
  if (parrainCode) { _registerParrainUse(parrainCode, customerEmail).catch(() => {}); _markVoucherUsed(parrainCode, order.id); }

  res.json({ ok: true, orderId: order.id, total, shipping });
});

/* ═══════════════════════════════════════════════════════════
   SYSTÈME DE FACTURATION
   ═══════════════════════════════════════════════════════════ */

function persistInvoices() { saveJSON(INVOICES_FILE, INVOICES); }

/* Numérotation FAC-YYYY-000001 — incrément atomique synchrone */
function nextInvoiceNumber() {
  let ctr = loadJSON(INVOICE_COUNTER_FILE, { year: new Date().getFullYear(), seq: 0 });
  const now = new Date().getFullYear();
  if (ctr.year !== now) { ctr = { year: now, seq: 0 }; }
  ctr.seq += 1;
  saveJSON(INVOICE_COUNTER_FILE, ctr);
  return `FAC-${ctr.year}-${String(ctr.seq).padStart(6, '0')}`;
}

function nextAvoirNumber() {
  let ctr = loadJSON(AVOIR_COUNTER_FILE, { year: new Date().getFullYear(), seq: 0 });
  const now = new Date().getFullYear();
  if (ctr.year !== now) { ctr = { year: now, seq: 0 }; }
  ctr.seq += 1;
  saveJSON(AVOIR_COUNTER_FILE, ctr);
  return `AVO-${ctr.year}-${String(ctr.seq).padStart(6, '0')}`;
}

/* Labels méthodes de paiement */
const PAYMENT_LABELS = {
  stripe_card: 'Carte bancaire',
  paypal:      'PayPal',
  virement:    'Virement bancaire',
  crypto_BTC:  'Bitcoin (BTC)',
  crypto_ETH:  'Ethereum (ETH)',
  crypto_USDT: 'USDT',
  crypto_SOL:  'Solana (SOL)',
  apple_pay:   'Apple Pay',
};

/* Calculs HT/TVA — TVA 20% sur produits ET livraison pour FR + DOM-TOM + UE. Hors UE : 0% TVA */
function calcInvoiceTotals(order) {
  const discount         = order.discount || 0;
  const shipping         = order.shipping || 0;
  const productsTTC      = Math.round((order.total - shipping) * 100) / 100;
  const zone             = _zoneIndex(order.shippingAddress?.country);
  const tvaRate          = zone <= 2 ? 1.20 : 1.00; /* Hors UE : exonéré TVA */
  const grossProductsTTC = Math.round((productsTTC + discount) * 100) / 100;
  const grossHT          = Math.round(grossProductsTTC / tvaRate * 100) / 100;
  const discountHT       = Math.round(discount / tvaRate * 100) / 100;
  const productsHT       = Math.round(productsTTC / tvaRate * 100) / 100;
  const shippingHT       = Math.round(shipping / tvaRate * 100) / 100;
  /* TVA calculée sur le total TTC complet (produits + livraison) — assure l'équilibre de la facture */
  const tvaAmount        = Math.round((order.total - productsHT - shippingHT) * 100) / 100;
  return { grossHT, discountHT, productsHT, shippingHT, tvaAmount, productsTTC, discount, shipping, totalTTC: order.total, tvaRate };
}

/* Génération du PDF avec PDFKit */
async function generateInvoicePDF(invoice) {
  return new Promise((resolve, reject) => {
    const pdfPath = path.join(INVOICES_DIR, `${invoice.invoiceNumber}.pdf`);
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);

    const BROWN  = '#3e2a14';
    const BEIGE  = '#d9c4a0';
    const GRAY   = '#888888';
    const BLACK  = '#1a1a1a';
    const RED    = '#cc0000';
    const W      = 495; /* largeur utile */

    /* ── En-tête ── */
    doc.rect(50, 50, W, 70).fill(BROWN);
    doc.fontSize(22).fillColor(BEIGE).font('Helvetica-Bold')
       .text('LE CLAM', 65, 65);
    doc.fontSize(9).fillColor(BEIGE).font('Helvetica')
       .text('contact@leclam.eu  ·  leclam.eu', 65, 82)
       .text(SELLER.address, 65, 94)
       .text(`${SELLER.zip} ${SELLER.city}  ·  ${SELLER.country}`, 65, 106);

    const titleLabel = invoice.isModification ? 'FACTURE MODIFICATIVE' : 'FACTURE';
    doc.fontSize(invoice.isModification ? 13 : 18).fillColor(BEIGE).font('Helvetica-Bold')
       .text(titleLabel, 300, invoice.isModification ? 68 : 72, { width: 230, align: 'right' });
    doc.fontSize(11).fillColor(BEIGE).font('Helvetica')
       .text(invoice.invoiceNumber, 300, 90, { width: 230, align: 'right' });

    /* ── Bloc informations ── */
    const Y2 = 140;
    /* Colonne gauche — client */
    doc.fontSize(8).fillColor(GRAY).font('Helvetica-Bold')
       .text('FACTURER À', 50, Y2);
    doc.moveTo(50, Y2 + 12).lineTo(220, Y2 + 12).lineWidth(0.5).strokeColor(BEIGE).stroke();
    doc.fontSize(10).fillColor(BLACK).font('Helvetica')
       .text(invoice.customerEmail || '—', 50, Y2 + 18);
    if (invoice.billingAddress) {
      const a = invoice.billingAddress;
      if (a.rue)  doc.text(a.rue, 50, doc.y + 2);
      if (a.zip || a.city) doc.text(`${a.zip || ''} ${a.city || ''}`.trim(), 50, doc.y + 2);
      if (a.country) doc.text(a.country, 50, doc.y + 2);
    }

    /* Colonne droite — facture */
    doc.fontSize(8).fillColor(GRAY).font('Helvetica-Bold')
       .text('INFORMATIONS FACTURE', 340, Y2);
    doc.moveTo(340, Y2 + 12).lineTo(545, Y2 + 12).lineWidth(0.5).strokeColor(BEIGE).stroke();
    const rows = [
      ['N° facture',    invoice.invoiceNumber],
      ['N° commande',   invoice.orderId],
      ...(invoice.originalInvoiceNumber ? [['Remplace facture', invoice.originalInvoiceNumber]] : []),
      ...(invoice.originalOrderId       ? [['N° cmd originale', invoice.originalOrderId]]       : []),
      ['Date facture',  new Date(invoice.createdAt).toLocaleDateString('fr-FR')],
      ['Date paiement', invoice.paymentDate ? new Date(invoice.paymentDate).toLocaleDateString('fr-FR') : '—'],
      ['Exigibilité TVA', invoice.paymentDate ? new Date(invoice.paymentDate).toLocaleDateString('fr-FR') : '—'],
      ['Mode paiement', PAYMENT_LABELS[invoice.paymentMethod] || invoice.paymentMethod || '—'],
    ];
    let ry = Y2 + 18;
    doc.fontSize(9).font('Helvetica');
    rows.forEach(([label, val]) => {
      doc.fillColor(GRAY).text(label + ' :', 340, ry, { continued: false });
      doc.fillColor(BLACK).text(val, 430, ry);
      ry += 14;
    });

    /* ── Tableau des articles ── */
    const TY = Math.max(doc.y + 20, 280);
    /* En-tête tableau */
    doc.rect(50, TY, W, 22).fill(BROWN);
    doc.fontSize(9).fillColor(BEIGE).font('Helvetica-Bold');
    doc.text('PRODUIT',    60,  TY + 7);
    doc.text('QTÉ',        350, TY + 7, { width: 40,  align: 'center' });
    doc.text('PRIX UNIT.', 395, TY + 7, { width: 70,  align: 'right'  });
    doc.text('TOTAL HT',   470, TY + 7, { width: 75,  align: 'right'  });

    let iy = TY + 22;
    doc.font('Helvetica').fontSize(9);
    invoice.items.forEach((item, idx) => {
      const bg = idx % 2 === 0 ? '#faf8f5' : '#ffffff';
      doc.rect(50, iy, W, 22).fill(bg);
      const tvaR    = invoice.totals?.tvaRate || 1.20;
      const lineHT  = Math.round(item.price / tvaR * item.qty * 100) / 100;
      const unitHT  = Math.round(item.price / tvaR * 100) / 100;
      doc.fillColor(BLACK)
         .text(item.name.substring(0, 55), 60, iy + 7, { width: 280 })
         .text(String(item.qty),   350, iy + 7, { width: 40,  align: 'center' })
         .text(unitHT.toFixed(2).replace('.', ',') + ' €',  395, iy + 7, { width: 70, align: 'right' })
         .text(lineHT.toFixed(2).replace('.', ',') + ' €',  470, iy + 7, { width: 75, align: 'right' });
      iy += 22;
    });

    /* Ligne séparatrice */
    doc.moveTo(50, iy).lineTo(545, iy).lineWidth(1).strokeColor(BEIGE).stroke();
    iy += 10;

    /* ── Totaux ── */
    const t = invoice.totals;
    const shippingHT = t.shippingHT != null ? t.shippingHT : Math.round(t.shipping / (t.tvaRate || 1.20) * 100) / 100;
    const totRows = [
      ...(t.discount > 0 ? [
        ['Sous-total brut HT',      t.grossHT.toFixed(2).replace('.', ',')     + ' €', false],
        ['Remise (code parrain)',   '−' + t.discountHT.toFixed(2).replace('.', ',') + ' €', false],
      ] : []),
      [t.discount > 0 ? 'Sous-total net HT' : 'Produits HT',
                                   t.productsHT.toFixed(2).replace('.', ',')  + ' €', false],
      ['Livraison HT',             shippingHT.toFixed(2).replace('.', ',')    + ' €', false],
      [t.tvaRate <= 1.00 ? 'TVA (0% — hors UE)' : 'TVA (20%)',
                                   t.tvaAmount.toFixed(2).replace('.', ',')   + ' €', false],
    ];
    totRows.forEach(([label, val]) => {
      doc.fontSize(9).fillColor(GRAY).font('Helvetica')
         .text(label, 350, iy, { width: 115, align: 'right' });
      doc.fillColor(BLACK)
         .text(val, 470, iy, { width: 75, align: 'right' });
      iy += 16;
    });
    /* Total TTC */
    doc.rect(345, iy - 2, W - 295, 22).fill(BROWN);
    doc.fontSize(11).fillColor(BEIGE).font('Helvetica-Bold')
       .text('TOTAL TTC', 350, iy + 4, { width: 115, align: 'right' })
       .text(t.totalTTC.toFixed(2).replace('.', ',') + ' €', 470, iy + 4, { width: 75, align: 'right' });
    iy += 30;

    /* Trop-perçu (facture modificative seulement) */
    if (invoice.avoirAmount > 0) {
      doc.rect(345, iy - 2, W - 295, 24).fill('#fff3cd');
      doc.fontSize(9).fillColor('#856404').font('Helvetica-Bold')
         .text('Trop-perçu — Avoir ' + (invoice.avoirNumber || ''), 350, iy + 4, { width: 115, align: 'right' });
      doc.fillColor('#856404')
         .text('−' + invoice.avoirAmount.toFixed(2).replace('.', ',') + ' €', 470, iy + 4, { width: 75, align: 'right' });
      iy += 30;
      doc.fontSize(8).fillColor(GRAY).font('Helvetica')
         .text('Un avoir de ' + invoice.avoirAmount.toFixed(2).replace('.', ',') + ' € a été émis (réf. ' + (invoice.avoirNumber || '') + '). Remboursement sous 5–10 jours ouvrés.', 50, iy, { width: W });
      iy += 20;
    }

    /* ── Pied de page ── */
    doc.fontSize(8).fillColor(GRAY).font('Helvetica')
       .text('Merci pour votre commande ! Des questions ? contact@leclam.eu', 50, iy + 10, { align: 'center', width: W });
    doc.moveTo(50, iy + 24).lineTo(545, iy + 24).lineWidth(0.3).strokeColor(BEIGE).stroke();
    doc.text(
      `${SELLER.name} — Entreprise individuelle — ${SELLER.address}, ${SELLER.zip} ${SELLER.city}, ${SELLER.country}`,
      50, iy + 28, { align: 'center', width: W }
    );
    doc.text(
      `SIRET : ${SELLER.siret}  ·  N° TVA intracommunautaire : ${SELLER.tvaIntra}  ·  leclam.eu`,
      50, iy + 40, { align: 'center', width: W }
    );

    doc.end();
    stream.on('finish', () => resolve(pdfPath));
    stream.on('error', reject);
  });
}

/* Génération du PDF d'avoir */
async function generateAvoirPDF(avoir) {
  return new Promise((resolve, reject) => {
    const pdfPath = path.join(INVOICES_DIR, `${avoir.avoirNumber}.pdf`);
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);

    const BROWN = '#3e2a14', BEIGE = '#d9c4a0', GRAY = '#888888', BLACK = '#1a1a1a', W = 495;
    const AMBER = '#92400e', AMBER_BG = '#fffbeb', AMBER_BORDER = '#fde68a';

    /* En-tête */
    doc.rect(50, 50, W, 70).fill(BROWN);
    doc.fontSize(22).fillColor(BEIGE).font('Helvetica-Bold').text('LE CLAM', 65, 65);
    doc.fontSize(9).fillColor(BEIGE).font('Helvetica')
       .text('contact@leclam.eu  ·  leclam.eu', 65, 82)
       .text(SELLER.address, 65, 94)
       .text(`${SELLER.zip} ${SELLER.city}  ·  ${SELLER.country}`, 65, 106);
    doc.fontSize(18).fillColor(BEIGE).font('Helvetica-Bold').text('AVOIR', 300, 72, { width: 230, align: 'right' });
    doc.fontSize(11).fillColor(BEIGE).font('Helvetica').text(avoir.avoirNumber, 300, 96, { width: 230, align: 'right' });

    /* Bloc infos */
    const Y2 = 145;
    doc.fontSize(8).fillColor(GRAY).font('Helvetica-Bold').text('REMBOURSEMENT À', 50, Y2);
    doc.moveTo(50, Y2 + 12).lineTo(220, Y2 + 12).lineWidth(0.5).strokeColor(BEIGE).stroke();
    doc.fontSize(10).fillColor(BLACK).font('Helvetica').text(avoir.customerEmail || '—', 50, Y2 + 18);
    if (avoir.billingAddress) {
      const a = avoir.billingAddress;
      if (a.rue) doc.text(a.rue, 50, doc.y + 2);
      if (a.zip || a.city) doc.text(`${a.zip||''} ${a.city||''}`.trim(), 50, doc.y + 2);
    }

    doc.fontSize(8).fillColor(GRAY).font('Helvetica-Bold').text('INFORMATIONS AVOIR', 340, Y2);
    doc.moveTo(340, Y2 + 12).lineTo(545, Y2 + 12).lineWidth(0.5).strokeColor(BEIGE).stroke();
    const infoRows = [
      ["N° avoir",           avoir.avoirNumber],
      ["Facture d'origine",  avoir.originalInvoiceNumber || '—'],
      ["Nouvelle facture",   avoir.newInvoiceNumber      || '—'],
      ["N° cmd originale",   avoir.originalOrderId       || '—'],
      ["Date",               new Date(avoir.createdAt).toLocaleDateString('fr-FR')],
    ];
    let ry = Y2 + 18;
    doc.fontSize(9).font('Helvetica');
    infoRows.forEach(([l, v]) => {
      doc.fillColor(GRAY).text(l + ' :', 340, ry); doc.fillColor(BLACK).text(v, 430, ry); ry += 14;
    });

    /* Bloc montant */
    const MY = Math.max(doc.y + 30, 310);
    doc.rect(50, MY, W, 60).fill(AMBER_BG).stroke();
    doc.rect(50, MY, W, 60).lineWidth(1).strokeColor(AMBER_BORDER).stroke();
    doc.fontSize(11).fillColor(AMBER).font('Helvetica-Bold')
       .text('Montant à rembourser', 70, MY + 12, { width: 260 });
    doc.fontSize(9).fillColor(GRAY).font('Helvetica')
       .text('Remboursement sur le moyen de paiement d\'origine sous 5–10 jours ouvrés.', 70, MY + 30, { width: 260 });
    doc.fontSize(22).fillColor(AMBER).font('Helvetica-Bold')
       .text(avoir.amount.toFixed(2).replace('.', ',') + ' €', 330, MY + 16, { width: 200, align: 'right' });

    /* Motif */
    const TY = MY + 80;
    doc.fontSize(9).fillColor(GRAY).font('Helvetica')
       .text('Motif : trop-perçu suite à modification de la commande ' + (avoir.originalOrderId || '') + '.', 50, TY, { width: W });

    /* Pied de page */
    const FY = TY + 40;
    doc.fontSize(8).fillColor(GRAY).font('Helvetica')
       .text('Des questions ? contact@leclam.eu', 50, FY, { align: 'center', width: W });
    doc.moveTo(50, FY + 14).lineTo(545, FY + 14).lineWidth(0.3).strokeColor(BEIGE).stroke();
    doc.text(
      `${SELLER.name} — Entreprise individuelle — ${SELLER.address}, ${SELLER.zip} ${SELLER.city}, ${SELLER.country}`,
      50, FY + 18, { align: 'center', width: W }
    );
    doc.text(
      `SIRET : ${SELLER.siret}  ·  N° TVA intracommunautaire : ${SELLER.tvaIntra}  ·  leclam.eu`,
      50, FY + 30, { align: 'center', width: W }
    );

    doc.end();
    stream.on('finish', () => resolve(pdfPath));
    stream.on('error', reject);
  });
}

const _invoiceLocks = new Set(); /* verrou anti-doublon concurrent pour createInvoice */

/* Création d'une facture (normale ou modificative) pour une commande */
async function createInvoice(order) {
  if (INVOICES.find(i => i.orderId === order.id)) {
    console.log(`[INVOICE] Facture déjà existante pour ${order.id}`);
    return INVOICES.find(i => i.orderId === order.id);
  }
  if (_invoiceLocks.has(order.id)) {
    console.log(`[INVOICE] Génération déjà en cours pour ${order.id}`);
    return null;
  }
  _invoiceLocks.add(order.id);

  /* Détecte si c'est une modification */
  const isModification = !!order.originalOrderId;
  const originalOrder  = isModification ? orders.find(o => o.id === order.originalOrderId) : null;
  const originalInv    = isModification ? INVOICES.find(i => i.orderId === order.originalOrderId) : null;

  const invoiceNumber = nextInvoiceNumber();
  const totals = calcInvoiceTotals(order);

  const invoice = {
    id:                    `inv-${Date.now()}`,
    invoiceNumber,
    orderId:               order.id,
    customerEmail:         order.email || null,
    billingAddress:        order.shippingAddress || null,
    items:                 order.items,
    totals,
    paymentMethod:         order.paymentMethod || null,
    paymentDate:           new Date().toISOString(),
    pdfPath:               null,
    status:                'paid',
    createdAt:             new Date().toISOString(),
    isModification:        isModification || undefined,
    originalOrderId:       order.originalOrderId || undefined,
    originalInvoiceNumber: originalInv?.invoiceNumber || undefined,
  };

  /* Calcule le trop-perçu éventuel */
  let avoir = null;
  if (isModification && originalOrder) {
    const diff = Math.round(((originalOrder.total || 0) - (order.total || 0)) * 100) / 100;
    if (diff > 0) {
      const avoirNumber = nextAvoirNumber();
      avoir = {
        id:                    `avo-${Date.now()}`,
        avoirNumber,
        originalOrderId:       originalOrder.id,
        newOrderId:            order.id,
        originalInvoiceNumber: originalInv?.invoiceNumber || null,
        newInvoiceNumber:      invoiceNumber,
        customerEmail:         order.email || null,
        billingAddress:        order.shippingAddress || null,
        amount:                diff,
        status:                'pending_refund',
        createdAt:             new Date().toISOString(),
        pdfPath:               null,
      };
      invoice.avoirAmount = diff;
      invoice.avoirNumber = avoirNumber;
    }
    /* Marque l'ancienne commande comme modifiée */
    if (originalOrder) { originalOrder.modifiedBy = order.id; persistOrders(); }
  }

  try {
    const pdfPath = await generateInvoicePDF(invoice);
    invoice.pdfPath = pdfPath;
    console.log(`[INVOICE] PDF généré : ${invoiceNumber}${isModification ? ' (modificative)' : ''}`);
  } catch (e) {
    console.error('[INVOICE] Échec génération PDF:', e.message);
  }

  INVOICES.push(invoice);
  _invoiceLocks.delete(order.id);
  persistInvoices();

  /* Génère et envoie l'avoir si trop-perçu */
  if (avoir) {
    try {
      avoir.pdfPath = await generateAvoirPDF(avoir);
      console.log(`[AVOIR] PDF généré : ${avoir.avoirNumber}`);
    } catch (e) {
      console.error('[AVOIR] Échec génération PDF:', e.message);
    }
    AVOIRS.push(avoir);
    persistAvoirs();
    sendAvoirEmail(avoir).catch(e => console.error('[AVOIR] Échec email:', e.message));
  }

  sendInvoiceEmail(invoice).catch(e => console.error('[INVOICE] Échec email:', e.message));
  return invoice;
}

/* Email facture au client */
async function sendInvoiceEmail(invoice) {
  if (!process.env.GMAIL_USER || !invoice.customerEmail) return;
  const attachments = [];
  if (invoice.pdfPath && fs.existsSync(invoice.pdfPath)) {
    attachments.push({ filename: `${invoice.invoiceNumber}.pdf`, path: invoice.pdfPath, contentType: 'application/pdf' });
  }
  const domain = process.env.DOMAIN || 'http://localhost:3000';
  await mailer.sendMail({
    from:        `"Le Clam" <${process.env.GMAIL_USER}>`,
    to:          invoice.customerEmail,
    subject:     `Votre facture — Commande ${invoice.orderId}`,
    attachments,
    html: `<!DOCTYPE html><html><body style="font-family:Georgia,serif;background:#f5f0e8;margin:0;padding:2rem">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(62,42,20,.1)">
  <div style="background:#3e2a14;padding:1.5rem 2rem">
    <h1 style="color:#d9c4a0;margin:0;font-size:1.4rem;letter-spacing:.04em">Le Clam</h1>
  </div>
  <div style="padding:2rem">
    <h2 style="color:#3e2a14;margin-top:0">Votre facture est disponible</h2>
    <p style="color:#444;line-height:1.6">Merci pour votre commande. Votre facture <strong>${invoice.invoiceNumber}</strong> est disponible en pièce jointe et dans votre <a href="${domain}/mes-commandes.html" style="color:#3e2a14">espace client</a>.</p>
    <div style="background:#faf8f5;border-radius:10px;padding:1.2rem;margin:1.2rem 0;border:1px solid #e8e0d4">
      <p style="margin:0;font-size:.88rem;color:#666">N° facture : <strong>${invoice.invoiceNumber}</strong></p>
      <p style="margin:.3rem 0 0;font-size:.88rem;color:#666">Commande : <strong>${invoice.orderId}</strong></p>
      <p style="margin:.3rem 0 0;font-size:.88rem;color:#666">Total TTC : <strong>${invoice.totals.totalTTC.toFixed(2).replace('.', ',')} €</strong></p>
    </div>
    <p style="color:#999;font-size:.85rem;margin:0">Des questions ? <a href="${domain}/contact.html" style="color:#3e2a14">Contactez-nous</a></p>
  </div>
</div></body></html>`,
  });
  console.log(`[INVOICE] Email facture envoyé à ${invoice.customerEmail} — ${invoice.invoiceNumber}`);
}

/* Email avoir au client */
async function sendAvoirEmail(avoir) {
  if (!process.env.GMAIL_USER || !avoir.customerEmail) return;
  const domain = process.env.DOMAIN || `http://localhost:${process.env.PORT || 3000}`;
  const attachments = [];
  if (avoir.pdfPath && fs.existsSync(avoir.pdfPath))
    attachments.push({ filename: `${avoir.avoirNumber}.pdf`, path: avoir.pdfPath, contentType: 'application/pdf' });
  await mailer.sendMail({
    from:    `"Le Clam" <${process.env.GMAIL_USER}>`,
    to:      avoir.customerEmail,
    subject: `Avoir — Remboursement suite à modification de commande`,
    attachments,
    html: `<!DOCTYPE html><html><body style="font-family:Georgia,serif;background:#f5f0e8;margin:0;padding:2rem">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(62,42,20,.1)">
  <div style="background:#3e2a14;padding:1.5rem 2rem"><h1 style="color:#d9c4a0;margin:0;font-size:1.4rem">Le Clam</h1></div>
  <div style="padding:2rem">
    <h2 style="color:#92400e;margin-top:0">Un avoir vous a été émis</h2>
    <p style="color:#444;line-height:1.6">Suite à la modification de votre commande, un trop-perçu de <strong>${avoir.amount.toFixed(2).replace('.', ',')} €</strong> a été constaté. Un avoir (réf. <strong>${avoir.avoirNumber}</strong>) est joint à ce message.</p>
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:1.2rem;margin:1.2rem 0">
      <p style="margin:0;font-size:.88rem;color:#92400e">N° avoir : <strong>${avoir.avoirNumber}</strong></p>
      <p style="margin:.3rem 0 0;font-size:.88rem;color:#92400e">Commande d'origine : <strong>${avoir.originalOrderId}</strong></p>
      <p style="margin:.3rem 0 0;font-size:.88rem;color:#92400e">Montant à rembourser : <strong>${avoir.amount.toFixed(2).replace('.', ',')} €</strong></p>
    </div>
    <p style="color:#666;font-size:.85rem">Le remboursement sera effectué sur votre moyen de paiement d'origine sous 5–10 jours ouvrés.</p>
    <p style="color:#999;font-size:.85rem;margin:0">Des questions ? <a href="${domain}/contact.html" style="color:#3e2a14">Contactez-nous</a></p>
  </div>
</div></body></html>`,
  });
  console.log(`[AVOIR] Email avoir envoyé à ${avoir.customerEmail} — ${avoir.avoirNumber}`);
}

/* ── Routes factures ── */

/** GET /api/invoices/mine — factures du client connecté */
app.get('/api/invoices/mine', (req, res) => {
  const session = getSession(req);
  if (!session || !session.email) return res.status(401).json({ ok: false, error: 'Non connecté' });
  const myInvoices = INVOICES.filter(i => i.customerEmail === session.email);
  res.json({ ok: true, invoices: myInvoices.map(i => ({
    ...i,
    pdfAvailable: !!(i.pdfPath && fs.existsSync(i.pdfPath)),
    pdfUrl: i.pdfPath && fs.existsSync(i.pdfPath) ? `/api/invoices/${i.id}/pdf` : null,
  })) });
});

/** GET /api/invoices/:invoiceId/pdf — télécharger le PDF (client propriétaire ou admin) */
app.get('/api/invoices/:invoiceId/pdf', (req, res) => {
  const session = getSession(req);
  const invoice = INVOICES.find(i => i.id === req.params.invoiceId || i.invoiceNumber === req.params.invoiceId);
  if (!invoice) return res.status(404).json({ ok: false, error: 'Facture introuvable' });

  const isAdmin = session?.role === 'admin' || session?.role === 'owner';
  const isOwner = session?.email && session.email === invoice.customerEmail;
  if (!isAdmin && !isOwner)
    return res.status(403).json({ ok: false, error: 'Accès refusé' });

  if (!invoice.pdfPath || !fs.existsSync(invoice.pdfPath))
    return res.status(404).json({ ok: false, error: 'PDF non disponible' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceNumber}.pdf"`);
  fs.createReadStream(invoice.pdfPath).pipe(res);
});

/** GET /api/orders/:id/invoice — infos facture d'une commande */
app.get('/api/orders/:id/invoice', (req, res) => {
  const session = getSession(req);
  const order   = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ ok: false, error: 'Commande introuvable' });

  const isAdmin = session?.role === 'admin' || session?.role === 'owner';
  const isOwner = session?.email && session.email === order.email;
  if (!isAdmin && !isOwner)
    return res.status(403).json({ ok: false, error: 'Accès refusé' });

  const invoice = INVOICES.find(i => i.orderId === order.id);
  if (!invoice) return res.json({ ok: true, invoice: null });

  const hasPdf = invoice.pdfPath && fs.existsSync(invoice.pdfPath);
  res.json({ ok: true, invoice: { ...invoice, pdfAvailable: hasPdf, pdfUrl: hasPdf ? `/api/invoices/${invoice.id}/pdf` : null } });
});

/** POST /api/admin/orders/:id/invoice/regen — régénère le PDF (admin) */
app.post('/api/admin/orders/:id/invoice/regen', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Non autorisé' });
  const order   = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ ok: false, error: 'Commande introuvable' });

  let invoice = INVOICES.find(i => i.orderId === order.id);
  if (!invoice) {
    invoice = await createInvoice(order);
  } else {
    try {
      const pdfPath = await generateInvoicePDF(invoice);
      invoice.pdfPath = pdfPath;
      persistInvoices();
    } catch (e) { return res.status(500).json({ ok: false, error: 'Échec génération PDF' }); }
  }
  res.json({ ok: true, invoice, pdfUrl: `/api/invoices/${invoice.id}/pdf` });
});

/** POST /api/admin/orders/:id/invoice/resend — renvoie email facture (admin) */
app.post('/api/admin/orders/:id/invoice/resend', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Non autorisé' });
  const invoice = INVOICES.find(i => i.orderId === req.params.id);
  if (!invoice) return res.status(404).json({ ok: false, error: 'Facture introuvable' });
  try {
    await sendInvoiceEmail(invoice);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** GET /api/avoirs/mine — avoirs du client connecté */
app.get('/api/avoirs/mine', (req, res) => {
  const session = getSession(req);
  if (!session?.email) return res.status(401).json({ ok: false, error: 'Non connecté' });
  const mine = AVOIRS.filter(a => a.customerEmail === session.email).map(a => ({
    ...a,
    pdfAvailable: !!(a.pdfPath && fs.existsSync(a.pdfPath)),
    pdfUrl: a.pdfPath && fs.existsSync(a.pdfPath) ? `/api/avoirs/${a.id}/pdf` : null,
  }));
  res.json({ ok: true, avoirs: mine });
});

/** GET /api/avoirs/:id/pdf — télécharger le PDF avoir (client propriétaire ou admin) */
app.get('/api/avoirs/:id/pdf', (req, res) => {
  const session = getSession(req);
  const avoir = AVOIRS.find(a => a.id === req.params.id || a.avoirNumber === req.params.id);
  if (!avoir) return res.status(404).json({ ok: false, error: 'Avoir introuvable' });
  const isAdm = session?.role === 'admin' || session?.role === 'owner';
  const isOwn = session?.email && session.email === avoir.customerEmail;
  if (!isAdm && !isOwn) return res.status(403).json({ ok: false, error: 'Accès refusé' });
  if (!avoir.pdfPath || !fs.existsSync(avoir.pdfPath))
    return res.status(404).json({ ok: false, error: 'PDF non disponible' });
  res.download(avoir.pdfPath, `${avoir.avoirNumber}.pdf`);
});

/** GET /api/admin/avoirs — tous les avoirs (admin) */
app.get('/api/admin/avoirs', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Non autorisé' });
  res.json({ ok: true, avoirs: AVOIRS.map(a => ({
    ...a, pdfAvailable: !!(a.pdfPath && fs.existsSync(a.pdfPath)),
    pdfUrl: a.pdfPath && fs.existsSync(a.pdfPath) ? `/api/avoirs/${a.id}/pdf` : null,
  })) });
});

/** GET /api/admin/invoices — liste toutes les factures (admin) */
app.get('/api/admin/invoices', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Non autorisé' });
  const { from, to, year, month } = req.query;
  let list = INVOICES.slice();
  if (year)  list = list.filter(i => new Date(i.createdAt).getFullYear()  === parseInt(year));
  if (month) list = list.filter(i => new Date(i.createdAt).getMonth() + 1 === parseInt(month));
  if (from)  list = list.filter(i => new Date(i.createdAt) >= new Date(from));
  if (to)    list = list.filter(i => new Date(i.createdAt) <= new Date(to));
  res.json({ ok: true, invoices: list.map(i => ({ ...i, pdfAvailable: !!(i.pdfPath && fs.existsSync(i.pdfPath)), pdfUrl: i.pdfPath && fs.existsSync(i.pdfPath) ? `/api/invoices/${i.id}/pdf` : null })) });
});

/** GET /api/admin/invoices/export-csv — export CSV */
app.get('/api/admin/invoices/export-csv', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Non autorisé' });
  const { year, month } = req.query;
  let list = INVOICES.slice();
  if (year)  list = list.filter(i => new Date(i.createdAt).getFullYear()  === parseInt(year));
  if (month) list = list.filter(i => new Date(i.createdAt).getMonth() + 1 === parseInt(month));

  /* Échappe la valeur CSV et neutralise les formules Excel (CSV injection) */
  const esc = v => {
    const s = String(v ?? '');
    const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
    return '"' + safe.replace(/"/g, '""') + '"';
  };
  const fmt = n => typeof n === 'number' ? n.toFixed(2).replace('.', ',') : '';
  const header = ['N° Facture','N° Commande','Date','Email client','Sous-total HT','TVA (20%)','Livraison','Total TTC','Mode paiement','Statut'];
  const rows = list.map(i => [
    esc(i.invoiceNumber), esc(i.orderId),
    esc(new Date(i.createdAt).toLocaleDateString('fr-FR')),
    esc(i.customerEmail),
    esc(fmt(i.totals?.productsHT)), esc(fmt(i.totals?.tvaAmount)),
    esc(fmt(i.totals?.shipping)),   esc(fmt(i.totals?.totalTTC)),
    esc(PAYMENT_LABELS[i.paymentMethod] || i.paymentMethod || ''),
    esc(i.status),
  ].join(';'));

  const csv = '﻿' + [header.map(esc).join(';'), ...rows].join('\r\n');
  const label = year ? (month ? `${String(month).padStart(2,'0')}-${year}` : `${year}`) : 'toutes';
  res.setHeader('Content-Type', 'text/csv;charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="Factures_${label}.csv"`);
  res.send(csv);
});

/** GET /api/admin/invoices/export-zip — ZIP de tous les PDF d'une période */
app.get('/api/admin/invoices/export-zip', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Non autorisé' });
  const { year, month } = req.query;
  let list = INVOICES.slice();
  if (year)  list = list.filter(i => new Date(i.createdAt).getFullYear()  === parseInt(year));
  if (month) list = list.filter(i => new Date(i.createdAt).getMonth() + 1 === parseInt(month));

  const pdfs = list.filter(i => i.pdfPath && fs.existsSync(i.pdfPath));
  if (!pdfs.length) return res.status(404).json({ ok: false, error: 'Aucun PDF disponible pour cette période' });

  /* Assemblage ZIP manuel (base64 stores) */
  const archiver = (() => { try { return require('archiver'); } catch { return null; } })();
  if (!archiver) {
    /* Fallback sans archiver : retourne liste des URLs */
    return res.json({ ok: false, error: 'Module archiver non installé. Utilisez le CSV ou téléchargez chaque PDF individuellement.' });
  }

  const label = year ? (month ? `Factures_${String(month).padStart(2,'0')}-${year}` : `Factures_${year}`) : 'Factures';
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${label}.zip"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.pipe(res);
  pdfs.forEach(i => archive.file(i.pdfPath, { name: `${i.invoiceNumber}.pdf` }));
  archive.finalize();
});

/* ─────────────────────────────────────────
   GESTION DES ERREURS NON CAPTURÉES
   ───────────────────────────────────────── */

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Exception non capturée :', err.message, err.stack);
  writeLog('error', { event: 'uncaught_exception', message: err.message, stack: err.stack });
  /* Laisser le process manager (PM2, systemd) redémarrer le serveur */
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error('[WARN] Promise rejetée non gérée :', msg);
  writeLog('error', { event: 'unhandled_rejection', message: msg });
  /* Ne pas quitter — les promesses non gérées sont souvent récupérables */
});

/* ─────────────────────────────────────────
   DÉMARRAGE
   ───────────────────────────────────────── */
app.listen(PORT, () => {
  writeLog('access', { event: 'server_start', port: PORT, env: process.env.NODE_ENV || 'development', node: process.version });
  console.log(`\n🦞 Le Clam — serveur démarré`);
  console.log(`   http://localhost:${PORT}\n`);
  console.log(`   Catégories disponibles : /api/products?category=plaisir|malin|bebe`);
  console.log(`   Admin orders : GET /api/orders (Authorization: Bearer <ADMIN_KEY>)\n`);
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.ADMIN_KEY || process.env.ADMIN_KEY === 'changeme')
      console.warn('⚠️  [SÉCURITÉ] ADMIN_KEY non définie ou valeur par défaut détectée en production !');
    if (!process.env.STRIPE_SECRET_KEY)
      console.warn('⚠️  [SÉCURITÉ] STRIPE_SECRET_KEY non définie en production !');
  }
});
