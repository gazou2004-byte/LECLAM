/* =====================================================
   LE CLAM — app.js
   Carousel · Cart (localStorage) · Filters · Nav
   ===================================================== */
'use strict';

/* ─────────────────────────────────────────
   I18N — Moteur de traduction multilingue
   ───────────────────────────────────────── */
const I18n = (() => {
  const SUPPORTED = ['fr', 'en', 'es', 'de', 'it'];
  const DEFAULT   = 'fr';
  const STORE_KEY = 'leclam_lang';

  let _locale = DEFAULT;
  let _tr     = {};
  const _cache = {};

  function _detect() {
    const pathParts = location.pathname.split('/').filter(Boolean);
    if (pathParts.length && SUPPORTED.includes(pathParts[0])) {
      localStorage.setItem(STORE_KEY, pathParts[0]);
      return pathParts[0];
    }
    const saved = localStorage.getItem(STORE_KEY);
    if (SUPPORTED.includes(saved)) return saved;
    const browser = (navigator.language || '').slice(0, 2).toLowerCase();
    return SUPPORTED.includes(browser) ? browser : DEFAULT;
  }

  function t(key, vars) {
    const val = key.split('.').reduce((o, k) => (o && k in o ? o[k] : undefined), _tr);
    if (typeof val !== 'string') return key;
    if (!vars) return val;
    return val.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{{${k}}}`));
  }

  function _updateSEO() {
    const page = (location.pathname.split('/').pop() || 'index').replace('.html', '') || 'index';
    const m    = _tr.meta?.[page];
    if (!m) return;
    if (m.title)       document.title = m.title;
    const desc = document.querySelector('meta[name="description"]');
    if (desc && m.description) desc.setAttribute('content', m.description);
    ['og:title','twitter:title'].forEach(p => {
      const el = document.querySelector(`meta[property="${p}"],meta[name="${p}"]`);
      if (el && m.title) el.setAttribute('content', m.title);
    });
    ['og:description','twitter:description'].forEach(p => {
      const el = document.querySelector(`meta[property="${p}"],meta[name="${p}"]`);
      if (el && m.description) el.setAttribute('content', m.description);
    });
    document.documentElement.lang = _locale;
  }

  function apply() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      const val = t(key);
      if (val === key) return;
      const attr = el.dataset.i18nAttr;
      if (attr) el.setAttribute(attr, val);
      else      el.textContent = val;
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(el => {
      const val = t(el.dataset.i18nPh);
      if (val !== el.dataset.i18nPh) el.placeholder = val;
    });
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
      const key = el.dataset.i18nHtml;
      const val = t(key);
      if (val !== key) el.innerHTML = val;
    });
    _updateSEO();
    document.dispatchEvent(new CustomEvent('i18nApplied', { detail: { locale: _locale } }));
  }

  const _SS_KEY = 'i18n_v3_'; /* bump when locale files change */

  async function _load(lang) {
    /* 1 — Déjà en mémoire : switch instantané */
    if (_cache[lang]) {
      _tr = _cache[lang]; _locale = lang; apply(); return;
    }
    /* 2 — sessionStorage (entre-sessions) : affichage immédiat sans réseau */
    try {
      const raw = sessionStorage.getItem(_SS_KEY + lang);
      if (raw) {
        const data = JSON.parse(raw);
        _cache[lang] = data; _tr = data; _locale = lang; apply(); return;
      }
    } catch {}
    /* 3 — Réseau (première fois seulement) */
    try {
      const r    = await fetch('/locales/' + lang + '.json');
      const data = await r.json();
      _cache[lang] = data; _tr = data; _locale = lang;
      try { sessionStorage.setItem(_SS_KEY + lang, JSON.stringify(data)); } catch {}
      apply();
    } catch {
      if (lang !== DEFAULT) {
        try {
          const r    = await fetch('/locales/' + DEFAULT + '.json');
          const data = await r.json();
          _cache[DEFAULT] = data; _tr = data; _locale = DEFAULT;
          apply();
        } catch {}
      }
    }
  }

  async function setLocale(lang) {
    if (!SUPPORTED.includes(lang)) return;
    localStorage.setItem(STORE_KEY, lang);
    await _load(lang);
    if (typeof Cart !== 'undefined') Cart._render();
    translatePage();
  }

  function preloadLocales() {
    SUPPORTED.forEach(lang => {
      if (_cache[lang]) return;
      fetch('/locales/' + lang + '.json')
        .then(r => r.json())
        .then(data => {
          _cache[lang] = data;
          try { sessionStorage.setItem('i18n_' + lang, JSON.stringify(data)); } catch {}
        })
        .catch(() => {});
    });
  }

  function _translateNavLinks() {
    document.querySelectorAll('.nav-link[data-cat]').forEach(a => {
      const cat = a.dataset.cat;
      const val = t('nav.' + cat);
      if (val === 'nav.' + cat) return;
      const nodes = [...a.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim());
      if (nodes.length) nodes[nodes.length - 1].textContent = val;
      else {
        const span = a.querySelector('[data-i18n-nav]');
        if (span) span.textContent = val;
      }
    });
    const cartLabel = document.querySelector('.cart-label');
    if (cartLabel) cartLabel.textContent = t('nav.cart');
    /* Titre du drawer panier */
    const cartHead = document.querySelector('.cart-head h3');
    if (cartHead) cartHead.textContent = t('cart.title');
    const cartClose = document.querySelector('.cart-close');
    if (cartClose) cartClose.setAttribute('aria-label', t('cart.close'));
  }

  function _translateFilters() {
    const cls = document.body.className;
    let ns = null;
    if (cls.includes('page-plaisir'))    ns = 'filters_plaisir';
    else if (cls.includes('page-malin')) ns = 'filters_malin';
    else if (cls.includes('page-bebe'))  ns = 'filters_bebe';

    /* Bouton "Tout" */
    const allBtn = document.querySelector('.f-btn-tout');
    if (allBtn) {
      const v = t('filters.all');
      if (v !== 'filters.all') allBtn.textContent = v;
    }

    if (!ns) return;
    document.querySelectorAll('.f-btn:not(.f-btn-tout)').forEach(btn => {
      const filter = btn.dataset.filter;
      if (!filter) return;
      const val = t(ns + '.' + filter);
      if (val === ns + '.' + filter) return;
      /* Remplacer le nœud texte après le SVG (préserver icône + f-arrow) */
      const nodes = [...btn.childNodes];
      const txtNode = nodes.find(n => n.nodeType === 3 && n.textContent.trim());
      if (txtNode) {
        const arrow = btn.querySelector('.f-arrow');
        txtNode.textContent = arrow ? ' ' + val + ' ' : ' ' + val;
      }
    });
  }

  function _translateGaranties() {
    const map = [
      ['home.delivery_title', 'home.delivery_text'],
      ['home.payment_title',  'home.payment_text'],
      ['home.returns_title',  'home.returns_text'],
      ['home.support_title',  'home.support_text'],
    ];
    document.querySelectorAll('.garantie').forEach((g, i) => {
      if (!map[i]) return;
      const h4 = g.querySelector('h4');
      const p  = g.querySelector('p');
      const tv = t(map[i][0]); const pv = t(map[i][1]);
      if (h4 && tv !== map[i][0]) h4.textContent = tv;
      if (p  && pv !== map[i][1]) p.textContent  = pv;
    });
  }

  function _translateProducts() {
    document.querySelectorAll('.p-card[data-id]').forEach(card => {
      const id  = card.dataset.id;
      if (!id) return;
      const val = t('products.' + id);
      if (val === 'products.' + id) return;
      const nameEl = card.querySelector('.p-name');
      if (nameEl) nameEl.textContent = val;
      const img = card.querySelector('.p-img img');
      if (img) img.alt = val;
    });
  }

  function translatePage() {
    _translateNavLinks();
    _translateGaranties();
    _translateFilters();
    _translateProducts();
    apply();
  }

  function init() {
    _locale = _detect();
    _load(_locale);
  }

  return {
    t, apply, setLocale, translatePage, preloadLocales, init,
    get locale()    { return _locale; },
    get supported() { return [...SUPPORTED]; },
  };
})();

/* Échappe les caractères HTML pour prévenir les injections XSS */
function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── Zones de livraison (même logique que server.js _zoneIndex) ── */
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

/* Grille tarifaire — mise à jour depuis /api/shipping-config au chargement */
let _shipCfg = {
  zones:          [{ key:'fr' },{ key:'dom' },{ key:'eu' },{ key:'int' }],
  flatRates:      [4.90, 8.90, 9.90, 14.90],
  freeThresholds: [50,   null, null,  null ],
};
fetch('/api/shipping-config').then(r => r.json()).then(d => {
  if (d.ok && Array.isArray(d.prices)) { _shipCfg = d; if (typeof Cart !== 'undefined') Cart._render(); }
}).catch(() => {});

/* ── Purge de sécurité ──
   Supprime les numéros de carte complets qui auraient pu être
   stockés par une version précédente du code. Tourne une seule
   fois au chargement de chaque page. */
(function purgeStoredCardNumbers() {
  try {
    const raw = localStorage.getItem('leclam_user');
    if (!raw) return;
    const u = JSON.parse(raw);
    if (!Array.isArray(u.paymentMethods)) return;
    let changed = false;
    u.paymentMethods = u.paymentMethods.map(pm => {
      if (pm.number !== undefined || pm.cvv !== undefined) {
        /* eslint-disable no-unused-vars */
        const { number, cvv, ...safe } = pm;
        /* eslint-enable */
        changed = true;
        return safe;
      }
      return pm;
    });
    if (changed) localStorage.setItem('leclam_user', JSON.stringify(u));
  } catch {}
})();

/* ─────────────────────────────────────────
   CODES PROMO
   Admin : ajouter ici les codes actifs.
   type: 'percent' → remise en % | 'flat' → remise en €
   ───────────────────────────────────────── */
const PROMO_CODES = {
  // Exemples (décommenter pour activer) :
  // 'BIENVENUE10': { type: 'percent', value: 10 },
  // 'ETE5':        { type: 'flat',    value: 5  },
};
try {
  const _storedPromos = JSON.parse(localStorage.getItem('leclam_promo_codes') || 'null');
  if (_storedPromos) Object.assign(PROMO_CODES, _storedPromos);
} catch {}

/* ─────────────────────────────────────────
   CART
   Stocké dans localStorage sous "leclam_cart"
   ───────────────────────────────────────── */
const Cart = {
  _key: 'leclam_cart',

  get items() {
    try { return JSON.parse(localStorage.getItem(this._key) || '[]'); }
    catch { return []; }
  },

  _save(items) {
    try { localStorage.setItem(this._key, JSON.stringify(items)); } catch (e) { console.warn('[Cart] localStorage plein :', e); }
    this._update();
  },

  add(product) {
    const items = this.items;
    const idx = items.findIndex(i => i.id === product.id);
    if (idx > -1) items[idx].qty++;
    else items.push({ ...product, qty: 1 });
    this._save(items);
    this._animateBtn();
  },

  remove(id) {
    this._save(this.items.filter(i => i.id !== id));
  },

  changeQty(id, delta) {
    const items = this.items;
    const item = items.find(i => i.id === id);
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) return this._save(items.filter(i => i.id !== id));
    this._save(items);
  },

  total() {
    return this.items.reduce((s, i) => s + (i.price || 0) * (i.qty || 1), 0);
  },

  shipping(country) {
    if (this.total() === 0) return 0;
    const c = (country
      || document.getElementById('shipCountry')?.value
      || document.getElementById('epCountry')?.value
      || (() => { try { return JSON.parse(localStorage.getItem('leclam_user')||'{}').address?.country||'FR'; } catch { return 'FR'; } })()
    ).toUpperCase();

    /* Lire la config transport (transport.html → localStorage) */
    let tcfg = null;
    try { tcfg = JSON.parse(localStorage.getItem('leclam_shipping_v2')||'null'); } catch {}

    const countries = tcfg?.countries || _shipCfg.flatRates?.map((price, i) => ({
      code: ['FR','GP','DE','US'][i] || 'FR', price, threshold: (_shipCfg.freeThresholds||[])[i]
    })) || [];

    /* Trouver le pays, sinon utiliser le dernier (international) */
    const found = countries.find(x => x.code === c) || countries[countries.length - 1] || { price: 14.90, threshold: null };

    /* Seuil livraison offerte */
    if (found.threshold != null && this.total() >= found.threshold) return 0;

    /* Appliquer le coefficient poids */
    const totalWeightKg = this.items.reduce((s, i) => s + (i.weightG || 200) * i.qty, 0) / 1000;
    const weights = (tcfg?.weights || []).slice().sort((a, b) => a.maxKg - b.maxKg);
    const bracket = weights.find(w => totalWeightKg <= w.maxKg) || weights[weights.length - 1];
    const coef = bracket ? bracket.coef : 1;

    return Math.round(found.price * coef * 100) / 100;
  },

  /* Retourne { code, type, value } ou null */
  getPromo() {
    try { return JSON.parse(localStorage.getItem('leclam_promo') || 'null'); }
    catch { return null; }
  },

  /* Montant de la remise (€) */
  discount() {
    const promo = this.getPromo();
    if (!promo) return 0;
    const sub = this.total();
    if (promo.type === 'percent') return Math.min(sub * promo.value / 100, sub);
    if (promo.type === 'flat')    return Math.min(promo.value, sub);
    return 0;
  },

  grandTotal() {
    return this.total() - this.discount() + this.shipping();
  },

  applyPromo() {
    const input = document.getElementById('promoInput');
    const msg   = document.getElementById('promoMsg');
    if (!input || !msg) return;
    const code = input.value.trim().toUpperCase();
    if (!code) { msg.innerHTML = ''; return; }
    const promo = PROMO_CODES[code];
    if (!promo) {
      msg.innerHTML = `<span class="cart-promo-err">${I18n.t('cart.promo_invalid')}</span>`;
      return;
    }
    localStorage.setItem('leclam_promo', JSON.stringify({ code, ...promo }));
    msg.innerHTML = `<span class="cart-promo-ok">${I18n.t('cart.promo_success')}</span>`;
    this._render();
  },

  removePromo() {
    localStorage.removeItem('leclam_promo');
    this._render();
  },

  count() {
    return this.items.reduce((s, i) => s + i.qty, 0);
  },

  clear() {
    this._save([]);
  },

  _animateBtn() {
    const btn = document.getElementById('cartToggle');
    if (!btn) return;
    btn.style.animation = 'none';
    // force reflow
    void btn.offsetWidth;
    btn.style.animation = 'cartPop .45s ease';
  },

  _update() {
    /* badge counter */
    const cnt = this.count();
    document.querySelectorAll('#cartCount').forEach(el => {
      el.textContent = cnt;
      el.classList.toggle('show', cnt > 0);
    });
    this._render();
  },

  _render() {
    const itemsEl = document.getElementById('cartItems');
    const footEl  = document.getElementById('cartFoot');
    if (!itemsEl) return;

    const items    = this.items;
    const subtotal = this.total();
    const shipping = this.shipping();
    const grand    = subtotal + shipping;

    if (items.length === 0) {
      itemsEl.innerHTML = '<div class="cart-empty"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" style="opacity:.35"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg><p>' + I18n.t('cart.empty') + '</p></div>';
      if (footEl) footEl.style.display = 'none';
      return;
    }

    itemsEl.innerHTML = items.map(item => {
      /* Whitelist l'id pour éviter toute injection dans les attributs onclick */
      const safeId = item.id.replace(/[^a-zA-Z0-9\-_]/g, '');
      const oldPriceLine = (item.oldPrice && item.oldPrice > item.price)
        ? `<span style="text-decoration:line-through;color:#a0784a;font-size:.8rem;margin-right:.3rem">${fmtPrice(item.oldPrice)}</span>`
        : '';
      return `
      <div class="cart-item">
        <div class="cart-item-img">
          ${item.img
            ? `<img src="${escHtml(item.img)}" alt="${escHtml(item.name)}">`
            : `<span>${escHtml(item.emoji)}</span>`}
        </div>
        <div class="cart-item-info">
          <div class="cart-item-name">${escHtml(item.name)}</div>
          <div class="cart-item-price">${oldPriceLine}${fmtPrice(item.price)}</div>
          <div class="cart-item-ctrl">
            <button onclick="Cart.changeQty('${safeId}', -1)" aria-label="Diminuer"><svg width="10" height="2" viewBox="0 0 10 2" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="0" y1="1" x2="10" y2="1"/></svg></button>
            <span class="qty">${item.qty}</span>
            <button onclick="Cart.changeQty('${safeId}', 1)" aria-label="Augmenter"><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="0" x2="5" y2="10"/><line x1="0" y1="5" x2="10" y2="5"/></svg></button>
            <button class="rm" onclick="Cart.remove('${safeId}')" aria-label="Supprimer"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg></button>
          </div>
        </div>
      </div>`;
    }).join('');

    if (footEl) {
      footEl.style.display = 'block';
      const discount = this.discount();
      const grand    = subtotal - discount + shipping;
      const promo    = this.getPromo();
      const discountLine = discount > 0
        ? `<div class="cart-line"><span>${I18n.t('cart.discount')} ${promo.code}</span><span class="cart-discount">−${fmtPrice(discount)}</span></div>`
        : '';
      const promoActive = promo
        ? `<div class="cart-promo-msg"><span class="cart-promo-ok">✓ ${promo.code} ${I18n.t('cart.promo_applied')} <button onclick="Cart.removePromo()" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:.75rem;padding:0;font-family:inherit">${I18n.t('cart.promo_remove')}</button></span></div>`
        : '';
      const savedCountry = (document.getElementById('shipCountry')?.value || document.getElementById('epCountry')?.value || (() => { try { return JSON.parse(localStorage.getItem('leclam_user')||'{}').address?.country || 'FR'; } catch { return 'FR'; } })());
      /* Config transport — lire en premier (utilisée par délai, seuil, etc.) */
      let _tcfg = null;
      try { _tcfg = JSON.parse(localStorage.getItem('leclam_shipping_v2')||'null'); } catch {}
      const _countryData = (_tcfg?.countries||[]).find(x => x.code === savedCountry);
      const _freeThr = _countryData?.threshold ?? null;
      /* Zone & délai & douanes */
      const _zone = _zoneIndex(savedCountry);
      /* TVA 20% incluse — nulle hors UE (zone >= 3) */
      const tva = _zone >= 3 ? 0 : grand / 6; /* TTC × (20/120) = TTC/6 */
      const _deliveryLabels = [I18n.t('cart.delay_z1'), I18n.t('cart.delay_z2'), I18n.t('cart.delay_z3'), I18n.t('cart.delay_z4')];
      const _deliveryTime = _countryData?.delay || _deliveryLabels[_zone] || _deliveryLabels[3];
      const _customsWarning = _zone >= 3
        ? `<div style="margin:.4rem 0 .2rem;padding:.5rem .75rem;background:#fff7ed;border-radius:8px;border:1px solid #fed7aa;font-size:.75rem;color:#92400e;display:flex;align-items:center;gap:.4rem"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> ${I18n.t('cart.customs_warning')}</div>`
        : '';
      /* Économies */
      const _totalSavings = items.reduce((s, i) => (i.oldPrice && i.oldPrice > i.price) ? s + (i.oldPrice - i.price) * i.qty : s, 0);
      const _savingsLine = _totalSavings > 0.01
        ? `<div class="cart-line"><span style="color:#16a34a;display:flex;align-items:center;gap:.3rem"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>${I18n.t('cart.savings')}</span><span style="color:#16a34a;font-weight:700">-${fmtPrice(_totalSavings)}</span></div>`
        : '';
      /* Barre livraison offerte */
      let freeBar = '';
      if (_freeThr !== null) {
        const pct       = Math.min(100, Math.round((subtotal / _freeThr) * 100));
        const remaining = Math.max(0, _freeThr - subtotal).toFixed(2).replace('.', ',');
        const isFree    = subtotal >= _freeThr;
        const barGrad   = isFree
          ? 'linear-gradient(90deg,#4ade80,#16a34a)'
          : pct >= 80
            ? 'linear-gradient(90deg,#fbbf24,#22c55e)'
            : pct >= 40
              ? 'linear-gradient(90deg,#f59e0b,#84cc16)'
              : 'linear-gradient(90deg,#fb923c,#f59e0b)';
        const accentColor = isFree ? '#16a34a' : pct >= 80 ? '#15803d' : pct >= 40 ? '#65a30d' : '#d97706';
        const bgColor     = isFree ? '#f0fdf4' : pct >= 80 ? '#f7fef4' : pct >= 40 ? '#fefce8' : '#fff7ed';
        const borderColor = isFree ? '#bbf7d0' : pct >= 80 ? '#d9f99d' : pct >= 40 ? '#fef08a' : '#fed7aa';
        const iconSvg = isFree
          ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${accentColor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/></svg>`
          : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${accentColor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13" rx="1"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`;
        const msgHtml = isFree
          ? `<span style="font-weight:700;color:${accentColor}">${I18n.t('cart.shipping_free')}</span>`
          : I18n.t('cart.shipping_free_from', { amount: remaining });
        freeBar = `<div style="margin:.3rem 0 .8rem;padding:.8rem 1rem;background:${bgColor};border-radius:12px;border:1px solid ${borderColor}">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.55rem">
            <div style="display:flex;align-items:center;gap:.4rem;font-size:.73rem;color:#555">${iconSvg}${msgHtml}</div>
            <span style="font-size:.68rem;font-weight:800;color:${accentColor};background:${isFree?'#dcfce7':'#fff'};border:1px solid ${borderColor};border-radius:20px;padding:.1rem .45rem">${pct}%</span>
          </div>
          <div style="background:#e8e2d8;border-radius:20px;height:7px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${barGrad};border-radius:20px;transition:width .45s cubic-bezier(.4,0,.2,1)"></div>
          </div>
        </div>`;
      }
      const countryOpts = [
        ['FR','🇫🇷 France'],['BE','🇧🇪 Belgique'],['LU','🇱🇺 Luxembourg'],['CH','🇨🇭 Suisse'],
        ['DE','🇩🇪 Allemagne'],['IT','🇮🇹 Italie'],['ES','🇪🇸 Espagne'],['PT','🇵🇹 Portugal'],
        ['NL','🇳🇱 Pays-Bas'],['GB','🇬🇧 Royaume-Uni'],['US','🇺🇸 États-Unis'],
        ['CA','🇨🇦 Canada'],['AU','🇦🇺 Australie'],['JP','🇯🇵 Japon'],
        ['GP','🇬🇵 Guadeloupe'],['MQ','🇲🇶 Martinique'],['RE','🇷🇪 La Réunion'],
        ['MA','🇲🇦 Maroc'],['DZ','🇩🇿 Algérie'],['TN','🇹🇳 Tunisie'],
      ].map(([v,l]) => `<option value="${v}"${v===savedCountry?' selected':''}>${l}</option>`).join('');
      footEl.innerHTML = `
        ${freeBar}
        <div class="cart-totals">
          ${discountLine}
          ${_savingsLine}
          <div class="cart-line" style="align-items:center">
            <span>${I18n.t('cart.shipping')}</span>
            <span style="display:flex;align-items:center;gap:.4rem">
              <select id="cartCountry" onchange="Cart._onCountryChange(this.value)"
                style="font-size:.72rem;border:1px solid #e0e0e0;border-radius:6px;padding:.15rem .3rem;background:#fff;cursor:pointer;font-family:inherit;color:#555;max-width:110px">
                ${countryOpts}
              </select>
              <span id="cartShipPrice">${fmtPrice(shipping)}</span>
            </span>
          </div>
          <div style="font-size:.7rem;color:#aaa;text-align:right;margin-top:.15rem"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:.2rem"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${I18n.t('cart.delay')} <strong style="color:#666">${_deliveryTime}</strong></div>
          ${_customsWarning}
          ${_zone >= 3
            ? `<div class="cart-line cart-tva" style="opacity:.65;font-style:italic"><span>${I18n.t('cart.tva_none')}</span><span>—</span></div>`
            : `<div class="cart-line cart-tva"><span>${I18n.t('cart.tva')}</span><span>${fmtPrice(tva)}</span></div>`
          }
          <div class="cart-line cart-grand"><span>${I18n.t('cart.total')}</span><span>${fmtPrice(grand)}</span></div>
        </div>
        ${Object.keys(PROMO_CODES).length > 0 || promo ? `
        <div class="cart-promo" id="cartPromo">
          ${promoActive}
          ${!promo ? `
          <div class="cart-promo-row">
            <input type="text" placeholder="${I18n.t('cart.promo_placeholder')}" id="promoInput" class="cart-promo-input" onkeydown="if(event.key==='Enter')Cart.applyPromo()">
            <button onclick="Cart.applyPromo()" class="cart-promo-btn">${I18n.t('cart.promo_apply')}</button>
          </div>
          <div class="cart-promo-msg" id="promoMsg"></div>` : ''}
        </div>` : ''}
        <a href="paiement.html" class="checkout-btn">${I18n.t('cart.checkout')} →</a>
      `;
    }
  },

  _onCountryChange(country) {
    try {
      const user = JSON.parse(localStorage.getItem('leclam_user') || '{}');
      if (!user.address) user.address = {};
      user.address.country = country;
      localStorage.setItem('leclam_user', JSON.stringify(user));
    } catch {}
    /* Re-render complet pour mettre à jour barre + prix */
    this._render();
  },

  init() { this._update(); }
};

/* Expose globally pour les boutons inline onclick */
window.Cart = Cart;

/* ─────────────────────────────────────────
   CAROUSEL — rendu depuis slides-config.js
   ───────────────────────────────────────── */
function renderSlides() {
  const track  = document.getElementById('carouselTrack');
  const dotsEl = document.getElementById('cDots');
  if (!track || typeof SLIDES_CONFIG === 'undefined') return;

  track.innerHTML = SLIDES_CONFIG.map(s => {
    const darkTitle = s.dark ? ' slide-title-dark' : '';
    const darkDesc  = s.dark ? ' slide-desc-dark'  : '';
    const darkBadge = s.dark ? ' s-badge-dark'     : '';
    const darkCta   = s.dark ? ` slide-cta-${s.id}`: '';
    const heroImg = s.img
      ? `<img src="${s.img}" class="slide-hero-img" alt="${s.title}">`
      : '';
    const titleAttr = s.titleKey ? ` data-i18n="${s.titleKey}"` : '';
    const descAttr  = s.descKey  ? ` data-i18n="${s.descKey}"`  : '';
    const ctaAttr   = s.ctaKey   ? ` data-i18n="${s.ctaKey}"`   : '';
    return `
        <div class="slide slide-${s.id}${s.img ? ' slide-has-img' : ''}">
          <div class="slide-particles">
            ${s.particles.map(p => `<span class="p">${p}</span>`).join('')}
          </div>
          ${heroImg}
          <div class="slide-content">
            <div class="slide-badges">
              ${s.badges.map(b => `<span class="s-badge${darkBadge}">${b}</span>`).join('\n              ')}
            </div>
            <h1 class="slide-title${darkTitle}"${titleAttr}>${s.title}</h1>
            <p class="slide-desc${darkDesc}"${descAttr}>${s.desc}</p>
            <a href="${s.href}" class="slide-cta${darkCta}">
              <span${ctaAttr}>${s.cta}</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </a>
          </div>
        </div>`;
  }).join('');

  if (dotsEl) {
    dotsEl.innerHTML = SLIDES_CONFIG.map((_, i) =>
      `<button class="dot${i === 0 ? ' active' : ''}" data-index="${i}"></button>`
    ).join('');
  }
}

/* ─────────────────────────────────────────
   CAROUSEL — navigation & timer
   ───────────────────────────────────────── */
class Carousel {
  constructor(intervalMs = 5000) {
    this.el        = document.getElementById('carousel');
    this.track     = document.getElementById('carouselTrack');
    this.dots      = document.querySelectorAll('#cDots .dot');
    this.bar       = document.getElementById('progressBar');
    if (!this.el || !this.track) return;

    this.slides    = this.track.querySelectorAll('.slide');
    this.total     = this.slides.length;
    this.current   = 0;
    this.delay     = intervalMs;
    this.timer     = null;

    document.getElementById('prevBtn')?.addEventListener('click', () => this.prev());
    document.getElementById('nextBtn')?.addEventListener('click', () => this.next());

    this.dots.forEach(d => d.addEventListener('click', () => {
      this.goTo(+d.dataset.index);
    }));

    /* Touch / swipe */
    let sx = 0;
    this.el.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
    this.el.addEventListener('touchend',   e => {
      const dx = sx - e.changedTouches[0].clientX;
      if (Math.abs(dx) > 45) dx > 0 ? this.next() : this.prev();
    }, { passive: true });

    /* Pause on hover */
    this.el.addEventListener('mouseenter', () => clearInterval(this.timer));
    this.el.addEventListener('mouseleave', () => this._startTimer());

    this._startTimer();
    this._startProgress();
  }

  goTo(index) {
    this.current = (index + this.total) % this.total;
    this.track.style.transform = `translateX(-${this.current * 100}%)`;
    this.dots.forEach((d, i) => d.classList.toggle('active', i === this.current));
    this._resetTimer();
    this._syncSubNav();
  }

  _syncSubNav() {
    if (window.innerWidth > 768) return;
    const navLinks = document.getElementById('navLinks');
    if (!navLinks) return;
    const slide = this.slides[this.current];
    if (!slide) return;
    const grads = {
      'slide-plaisir': 'linear-gradient(90deg,#8b0030 0%,#cc0050 60%,#ff3d8a 100%)',
      'slide-malin':   'linear-gradient(90deg,#0a0a0a 0%,#1a0030 60%,#2d0050 100%)',
'slide-bebe':    'linear-gradient(90deg,#d4607a 0%,#f08090 60%,#ffb3c1 100%)',
    };
    const key = Object.keys(grads).find(k => slide.classList.contains(k));
    if (key) navLinks.style.background = grads[key];
  }
  next() { this.goTo(this.current + 1); }
  prev() { this.goTo(this.current - 1); }

  _startTimer() {
    clearInterval(this.timer);
    this.timer = setInterval(() => this.next(), this.delay);
  }
  _resetTimer() {
    this._startTimer();
    this._startProgress();
  }
  _startProgress() {
    if (!this.bar) return;
    this.bar.style.transition = 'none';
    this.bar.style.width = '0%';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.bar.style.transition = `width ${this.delay}ms linear`;
        this.bar.style.width = '100%';
      });
    });
  }
}

/* ─────────────────────────────────────────
   NAVBAR — scroll effect + mobile menu
   ───────────────────────────────────────── */
function initNavbar() {
  const nav = document.getElementById('navbar');
  if (!nav) return;
  const upd = () => nav.classList.toggle('scrolled', window.scrollY > 10);
  window.addEventListener('scroll', upd, { passive: true });
  upd();

  /* Mobile menu */
  const btn   = document.getElementById('mobileMenuBtn');
  const links = document.getElementById('navLinks');
  btn?.addEventListener('click', () => links?.classList.toggle('open'));
  links?.querySelectorAll('.nav-link').forEach(a => a.addEventListener('click', () => links.classList.remove('open')));

  /* Auth state */
  const identifyLinks = document.querySelectorAll('.nav-identify');
  const stored = localStorage.getItem('leclam_user');
  if (stored) {
    try {
      const user  = JSON.parse(stored);
      const token = localStorage.getItem('leclam_token') || '';
      const firstName = user.name ? user.name.split(' ')[0] : I18n.t('nav.my_account');
      identifyLinks.forEach(el => {
        el.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          <span style="display:flex;flex-direction:column;align-items:flex-start;line-height:1.15">
            <span style="font-size:.85rem;font-weight:600">${firstName} <span style="font-size:.65rem;opacity:.6">▾</span></span>
            <span style="font-size:.7rem;opacity:.55;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${user.email || ''}</span>
          </span>`;
        el.style.display = 'inline-flex';
        el.style.alignItems = 'center';
        el.style.gap = '.35rem';
        el.href = '#';
        el.style.position = 'relative';
        el.addEventListener('click', e => {
          if (document.getElementById('userDropdown')?.contains(e.target)) return;
          e.preventDefault();
          e.stopPropagation();
          toggleUserMenu(el, user);
        });
      });
      /* Cacher le panier pour l'admin (hors vue client) */
      if ((user.role === 'admin' || user.role === 'owner') && !isClientView()) {
        document.querySelectorAll('.cart-toggle').forEach(el => el.style.display = 'none');
        /* Afficher le lien Sourcing (admin uniquement) */
        document.querySelectorAll('.nav-sourcing').forEach(el => el.style.display = '');
      }
      /* Badge notifications */
      updateNavBadge();
      syncMessages(token);
      /* Restaure le cookie admin si on revient de vue client (cookie stale) */
      if ((user.role === 'admin' || user.role === 'owner') && !isClientView() && token) {
        fetch('/api/admin/restore-admin', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, credentials: 'include' }).catch(() => {});
      }
    } catch { localStorage.removeItem('leclam_user'); }
  }
}

/* ─────────────────────────────────────────
   MESSAGES / NOTIFICATIONS
   ───────────────────────────────────────── */
/* ── Notif admin (nouvelle commande, annulation, etc.) ── */
function notifyAdmin(type, data) {
  try {
    const notifs = JSON.parse(localStorage.getItem('leclam_admin_notifs') || '[]');
    notifs.unshift({
      id:        'anotif-' + Date.now() + '-' + Math.random().toString(36).slice(2,6),
      type,
      data,
      read:      false,
      createdAt: new Date().toISOString(),
    });
    localStorage.setItem('leclam_admin_notifs', JSON.stringify(notifs));
  } catch {}
}

function getAdminUnreadCount() {
  return parseInt(localStorage.getItem('leclam_admin_thread_unread') || '0', 10);
}

function getMsgUnreadCount() {
  try {
    const user = JSON.parse(localStorage.getItem('leclam_user') || '{}');
    if ((user.role === 'admin' || user.role === 'owner') && !isClientView()) return getAdminUnreadCount();
    const threadUnread = parseInt(localStorage.getItem('leclam_thread_unread') || '0', 10);
    const msgs = JSON.parse(localStorage.getItem('leclam_messages') || '[]');
    const msgUnread = msgs.filter(m => (!m.email || m.email === user.email || m.email === 'all') && !m.read).length;
    return threadUnread + msgUnread;
  } catch { return 0; }
}

function getUnreadCount() {
  try {
    const user = JSON.parse(localStorage.getItem('leclam_user') || '{}');
    if ((user.role === 'admin' || user.role === 'owner') && !isClientView()) return getAdminUnreadCount();
    const msgs = JSON.parse(localStorage.getItem('leclam_messages') || '[]');
    const msgUnread = msgs.filter(m =>
      (!m.email || m.email === user.email || m.email === 'all') && !m.read
    ).length;
    const threadUnread = parseInt(localStorage.getItem('leclam_thread_unread') || '0', 10);
    return msgUnread + threadUnread + (user.needsAddress ? 1 : 0);
  } catch { return 0; }
}

function updateNavBadge() {
  const count = getUnreadCount();
  document.querySelectorAll('.nav-identify').forEach(el => {
    let badge = el.querySelector('.nav-notif-badge');
    if (count > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'nav-notif-badge';
        el.appendChild(badge);
      }
      badge.textContent = count > 9 ? '9+' : count;
    } else if (badge) {
      badge.remove();
    }
  });
}

async function syncMessages(token) {
  if (!token) return;
  try {
    const user = JSON.parse(localStorage.getItem('leclam_user') || '{}');
    const isAdminUser = user.role === 'admin' || user.role === 'owner';
    let tok = token;
    const mkHdrs = () => ({ 'Authorization': 'Bearer ' + tok });

    /* Auto-refresh si token périmé (session cookie httpOnly valide 30 jours) */
    const _tryRefresh = async () => {
      try {
        const r = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
        const d = await r.json();
        if (d.ok) {
          tok = d.token;
          localStorage.setItem('leclam_token', d.token);
          localStorage.setItem('leclam_csrf',  d.csrfToken);
          return true;
        }
      } catch {}
      return false;
    };

    /* Messages système */
    const res = await fetch('/api/messages/mine', { headers: mkHdrs(), credentials: 'include' });
    if (res.status === 401) {
      if (!await _tryRefresh()) { updateNavBadge(); return; }
    } else if (res.ok) {
      const data = await res.json();
      if (data.ok) {
        const local = JSON.parse(localStorage.getItem('leclam_messages') || '[]');
        data.messages.forEach(sm => {
          const idx = local.findIndex(lm => lm.id === sm.id);
          if (idx > -1) local[idx] = { ...local[idx], ...sm };
          else local.push(sm);
        });
        localStorage.setItem('leclam_messages', JSON.stringify(local));
      }
    }

    /* Threads (conversations support) — calcul des non lus */
    const isAdminMode = isAdminUser && !isClientView();
    const threadsUrl = isAdminMode ? '/api/admin/threads' : '/api/threads';
    const tr = await fetch(threadsUrl, { headers: mkHdrs(), credentials: 'include' });
    if (tr.ok) {
      const td = await tr.json();
      if (td.ok) {
        const count = (td.threads || []).reduce((s, t) => {
          const msgs = t.messages || [];
          return s + (isAdminMode
            ? msgs.filter(m => m.from === 'client'  && !m.readByAdmin).length
            : msgs.filter(m => m.from === 'admin'   && !m.readByClient).length);
        }, 0);
        localStorage.setItem(isAdminMode ? 'leclam_admin_thread_unread' : 'leclam_thread_unread', String(count));
      }
    }

    updateNavBadge();
  } catch { /* serveur off */ }
}

function _dropdownItem(icon, label, sub, href, badge) {
  const bdg = badge > 0
    ? `<span style="background:#ef4444;color:#fff;font-size:.62rem;font-weight:700;padding:.1rem .42rem;border-radius:20px;flex-shrink:0">${badge > 9 ? '9+' : badge}</span>`
    : '';
  return `
    <a href="${href}" style="display:flex;align-items:center;gap:.75rem;padding:.6rem .85rem;color:#1a1a1a;border-radius:10px;text-decoration:none"
      onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background=''">
      <span style="width:28px;text-align:center;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#666">${icon}</span>
      <span style="flex:1;min-width:0">
        <span style="display:block;font-weight:600;font-size:.85rem">${label}</span>
        <span style="display:block;font-size:.73rem;color:#aaa;margin-top:.05rem">${sub}</span>
      </span>
      ${bdg}
    </a>`;
}

/* ── Vue client (admin simulation) ── */
function isClientView() {
  return localStorage.getItem('leclam_view_mode') === 'client';
}

async function _setViewMode(mode) {
  if (mode === 'client') {
    const adminToken = localStorage.getItem('leclam_token') || '';
    try {
      const r = await fetch('/api/admin/preview-client', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + adminToken },
      });
      if (r.ok) {
        const d = await r.json();
        if (d.ok) {
          localStorage.setItem('leclam_admin_backup_token', adminToken);
          localStorage.setItem('leclam_admin_backup_csrf',  localStorage.getItem('leclam_csrf') || '');
          localStorage.setItem('leclam_admin_backup_user',  localStorage.getItem('leclam_user') || '');
          localStorage.setItem('leclam_token', d.token);
          localStorage.setItem('leclam_csrf',  d.csrfToken);
          localStorage.setItem('leclam_user',  JSON.stringify({ name: 'Client (aperçu)', email: d.user.email, role: 'user' }));
          localStorage.setItem('leclam_admin_backup_page', location.pathname + location.search);
          localStorage.setItem('leclam_view_mode', 'client');
          location.href = 'index.html';
          return;
        }
      }
    } catch {}
    /* Fallback si le serveur n'a pas encore l'endpoint — bascule simple */
    localStorage.setItem('leclam_admin_backup_token', localStorage.getItem('leclam_token') || '');
    localStorage.setItem('leclam_admin_backup_csrf',  localStorage.getItem('leclam_csrf')  || '');
    localStorage.setItem('leclam_admin_backup_user',  localStorage.getItem('leclam_user')  || '');
    localStorage.setItem('leclam_admin_backup_page',  location.pathname + location.search);
    localStorage.setItem('leclam_view_mode', 'client');
    location.reload();
  } else {
    const adminToken = localStorage.getItem('leclam_admin_backup_token');
    const adminCsrf  = localStorage.getItem('leclam_admin_backup_csrf');
    const adminUser  = localStorage.getItem('leclam_admin_backup_user');
    const adminPage  = localStorage.getItem('leclam_admin_backup_page') || 'admin.html';
    if (adminToken) localStorage.setItem('leclam_token', adminToken);
    if (adminCsrf)  localStorage.setItem('leclam_csrf',  adminCsrf);
    if (adminUser)  localStorage.setItem('leclam_user',  adminUser);
    localStorage.removeItem('leclam_admin_backup_token');
    localStorage.removeItem('leclam_admin_backup_csrf');
    localStorage.removeItem('leclam_admin_backup_user');
    localStorage.removeItem('leclam_admin_backup_page');
    localStorage.removeItem('leclam_view_mode');
    /* Restaure le cookie session admin côté serveur */
    try {
      await fetch('/api/admin/restore-admin', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + (adminToken || '') },
      });
    } catch {}
    location.href = adminPage;
  }
}

function _injectClientViewBanner() {
  if (document.getElementById('clientViewBanner')) return;
  const bar = document.createElement('div');
  bar.id = 'clientViewBanner';
  bar.style.cssText = `position:fixed;bottom:0;left:0;right:0;z-index:99999;
    background:#f59e0b;color:#1a1a1a;display:flex;align-items:center;justify-content:center;
    gap:.75rem;padding:.45rem 1rem;font-size:.8rem;font-weight:700;font-family:inherit;
    box-shadow:0 -2px 12px rgba(0,0,0,.18)`;
  bar.innerHTML = `<span>Vue client active — vous voyez le site comme un client</span>
    <button onclick="_setViewMode('admin')" style="background:#1a1a1a;color:#fff;border:none;
      border-radius:20px;padding:.25rem .8rem;font-size:.75rem;font-weight:700;cursor:pointer;
      font-family:inherit">↩ Retour admin</button>`;
  document.body.appendChild(bar);
}

function toggleUserMenu(anchor, user) {
  const existing = document.getElementById('userDropdown');
  if (existing) { existing.remove(); return; }

  const unread  = getUnreadCount();
  const isAdmin = user.role === 'admin' || user.role === 'owner';
  const hasAdminBackup = !!localStorage.getItem('leclam_admin_backup_token');
  const histCount = (() => { try { return JSON.parse(localStorage.getItem('leclam_history')||'[]').length; } catch { return 0; } })();
  const clientV = isClientView();

  const menu = document.createElement('div');
  menu.id = 'userDropdown';
  menu.style.cssText = `
    position:absolute; top:calc(100% + 10px); right:0;
    background:#fff; border-radius:16px; padding:.4rem;
    box-shadow:0 12px 48px rgba(0,0,0,.18); min-width:240px;
    z-index:9999; color:#222; font-size:.85rem;
    border:1px solid rgba(0,0,0,.06);
  `;

  const viewToggle = (isAdmin || hasAdminBackup) ? `
    <div style="padding:.4rem .5rem .2rem">
      <button onclick="document.getElementById('userDropdown').remove();_setViewMode('${clientV ? 'admin' : 'client'}')"
        style="width:100%;display:flex;align-items:center;gap:.65rem;padding:.55rem .75rem;
          border:none;border-radius:10px;cursor:pointer;font-family:inherit;font-size:.83rem;font-weight:600;
          background:${clientV ? '#fef3c7' : '#f0fdf4'};color:${clientV ? '#92400e' : '#166534'};text-align:left">
        <span style="font-size:1.1rem">${clientV ? '↩' : '→'}</span>
        <span style="flex:1">
          <span style="display:block">${clientV ? I18n.t('account.view_admin') : I18n.t('account.view_client')}</span>
          <span style="font-size:.7rem;font-weight:400;opacity:.7">${clientV ? I18n.t('account.view_admin_sub') : I18n.t('account.view_client_sub')}</span>
        </span>
      </button>
    </div>
    <div style="border-top:1px solid #f5f5f5;margin:.2rem 0"></div>` : '';

  menu.innerHTML = `
    <div style="padding:.6rem .9rem .45rem;color:#aaa;font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em">${isAdmin ? (clientV ? I18n.t('account.client_view') : I18n.t('account.admin')) : I18n.t('account.my_account')}</div>
    <div style="padding:.45rem .9rem .7rem;border-bottom:1px solid #f0f0f0;margin-bottom:.3rem">
      <div style="font-weight:700;color:#1a1a1a;font-size:.9rem">${user.name}</div>
      <div style="font-size:.75rem;color:#bbb;margin-top:.1rem">${isAdmin ? (clientV ? I18n.t('account.client_view') : I18n.t('account.administrator')) : user.email}</div>
    </div>

    ${viewToggle}

    ${(isAdmin && !clientV)
      ? _dropdownItem('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>', I18n.t('account.dashboard'), 'Fournisseurs · Transport · TVA · …', 'admin.html', 0)
        + _dropdownItem('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>', I18n.t('account.messages_admin'), unread > 0 ? (unread > 1 ? unread + ' non lus' : '1 non lu') : I18n.t('account.messages_admin_sub'), 'admin-messages.html', unread)
      : (user.needsAddress ? `
        <a href="#" onclick="event.preventDefault();document.getElementById('userDropdown').remove();showAccountModal('edit')"
          style="display:flex;align-items:center;gap:.75rem;padding:.6rem .85rem;color:#92400e;border-radius:10px;text-decoration:none;background:#fffbeb;margin:.2rem 0"
          onmouseover="this.style.background='#fef3c7'" onmouseout="this.style.background='#fffbeb'">
          <span style="width:28px;text-align:center;flex-shrink:0;font-size:1.1rem">📍</span>
          <span style="flex:1;min-width:0">
            <span style="display:block;font-weight:700;font-size:.85rem">${I18n.t('account.address_required')}</span>
            <span style="display:block;font-size:.73rem;opacity:.7;margin-top:.05rem">${I18n.t('account.address_required_sub')}</span>
          </span>
          <span style="background:#ef4444;color:#fff;font-size:.62rem;font-weight:700;padding:.1rem .42rem;border-radius:20px;flex-shrink:0">1</span>
        </a>` : '')
        + `<a href="#" onclick="event.preventDefault();document.getElementById('userDropdown').remove();showAccountModal()" style="display:flex;align-items:center;gap:.75rem;padding:.6rem .85rem;color:#1a1a1a;border-radius:10px;text-decoration:none"
          onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background=''">
          <span style="width:28px;text-align:center;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#666"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
          <span style="flex:1;min-width:0">
            <span style="display:block;font-weight:600;font-size:.85rem">${I18n.t('account.profile')}</span>
            <span style="display:block;font-size:.73rem;color:#aaa;margin-top:.05rem">${I18n.t('account.profile_sub')}</span>
          </span>
        </a>`
        + _dropdownItem('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>', I18n.t('account.orders'), I18n.t('account.orders_sub'), 'mes-commandes.html', 0)
        + _dropdownItem('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>', I18n.t('account.messages'), unread > 0 ? (unread > 1 ? unread + ' non lus' : '1 non lu') : I18n.t('account.messages_sub'), 'messages.html', unread)
    }

    <div style="border-top:1px solid #f5f5f5;margin:.3rem 0"></div>
    <button onclick="logout()" style="width:100%;text-align:left;padding:.55rem .9rem;border:none;background:none;cursor:pointer;color:#ef4444;font-weight:600;font-size:.83rem;border-radius:10px;font-family:inherit;display:flex;align-items:center;gap:.6rem"
      onmouseover="this.style.background='#fff5f5'" onmouseout="this.style.background=''">
      <span style="font-size:1.1rem">↪</span> ${I18n.t('auth.logout')}
    </button>
  `;

  anchor.appendChild(menu);
  const closeMenu = e => {
    if (!menu.contains(e.target) && e.target !== anchor) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

/* ─────────────────────────────────────────
   MODAL COMPTE — 3 onglets
   ───────────────────────────────────────── */
function showAccountModal(initialTab) {
  if (document.getElementById('accountOverlay')) return;
  const raw = localStorage.getItem('leclam_user');
  if (!raw) return;
  const user = JSON.parse(raw);
  const initials = (user.name || '?').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();

  const overlay = document.createElement('div');
  overlay.id = 'accountOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10000;display:flex;align-items:center;justify-content:center;padding:1rem;backdrop-filter:blur(3px)';

  const IS = 'width:100%;box-sizing:border-box;padding:.65rem .85rem;border:1.5px solid #e0e0e0;border-radius:10px;font-size:.88rem;font-family:inherit;color:#222;outline:none;background:#fff';

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:20px;width:100%;max-width:480px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.28);overflow:hidden;font-family:inherit">
      <div style="padding:1.1rem 1.4rem;border-bottom:1px solid #f0f0f0;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;background:#faf9f7">
        <div style="display:flex;align-items:center;gap:.7rem">
          <div style="width:38px;height:38px;border-radius:50%;background:#3e2a14;display:flex;align-items:center;justify-content:center;color:#d9c4a0;font-weight:700;font-size:.88rem;flex-shrink:0">${initials}</div>
          <div><div style="font-size:.92rem;font-weight:700;color:#1a1a1a">${user.name||I18n.t('nav.my_account')}</div><div style="font-size:.7rem;color:#aaa">${user.email||''}</div></div>
        </div>
        <button onclick="document.getElementById('accountOverlay').remove()" style="background:none;border:none;cursor:pointer;font-size:1.2rem;color:#bbb;padding:.2rem;line-height:1;flex-shrink:0">✕</button>
      </div>
      <div id="acctContent" style="overflow-y:auto;flex:1;padding:1.3rem 1.4rem"></div>
    </div>`;

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  _acctRender(document.getElementById('acctContent'));
  if (initialTab === 'edit') _acctProfilEdit();
}

/* ── Préférences notifications ── */
function _notifRow(key, icon, label, desc, notifs, disabled) {
  const defaults = { email: true, sms: false, push: false, promo: true };
  const on = disabled ? false : (notifs[key] !== undefined ? !!notifs[key] : !!defaults[key]);
  const disabledNote = disabled ? ' <span style="font-size:.68rem;color:#f59e0b;font-weight:500">(numéro requis)</span>' : '';
  return `
    <div style="display:flex;align-items:center;gap:.75rem;background:#faf9f7;border-radius:10px;padding:.65rem .9rem">
      <span style="font-size:1.15rem;line-height:1">${icon}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:.84rem;font-weight:600;color:${disabled?'#bbb':'#1a1a1a'}">${label}${disabledNote}</div>
        <div style="font-size:.71rem;color:#aaa;margin-top:.08rem">${desc}</div>
      </div>
      <button onclick="${disabled?'':("_toggleNotif('"+key+"',this)")}"
        data-notif-key="${key}"
        style="min-width:56px;height:26px;padding:0 .65rem;border-radius:20px;font-size:.72rem;font-weight:700;
          border:2px solid ${on?'#3e2a14':'#e0e0e0'};background:${on?'#3e2a14':'#fff'};
          color:${on?'#d9c4a0':'#aaa'};cursor:${disabled?'default':'pointer'};
          font-family:inherit;transition:all .15s;opacity:${disabled?'.4':'1'}"
        ${disabled?'disabled':''}>
        ${on?I18n.t('account.enabled'):I18n.t('account.disabled')}
      </button>
    </div>`;
}

function _toggleNotif(key, btn) {
  const notifs = JSON.parse(localStorage.getItem('leclam_notif_prefs') || '{}');
  const defaults = { email: true, sms: false, push: false, promo: true };
  const cur = notifs[key] !== undefined ? notifs[key] : !!defaults[key];
  const next = !cur;
  notifs[key] = next;
  localStorage.setItem('leclam_notif_prefs', JSON.stringify(notifs));
  btn.textContent = next ? I18n.t('account.enabled') : I18n.t('account.disabled');
  btn.style.background   = next ? '#3e2a14' : '#fff';
  btn.style.color        = next ? '#d9c4a0' : '#aaa';
  btn.style.borderColor  = next ? '#3e2a14' : '#e0e0e0';
  const fb = document.getElementById('notifSaveMsg');
  if (fb) {
    fb.style.display = '';
    clearTimeout(fb._t);
    fb._t = setTimeout(() => { fb.style.display = 'none'; }, 2200);
  }
}

/* ── Onglet Profil ── */
function _acctRender(el) {
  if (!el) return;
  const user   = JSON.parse(localStorage.getItem('leclam_user') || '{}');
  const addr   = user.address || {};
  const pm     = user.paymentMethods || [];
  const orders = JSON.parse(localStorage.getItem('leclam_orders') || '[]')
    .filter(o => ['processing','shipped'].includes(o.status)).reverse();

  const IS  = 'width:100%;box-sizing:border-box;padding:.65rem .85rem;border:1.5px solid #e0e0e0;border-radius:10px;font-size:.88rem;font-family:inherit;color:#222;outline:none;background:#fff';
  const LBL = 'font-size:.72rem;font-weight:700;color:#666;display:block;margin-bottom:.25rem';

  const ST_COLOR = { processing:'#856404', shipped:'#0f5132' };
  const ST_BG    = { processing:'#fff3cd', shipped:'#d1e7dd' };
  const ST_LABEL = { processing:I18n.t('order.processing'), shipped:I18n.t('order.shipped') };

  el.innerHTML = `
    <!-- Vue profil -->
    <div id="acctProfilView">
      <div style="font-size:.68rem;font-weight:700;color:#a0856a;text-transform:uppercase;letter-spacing:.07em;margin-bottom:.6rem">Mon profil</div>
      <div style="display:grid;gap:.5rem;margin-bottom:1rem">
        ${[
          ['Prénom et nom', user.name  || '<span style="color:#bbb;font-style:italic">—</span>'],
          ['E-mail',        user.email || '<span style="color:#bbb;font-style:italic">—</span>'],
          [I18n.t('account.phone'), user.phone || `<span style="color:#bbb;font-style:italic">${I18n.t('account.not_set')}</span>`],
          [I18n.t('account.birthday'), user.birthday
            ? new Date(user.birthday).toLocaleDateString(I18n.locale + '-' + I18n.locale.toUpperCase(), { day:'2-digit', month:'long', year:'numeric' })
            : `<span style="color:#bbb;font-style:italic">${I18n.t('account.not_set')}</span>`],
          [I18n.t('auth.address')||'Adresse', addr.rue || addr.city
            ? [addr.rue, [addr.zip, addr.city].filter(Boolean).join(' '), addr.country].filter(Boolean).join(', ')
            : `<span style="color:#bbb;font-style:italic">${I18n.t('account.no_address')}</span>`],
        ].map(([l, v]) => `
          <div style="background:#faf9f7;border-radius:10px;padding:.6rem .9rem;display:flex;align-items:baseline;gap:.6rem">
            <div style="font-size:.66rem;font-weight:700;color:#a0856a;width:90px;flex-shrink:0">${l}</div>
            <div style="font-size:.87rem;font-weight:600;color:#1a1a1a;min-width:0">${v}</div>
          </div>`).join('')}
        <div style="background:#faf9f7;border-radius:10px;padding:.6rem .9rem">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.4rem">
            <div style="font-size:.66rem;font-weight:700;color:#a0856a">Paiements enregistrés</div>
            <button onclick="_showAddPayForm()" id="addPayBtn" style="font-size:.68rem;font-weight:700;color:#3e2a14;background:none;border:1px solid #d9c4a0;border-radius:20px;padding:.15rem .55rem;cursor:pointer;font-family:inherit">+ Ajouter</button>
          </div>
          <div id="pmList">
          ${pm.length ? pm.map((p, i) => {
            const coinColors = {BTC:'#F7931A',ETH:'#627EEA',USDT:'#26A17B',SOL:'#9945FF'};
            let badge = '', info = '';
            if (p.type === 'card') {
              badge = '<span style="background:#1a1f71;color:#fff;font-size:.6rem;padding:.1rem .4rem;border-radius:3px">' + escHtml(p.brand||'Carte') + '</span>';
              info  = '•••• ' + escHtml(p.last4||'????') + ' <span style="color:#aaa;font-size:.72rem">' + escHtml(p.expiry||'') + '</span>';
            } else if (p.type === 'paypal') {
              badge = '<svg viewBox="0 0 60 18" height="16" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle"><path d="M5.5 3h4c2 0 3.3 1 3 3.1-.4 2.2-2 3.3-4 3.3H7L6.3 13H3.8L5.5 3z" fill="#003087"/><path d="M7.3 7.6H8.5c.8 0 1.5-.4 1.6-1.5.2-1-.4-1.5-1.2-1.5H8L7.3 7.6z" fill="#009cde"/><path d="M12.5 5h4c2 0 3.3 1 3 3.1-.4 2.2-2 3.3-4 3.3H14L13.3 16H10.8L12.5 5z" fill="#009cde"/><path d="M14.3 10.6H15.5c.8 0 1.5-.4 1.6-1.5.2-1-.4-1.5-1.2-1.5H15L14.3 10.6z" fill="#012169"/><text x="22" y="13" font-family="Arial Black,Arial,sans-serif" font-size="9" font-weight="900" fill="#003087">Pay</text><text x="39" y="13" font-family="Arial Black,Arial,sans-serif" font-size="9" font-weight="900" fill="#009cde">Pal</text></svg>';
              info  = escHtml(p.email || '');
            } else if (p.type === 'crypto') {
              badge = '<span style="background:' + escHtml(coinColors[p.coin]||'#555') + ';color:#fff;font-size:.6rem;padding:.1rem .4rem;border-radius:3px">' + escHtml(p.coin||'₿') + '</span>';
              const w = escHtml(p.wallet || '');
              info  = w.length > 12 ? w.slice(0,6) + '…' + w.slice(-4) : w;
            }
            return '<div style="display:flex;align-items:center;gap:.5rem;font-size:.85rem;font-weight:600;color:#1a1a1a;margin-bottom:.2rem">'
              + badge + ' ' + info
              + '<button onclick="_removePayMethod(' + i + ')" style="margin-left:auto;background:none;border:none;cursor:pointer;color:#ddd;font-size:.8rem;padding:0">✕</button>'
              + '</div>';
          }).join('')
            : '<div id="pmEmpty" style="font-size:.82rem;color:#bbb;font-style:italic">Aucun enregistré</div>'}
          </div>
          <!-- Formulaire ajout moyen de paiement -->
          <div id="addPayForm" style="display:none;margin-top:.7rem;border-top:1px solid #ece6de;padding-top:.7rem">
            <div style="font-size:.7rem;font-weight:700;color:#3e2a14;margin-bottom:.5rem">Nouveau moyen de paiement</div>
            <div style="display:flex;gap:.3rem;margin-bottom:.65rem">
              <button onclick="_pmSetType('card')" id="pmTypeCard" style="flex:1;padding:.4rem .3rem;border:2px solid #1a1a1a;border-radius:8px;font-size:.7rem;font-weight:700;color:#1a1a1a;background:#f9f9f7;cursor:pointer;font-family:inherit"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:.3rem"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>Carte</button>
              <button onclick="_pmSetType('paypal')" id="pmTypePaypal" style="flex:1;padding:.4rem .3rem;border:2px solid #e5e5e5;border-radius:8px;font-size:.7rem;font-weight:700;color:#666;background:none;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center"><svg viewBox="0 0 60 18" height="14" xmlns="http://www.w3.org/2000/svg"><path d="M5.5 3h4c2 0 3.3 1 3 3.1-.4 2.2-2 3.3-4 3.3H7L6.3 13H3.8L5.5 3z" fill="#003087"/><path d="M7.3 7.6H8.5c.8 0 1.5-.4 1.6-1.5.2-1-.4-1.5-1.2-1.5H8L7.3 7.6z" fill="#009cde"/><path d="M12.5 5h4c2 0 3.3 1 3 3.1-.4 2.2-2 3.3-4 3.3H14L13.3 16H10.8L12.5 5z" fill="#009cde"/><path d="M14.3 10.6H15.5c.8 0 1.5-.4 1.6-1.5.2-1-.4-1.5-1.2-1.5H15L14.3 10.6z" fill="#012169"/><text x="22" y="13" font-family="Arial Black,Arial,sans-serif" font-size="9" font-weight="900" fill="#003087">Pay</text><text x="39" y="13" font-family="Arial Black,Arial,sans-serif" font-size="9" font-weight="900" fill="#009cde">Pal</text></svg></button>
              <button onclick="_pmSetType('crypto')" id="pmTypeCrypto" style="flex:1;padding:.4rem .3rem;border:2px solid #e5e5e5;border-radius:8px;font-size:.7rem;font-weight:700;color:#666;background:none;cursor:pointer;font-family:inherit">₿ Crypto</button>
            </div>
            <!-- Carte -->
            <div id="pmFormCard" style="display:grid;gap:.4rem">
              <div>
                <div style="font-size:.68rem;font-weight:700;color:#666;margin-bottom:.18rem">Numéro de carte</div>
                <input id="pmCardNumber" type="text" placeholder="1234 5678 9012 3456" maxlength="19"
                  style="width:100%;box-sizing:border-box;padding:.55rem .75rem;border:1.5px solid #e0e0e0;border-radius:9px;font-size:.85rem;font-family:inherit;color:#222;outline:none"
                  oninput="this.value=this.value.replace(/\\D/g,'').slice(0,16).replace(/(.{4})/g,'$1 ').trim();document.getElementById('perr-pmCardNumber').style.display='none';this.style.borderColor='#e0e0e0'">
                <span id="perr-pmCardNumber" style="display:none;font-size:.68rem;color:#dc2626;font-weight:600"></span>
              </div>
              <div>
                <div style="font-size:.68rem;font-weight:700;color:#666;margin-bottom:.18rem">Titulaire</div>
                <input id="pmCardName" type="text" placeholder="Marie Dupont"
                  style="width:100%;box-sizing:border-box;padding:.55rem .75rem;border:1.5px solid #e0e0e0;border-radius:9px;font-size:.85rem;font-family:inherit;color:#222;outline:none"
                  oninput="document.getElementById('perr-pmCardName').style.display='none';this.style.borderColor='#e0e0e0'">
                <span id="perr-pmCardName" style="display:none;font-size:.68rem;color:#dc2626;font-weight:600"></span>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:.4rem">
                <div>
                  <div style="font-size:.68rem;font-weight:700;color:#666;margin-bottom:.18rem">Expiration</div>
                  <input id="pmCardExpiry" type="text" placeholder="MM/AA" maxlength="5"
                    style="width:100%;box-sizing:border-box;padding:.55rem .75rem;border:1.5px solid #e0e0e0;border-radius:9px;font-size:.85rem;font-family:inherit;color:#222;outline:none"
                    oninput="let v=this.value.replace(/\\D/g,'').slice(0,4);if(v.length>=3)v=v.slice(0,2)+'/'+v.slice(2);this.value=v;document.getElementById('perr-pmCardExpiry').style.display='none';this.style.borderColor='#e0e0e0'">
                  <span id="perr-pmCardExpiry" style="display:none;font-size:.68rem;color:#dc2626;font-weight:600"></span>
                </div>
                <div>
                  <div style="font-size:.68rem;font-weight:700;color:#666;margin-bottom:.18rem">CVV</div>
                  <input id="pmCardCvv" type="password" placeholder="•••" maxlength="4"
                    style="width:100%;box-sizing:border-box;padding:.55rem .75rem;border:1.5px solid #e0e0e0;border-radius:9px;font-size:.85rem;font-family:inherit;color:#222;outline:none"
                    oninput="this.value=this.value.replace(/\\D/g,'').slice(0,4);document.getElementById('perr-pmCardCvv').style.display='none';this.style.borderColor='#e0e0e0'">
                  <span id="perr-pmCardCvv" style="display:none;font-size:.68rem;color:#dc2626;font-weight:600"></span>
                </div>
              </div>
            </div>
            <!-- PayPal -->
            <div id="pmFormPaypal" style="display:none">
              <div style="font-size:.72rem;color:#666;margin-bottom:.45rem;line-height:1.4">Entrez l'e-mail de votre compte PayPal pour le retrouver rapidement au paiement.</div>
              <div>
                <div style="font-size:.68rem;font-weight:700;color:#666;margin-bottom:.18rem">E-mail PayPal</div>
                <input id="pmPaypalEmail" type="email" placeholder="vous@example.com"
                  style="width:100%;box-sizing:border-box;padding:.55rem .75rem;border:1.5px solid #e0e0e0;border-radius:9px;font-size:.85rem;font-family:inherit;color:#222;outline:none"
                  oninput="document.getElementById('perr-pmPaypalEmail').style.display='none';this.style.borderColor='#e0e0e0'">
                <span id="perr-pmPaypalEmail" style="display:none;font-size:.68rem;color:#dc2626;font-weight:600"></span>
              </div>
            </div>
            <!-- Crypto -->
            <div id="pmFormCrypto" style="display:none">
              <div style="font-size:.68rem;font-weight:700;color:#666;margin-bottom:.3rem">Cryptomonnaie</div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:.3rem;margin-bottom:.5rem">
                <button onclick="_pmCryptoSelect(this,'BTC')" id="pmCoinBTC" style="display:flex;align-items:center;gap:.4rem;padding:.45rem .6rem;border:2px solid #1a1a1a;border-radius:8px;font-size:.74rem;font-weight:700;color:#1a1a1a;background:#fdf9f3;cursor:pointer;font-family:inherit"><span style="display:inline-block;width:12px;height:12px;background:#F7931A;border-radius:50%;flex-shrink:0"></span>Bitcoin</button>
                <button onclick="_pmCryptoSelect(this,'ETH')" id="pmCoinETH"  style="display:flex;align-items:center;gap:.4rem;padding:.45rem .6rem;border:2px solid #e5e5e5;border-radius:8px;font-size:.74rem;font-weight:700;color:#666;background:none;cursor:pointer;font-family:inherit"><span style="display:inline-block;width:12px;height:12px;background:#627EEA;border-radius:50%;flex-shrink:0"></span>Ethereum</button>
                <button onclick="_pmCryptoSelect(this,'USDT')" id="pmCoinUSDT" style="display:flex;align-items:center;gap:.4rem;padding:.45rem .6rem;border:2px solid #e5e5e5;border-radius:8px;font-size:.74rem;font-weight:700;color:#666;background:none;cursor:pointer;font-family:inherit"><span style="display:inline-block;width:12px;height:12px;background:#26A17B;border-radius:50%;flex-shrink:0"></span>USDT</button>
                <button onclick="_pmCryptoSelect(this,'SOL')" id="pmCoinSOL"  style="display:flex;align-items:center;gap:.4rem;padding:.45rem .6rem;border:2px solid #e5e5e5;border-radius:8px;font-size:.74rem;font-weight:700;color:#666;background:none;cursor:pointer;font-family:inherit"><span style="display:inline-block;width:12px;height:12px;background:#9945FF;border-radius:50%;flex-shrink:0"></span>Solana</button>
              </div>
              <div>
                <div style="font-size:.68rem;font-weight:700;color:#666;margin-bottom:.18rem">Adresse de wallet</div>
                <input id="pmCryptoWallet" type="text" placeholder="0x… ou bc1…"
                  style="width:100%;box-sizing:border-box;padding:.55rem .75rem;border:1.5px solid #e0e0e0;border-radius:9px;font-size:.82rem;font-family:monospace;color:#222;outline:none"
                  oninput="document.getElementById('perr-pmCryptoWallet').style.display='none';this.style.borderColor='#e0e0e0'">
                <span id="perr-pmCryptoWallet" style="display:none;font-size:.68rem;color:#dc2626;font-weight:600"></span>
              </div>
            </div>
            <div style="display:flex;gap:.4rem;margin-top:.6rem">
              <button onclick="_savePayMethod()" style="flex:1;padding:.6rem;background:#3e2a14;color:#d9c4a0;border:none;border-radius:50px;font-size:.8rem;font-weight:700;cursor:pointer;font-family:inherit">${I18n.t('account.save')}</button>
              <button onclick="_showAddPayForm(false)" style="padding:.6rem .9rem;background:#f0ece6;color:#555;border:none;border-radius:50px;font-size:.8rem;font-weight:600;cursor:pointer;font-family:inherit">${I18n.t('account.cancel')}</button>
            </div>
          </div>
        </div>
      </div>
      <button onclick="_acctProfilEdit()" style="width:100%;padding:.7rem;background:#3e2a14;color:#d9c4a0;border:none;border-radius:50px;font-size:.87rem;font-weight:700;cursor:pointer;font-family:inherit">${I18n.t('account.edit_profile')}</button>

      <!-- ── Section Notifications ── -->
      ${(() => {
        const notifs = JSON.parse(localStorage.getItem('leclam_notif_prefs') || '{}');
        return `
      <div style="border-top:1px solid #f0ece6;margin-top:1.2rem;padding-top:1rem">
        <div style="font-size:.65rem;font-weight:700;color:#a0856a;text-transform:uppercase;letter-spacing:.07em;margin-bottom:.75rem">Préférences de notification</div>
        <div style="display:grid;gap:.5rem">
          ${_notifRow('email', '📧', I18n.t('account.notif_email'), 'Confirmations de commande & suivi de livraison', notifs, false)}
          ${_notifRow('sms',   '📱', I18n.t('account.notif_sms'),   I18n.t('account.notif_sms_sub'),  notifs, !user.phone)}
          ${_notifRow('push',  '🔔', I18n.t('account.notif_push'),  I18n.t('account.notif_push_sub'), notifs, false)}
          ${_notifRow('promo', '🏷️',  I18n.t('account.notif_promo'), I18n.t('account.notif_promo_sub'), notifs, false)}
        </div>
        <div id="notifSaveMsg" style="display:none;text-align:center;margin-top:.55rem;font-size:.8rem;color:#16a34a;font-weight:600">✓ Préférence enregistrée</div>
      </div>`;
      })()}

      <!-- ── Section RGPD ── -->
      <div style="border-top:1px solid #f0ece6;margin-top:1.2rem;padding-top:1rem">
        <div style="font-size:.65rem;font-weight:700;color:#a0856a;text-transform:uppercase;letter-spacing:.07em;margin-bottom:.7rem">Mes données personnelles</div>
        <button onclick="exportMyData()" style="width:100%;padding:.6rem;background:#f5f5f5;color:#3e2a14;border:1px solid #e5e5e5;border-radius:50px;font-size:.82rem;font-weight:600;cursor:pointer;font-family:inherit;margin-bottom:.5rem">${I18n.t('account.download_data')}</button>
        <button onclick="deleteMyAccount()" style="width:100%;padding:.6rem;background:none;color:#dc2626;border:1px solid #fecaca;border-radius:50px;font-size:.82rem;font-weight:600;cursor:pointer;font-family:inherit">${I18n.t('account.delete_account')}</button>
        <p style="font-size:.68rem;color:#bbb;text-align:center;margin:.6rem 0 0;line-height:1.4">${I18n.t('account.rgpd')}, <a href="confidentialite.html" style="color:#a0856a;text-decoration:underline">Politique de confidentialité</a></p>
      </div>
    </div>

    <!-- Formulaire édition (masqué) -->
    <div id="acctProfilEdit" style="display:none">
      <div style="font-size:.68rem;font-weight:700;color:#a0856a;text-transform:uppercase;letter-spacing:.07em;margin-bottom:.65rem">${I18n.t('account.edit_profile')}</div>
      <div style="display:grid;gap:.5rem">
        <div><label style="${LBL}">${I18n.t('account.fullname')}</label><input id="epName"  type="text"  value="${user.name||''}"  placeholder="${I18n.t('account.name_placeholder')}"     style="${IS}" onfocus="this.style.borderColor='#d9c4a0'" onblur="this.style.borderColor='#e0e0e0'"><span id="perr-epName"  style="display:none;font-size:.7rem;color:#dc2626;font-weight:600;margin-top:.15rem"></span></div>
        <div><label style="${LBL}">${I18n.t('auth.email')}</label>        <input id="epEmail" type="email" value="${user.email||''}" placeholder="votre@email.fr"   style="${IS}" onfocus="this.style.borderColor='#d9c4a0'" onblur="this.style.borderColor='#e0e0e0'"><span id="perr-epEmail" style="display:none;font-size:.7rem;color:#dc2626;font-weight:600;margin-top:.15rem"></span></div>
        <div><label style="${LBL}">${I18n.t('account.phone')} <span style="font-weight:400;color:#ccc">${I18n.t('account.phone_optional')}</span></label><input id="epPhone" type="tel" value="${user.phone||''}" placeholder="${I18n.t('account.phone_placeholder')}" style="${IS}" onfocus="this.style.borderColor='#d9c4a0'" onblur="this.style.borderColor='#e0e0e0'"><span id="perr-epPhone" style="display:none;font-size:.7rem;color:#dc2626;font-weight:600;margin-top:.15rem"></span></div>
        <div><label style="${LBL}">${I18n.t('account.birthday')} <span style="font-weight:400;color:#ccc">${I18n.t('account.phone_optional')}</span></label><input id="epBirthday" type="date" value="${user.birthday||''}" style="${IS};color:${user.birthday?'#222':'#aaa'}" onfocus="this.style.borderColor='#d9c4a0'" onblur="this.style.borderColor='#e0e0e0'"><span id="perr-epBirthday" style="display:none;font-size:.7rem;color:#dc2626;font-weight:600;margin-top:.15rem"></span></div>
        <div style="border-top:1px solid #f0f0f0;padding-top:.55rem;margin-top:.1rem">
          <div style="font-size:.7rem;font-weight:700;color:#3e2a14;margin-bottom:.45rem">Adresse de livraison</div>
          <select id="epCountry" onchange="_applyZipMaxlen(); Cart._render();" style="${IS};margin-bottom:.4rem;appearance:none;-webkit-appearance:none;cursor:pointer;background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23aaa' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\");background-repeat:no-repeat;background-position:right .7rem center;padding-right:2rem" onfocus="this.style.borderColor='#d9c4a0'" onblur="this.style.borderColor='#e0e0e0'">
            <option value="FR" ${addr.country==='FR'||!addr.country?'selected':''}>🇫🇷 France</option>
            <option value="BE" ${addr.country==='BE'?'selected':''}>🇧🇪 Belgique</option>
            <option value="LU" ${addr.country==='LU'?'selected':''}>🇱🇺 Luxembourg</option>
            <option value="CH" ${addr.country==='CH'?'selected':''}>🇨🇭 Suisse</option>
            <option value="DE" ${addr.country==='DE'?'selected':''}>🇩🇪 Allemagne</option>
            <option value="IT" ${addr.country==='IT'?'selected':''}>🇮🇹 Italie</option>
            <option value="ES" ${addr.country==='ES'?'selected':''}>🇪🇸 Espagne</option>
            <option value="PT" ${addr.country==='PT'?'selected':''}>🇵🇹 Portugal</option>
            <option value="NL" ${addr.country==='NL'?'selected':''}>🇳🇱 Pays-Bas</option>
            <option value="GB" ${addr.country==='GB'?'selected':''}>🇬🇧 Royaume-Uni</option>
            <option value="US" ${addr.country==='US'?'selected':''}>🇺🇸 États-Unis</option>
            <option value="CA" ${addr.country==='CA'?'selected':''}>🇨🇦 Canada</option>
            <option value="AU" ${addr.country==='AU'?'selected':''}>🇦🇺 Australie</option>
            <option value="JP" ${addr.country==='JP'?'selected':''}>🇯🇵 Japon</option>
            <option value="KR" ${addr.country==='KR'?'selected':''}>🇰🇷 Corée du Sud</option>
            <option value="CN" ${addr.country==='CN'?'selected':''}>🇨🇳 Chine</option>
            <option value="MX" ${addr.country==='MX'?'selected':''}>🇲🇽 Mexique</option>
            <option value="BR" ${addr.country==='BR'?'selected':''}>🇧🇷 Brésil</option>
            <option value="IN" ${addr.country==='IN'?'selected':''}>🇮🇳 Inde</option>
            <option value="RU" ${addr.country==='RU'?'selected':''}>🇷🇺 Russie</option>
            <option value="AR" ${addr.country==='AR'?'selected':''}>🇦🇷 Argentine</option>
            <option value="MA" ${addr.country==='MA'?'selected':''}>🇲🇦 Maroc</option>
            <option value="DZ" ${addr.country==='DZ'?'selected':''}>🇩🇿 Algérie</option>
            <option value="TN" ${addr.country==='TN'?'selected':''}>🇹🇳 Tunisie</option>
          </select>
          <div><input id="epRue"  type="text" value="${addr.rue||''}"  placeholder="12 rue des Lilas" style="${IS};margin-bottom:.15rem" onfocus="this.style.borderColor='#d9c4a0'" onblur="this.style.borderColor='#e0e0e0'"><span id="perr-epRue" style="display:none;font-size:.7rem;color:#dc2626;font-weight:600;margin-bottom:.25rem;display:block"></span></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:.4rem">
            <div><input id="epZip"  type="text" value="${addr.zip||''}"  placeholder="Code postal" style="${IS}" oninput="_epZipSuggest()" onfocus="this.style.borderColor='#d9c4a0'" onblur="this.style.borderColor='#e0e0e0'"><span id="perr-epZip" style="display:none;font-size:.7rem;color:#dc2626;font-weight:600;margin-top:.15rem"></span></div>
            <div><input id="epCity" type="text" value="${addr.city||''}" placeholder="Ville"       style="${IS}" list="epCityList" onfocus="this.style.borderColor='#d9c4a0'" onblur="this.style.borderColor='#e0e0e0'"><datalist id="epCityList"></datalist><span id="perr-epCity" style="display:none;font-size:.7rem;color:#dc2626;font-weight:600;margin-top:.15rem"></span></div>
          </div>
        </div>
      </div>
      <div style="display:flex;gap:.5rem;margin-top:.9rem">
        <button onclick="_saveAcctProfil()" style="flex:1;padding:.7rem;background:#3e2a14;color:#d9c4a0;border:none;border-radius:50px;font-size:.87rem;font-weight:700;cursor:pointer;font-family:inherit">${I18n.t('account.save')}</button>
        <button onclick="document.getElementById('acctProfilView').style.display='';document.getElementById('acctProfilEdit').style.display='none'" style="padding:.7rem 1rem;background:#f5f5f5;color:#555;border:none;border-radius:50px;font-size:.87rem;font-weight:600;cursor:pointer;font-family:inherit">${I18n.t('account.cancel')}</button>
      </div>
      <div id="acctProfilMsg" style="display:none;text-align:center;margin-top:.55rem;font-size:.8rem;color:#16a34a;font-weight:600">${I18n.t('account.saved')}</div>
    </div>

    `;
}

function _acctProfilEdit() {
  document.getElementById('acctProfilView').style.display  = 'none';
  document.getElementById('acctProfilEdit').style.display  = '';
  _applyZipMaxlen();
}

function _profErr(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.style.borderColor = '#ef4444'; el.style.background = '#fff5f5'; }
  const sp = document.getElementById('perr-' + id);
  if (sp) { sp.textContent = msg; sp.style.display = 'block'; }
  return false;
}
function _profOk(id) {
  const el = document.getElementById(id);
  if (el) { el.style.borderColor = ''; el.style.background = ''; }
  const sp = document.getElementById('perr-' + id);
  if (sp) sp.style.display = 'none';
}

const _ZIP_MAXLEN = {
  FR:5, BE:4, LU:4, CH:4, DE:5, IT:5, ES:5, PT:8, NL:7,
  GB:8, US:10, CA:7, AU:4, JP:8, KR:5, CN:6, MX:5,
  BR:9, IN:6, RU:6, AR:8, MA:5, DZ:5, TN:4,
};
function _applyZipMaxlen() {
  const country = document.getElementById('epCountry')?.value || 'FR';
  const el = document.getElementById('epZip');
  if (el) el.maxLength = _ZIP_MAXLEN[country] || 10;
}

let _epZipTimer = null;
async function _epZipSuggest() {
  clearTimeout(_epZipTimer);
  _epZipTimer = setTimeout(async () => {
    const zip     = document.getElementById('epZip')?.value.trim()    || '';
    const country = document.getElementById('epCountry')?.value       || 'FR';
    const dl      = document.getElementById('epCityList');
    const cityEl  = document.getElementById('epCity');
    if (!dl) return;
    dl.innerHTML = '';

    const cities = await _fetchCitiesForZip(zip, country);
    dl.innerHTML = cities.map(c => `<option value="${c}">`).join('');
    if (cities.length === 1 && cityEl && !cityEl.value) cityEl.value = cities[0];
  }, 300);
}

async function _fetchCitiesForZip(zip, country) {
  try {
    if (country === 'FR' && /^\d{5}$/.test(zip)) {
      const r = await fetch(`https://geo.api.gouv.fr/communes?codePostal=${zip}&fields=nom&format=json`);
      const d = await r.json();
      return d.map(c => c.nom).sort();
    }
    const cc = { BE:'be', CH:'ch', DE:'de', NL:'nl', ES:'es', PT:'pt',
                 IT:'it', US:'us', CA:'ca', AU:'au', GB:'gb', MA:'ma', TN:'tn' };
    if (cc[country] && zip.length >= 4) {
      const r = await fetch(`https://api.zippopotam.us/${cc[country]}/${zip}`);
      if (!r.ok) return [];
      const d = await r.json();
      return [...new Set(d.places?.map(p => p['place name']) || [])].sort();
    }
  } catch {}
  return [];
}

function _saveAcctProfil() {
  const raw = localStorage.getItem('leclam_user');
  if (!raw) return;

  const name    = document.getElementById('epName').value.trim();
  const email   = document.getElementById('epEmail').value.trim();
  const phone   = document.getElementById('epPhone').value.trim();
  const zip     = document.getElementById('epZip').value.trim();
  const country = document.getElementById('epCountry')?.value || 'FR';

  let ok = true;

  /* Nom */
  if (!name) ok = _profErr('epName', 'Le nom est requis.');
  else _profOk('epName');

  /* Email */
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
    ok = _profErr('epEmail', 'Adresse e-mail invalide.');
  else _profOk('epEmail');

  /* Téléphone (facultatif, mais si rempli doit être valide) */
  if (phone) {
    const cleaned = phone.replace(/[\s.\-()]/g, '');
    let phoneOk;
    if (country === 'FR' || country === 'BE' || country === 'LU') {
      phoneOk = /^(\+33|0033|\+32|0032|\+352|00352)\d{7,9}$|^0[1-9]\d{7,8}$/.test(cleaned);
      if (!phoneOk) ok = _profErr('epPhone', I18n.t('errors.phone_invalid'));
    } else {
      phoneOk = /^\+?\d{7,15}$/.test(cleaned);
      if (!phoneOk) ok = _profErr('epPhone', I18n.t('errors.phone_format'));
    }
    if (phoneOk) _profOk('epPhone');
  } else _profOk('epPhone');

  /* Date de naissance (facultatif, mais si remplie doit être cohérente) */
  const birthday = document.getElementById('epBirthday').value;
  if (birthday) {
    const bd  = new Date(birthday);
    const now = new Date();
    const age = (now - bd) / (365.25 * 24 * 3600 * 1000);
    if (bd > now)    ok = _profErr('epBirthday', I18n.t('errors.future_date'));
    else if (age > 120) ok = _profErr('epBirthday', 'Date de naissance invalide.');
  }

  /* Code postal */
  const ZIP_RULES = {
    FR:/^\d{5}$/,        BE:/^\d{4}$/,              LU:/^\d{4}$/,
    CH:/^\d{4}$/,        DE:/^\d{5}$/,              IT:/^\d{5}$/,
    ES:/^\d{5}$/,        PT:/^\d{4}(-\d{3})?$/,     NL:/^\d{4} ?[A-Z]{2}$/i,
    GB:/^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i,
    US:/^\d{5}(-\d{4})?$/, CA:/^[A-Z]\d[A-Z] ?\d[A-Z]\d$/i,
    AU:/^\d{4}$/,        JP:/^\d{3}-?\d{4}$/,       KR:/^\d{5}$/,
    CN:/^\d{6}$/,        MX:/^\d{5}$/,              BR:/^\d{5}-?\d{3}$/,
    IN:/^\d{6}$/,        RU:/^\d{6}$/,              AR:/^\d{4}$|^[A-Z]\d{4}[A-Z]{3}$/i,
    MA:/^\d{5}$/,        DZ:/^\d{5}$/,              TN:/^\d{4}$/,
  };
  if (zip) {
    const rule = ZIP_RULES[country];
    if (rule && !rule.test(zip)) ok = _profErr('epZip', 'Code postal invalide pour ce pays.');
    else _profOk('epZip');
  } else _profOk('epZip');

  /* Rue (facultatif, mais si remplie doit être cohérente) */
  const rue = document.getElementById('epRue').value.trim();
  if (rue) {
    if (rue.length < 5)
      ok = _profErr('epRue', I18n.t('errors.address_short'));
    else if (!/\d/.test(rue))
      ok = _profErr('epRue', I18n.t('errors.address_no_number'));
    else _profOk('epRue');
  } else _profOk('epRue');

  /* Ville */
  const city = document.getElementById('epCity').value.trim();
  if (city) {
    if (city.length < 2)
      ok = _profErr('epCity', 'Nom de ville trop court.');
    else if (/^\d/.test(city))
      ok = _profErr('epCity', 'Le nom de ville ne peut pas commencer par un chiffre.');
    else _profOk('epCity');
  } else _profOk('epCity');

  if (!ok) return;

  let user;
  try { user = JSON.parse(raw); } catch { return; }
  user.name  = name || user.name;
  user.email = email || user.email;
  user.phone    = phone;
  user.birthday = document.getElementById('epBirthday').value || user.birthday || '';
  user.address = { rue, zip, city, country };
  delete user.needsAddress;
  localStorage.setItem('leclam_user', JSON.stringify(user));
  Cart._render();
  const msg = document.getElementById('acctProfilMsg');
  if (msg) msg.style.display = 'block';
  setTimeout(() => {
    document.getElementById('accountOverlay')?.remove();
    const firstName = user.name.split(' ')[0];
    document.querySelectorAll('.nav-identify span span:first-child').forEach(s => {
      s.innerHTML = firstName + ' <span style="font-size:.65rem;opacity:.6">▾</span>';
    });
    document.querySelectorAll('.nav-identify span + span').forEach(s => { s.textContent = user.email; });
  }, 800);
}

function _removePayMethod(idx) {
  const user = JSON.parse(localStorage.getItem('leclam_user') || '{}');
  if (!user.paymentMethods) return;
  user.paymentMethods.splice(idx, 1);
  localStorage.setItem('leclam_user', JSON.stringify(user));
  _acctRender(document.getElementById('acctContent'));
}

let _pmCurrentType = 'card';
let _pmSelectedCoin = 'BTC';

function _showAddPayForm(show) {
  const form = document.getElementById('addPayForm');
  const btn  = document.getElementById('addPayBtn');
  if (!form) return;
  const visible = show === false ? false : form.style.display === 'none';
  form.style.display = visible ? '' : 'none';
  if (btn) btn.textContent = visible ? '✕ Fermer' : '+ Ajouter';
  if (visible) {
    _pmCurrentType = 'card';
    _pmSelectedCoin = 'BTC';
    _pmSetType('card');
    ['pmCardNumber','pmCardName','pmCardExpiry','pmCardCvv','pmPaypalEmail','pmCryptoWallet'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.value = ''; el.style.borderColor = '#e0e0e0'; }
    });
    ['perr-pmCardNumber','perr-pmCardName','perr-pmCardExpiry','perr-pmCardCvv','perr-pmPaypalEmail','perr-pmCryptoWallet'].forEach(id => {
      const sp = document.getElementById(id);
      if (sp) sp.style.display = 'none';
    });
  }
}

function _cardBrand(num) {
  const n = num.replace(/\s/g, '');
  if (/^4/.test(n))           return 'Visa';
  if (/^5[1-5]/.test(n))     return 'Mastercard';
  if (/^2[2-7]/.test(n))     return 'Mastercard';
  if (/^3[47]/.test(n))      return 'Amex';
  if (/^6/.test(n))          return 'CB';
  return 'Carte';
}

function _pmErr(id, msg) {
  const el = document.getElementById(id);
  if (el) el.style.borderColor = '#ef4444';
  const sp = document.getElementById('perr-' + id);
  if (sp) { sp.textContent = msg; sp.style.display = 'block'; }
  return false;
}

function _savePayMethod() {
  const type = _pmCurrentType || 'card';
  let ok = true;
  const user = JSON.parse(localStorage.getItem('leclam_user') || '{}');
  if (!user.paymentMethods) user.paymentMethods = [];

  if (type === 'card') {
    const numRaw = (document.getElementById('pmCardNumber')?.value || '').replace(/\s/g, '');
    const name   = (document.getElementById('pmCardName')?.value   || '').trim();
    const expiry = (document.getElementById('pmCardExpiry')?.value || '').trim();
    const cvv    = (document.getElementById('pmCardCvv')?.value    || '').trim();

    if (!/^\d{16}$/.test(numRaw)) ok = _pmErr('pmCardNumber', '16 chiffres requis.');
    if (!name) ok = _pmErr('pmCardName', 'Nom du titulaire requis.');
    if (!/^\d{2}\/\d{2}$/.test(expiry)) {
      ok = _pmErr('pmCardExpiry', 'Format MM/AA requis.');
    } else {
      const [mm, yy] = expiry.split('/').map(Number);
      const now = new Date();
      if (mm < 1 || mm > 12 || new Date(2000 + yy, mm - 1) < new Date(now.getFullYear(), now.getMonth()))
        ok = _pmErr('pmCardExpiry', 'Carte expirée.');
    }
    if (!/^\d{3,4}$/.test(cvv)) ok = _pmErr('pmCardCvv', '3 ou 4 chiffres.');
    if (!ok) return;
    if (!user.paymentMethods.find(p => p.type === 'card' && p.last4 === numRaw.slice(-4) && p.expiry === expiry))
      user.paymentMethods.push({ type:'card', brand:_cardBrand(numRaw), last4:numRaw.slice(-4), expiry, cardName:name });
      /* Le numéro complet et le CVV ne sont JAMAIS stockés — PCI DSS */

  } else if (type === 'paypal') {
    const email = (document.getElementById('pmPaypalEmail')?.value || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
      ok = _pmErr('pmPaypalEmail', 'Adresse e-mail invalide.');
    if (!ok) return;
    if (!user.paymentMethods.find(p => p.type === 'paypal' && p.email === email))
      user.paymentMethods.push({ type:'paypal', email });

  } else if (type === 'crypto') {
    const coin   = _pmSelectedCoin || 'BTC';
    const wallet = (document.getElementById('pmCryptoWallet')?.value || '').trim();
    if (!wallet || wallet.length < 10) ok = _pmErr('pmCryptoWallet', 'Adresse de wallet invalide.');
    if (!ok) return;
    if (!user.paymentMethods.find(p => p.type === 'crypto' && p.coin === coin && p.wallet === wallet))
      user.paymentMethods.push({ type:'crypto', coin, wallet });
  }

  localStorage.setItem('leclam_user', JSON.stringify(user));
  _acctRender(document.getElementById('acctContent'));
}

function _pmSetType(type) {
  _pmCurrentType = type;
  ['card','paypal','crypto'].forEach(t => {
    const cap  = t.charAt(0).toUpperCase() + t.slice(1);
    const btn  = document.getElementById('pmType' + cap);
    const form = document.getElementById('pmForm' + cap);
    const active = t === type;
    if (btn) {
      btn.style.border      = active ? '2px solid #1a1a1a' : '2px solid #e5e5e5';
      btn.style.background  = active ? '#f9f9f7' : 'none';
      btn.style.color       = active ? '#1a1a1a' : '#666';
      btn.style.fontWeight  = active ? '700' : '600';
    }
    if (form) form.style.display = active ? '' : 'none';
  });
}

function _pmCryptoSelect(btn, coin) {
  _pmSelectedCoin = coin;
  ['BTC','ETH','USDT','SOL'].forEach(c => {
    const b = document.getElementById('pmCoin' + c);
    if (!b) return;
    const active = c === coin;
    b.style.border     = active ? '2px solid #1a1a1a' : '2px solid #e5e5e5';
    b.style.background = active ? '#fdf9f3' : 'none';
    b.style.color      = active ? '#1a1a1a' : '#666';
  });
}

/* ─────────────────────────────────────────
   COULEURS THÈME — navbar / footer / search
   ───────────────────────────────────────── */
const _THEME_COLOR_KEY = 'leclam_theme_colors';
const _THEME_DEFAULTS  = { plaisir: '#b00804', malin: '#1a1a2e', bebe: '#d36e87' };

function _applyThemeColors() {
  const colors = JSON.parse(localStorage.getItem(_THEME_COLOR_KEY) || '{}');
  let css = '';
  ['plaisir', 'malin', 'bebe'].forEach(cat => {
    const c = colors[cat];
    if (!c) return;
    css += `.page-${cat} .navbar,.page-${cat} .navbar.scrolled{background:${c}!important}`;
    css += `.page-${cat} .footer{background:${c}!important}`;
    css += `.page-${cat} .search-bar-wrap{background:${c}!important}`;
  });
  let el = document.getElementById('leclam-theme-override');
  if (!el) { el = document.createElement('style'); el.id = 'leclam-theme-override'; document.head.appendChild(el); }
  el.textContent = css;
}

function _onThemeColorInput(input) {
  const cat = input.dataset.cat;
  const val = input.value;
  const colors = JSON.parse(localStorage.getItem(_THEME_COLOR_KEY) || '{}');
  colors[cat] = val;
  localStorage.setItem(_THEME_COLOR_KEY, JSON.stringify(colors));
  _applyThemeColors();
  const hexEl = document.querySelector('.tc-hex-' + cat);
  if (hexEl) hexEl.textContent = val;
}

function _resetThemeColor(cat) {
  const colors = JSON.parse(localStorage.getItem(_THEME_COLOR_KEY) || '{}');
  delete colors[cat];
  localStorage.setItem(_THEME_COLOR_KEY, JSON.stringify(colors));
  _applyThemeColors();
  /* Rafraîchir le panel couleurs s'il est ouvert */
  const panel = document.getElementById('couleursPanel');
  if (panel) {
    panel.remove();
    const btn = document.getElementById('adminCouleursBtn');
    const pageCat = ['plaisir','malin','bebe'].find(c => document.body.classList.contains('page-'+c)) || '';
    _openCouleursPanel(pageCat);
  }
}


/* ─────────────────────────────────────────
   TABLEAU DE BORD ADMIN — Suivi commandes
   ───────────────────────────────────────── */
function showAdminDashboard() {
  if (document.getElementById('adminDashOverlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'adminDashOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10000;display:flex;align-items:center;justify-content:center;padding:1rem;backdrop-filter:blur(3px)';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:20px;width:100%;max-width:560px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.28);overflow:hidden;font-family:inherit">
      <div style="padding:1rem 1.4rem;border-bottom:1px solid #f0f0f0;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;background:#faf9f7">
        <div style="font-size:.95rem;font-weight:700;color:#1a1a1a">Suivi commandes</div>
        <button onclick="document.getElementById('adminDashOverlay').remove()" style="background:none;border:none;cursor:pointer;font-size:1.2rem;color:#bbb;padding:.2rem;line-height:1;flex-shrink:0">✕</button>
      </div>
      <div id="adminDashTabs" style="display:flex;border-bottom:1px solid #f0f0f0;flex-shrink:0">
        <button id="adTabClient" onclick="_adminDashTab('client')" style="flex:1;padding:.7rem;border:none;background:none;cursor:pointer;font-family:inherit;font-size:.82rem;font-weight:700;color:#3e2a14;border-bottom:2px solid #3e2a14">Commandes clients</button>
        <button id="adTabFourn" onclick="_adminDashTab('fourn')" style="flex:1;padding:.7rem;border:none;background:none;cursor:pointer;font-family:inherit;font-size:.82rem;font-weight:600;color:#aaa;border-bottom:2px solid transparent">Commandes fournisseurs</button>
      </div>
      <div id="adminDashContent" style="overflow-y:auto;flex:1;padding:1.2rem 1.4rem"></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  _adminDashTab('client');
}

function _adminDashTab(tab) {
  const tC = document.getElementById('adTabClient');
  const tF = document.getElementById('adTabFourn');
  if (!tC || !tF) return;
  const base = 'flex:1;padding:.7rem;border:none;background:none;cursor:pointer;font-family:inherit;font-size:.82rem;';
  tC.style.cssText = base + `font-weight:${tab==='client'?'700':'600'};color:${tab==='client'?'#3e2a14':'#aaa'};border-bottom:2px solid ${tab==='client'?'#3e2a14':'transparent'}`;
  tF.style.cssText = base + `font-weight:${tab==='fourn'?'700':'600'};color:${tab==='fourn'?'#3e2a14':'#aaa'};border-bottom:2px solid ${tab==='fourn'?'#3e2a14':'transparent'}`;
  const el = document.getElementById('adminDashContent');
  if (!el) return;
  if (tab === 'client') _adminClientOrders(el);
  else _adminFournOrders(el);
}

function _adminClientOrders(el) {
  const allOrders = JSON.parse(localStorage.getItem('leclam_orders') || '[]');
  const active    = allOrders.filter(o => ['processing','shipped'].includes(o.status));
  const ST_COLOR  = { processing:'#856404', shipped:'#0f5132' };
  const ST_BG     = { processing:'#fff3cd', shipped:'#d1e7dd' };
  const ST_LABEL  = { processing:I18n.t('order.processing'), shipped:I18n.t('order.shipped') };

  const byClient = {};
  active.forEach(o => {
    const key  = o.email || '—';
    const name = o.shippingAddress?.name || o.email || 'Client inconnu';
    if (!byClient[key]) byClient[key] = { name, email: key, orders: [] };
    byClient[key].orders.push(o);
  });
  const clients = Object.values(byClient);

  if (!clients.length) {
    el.innerHTML = '<div style="text-align:center;padding:2.5rem;color:#bbb;font-size:.85rem">Aucune commande client en cours.</div>';
    return;
  }
  el.innerHTML = clients.map(c => `
    <div class="js-client-card" data-email="${escHtml(c.email)}" data-name="${escHtml(c.name)}"
      style="border:1px solid #eee;border-radius:12px;padding:.85rem 1rem;margin-bottom:.7rem;cursor:pointer;transition:background .15s"
      onmouseover="this.style.background='#faf9f7'" onmouseout="this.style.background=''">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:.4rem">
        <div>
          <div style="font-size:.88rem;font-weight:700;color:#1a1a1a">${escHtml(c.name)}</div>
          <div style="font-size:.72rem;color:#aaa;margin-top:.05rem">${escHtml(c.email)}</div>
        </div>
        <span style="font-size:.72rem;background:#f0ebe3;color:#3e2a14;font-weight:700;padding:.2rem .6rem;border-radius:20px;white-space:nowrap;flex-shrink:0">${c.orders.length} en cours</span>
      </div>
      ${c.orders.map(o => {
        const st = o.status || 'processing';
        const date = o.createdAt ? new Date(o.createdAt).toLocaleDateString('fr-FR') : '—';
        return `<div style="display:flex;align-items:center;gap:.5rem;margin-top:.28rem;flex-wrap:wrap">
          <span style="font-size:.68rem;padding:.12rem .45rem;border-radius:20px;background:${ST_BG[st]};color:${ST_COLOR[st]};font-weight:700">${ST_LABEL[st]||st}</span>
          <span style="font-size:.72rem;color:#999">${escHtml(o.id)} · ${date} · ${(o.total||0).toFixed(2).replace('.',',')} €</span>
        </div>`;
      }).join('')}
      <div style="font-size:.71rem;color:#c0a882;margin-top:.45rem;text-align:right">Voir l'historique →</div>
    </div>`).join('');
  el.addEventListener('click', e => {
    const card = e.target.closest('.js-client-card');
    if (card) _adminClientHistory(card.dataset.email, card.dataset.name);
  });
}

function _adminClientHistory(email, name) {
  const allOrders = JSON.parse(localStorage.getItem('leclam_orders') || '[]');
  const history   = allOrders.filter(o => o.email === email).reverse();
  const ST_COLOR  = { processing:'#856404', shipped:'#0f5132', delivered:'#1e3a5f', cancelled:'#7f1d1d' };
  const ST_BG     = { processing:'#fff3cd', shipped:'#d1e7dd', delivered:'#dbeafe', cancelled:'#fee2e2' };
  const ST_LABEL  = { processing:I18n.t('order.processing'), shipped:I18n.t('order.shipped'), delivered:I18n.t('order.delivered'), cancelled:I18n.t('order.cancelled') };
  const el = document.getElementById('adminDashContent');
  if (!el) return;
  el.innerHTML = `
    <button onclick="_adminDashTab('client')" style="display:inline-flex;align-items:center;gap:.35rem;background:none;border:none;cursor:pointer;font-family:inherit;font-size:.8rem;color:#a0856a;font-weight:600;margin-bottom:.9rem;padding:0">← Retour</button>
    <div style="margin-bottom:1rem">
      <div style="font-size:.92rem;font-weight:700;color:#1a1a1a">${escHtml(name)}</div>
      <div style="font-size:.73rem;color:#aaa">${escHtml(email)} · ${history.length} commande${history.length>1?'s':''} au total</div>
    </div>
    ${history.length ? history.map(o => {
      const st   = o.status || 'processing';
      const date = o.createdAt ? new Date(o.createdAt).toLocaleDateString('fr-FR') : '—';
      return `
      <div style="border:1px solid #eee;border-radius:12px;padding:.85rem 1rem;margin-bottom:.65rem">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.3rem">
          <code style="font-size:.68rem;color:#bbb">${escHtml(o.id)}</code>
          <span style="font-size:.7rem;font-weight:700;padding:.15rem .5rem;border-radius:20px;background:${ST_BG[st]};color:${ST_COLOR[st]}">${ST_LABEL[st]||st}</span>
        </div>
        <div style="font-size:.75rem;color:#999;margin-bottom:.35rem">${date} · ${(o.items||[]).length} article${(o.items||[]).length>1?'s':''}</div>
        ${(o.items||[]).map(i=>`<div style="font-size:.78rem;color:#555;padding:.1rem 0">· ${escHtml(i.name||i.id)}${(i.qty||1)>1?` ×${i.qty}`:''} ${((i.price||0)*(i.qty||1)).toFixed(2).replace('.',',')} €</div>`).join('')}
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:.5rem">
          <div style="font-size:.88rem;font-weight:700;color:#1a1a1a">${(o.total||0).toFixed(2).replace('.',',')} €</div>
          <button class="js-set-status" data-order-id="${escHtml(o.id)}" data-email="${escHtml(email)}" data-name="${escHtml(name)}" style="padding:.28rem .7rem;background:#f5f5f5;border:1px solid #e5e5e5;border-radius:20px;font-size:.72rem;font-weight:600;cursor:pointer;color:#555;font-family:inherit">Changer statut</button>
        </div>
      </div>`;
    }).join('') : '<div style="text-align:center;padding:1.5rem;color:#bbb;font-size:.85rem">Aucune commande.</div>'}`;
  el.addEventListener('click', e => {
    const btn = e.target.closest('.js-set-status');
    if (btn) _adminSetOrderStatus(btn.dataset.orderId, btn.dataset.email, btn.dataset.name);
  });
}

function _adminSetOrderStatus(orderId, email, name) {
  const orders = JSON.parse(localStorage.getItem('leclam_orders') || '[]');
  const o = orders.find(x => x.id === orderId);
  if (!o) return;
  const statuses = [
    { v:'processing', l:I18n.t('order.processing') },
    { v:'shipped',    l:I18n.t('order.shipped')    },
    { v:'delivered',  l:I18n.t('order.delivered')  },
    { v:'cancelled',  l:I18n.t('order.cancelled')  },
  ];
  const overlay = document.createElement('div');
  overlay.id = 'statusPickerOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:10001;display:flex;align-items:center;justify-content:center;padding:1rem';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;width:100%;max-width:320px;padding:1.2rem;font-family:inherit;box-shadow:0 12px 40px rgba(0,0,0,.25)">
      <div style="font-size:.85rem;font-weight:700;color:#1a1a1a;margin-bottom:.2rem">Changer le statut</div>
      <div style="font-size:.72rem;color:#aaa;margin-bottom:.9rem">${escHtml(orderId)}</div>
      ${statuses.map(s => `
        <button class="js-pick-status" data-status="${escHtml(s.v)}"
          style="width:100%;text-align:left;padding:.55rem .8rem;border:1.5px solid ${o.status===s.v?'#3e2a14':'#eee'};border-radius:10px;background:${o.status===s.v?'#faf9f7':'#fff'};cursor:pointer;font-family:inherit;font-size:.84rem;font-weight:${o.status===s.v?'700':'400'};color:#1a1a1a;margin-bottom:.35rem">
          ${escHtml(s.l)}${o.status===s.v?' ✓':''}
        </button>`).join('')}
      <button class="js-close-overlay" style="width:100%;padding:.5rem;border:none;background:none;cursor:pointer;font-family:inherit;font-size:.8rem;color:#bbb;margin-top:.2rem">Annuler</button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => {
    if (e.target === overlay || e.target.closest('.js-close-overlay')) { overlay.remove(); return; }
    const btn = e.target.closest('.js-pick-status');
    if (btn) { _applyOrderStatus(orderId, btn.dataset.status, email, name); overlay.remove(); }
  });
}

function _applyOrderStatus(orderId, newStatus, email, name) {
  const orders = JSON.parse(localStorage.getItem('leclam_orders') || '[]');
  const idx = orders.findIndex(x => x.id === orderId);
  if (idx < 0) return;
  orders[idx].status = newStatus;
  localStorage.setItem('leclam_orders', JSON.stringify(orders));
  _adminClientHistory(email, name);
}

/* ── Commandes fournisseurs ── */
function _adminFournOrders(el) {
  const orders = JSON.parse(localStorage.getItem('leclam_fournisseur_orders') || '[]');
  const ST_COLOR = { pending:'#856404', sent:'#1e3a5f', received:'#0f5132' };
  const ST_BG    = { pending:'#fff3cd', sent:'#dbeafe', received:'#d1e7dd' };
  const ST_LABEL = { pending:I18n.t('order.pending'), sent:I18n.t('order.sent'), received:I18n.t('order.received') };

  el.innerHTML = `
    <button onclick="_adminNewFournOrder()" style="width:100%;padding:.65rem;background:#3e2a14;color:#d9c4a0;border:none;border-radius:50px;font-size:.84rem;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:1rem">+ Nouvelle commande fournisseur</button>
    <div id="fournOrderList">
    ${orders.length ? [...orders].reverse().map(o => {
      const st   = o.status || 'pending';
      const date = o.createdAt ? new Date(o.createdAt).toLocaleDateString('fr-FR') : '—';
      return `
      <div style="border:1px solid #eee;border-radius:12px;padding:.85rem 1rem;margin-bottom:.65rem">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:.3rem;gap:.5rem">
          <div>
            <div style="font-size:.88rem;font-weight:700;color:#1a1a1a">${escHtml(o.supplierName||'—')}</div>
            ${o.ref ? `<div style="font-size:.71rem;color:#aaa">Réf. ${escHtml(o.ref)}</div>` : ''}
          </div>
          <span style="font-size:.7rem;font-weight:700;padding:.15rem .5rem;border-radius:20px;background:${ST_BG[st]};color:${ST_COLOR[st]};white-space:nowrap;flex-shrink:0">${ST_LABEL[st]||st}</span>
        </div>
        <div style="font-size:.75rem;color:#999;margin-bottom:.3rem">${date}</div>
        ${o.notes ? `<div style="font-size:.78rem;color:#555;background:#faf9f7;border-radius:8px;padding:.4rem .6rem;margin-bottom:.4rem">${escHtml(o.notes)}</div>` : ''}
        <div style="display:flex;gap:.4rem;flex-wrap:wrap">
          <button class="js-fourn-status" data-id="${escHtml(o.id)}" style="padding:.28rem .7rem;background:#f5f5f5;border:1px solid #e5e5e5;border-radius:20px;font-size:.72rem;font-weight:600;cursor:pointer;color:#555;font-family:inherit">Statut</button>
          <button class="js-fourn-delete" data-id="${escHtml(o.id)}" style="padding:.28rem .7rem;background:none;border:1px solid #fecaca;border-radius:20px;font-size:.72rem;font-weight:600;cursor:pointer;color:#ef4444;font-family:inherit">Supprimer</button>
        </div>
      </div>`;
    }).join('') : '<div style="text-align:center;padding:2rem;color:#bbb;font-size:.85rem">Aucune commande fournisseur.</div>'}
    </div>`;
  el.addEventListener('click', e => {
    const s = e.target.closest('.js-fourn-status');
    const d = e.target.closest('.js-fourn-delete');
    if (s) _adminFournStatus(s.dataset.id);
    if (d) _adminFournDelete(d.dataset.id);
  });
}

function _adminNewFournOrder() {
  const overlay = document.createElement('div');
  overlay.id = 'fournOrderFormOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:10001;display:flex;align-items:center;justify-content:center;padding:1rem';
  const IS = 'width:100%;box-sizing:border-box;padding:.6rem .8rem;border:1.5px solid #e0e0e0;border-radius:10px;font-size:.85rem;font-family:inherit;color:#222;outline:none;background:#fff;margin-bottom:.6rem';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;width:100%;max-width:380px;padding:1.4rem;font-family:inherit;box-shadow:0 12px 40px rgba(0,0,0,.25)">
      <div style="font-size:.9rem;font-weight:700;color:#1a1a1a;margin-bottom:1rem">Nouvelle commande fournisseur</div>
      <label style="font-size:.72rem;font-weight:700;color:#666;display:block;margin-bottom:.25rem">Fournisseur *</label>
      <input id="fofSupplier" type="text" placeholder="Nom du fournisseur" style="${IS}" onfocus="this.style.borderColor='#d9c4a0'" onblur="this.style.borderColor='#e0e0e0'">
      <label style="font-size:.72rem;font-weight:700;color:#666;display:block;margin-bottom:.25rem">Référence</label>
      <input id="fofRef" type="text" placeholder="N° commande, réf. interne…" style="${IS}" onfocus="this.style.borderColor='#d9c4a0'" onblur="this.style.borderColor='#e0e0e0'">
      <label style="font-size:.72rem;font-weight:700;color:#666;display:block;margin-bottom:.25rem">Détails / produits</label>
      <textarea id="fofNotes" placeholder="Articles commandés, quantités…" rows="3" style="${IS}resize:vertical"></textarea>
      <div style="display:flex;gap:.6rem;margin-top:.4rem">
        <button onclick="_adminSaveFournOrder()" style="flex:1;padding:.65rem;background:#3e2a14;color:#d9c4a0;border:none;border-radius:50px;font-size:.84rem;font-weight:700;cursor:pointer;font-family:inherit">Enregistrer</button>
        <button onclick="document.getElementById('fournOrderFormOverlay').remove()" style="padding:.65rem 1rem;background:#f5f5f5;color:#555;border:none;border-radius:50px;font-size:.84rem;font-weight:600;cursor:pointer;font-family:inherit">Annuler</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('fofSupplier').focus();
}

function _adminSaveFournOrder() {
  const supplier = document.getElementById('fofSupplier')?.value.trim();
  if (!supplier) { document.getElementById('fofSupplier').style.borderColor = '#ef4444'; return; }
  const orders = JSON.parse(localStorage.getItem('leclam_fournisseur_orders') || '[]');
  orders.push({
    id:           'FOUR-' + Date.now(),
    supplierName: supplier,
    ref:          document.getElementById('fofRef')?.value.trim() || '',
    notes:        document.getElementById('fofNotes')?.value.trim() || '',
    status:       'pending',
    createdAt:    new Date().toISOString(),
  });
  localStorage.setItem('leclam_fournisseur_orders', JSON.stringify(orders));
  document.getElementById('fournOrderFormOverlay')?.remove();
  _adminFournOrders(document.getElementById('adminDashContent'));
}

function _adminFournStatus(orderId) {
  const orders   = JSON.parse(localStorage.getItem('leclam_fournisseur_orders') || '[]');
  const o        = orders.find(x => x.id === orderId);
  if (!o) return;
  const statuses = [
    { v:'pending',  l:'En attente' },
    { v:'sent',     l:'Envoyée'    },
    { v:'received', l:'Reçue'      },
  ];
  const overlay = document.createElement('div');
  overlay.id = 'fournStatusOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:10001;display:flex;align-items:center;justify-content:center;padding:1rem';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;width:100%;max-width:300px;padding:1.2rem;font-family:inherit;box-shadow:0 12px 40px rgba(0,0,0,.25)">
      <div style="font-size:.85rem;font-weight:700;color:#1a1a1a;margin-bottom:.2rem">Statut commande</div>
      <div style="font-size:.72rem;color:#aaa;margin-bottom:.9rem">${escHtml(o.supplierName||'—')}</div>
      ${statuses.map(s => `
        <button class="js-fourn-pick-status" data-status="${escHtml(s.v)}"
          style="width:100%;text-align:left;padding:.55rem .8rem;border:1.5px solid ${o.status===s.v?'#3e2a14':'#eee'};border-radius:10px;background:${o.status===s.v?'#faf9f7':'#fff'};cursor:pointer;font-family:inherit;font-size:.84rem;font-weight:${o.status===s.v?'700':'400'};color:#1a1a1a;margin-bottom:.35rem">
          ${escHtml(s.l)}${o.status===s.v?' ✓':''}
        </button>`).join('')}
      <button class="js-close-overlay" style="width:100%;padding:.5rem;border:none;background:none;cursor:pointer;font-family:inherit;font-size:.8rem;color:#bbb;margin-top:.2rem">Annuler</button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => {
    if (e.target === overlay || e.target.closest('.js-close-overlay')) { overlay.remove(); return; }
    const btn = e.target.closest('.js-fourn-pick-status');
    if (btn) { _applyFournStatus(orderId, btn.dataset.status); overlay.remove(); }
  });
}

function _applyFournStatus(orderId, newStatus) {
  const orders = JSON.parse(localStorage.getItem('leclam_fournisseur_orders') || '[]');
  const idx = orders.findIndex(x => x.id === orderId);
  if (idx < 0) return;
  orders[idx].status = newStatus;
  localStorage.setItem('leclam_fournisseur_orders', JSON.stringify(orders));
  _adminFournOrders(document.getElementById('adminDashContent'));
}

function _adminFournDelete(orderId) {
  const orders = JSON.parse(localStorage.getItem('leclam_fournisseur_orders') || '[]');
  localStorage.setItem('leclam_fournisseur_orders', JSON.stringify(orders.filter(x => x.id !== orderId)));
  _adminFournOrders(document.getElementById('adminDashContent'));
}

function _printInvoice(orderId) {
  const orders = JSON.parse(localStorage.getItem('leclam_orders') || '[]');
  const order  = orders.find(o => o.id === orderId);
  if (!order) return;
  const user = JSON.parse(localStorage.getItem('leclam_user') || '{}');
  const date = order.createdAt ? new Date(order.createdAt).toLocaleDateString('fr-FR') : new Date().toLocaleDateString('fr-FR');
  const addr = order.shippingAddress || user.address || {};
  const rows = (order.items || []).map(i =>
    `<tr><td style="padding:.4rem .6rem">${i.name}</td><td style="padding:.4rem .6rem;text-align:center">${i.qty}</td><td style="padding:.4rem .6rem;text-align:right">${(i.price*i.qty).toFixed(2).replace('.',',')} €</td></tr>`
  ).join('');
  const addrStr = [addr.rue, [addr.zip, addr.city].filter(Boolean).join(' '), addr.country].filter(Boolean).join(', ') || '—';
  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Facture ${order.id}</title>
  <style>body{font-family:Arial,sans-serif;max-width:600px;margin:2rem auto;color:#222;font-size:14px}
  h1{font-size:1.3rem;margin:0 0 .3rem}table{width:100%;border-collapse:collapse;margin:1rem 0}
  th{background:#f5f5f5;padding:.5rem .6rem;text-align:left;font-size:12px}
  td{border-bottom:1px solid #f0f0f0}.total{font-weight:700;font-size:1rem}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1.5rem;border-bottom:2px solid #3e2a14;padding-bottom:1rem}
  @media print{button{display:none}}</style></head><body>
  <div class="hdr"><div><h1>Le Clam</h1><div style="font-size:12px;color:#888">leclam.eu</div></div>
  <div style="text-align:right"><div style="font-weight:700">FACTURE</div><div style="font-size:12px;color:#888">${order.id}</div><div style="font-size:12px;color:#888">${date}</div></div></div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.5rem">
  <div><div style="font-size:11px;font-weight:700;color:#a0856a;text-transform:uppercase;margin-bottom:.3rem">Client</div>
  <div>${user.name||'—'}</div><div style="font-size:12px;color:#888">${user.email||''}</div></div>
  <div><div style="font-size:11px;font-weight:700;color:#a0856a;text-transform:uppercase;margin-bottom:.3rem">Livraison</div>
  <div style="font-size:12px">${addrStr}</div></div></div>
  <table><thead><tr><th>Article</th><th style="text-align:center">Qté</th><th style="text-align:right">Montant</th></tr></thead>
  <tbody>${rows}</tbody></table>
  <div style="text-align:right">
  <div style="font-size:13px;color:#888;margin-bottom:.2rem">Livraison : ${(order.shipping||0).toFixed(2).replace('.',',')} €</div>
  <div class="total">Total TTC : ${(order.total||0).toFixed(2).replace('.',',')} €</div></div>
  <div style="margin-top:2rem;text-align:center"><button onclick="window.print()" style="padding:.6rem 1.5rem;background:#3e2a14;color:#d9c4a0;border:none;border-radius:20px;cursor:pointer;font-size:13px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:.35rem"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>Imprimer</button></div>
  </body></html>`);
  w.document.close();
}

function showAccountEdit() { _acctProfilEdit(); }
function saveAccountEdit() { _saveAcctProfil(); }

/* Renvoie les headers auth pour les appels API */
function authHeaders(extra = {}) {
  const token = localStorage.getItem('leclam_token') || '';
  const csrf  = localStorage.getItem('leclam_csrf')  || '';
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'X-CSRF-Token': csrf, ...extra };
}

/* Synchronise le CSRF token depuis le serveur si le localStorage ne l'a pas
   (ex: après rechargement de page quand la session httpOnly cookie est encore valide) */
async function syncCsrfToken() {
  if (localStorage.getItem('leclam_csrf')) return;
  if (!localStorage.getItem('leclam_token')) return;
  try {
    const res  = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
    const data = await res.json();
    if (data.ok && data.csrfToken) localStorage.setItem('leclam_csrf', data.csrfToken);
  } catch { /* silencieux — la prochaine requête CSRF échouera normalement */ }
}

/* ── RGPD — Export des données personnelles ── */
async function exportMyData() {
  try {
    const res  = await fetch('/api/auth/export', { headers: authHeaders(), credentials: 'same-origin' });
    if (!res.ok) { alert(I18n.t('account.download_error')); return; }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `leclam-mes-donnees-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch {
    alert(I18n.t('auth.error_server'));
  }
}

/* ── RGPD — Suppression du compte ── */
async function deleteMyAccount() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:20000;display:flex;align-items:center;justify-content:center;padding:1.5rem';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:18px;max-width:360px;width:100%;padding:1.6rem;font-family:inherit;box-shadow:0 16px 48px rgba(0,0,0,.3)">
      <div style="font-size:1.1rem;font-weight:700;color:#1a1a1a;margin-bottom:.6rem">${I18n.t('account.delete_account')}</div>
      <p style="font-size:.85rem;color:#555;line-height:1.55;margin-bottom:1.2rem">Cette action est <strong>irréversible</strong>. Vos données personnelles seront supprimées. Vos commandes seront anonymisées (obligation légale comptable).</p>
      <p style="font-size:.82rem;color:#dc2626;background:#fff5f5;padding:.6rem .8rem;border-radius:8px;margin-bottom:1.2rem">Tapez <strong>SUPPRIMER</strong> pour confirmer :</p>
      <input id="deleteConfirmInput" type="text" placeholder="SUPPRIMER" style="width:100%;box-sizing:border-box;padding:.65rem .9rem;border:1.5px solid #e0e0e0;border-radius:10px;font-size:.9rem;font-family:inherit;margin-bottom:.9rem" autocomplete="off">
      <div style="display:flex;gap:.5rem">
        <button id="deleteConfirmBtn" style="flex:1;padding:.7rem;background:#dc2626;color:#fff;border:none;border-radius:50px;font-size:.87rem;font-weight:700;cursor:pointer;font-family:inherit;opacity:.4" disabled>Supprimer définitivement</button>
        <button onclick="this.closest('div[style]').remove()" style="padding:.7rem 1rem;background:#f5f5f5;color:#555;border:none;border-radius:50px;font-size:.87rem;font-weight:600;cursor:pointer;font-family:inherit">${I18n.t('account.cancel')}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('#deleteConfirmInput');
  const btn   = overlay.querySelector('#deleteConfirmBtn');
  input.focus();
  input.addEventListener('input', () => {
    const ok = input.value.trim().toUpperCase() === 'SUPPRIMER';
    btn.disabled = !ok;
    btn.style.opacity = ok ? '1' : '.4';
  });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = I18n.t('account.deleting');
    try {
      const res  = await fetch('/api/auth/account', { method: 'DELETE', headers: authHeaders(), credentials: 'same-origin' });
      const data = await res.json();
      if (data.ok) {
        overlay.remove();
        localStorage.removeItem('leclam_token');
        localStorage.removeItem('leclam_csrf');
        localStorage.removeItem('leclam_user');
        Cart.clear();
        location.href = 'index.html';
      } else {
        btn.disabled = false; btn.textContent = I18n.t('account.delete_confirm');
        alert(data.error || I18n.t('account.delete_error'));
      }
    } catch {
      btn.disabled = false; btn.textContent = I18n.t('account.delete_confirm');
      alert(I18n.t('auth.error_server'));
    }
  });
}

async function logout() {
  Cart.clear();
  localStorage.removeItem('leclam_promo');
  await fetch('/api/auth/logout', {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'same-origin',
  }).catch(() => {});
  localStorage.removeItem('leclam_token');
  localStorage.removeItem('leclam_csrf');
  localStorage.removeItem('leclam_user');
  location.reload();
}

/* ─────────────────────────────────────────
   CART DRAWER
   ───────────────────────────────────────── */
function initCartDrawer() {
  const toggle  = document.getElementById('cartToggle');
  const overlay = document.getElementById('cartOverlay');
  const close   = document.getElementById('cartClose');
  const drawer  = document.getElementById('cartDrawer');

  const open   = () => { drawer?.classList.add('open'); overlay?.classList.add('open'); document.body.style.overflow = 'hidden'; };
  const close_ = () => { drawer?.classList.remove('open'); overlay?.classList.remove('open'); document.body.style.overflow = ''; };

  toggle?.addEventListener('click', open);
  overlay?.addEventListener('click', close_);
  close?.addEventListener('click', close_);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close_(); });
}

/* ─────────────────────────────────────────
   SAVE LOCAL ORDER (global, used by paiement.html)
   ───────────────────────────────────────── */
window.saveLocalOrder = function(order) {
  const prev = JSON.parse(localStorage.getItem('leclam_orders') || '[]');
  if (!prev.find(o => o.id === order.id)) {
    localStorage.setItem('leclam_orders', JSON.stringify([...prev, order]));
    notifyAdmin('new_order', order);
    updateNavBadge();
  }
};

/* Appelé depuis commande.html quand un client annule */
window.notifyAdminCancel = function(order) {
  notifyAdmin('cancel_order', order);
  updateNavBadge();
};

/* ─────────────────────────────────────────
   PRODUCT FILTERS + SEARCH (pages catégorie)
   ───────────────────────────────────────── */
/* Ordre original des cartes produit (mémorisé au 1er appel) */
let _origCardOrder = null;

/* ── Sous-familles ── */
const SUB_FILTERS = {
  duo:      [{ v:'coquin',       l:'Coquin' }, { v:'telecommande', l:'Télécommandé' }],
  soloclub: [{ v:'femme', l:'Femme', mode:'groupe' }, { v:'homme', l:'Homme', mode:'groupe' }, { v:'mixte', l:'Mixte', mode:'groupe' }],
  maison:   [{ v:'cuisine',      l:'Cuisine' }, { v:'chambre',      l:'Chambre'       }, { v:'sdb',  l:'Salle de bain' }],
};
let _activeSubFam = '';
let _activeGroupe = '';

function closeSubDropdown() {
  const row = document.getElementById('subfamRow');
  if (row) { row.classList.remove('open'); row.innerHTML = ''; }
  document.querySelectorAll('.f-btn.subfam-open').forEach(b => b.classList.remove('subfam-open'));
}

function _getSubfamRow() {
  let row = document.getElementById('subfamRow');
  if (!row) {
    const bar = document.querySelector('.filters-bar');
    if (!bar) return null;
    row = document.createElement('div');
    row.className = 'subfam-row';
    row.id = 'subfamRow';
    bar.appendChild(row);
  }
  return row;
}

function renderSubFilters(filter) {
  closeSubDropdown();
  _activeSubFam = '';
  _activeGroupe = '';

  const subs = SUB_FILTERS[filter];
  if (!subs) return;

  const row = _getSubfamRow();
  if (!row) return;

  const anchor = document.querySelector(`.f-btn[data-filter="${filter}"]`);
  if (anchor) anchor.classList.add('subfam-open');

  const useGroupe = subs.length > 0 && subs[0].mode === 'groupe';

  const inner = document.createElement('div');
  inner.className = 'subfam-row-inner';
  inner.innerHTML = `<button class="sf-btn active" data-sf="">Tout</button>`
    + subs.map(s => `<button class="sf-btn" data-sf="${s.v}">${s.l}</button>`).join('');

  row.appendChild(inner);
  row.classList.add('open');

  inner.querySelectorAll('.sf-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      inner.querySelectorAll('.sf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      if (btn.dataset.sf === '') {
        /* "Tout" dans le défileur → tous les produits de la famille active, sans sous-filtre */
        _activeSubFam = '';
        _activeGroupe = '';
        applyFiltersAndSearch();
      } else {
        if (useGroupe) {
          _activeGroupe = btn.dataset.sf;
          _activeSubFam = '';
        } else {
          _activeSubFam = btn.dataset.sf;
          _activeGroupe = '';
        }
        applyFiltersAndSearch();
      }
    });
  });
}

function applyFiltersAndSearch() {
  const input  = document.getElementById('searchInput');
  const query  = input ? input.value.trim().toLowerCase() : '';
  const sortEl = document.getElementById('sortSelect');
  const sort   = sortEl ? sortEl.value : '';

  /* Recueillir tous les filtres actifs (hors "all") */
  const activeFilters = Array.from(document.querySelectorAll('.f-btn.active'))
    .map(b => b.dataset.filter)
    .filter(f => f && f !== 'all');
  const filterAll = activeFilters.length === 0;

  const grid  = document.querySelector('.products-grid');
  /* Exclure les cartes gérées par la page sourcing (data-src-card) */
  const cards = Array.from(document.querySelectorAll('.p-card:not([data-src-card])'));

  /* Mémoriser l'ordre HTML d'origine une seule fois */
  if (!_origCardOrder) _origCardOrder = [...cards];

  let visible = 0;
  cards.forEach(card => {
    /* La carte "Demande sur mesure" est toujours visible */
    if (card.classList.contains('p-card-request')) {
      card.style.display = '';
      visible++;
      return;
    }

    const tags     = (card.dataset.filter    || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    const familles = (card.dataset.famille   || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    const subfams  = (card.dataset.subfamille|| '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    const groupes  = (card.dataset.groupe    || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    const name  = (card.querySelector('.p-name')?.textContent || '').toLowerCase();
    const sub   = (card.querySelector('.p-sub')?.textContent  || '').toLowerCase();

    /* Filtres combinables : la carte doit matcher N'IMPORTE LEQUEL des filtres actifs */
    const matchMain   = filterAll || activeFilters.some(f => tags.includes(f) || familles.includes(f));
    const matchSub    = !_activeSubFam || subfams.includes(_activeSubFam);
    const matchGroupe = !_activeGroupe || groupes.includes(_activeGroupe);
    const match = matchMain && matchSub && matchGroupe && (!query || name.includes(query) || sub.includes(query));
    card.style.display = match ? '' : 'none';
    if (match) visible++;
  });

  /* Tri par prix ou note — ou restauration de l'ordre original */
  if (grid) {
    if (sort) {
      const pinned = _origCardOrder.filter(c => c.classList.contains('p-card-request'));
      const rest   = _origCardOrder.filter(c => !c.classList.contains('p-card-request'));
      const shown  = rest.filter(c => c.style.display !== 'none');
      const hidden = rest.filter(c => c.style.display === 'none');
      shown.sort((a, b) => {
        if (sort === 'price-asc') {
          return (parseFloat(a.dataset.price) || 0) - (parseFloat(b.dataset.price) || 0);
        } else if (sort === 'price-desc') {
          return (parseFloat(b.dataset.price) || 0) - (parseFloat(a.dataset.price) || 0);
        } else if (sort === 'rating') {
          return (parseFloat(b.dataset.rating) || 0) - (parseFloat(a.dataset.rating) || 0);
        }
        return 0;
      });
      [...pinned, ...shown, ...hidden].forEach(c => grid.appendChild(c));
    } else {
      /* Pas de tri → ordre choisi (HTML d'origine) */
      _origCardOrder.forEach(c => grid.appendChild(c));
    }
  }

  const countEl = document.querySelector('.prod-count');
  if (countEl) countEl.textContent = (typeof I18n !== 'undefined') ? I18n.t('filters.results', { count: visible }) : visible + ' article' + (visible > 1 ? 's' : '');

  const noRes = document.querySelector('.search-no-results');
  if (noRes) noRes.style.display = visible === 0 ? 'block' : 'none';
}

function onSortChange(sel) {
  const inner = document.getElementById('sortInner');
  if (inner) inner.classList.toggle('active-sort', !!sel.value);
  applyFiltersAndSearch();
}

function initFilters() {
  const btns = document.querySelectorAll('.f-btn');
  if (!btns.length) return;

  btns.forEach(btn => btn.addEventListener('click', e => {
    const filter = btn.dataset.filter;

    /* Bouton "Tout" — réinitialise tout */
    if (filter === 'all') {
      closeSubDropdown();
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _activeSubFam = '';
      _activeGroupe = '';
      applyFiltersAndSearch();
      return;
    }

    /* Toggle défileur si même famille recliquée (ferme le défileur, garde le filtre principal) */
    if (btn.classList.contains('subfam-open')) {
      closeSubDropdown();
      _activeSubFam = '';
      _activeGroupe = '';
      applyFiltersAndSearch();
      return;
    }
    closeSubDropdown();

    const toutBtn = document.querySelector('.f-btn-tout, .f-btn[data-filter="all"]');
    const wasActive = btn.classList.contains('active');

    /* Sélection exclusive : désactiver tous, puis activer le cliqué (sauf si déjà actif) */
    btns.forEach(b => b.classList.remove('active'));
    if (!wasActive) {
      btn.classList.add('active');
      if (toutBtn) toutBtn.classList.remove('active');
      renderSubFilters(filter);
    } else {
      /* Recliqué → retour à "Tout" */
      _activeSubFam = '';
      _activeGroupe = '';
      if (toutBtn) toutBtn.classList.add('active');
    }
    applyFiltersAndSearch();
  }));
}

function initSearch() {
  const input = document.getElementById('searchInput');
  const clear = document.getElementById('searchClear');
  if (!input) return;

  input.addEventListener('input', () => {
    if (clear) clear.style.display = input.value ? '' : 'none';
    applyFiltersAndSearch();
  });

  clear?.addEventListener('click', () => {
    input.value = '';
    clear.style.display = 'none';
    input.focus();
    applyFiltersAndSearch();
  });
}

/* ─────────────────────────────────────────
   ADD TO CART  (appelé via onclick="addToCart(this)")
   ───────────────────────────────────────── */
window.addToCart = function(btn) {
  const card = btn.closest('.p-card');
  if (!card) return;

  const firstImg = card.querySelector('.p-gallery-track img') || card.querySelector('.p-img img');
  const price    = parseFloat(card.dataset.price) || 0;
  const oldPriceRaw = parseFloat(card.dataset.oldPrice);
  const oldPrice = !isNaN(oldPriceRaw) && oldPriceRaw > price ? oldPriceRaw : undefined;

  Cart.add({
    id:       card.dataset.id,
    name:     card.querySelector('.p-name')?.textContent?.trim() || 'Produit',
    emoji:    card.querySelector('.p-img > span:first-child')?.textContent || '📦',
    price,
    oldPrice,
    img:      firstImg ? firstImg.getAttribute('src') : null,
    weightG:  parseInt(card.dataset.weight, 10) || 200,
  });

  btn.textContent = I18n.t('product.added');
  btn.style.background = '#22C55E';
  setTimeout(() => {
    btn.textContent = I18n.t('product.add');
    btn.style.background = '';
  }, 1400);
};

/* ─────────────────────────────────────────
   UTILS
   ───────────────────────────────────────── */
function fmtPrice(n) {
  return n.toFixed(2).replace('.', ',') + ' €';
}

/* Inject animation keyframes dynamically */
const style = document.createElement('style');
style.textContent = `
  @keyframes cartPop {
    0%,100% { transform: scale(1) rotate(0deg); }
    30%  { transform: scale(1.15) rotate(-8deg); }
    60%  { transform: scale(1.1)  rotate(7deg); }
  }
`;
document.head.appendChild(style);

/* ─────────────────────────────────────────
   MODAL PRODUIT
   S'ouvre au clic sur une .p-card (hors boutons)
   ───────────────────────────────────────── */
/* ── Avis par catégorie — sélection déterministe par data-id ── */
const REVIEW_POOLS = {
  plaisir: [
    { author: 'Marie-L.',     stars: 5, dateISO: '2025-04-08' },
    { author: 'Julien B.',    stars: 4, dateISO: '2025-04-02' },
    { author: 'Camille R.',   stars: 5, dateISO: '2025-03-25' },
    { author: 'Thomas D.',    stars: 5, dateISO: '2025-03-18' },
    { author: 'Sophie M.',    stars: 4, dateISO: '2025-03-11' },
    { author: 'Alexandre P.', stars: 5, dateISO: '2025-03-03' },
    { author: 'Léa V.',       stars: 3, dateISO: '2025-02-24' },
    { author: 'Mathieu G.',   stars: 5, dateISO: '2025-02-15' },
    { author: 'Anaïs F.',     stars: 4, dateISO: '2025-02-08' },
    { author: 'Nicolas L.',   stars: 5, dateISO: '2025-02-01' },
    { author: 'Emma C.',      stars: 4, dateISO: '2025-01-22' },
    { author: 'Lucie T.',     stars: 5, dateISO: '2025-01-08' },
    { author: 'Baptiste K.',  stars: 4, dateISO: '2025-01-02' },
    { author: 'Inès B.',      stars: 5, dateISO: '2024-12-26' },
    { author: 'Clara N.',     stars: 5, dateISO: '2024-12-12' },
    { author: 'Pierre M.',    stars: 3, dateISO: '2024-12-05' },
    { author: 'Zoé A.',       stars: 5, dateISO: '2024-11-28' },
    { author: 'Florian D.',   stars: 4, dateISO: '2024-11-21' },
    { author: 'Manon S.',     stars: 5, dateISO: '2024-11-14' },
    { author: 'Hugo P.',      stars: 4, dateISO: '2024-11-07' },
  ],
  malin: [
    { author: 'Yasmine B.',   stars: 5, dateISO: '2025-04-10' },
    { author: 'Kévin M.',     stars: 4, dateISO: '2025-04-05' },
    { author: 'Lola F.',      stars: 5, dateISO: '2025-03-29' },
    { author: 'Théo G.',      stars: 4, dateISO: '2025-03-22' },
    { author: 'Sarah P.',     stars: 5, dateISO: '2025-03-15' },
    { author: 'Dylan C.',     stars: 3, dateISO: '2025-03-08' },
    { author: 'Manon T.',     stars: 5, dateISO: '2025-03-01' },
    { author: 'Hugo R.',      stars: 4, dateISO: '2025-02-22' },
    { author: 'Noémie V.',    stars: 5, dateISO: '2025-02-14' },
    { author: 'Enzo L.',      stars: 4, dateISO: '2025-02-07' },
    { author: 'Pauline A.',   stars: 5, dateISO: '2025-01-31' },
    { author: 'Maxime K.',    stars: 4, dateISO: '2025-01-24' },
    { author: 'Jade H.',      stars: 5, dateISO: '2025-01-17' },
    { author: 'Eva S.',       stars: 5, dateISO: '2025-01-03' },
    { author: 'Ambre N.',     stars: 5, dateISO: '2024-12-20' },
    { author: 'Tom G.',       stars: 4, dateISO: '2024-12-13' },
    { author: 'Chloé M.',     stars: 5, dateISO: '2024-12-06' },
    { author: 'Romain P.',    stars: 4, dateISO: '2024-11-29' },
    { author: 'Nathan B.',    stars: 3, dateISO: '2025-01-10' },
    { author: 'Lucas D.',     stars: 4, dateISO: '2024-12-27' },
  ],
  bebe: [
    { author: 'Audrey M.',    stars: 5, dateISO: '2025-04-09' },
    { author: 'Jérôme F.',    stars: 4, dateISO: '2025-04-03' },
    { author: 'Céline B.',    stars: 5, dateISO: '2025-03-27' },
    { author: 'Laurent C.',   stars: 4, dateISO: '2025-03-20' },
    { author: 'Nathalie V.',  stars: 5, dateISO: '2025-03-13' },
    { author: 'Pierre-A. G.', stars: 5, dateISO: '2025-03-06' },
    { author: 'Isabelle R.',  stars: 4, dateISO: '2025-02-27' },
    { author: 'Christophe L.',stars: 3, dateISO: '2025-02-19' },
    { author: 'Valérie T.',   stars: 5, dateISO: '2025-02-12' },
    { author: 'Stéphane D.',  stars: 4, dateISO: '2025-02-05' },
    { author: 'Caroline H.',  stars: 5, dateISO: '2025-01-29' },
    { author: 'David N.',     stars: 4, dateISO: '2025-01-22' },
    { author: 'Sylvie A.',    stars: 5, dateISO: '2025-01-15' },
    { author: 'Amandine K.',  stars: 5, dateISO: '2025-01-01' },
    { author: 'Guillaume S.', stars: 3, dateISO: '2024-12-25' },
    { author: 'Sandrine P.',  stars: 5, dateISO: '2024-12-18' },
    { author: 'Olivier M.',   stars: 4, dateISO: '2024-12-11' },
    { author: 'Marion G.',    stars: 5, dateISO: '2024-12-04' },
    { author: 'Patrick L.',   stars: 4, dateISO: '2024-11-27' },
    { author: 'Frédéric B.',  stars: 4, dateISO: '2025-01-08' },
  ],
};
function getProductReviews(productId, maxCount) {
  const cat  = ['plaisir','malin','bebe'].find(c => (productId || '').startsWith(c)) || 'plaisir';
  const pool = REVIEW_POOLS[cat] || REVIEW_POOLS.plaisir;
  const n    = Math.min(Math.max(maxCount, 1), 5);
  const hash = (productId || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const start = hash % pool.length;
  const result = [];
  for (let i = 0; i < n; i++) {
    const idx = (start + i) % pool.length;
    result.push({ ...pool[idx], key: 'reviews.' + cat + '_' + idx });
  }
  return result;
}

function openProductModal(card, scrollToReviews) {
  _trackBrowse(card);
  const name     = card.querySelector('.p-name')?.textContent?.trim() || 'Produit';
  const sub      = card.querySelector('.p-sub')?.textContent?.trim()  || '';
  const desc     = card.dataset.desc?.trim() || sub;
  const priceRaw = parseFloat(card.dataset.price) || 0;
  const rating   = parseFloat(card.dataset.rating) || 0;
  const reviews  = parseInt(card.dataset.reviews)  || 0;
  const imgEl    = card.querySelector('.p-img img');
  const emoji    = card.querySelector('.p-img > span:first-child')?.textContent || '📦';
  const badges   = Array.from(card.querySelectorAll('.p-badge')).map(b => b.textContent.trim());
  const id       = card.dataset.id;

  /* ── Images (galerie complète) ── */
  const galleryImgs = Array.from(card.querySelectorAll('.p-gallery-track img'));
  const totalImgs = galleryImgs.length;
  let imgHtml;
  if (totalImgs > 1) {
    const thumbsHtml = galleryImgs.map((img, i) =>
      `<button class="mg-thumb ${i===0?'active':''}" data-idx="${i}" data-src="${img.src}">
        <img src="${img.src}" alt="">
      </button>`
    ).join('');
    imgHtml = `
      <div class="mg-main">
        <img class="mg-main-img" src="${galleryImgs[0].src}" alt="${name}">
        <button class="mg-nav mg-prev" aria-label="${I18n.t('product.photo_prev')}">‹</button>
        <button class="mg-nav mg-next" aria-label="${I18n.t('product.photo_next')}">›</button>
      </div>
      <div class="mg-thumbs">${thumbsHtml}</div>`;
  } else if (totalImgs === 1) {
    imgHtml = `<div class="mg-main"><img class="mg-main-img" src="${galleryImgs[0].src}" alt="${name}"></div>`;
  } else if (imgEl) {
    imgHtml = `<div class="mg-main"><img class="mg-main-img" src="${imgEl.src}" alt="${name}"></div>`;
  } else {
    imgHtml = `<div style="font-size:4rem;text-align:center;padding:2rem">${emoji}</div>`;
  }

  /* ── Étoiles ── */
  const starsHtml = [1,2,3,4,5].map(i => {
    if (rating >= i)       return '<span class="star">★</span>';
    if (rating >= i - 0.5) return '<span class="star" style="opacity:.5">★</span>';
    return '<span class="star-empty">★</span>';
  }).join('');

  /* ── Badge thème ── */
  const badgeHtml = badges.length
    ? `<div style="display:flex;gap:.4rem;flex-wrap:wrap">${badges.map(b => `<span style="font-size:.7rem;background:var(--gray-100);padding:.2rem .6rem;border-radius:20px">${b}</span>`).join('')}</div>`
    : '';

  /* ── Avis : sélection déterministe par produit ── */
  const _revLocales = { fr: 'fr-FR', en: 'en-GB', es: 'es-ES', de: 'de-DE', it: 'it-IT' };
  const mkRev = r => {
    const dateStr = r.dateISO
      ? new Date(r.dateISO + 'T12:00:00').toLocaleDateString(_revLocales[I18n.locale] || 'fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
      : '';
    return `
    <div class="prod-modal-rev-item">
      <div class="rev-header">
        <span class="rev-stars">${'★'.repeat(r.stars)}${'☆'.repeat(5-r.stars)}</span>
        <span class="rev-author">${escHtml(r.author)}</span>
        ${dateStr ? `<span class="rev-date">${escHtml(dateStr)}</span>` : ''}
      </div>
      <p class="rev-text">${escHtml(I18n.t(r.key))}</p>
    </div>`;
  };
  const productRevs = reviews > 0 ? getProductReviews(id, Math.min(reviews, 5)) : [];
  const revsHtml = productRevs.length
    ? productRevs.map(mkRev).join('')
    : `<p class="rev-empty">${I18n.t('product.no_reviews')}</p>`;

  /* ── Overlay + modal ── */
  let overlay = document.getElementById('prodModalOverlay');
  if (overlay) overlay.remove();

  overlay = document.createElement('div');
  overlay.id = 'prodModalOverlay';
  overlay.className = 'prod-modal-overlay';
  overlay.innerHTML = `
    <div class="prod-modal" id="prodModal" role="dialog" aria-modal="true" aria-label="${name}">
      <div class="prod-modal-img">${imgHtml}</div>
      <div class="prod-modal-body">
        <button class="prod-modal-close" aria-label="${I18n.t('cart.close')}">✕</button>
        ${badgeHtml}
        <h2 class="prod-modal-name">${name}</h2>
        <div class="prod-modal-stars" onclick="_scrollToModalReviews(this)">
          ${starsHtml}
          <span class="rev-count">(${reviews} ${I18n.t('product.reviews')})</span>
        </div>
        ${desc ? `<p class="prod-modal-sub">${desc}</p>` : ''}
        <div class="prod-modal-price">${fmtPrice(priceRaw)}<span class="ttc-label"> ${I18n.t('product.ttc')}</span></div>
        <button class="prod-modal-atc" data-card-id="${id}" onclick="addToCartFromModal(this)">
          ${I18n.t('product.add_to_cart')}
        </button>
        <div class="prod-modal-reviews" id="modal-reviews">
          <h4>${I18n.t('product.reviews_title')}</h4>
          ${revsHtml}
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  /* ── Navigation galerie modal (flèches + miniatures) ── */
  const mainImg   = overlay.querySelector('.mg-main-img');
  const thumbBtns = overlay.querySelectorAll('.mg-thumb');
  const srcs      = galleryImgs.map(img => img.src);
  let curIdx = 0;

  function goTo(idx) {
    curIdx = (idx + srcs.length) % srcs.length;
    if (mainImg) mainImg.src = srcs[curIdx];
    thumbBtns.forEach((tb, j) => tb.classList.toggle('active', j === curIdx));
  }

  if (mainImg && srcs.length > 1) {
    overlay.querySelector('.mg-prev')?.addEventListener('click', e => { e.stopPropagation(); goTo(curIdx - 1); });
    overlay.querySelector('.mg-next')?.addEventListener('click', e => { e.stopPropagation(); goTo(curIdx + 1); });
    thumbBtns.forEach((t, i) => t.addEventListener('click', e => { e.stopPropagation(); goTo(i); }));
  }

  /* Animer l'ouverture */
  requestAnimationFrame(() => {
    overlay.classList.add('open');
    if (scrollToReviews) {
      setTimeout(() => {
        const body = overlay.querySelector('.prod-modal-body');
        const revs = overlay.querySelector('#modal-reviews');
        if (body && revs) body.scrollTop = revs.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 12;
      }, 300);
    }
  });

  /* Fermeture */
  const close = () => {
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 260);
    document.removeEventListener('keydown', onKey);
  };
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('.prod-modal-close').addEventListener('click', close);
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
}

window._scrollToModalReviews = function(el) {
  const body = el.closest('.prod-modal-body');
  const revs = body?.querySelector('#modal-reviews');
  if (body && revs) body.scrollTop = revs.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 12;
};

window.addToCartFromModal = function(btn) {
  const id = btn.dataset.cardId;
  const card = document.querySelector(`.p-card[data-id="${id}"]`);
  if (card) {
    const firstImg = card.querySelector('.p-gallery-track img') || card.querySelector('.p-img img');
    Cart.add({
      id,
      name:    card.querySelector('.p-name')?.textContent?.trim() || 'Produit',
      emoji:   card.querySelector('.p-img > span:first-child')?.textContent || '📦',
      price:   parseFloat(card.dataset.price) || 0,
      img:     firstImg ? firstImg.getAttribute('src') : null,
      weightG: parseInt(card.dataset.weight, 10) || 200,
    });
  }
  btn.textContent = I18n.t('product.added');
  btn.style.background = '#22C55E';
  setTimeout(() => {
    btn.textContent = I18n.t('product.add_to_cart');
    btn.style.background = '';
  }, 1400);
};

/* ── Tags descriptifs sur les cartes ── */
function initProductTags() {
  document.querySelectorAll('.p-card:not(.p-card-request)').forEach(card => {
    const sub = card.querySelector('.p-sub')?.textContent?.trim();
    if (!sub) return;
    const pInfo = card.querySelector('.p-info');
    const pFoot = card.querySelector('.p-foot');
    if (!pInfo || !pFoot) return;
    // Supprimer tags existants
    pInfo.querySelector('.p-tags')?.remove();
    // Diviser par · et garder les 3 premiers mots-clés max
    const terms = sub.split(/[·\|]/).map(t => t.trim()).filter(Boolean).slice(0, 3);
    if (!terms.length) return;
    const wrap = document.createElement('div');
    wrap.className = 'p-tags';
    wrap.innerHTML = terms.map(t => `<span class="p-tag">${t}</span>`).join('');
    pInfo.insertBefore(wrap, pFoot);
  });
}

function initProductModals() {
  document.querySelectorAll('.p-card:not(.p-card-request)').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('.atc-btn') || e.target.closest('.p-wish') ||
          e.target.closest('.p-gal-btn') || e.target.closest('.p-gal-dot')) return;
      openProductModal(card);
    });
  });
}

/* ─────────────────────────────────────────
   GALLERY — carousel multi-photos dans p-card
   ───────────────────────────────────────── */
function initProductGalleries() {
  document.querySelectorAll('.p-gallery').forEach(gallery => {
    const track = gallery.querySelector('.p-gallery-track');
    if (!track) return;
    const imgs = track.getElementsByTagName('img'); // live — se met à jour si un img est retiré du DOM
    if (imgs.length <= 1) return;

    const dots = gallery.querySelectorAll('.p-gal-dot');
    let current = 0;

    const goTo = idx => {
      const len = imgs.length;
      if (!len) return;
      current = (idx + len) % len;
      track.style.transform = `translateX(-${current * 100}%)`;
      gallery.querySelectorAll('.p-gal-dot').forEach((d, i) => d.classList.toggle('active', i === current));
    };

    gallery.querySelector('.p-gal-prev')?.addEventListener('click', e => {
      e.stopPropagation(); goTo(current - 1);
    });
    gallery.querySelector('.p-gal-next')?.addEventListener('click', e => {
      e.stopPropagation(); goTo(current + 1);
    });
    dots.forEach((d, i) => d.addEventListener('click', e => {
      e.stopPropagation(); goTo(i);
    }));

    /* Swipe tactile */
    let sx = 0;
    gallery.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
    gallery.addEventListener('touchend', e => {
      const dx = sx - e.changedTouches[0].clientX;
      if (Math.abs(dx) > 30) dx > 0 ? goTo(current + 1) : goTo(current - 1);
    }, { passive: true });
  });
}

/* ─────────────────────────────────────────
   STAR RATINGS
   ───────────────────────────────────────── */
function renderStars(rating, reviews, pSub) {
  const pInfo = pSub ? pSub.parentElement : null;
  if (!pInfo) return;
  pInfo.querySelector('.p-stars')?.remove();

  const starsHtml = [1,2,3,4,5].map(i => {
    if (rating >= i)       return '<span class="star full">★</span>';
    if (rating >= i - 0.5) return '<span class="star half">★</span>';
    return                        '<span class="star">★</span>';
  }).join('');

  const bar = document.createElement('div');
  bar.className = 'p-stars';
  bar.innerHTML = `<div class="p-stars-bar">${starsHtml}</div><span class="p-stars-count">(${reviews} avis)</span>`;
  bar.addEventListener('click', e => {
    e.stopPropagation();
    const card = bar.closest('.p-card');
    if (card) openProductModal(card, true);
  });
  // Insérer avant .p-foot pour garantir la position même si .p-sub absent
  const pFoot = pInfo.querySelector('.p-foot');
  if (pFoot) pInfo.insertBefore(bar, pFoot);
  else pInfo.appendChild(bar);
}

async function initStarRatings() {
  const cards = Array.from(document.querySelectorAll('.p-card[data-rating]'));
  if (!cards.length) return;

  // Rendu immédiat depuis les attributs data- (pas de flash vide)
  cards.forEach(card => {
    const pSub = card.querySelector('.p-sub') || card.querySelector('.p-name');
    renderStars(parseFloat(card.dataset.rating) || 0, parseInt(card.dataset.reviews) || 0, pSub);
  });

  // Mise à jour depuis l'API (si le serveur tourne)
  try {
    const res  = await fetch('/api/ratings');
    if (!res.ok) return;
    const { ratings } = await res.json();

    cards.forEach(card => {
      const id   = card.dataset.id;
      if (!ratings[id]) return;
      const pSub = card.querySelector('.p-sub') || card.querySelector('.p-name');
      renderStars(ratings[id].rating, ratings[id].reviews, pSub);
    });
  } catch {
    // Serveur non disponible — les notes statiques restent affichées
  }
}

/* ─────────────────────────────────────────
   ADMIN — MODE ÉDITION (pages catégories)
   ───────────────────────────────────────── */
const _AEB_INPUT  = 'width:100%;padding:.58rem .9rem;border:1.5px solid #e0e0e0;border-radius:9px;font-size:.875rem;font-family:inherit;box-sizing:border-box;outline:none;transition:border-color .15s';
const _AEB_CANCEL = 'padding:.48rem 1rem;background:none;border:1.5px solid #e0e0e0;border-radius:20px;font-size:.82rem;font-weight:600;cursor:pointer;font-family:inherit;color:#555;transition:background .15s';
const _AEB_SAVE   = 'padding:.48rem 1.2rem;background:#3e2a14;color:#d9c4a0;border:none;border-radius:20px;font-size:.82rem;font-weight:700;cursor:pointer;font-family:inherit;transition:background .15s';
const _AEB_MOVE   = 'padding:.26rem .6rem;border:1.5px solid #e0e0e0;border-radius:7px;background:#fff;cursor:pointer;font-size:.85rem;font-family:inherit;color:#444;transition:background .15s';

let _editModeActive = false;

function initAdminEditMode() {
  if (isClientView()) return;
  try {
    const u = JSON.parse(localStorage.getItem('leclam_user') || '{}');
    if (u.role !== 'admin' && u.role !== 'owner') return;
  } catch { return; }
  if (!document.querySelector('.p-card')) return;

  /* Injecter les styles */
  const s = document.createElement('style');
  s.textContent = `
    .aeb-bar{position:absolute;top:0;left:0;right:0;display:flex;gap:.3rem;align-items:center;
      flex-wrap:wrap;padding:.4rem .55rem;background:rgba(14,9,3,.78);
      backdrop-filter:blur(6px);z-index:10;border-radius:12px 12px 0 0}
    .aeb-btn{padding:.26rem .65rem;background:rgba(255,255,255,.12);color:#fff;
      border:1px solid rgba(255,255,255,.25);border-radius:20px;
      font-size:.68rem;font-weight:700;cursor:pointer;font-family:inherit;
      transition:background .15s;white-space:nowrap}
    .aeb-btn:hover{background:rgba(255,255,255,.28)}
    .aeb-btn.aeb-on{background:#f59e0b;border-color:#f59e0b;color:#1a1a1a}
    .sel-card{border:1.5px solid #e8e8e0;border-radius:12px;overflow:hidden;cursor:pointer;
      background:#fff;transition:transform .15s,box-shadow .15s}
    .sel-card:hover{transform:translateY(-3px);box-shadow:0 6px 24px rgba(0,0,0,.1)}
    #adminModifBtn:hover{filter:brightness(1.15)}
    .p-card.epuise{position:relative}
    .p-card.epuise::after{content:'ÉPUISÉ';position:absolute;top:22px;left:-28px;
      width:130px;padding:5px 0;background:#7f1d1d;color:#fff;
      font-size:.68rem;font-weight:900;text-align:center;letter-spacing:.12em;
      transform:rotate(-35deg);transform-origin:center;z-index:20;
      pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.35)}
    .p-card.epuise .atc-btn{opacity:.4;pointer-events:none}
    .aeb-btn.aeb-epuise{background:rgba(127,29,29,.5);border-color:rgba(220,38,38,.6)}
    .aeb-btn.aeb-epuise.aeb-on{background:#7f1d1d;border-color:#7f1d1d;color:#fff}
  `;
  document.head.appendChild(s);

  const cat = ['plaisir','malin','bebe']
    .find(c => document.body.classList.contains('page-'+c)) || 'cat';

  /* Appliquer overrides sauvegardés */
  _applyProdOverrides();

  /* Masquer les produits supprimés */
  _applyDeleted(cat);

  /* Marquer les produits épuisés */
  _applyEpuises();

  /* Rendre la section sélection */
  _renderSelSection(cat);

  /* Bouton Modif flottant */
  const btn = document.createElement('button');
  btn.id = 'adminModifBtn';
  btn.textContent = 'Modif';
  btn.style.cssText = `position:fixed;top:82px;right:1rem;z-index:9998;
    background:#3e2a14;color:#d9c4a0;border:none;border-radius:50px;
    padding:.48rem 1.2rem;font-size:.8rem;font-weight:700;cursor:pointer;
    font-family:inherit;box-shadow:0 4px 20px rgba(0,0,0,.28);transition:all .2s`;
  btn.addEventListener('click', () => _toggleEditMode(cat, btn));
  document.body.appendChild(btn);

  /* Bouton Corbeille — toujours visible en mode admin */
  function _refreshCorbeilleBtn() {
    let btn = document.getElementById('adminCorbeilleBtn');
    const artCount   = _getDeleted(cat).length;
    const photoCount = _getPhotoTrash().filter(t => t.prodId.startsWith(cat+'-')).length;
    const total      = artCount + photoCount;
    const label      = `Corbeille${total ? ' ('+total+')' : ''}`;
    if (btn) { btn.textContent = label; return; }
    btn = document.createElement('button');
    btn.id = 'adminCorbeilleBtn';
    btn.textContent = label;
    btn.style.cssText = `position:fixed;top:122px;right:1rem;z-index:9998;
      background:#7f1d1d;color:#fff;border:none;border-radius:50px;
      padding:.48rem 1.2rem;font-size:.8rem;font-weight:700;cursor:pointer;
      font-family:inherit;box-shadow:0 4px 20px rgba(0,0,0,.28);transition:all .2s`;
    btn.addEventListener('click', () => _openCorbeillePanel(cat));
    document.body.appendChild(btn);
  }
  _refreshCorbeilleBtn();
  window._refreshCorbeilleBtn = _refreshCorbeilleBtn;

  /* Bouton Couleurs — accès rapide au color picker de la page */
  if (!document.getElementById('adminCouleursBtn')) {
    const btnCol = document.createElement('button');
    btnCol.id = 'adminCouleursBtn';
    btnCol.textContent = 'Couleurs';
    btnCol.style.cssText = `position:fixed;top:162px;right:1rem;z-index:9998;
      background:#1e3a5f;color:#fff;border:none;border-radius:50px;
      padding:.48rem 1.2rem;font-size:.8rem;font-weight:700;cursor:pointer;
      font-family:inherit;box-shadow:0 4px 20px rgba(0,0,0,.28);transition:all .2s`;
    btnCol.addEventListener('click', () => _openCouleursPanel(cat));
    document.body.appendChild(btnCol);
  }
}

function _openCouleursPanel(cat) {
  if (document.getElementById('couleursPanel')) {
    document.getElementById('couleursPanel').remove();
    return;
  }
  const panel = document.createElement('div');
  panel.id = 'couleursPanel';
  panel.style.cssText = `position:fixed;top:162px;right:4.5rem;z-index:9999;
    background:#fff;border-radius:16px;padding:1rem 1.2rem;
    box-shadow:0 12px 40px rgba(0,0,0,.22);width:280px;font-family:inherit;
    border:1px solid #f0f0f0`;

  const colors = JSON.parse(localStorage.getItem(_THEME_COLOR_KEY) || '{}');
  const cats = [
    { id: 'plaisir', label: 'Plaisir', def: '#b00804' },
    { id: 'malin',   label: 'Malin',   def: '#1a1a2e' },
    { id: 'bebe',    label: 'Bébé',    def: '#d36e87' },
  ];

  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.9rem">
      <span style="font-size:.82rem;font-weight:700;color:#3e2a14">Banderoles &amp; recherche</span>
      <button onclick="document.getElementById('couleursPanel').remove()"
        style="background:none;border:none;cursor:pointer;font-size:1.1rem;color:#ccc;line-height:1;padding:0">✕</button>
    </div>
    ${cats.map(({ id, label, def }) => {
      const val = colors[id] || def;
      const isCustom = !!colors[id];
      return `
      <div style="display:flex;align-items:center;gap:.7rem;padding:.55rem 0;border-bottom:1px solid #f5f5f5">
        <span style="font-size:.85rem;font-weight:700;color:#3e2a14;flex:1">${label}</span>
        <input type="color" value="${val}" data-cat="${id}" oninput="_onThemeColorInput(this)"
          style="width:40px;height:32px;border:2px solid #eee;border-radius:8px;cursor:pointer;padding:2px;background:#fff">
        <span class="tc-hex-${id}" style="font-family:monospace;font-size:.74rem;color:#999;width:56px">${val}</span>
        <button onclick="_resetThemeColor('${id}')" title="Remettre la couleur par défaut"
          style="background:none;border:1px solid #e0e0e0;border-radius:8px;padding:.22rem .5rem;font-size:.72rem;color:${isCustom?'#b00804':'#ccc'};cursor:pointer">↺</button>
      </div>`;
    }).join('')}
    <p style="font-size:.68rem;color:#ccc;margin:.8rem 0 0">Appliqué immédiatement à toutes les pages.</p>`;

  document.body.appendChild(panel);
  document.addEventListener('click', function outside(e) {
    if (!panel.contains(e.target) && e.target.id !== 'adminCouleursBtn') {
      panel.remove();
      document.removeEventListener('click', outside);
    }
  }, { capture: true });
}

function _toggleEditMode(cat, btn) {
  _editModeActive = !_editModeActive;
  btn.textContent  = _editModeActive ? '✓ Terminer' : 'Modif';
  btn.style.background = _editModeActive ? '#16a34a' : '#3e2a14';
  btn.style.color      = _editModeActive ? '#fff'    : '#d9c4a0';

  if (_editModeActive) {
    document.querySelectorAll('.p-card').forEach(card => _addEditBar(card, cat));
  } else {
    document.querySelectorAll('.aeb-bar').forEach(el => el.remove());
    _closeAdminPanel();
  }
}

function _addEditBar(card, cat) {
  if (card.querySelector('.aeb-bar')) return;
  const id    = card.dataset.id;
  const inSel = _getSel(cat).includes(id);

  const edits     = JSON.parse(localStorage.getItem('leclam_prod_edits') || '{}');
  const rawFam    = edits[id]?.famille;
  const curFamArr = Array.isArray(rawFam) ? rawFam : (rawFam ? [rawFam] : []);
  const famLabel  = curFamArr.length === 0 ? ''
    : curFamArr.length === 1
      ? (document.querySelector(`.f-btn[data-filter="${curFamArr[0]}"]`)?.textContent.trim() || curFamArr[0])
      : curFamArr.length + ' familles';

  const curSupName = (JSON.parse(localStorage.getItem('leclam_suppliers') || '{}')?.[id] || '');

  const bar = document.createElement('div');
  bar.className = 'aeb-bar';
  bar.innerHTML = `
    <button class="aeb-btn${inSel?' aeb-on':''}" onclick="event.stopPropagation();_toggleSel('${id}','${cat}',this)">
      ${inSel ? 'Sélection ✓' : 'Sélection'}
    </button>
    <button class="aeb-btn" onclick="event.stopPropagation();_openTextPanel('${id}')">Texte</button>
    <button class="aeb-btn" onclick="event.stopPropagation();_openPhotoPanel('${id}')">Photos</button>
    <button class="aeb-btn aeb-fam${curFamArr.length?' aeb-on':''}" id="aeb-fam-${id}">
      ${famLabel || 'Famille'}
    </button>
    <button class="aeb-btn${curSupName?' aeb-on':''}" id="aeb-fourn-${id}" onclick="event.stopPropagation();_openFournisseurPanel('${id}')">
      ${curSupName || 'Fournisseur'}
    </button>
    <button class="aeb-btn aeb-epuise${_isEpuise(id)?' aeb-on':''}" onclick="event.stopPropagation();_toggleEpuise('${id}',this)">${_isEpuise(id)?'Épuisé ✓':'Épuisé'}</button>
    <button class="aeb-btn" style="background:rgba(220,38,38,.35);border-color:rgba(220,38,38,.6);margin-left:auto" onclick="event.stopPropagation();_confirmDelete('${id}','${cat}')">Supprimer</button>`;

  const famBtn = bar.querySelector('.aeb-fam');
  famBtn.addEventListener('click', e => { e.stopPropagation(); _openFamillePanel(id); });

  card.style.position = 'relative';
  card.prepend(bar);
}

/* ── Sélection ── */
function _getSel(cat) {
  try { return JSON.parse(localStorage.getItem('leclam_sel_'+cat)||'[]'); } catch { return []; }
}
function _saveSel(cat, ids) { localStorage.setItem('leclam_sel_'+cat, JSON.stringify(ids)); }

window._toggleSel = function(id, cat, btn) {
  let ids = _getSel(cat);
  if (ids.includes(id)) {
    ids = ids.filter(i => i !== id);
    btn.textContent = 'Sélection';
    btn.classList.remove('aeb-on');
  } else {
    ids.push(id);
    btn.textContent = 'Sélection ✓';
    btn.classList.add('aeb-on');
  }
  _saveSel(cat, ids);
  _renderSelSection(cat);
};

function _renderSelSection(cat) {
  const ids    = _getSel(cat);
  let section  = document.getElementById('selectionSection');
  if (!ids.length) { section?.remove(); return; }

  if (!section) {
    section = document.createElement('div');
    section.id = 'selectionSection';
    const container = document.querySelector('.products-wrap .container');
    const grid      = document.querySelector('.products-grid');
    if (container && grid) container.insertBefore(section, grid);
    else return;
  }

  const cards = ids.map(id => {
    const card = document.querySelector(`.p-card[data-id="${id}"]`);
    if (!card) return '';
    const name  = card.querySelector('.p-name')?.textContent || '';
    const sub   = card.querySelector('.p-sub')?.textContent  || '';
    const price = parseFloat(card.dataset.price||0).toFixed(2).replace('.',',');
    const img   = card.querySelector('.p-gallery-track img')?.src || '';
    const safeId = id.replace(/"/g,'');
    return `
      <div class="sel-card"
        onclick="document.querySelector('.p-card[data-id=&quot;${safeId}&quot;]')?.scrollIntoView({behavior:'smooth',block:'center'})">
        ${img ? `<img src="${img}" alt="" style="width:100%;aspect-ratio:1;object-fit:cover;display:block">` : ''}
        <div style="padding:.55rem .7rem .7rem">
          <div style="font-weight:700;font-size:.81rem;color:#1a1a1a;line-height:1.3;margin-bottom:.15rem">${name}</div>
          <div style="font-size:.72rem;color:#bbb;margin-bottom:.25rem;line-height:1.3">${sub}</div>
          <div style="font-weight:700;font-size:.87rem;color:#1a1a1a">${price} €</div>
        </div>
      </div>`;
  }).join('');

  section.innerHTML = `
    <div style="margin-bottom:1rem;padding-top:.25rem">
      <h2 style="font-family:'Playfair Display',serif;font-size:1.3rem;color:#1a1a1a;margin-bottom:.2rem">
        Sélection du moment
      </h2>
      <p style="font-size:.83rem;color:#999;margin:0">Nos coups de cœur</p>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(138px,1fr));gap:.8rem;margin-bottom:1.8rem">
      ${cards}
    </div>
    <div style="border-top:1.5px solid #e8e8e0;margin-bottom:1.6rem"></div>`;
}

/* ── Panel édition texte ── */
window._openTextPanel = function(id) {
  _closeAdminPanel();
  const card    = document.querySelector(`.p-card[data-id="${id}"]`);
  if (!card) return;
  const name  = (card.querySelector('.p-name')?.textContent  || '').replace(/"/g,'&quot;');
  const sub   = (card.querySelector('.p-sub')?.textContent   || '').replace(/"/g,'&quot;');
  const price = card.dataset.price || '';

  _showAdminPanel(`
    <div style="font-weight:700;font-size:.95rem;margin-bottom:1rem;color:#1a1a1a">Modifier le produit</div>
    <div style="display:flex;flex-direction:column;gap:.65rem">
      <div>
        <label style="font-size:.74rem;font-weight:600;color:#666;display:block;margin-bottom:.2rem">Nom</label>
        <input id="ep-name" value="${name}" style="${_AEB_INPUT}">
      </div>
      <div>
        <label style="font-size:.74rem;font-weight:600;color:#666;display:block;margin-bottom:.2rem">Description courte</label>
        <input id="ep-sub" value="${sub}" style="${_AEB_INPUT}">
      </div>
      <div>
        <label style="font-size:.74rem;font-weight:600;color:#666;display:block;margin-bottom:.2rem">Prix (€)</label>
        <input id="ep-price" type="number" value="${price}" step="0.01" min="0" style="${_AEB_INPUT}">
      </div>
    </div>
    <div style="display:flex;gap:.55rem;margin-top:1.1rem;justify-content:flex-end">
      <button onclick="_closeAdminPanel()" style="${_AEB_CANCEL}">Annuler</button>
      <button onclick="_saveTextEdit('${id}')" style="${_AEB_SAVE}">Enregistrer</button>
    </div>`);
  document.getElementById('ep-name')?.focus();
};

window._saveTextEdit = function(id) {
  const name  = document.getElementById('ep-name')?.value.trim();
  const sub   = document.getElementById('ep-sub')?.value.trim()  || '';
  const price = parseFloat(document.getElementById('ep-price')?.value) || 0;
  if (!name) return;

  const edits = JSON.parse(localStorage.getItem('leclam_prod_edits') || '{}');
  edits[id] = { ...(edits[id]||{}), name, sub, price };
  localStorage.setItem('leclam_prod_edits', JSON.stringify(edits));

  const card = document.querySelector(`.p-card[data-id="${id}"]`);
  if (card) {
    const en = card.querySelector('.p-name'); if (en) en.textContent = name;
    const es = card.querySelector('.p-sub');  if (es) es.textContent = sub;
    const ep = card.querySelector('.p-price');if (ep) ep.textContent = price.toFixed(2).replace('.',',') + ' €';
    card.dataset.price = price;
  }
  _closeAdminPanel();

  const cat = ['plaisir','malin','bebe'].find(c => document.body.classList.contains('page-'+c)) || 'cat';
  _renderSelSection(cat);
};

/* ── Panel famille ── */
window._openFamillePanel = function(id) {
  _closeAdminPanel();
  const card   = document.querySelector(`.p-card[data-id="${id}"]`);
  if (!card) return;

  const famBtns = Array.from(document.querySelectorAll('.f-btn:not(.f-btn-tout)'));
  if (!famBtns.length) { alert('Aucune famille définie sur cette page.'); return; }

  const edits     = JSON.parse(localStorage.getItem('leclam_prod_edits') || '{}');
  const rawFam    = edits[id]?.famille;
  const curFamArr = Array.isArray(rawFam) ? rawFam : (rawFam ? [rawFam] : []);

  const rawSubfam    = edits[id]?.subfamille;
  const curSubfamArr = Array.isArray(rawSubfam) ? rawSubfam : (rawSubfam ? [rawSubfam] : []);

  const checkboxes = famBtns.map(btn => {
    const val     = btn.dataset.filter;
    const lbl     = btn.textContent.trim();
    const checked = curFamArr.includes(val) ? ' checked' : '';
    const hasSub  = !!SUB_FILTERS[val];
    return `
      <label style="display:flex;align-items:center;gap:.65rem;padding:.55rem .7rem;
        border:1.5px solid #e8e8e0;border-radius:10px;cursor:pointer;transition:border-color .15s"
        onmouseover="this.style.borderColor='#3e2a14'" onmouseout="this.style.borderColor='#e8e8e0'">
        <input type="checkbox" name="fam-cb" value="${val}"${checked}
          style="width:16px;height:16px;accent-color:#3e2a14;cursor:pointer;flex-shrink:0"
          ${hasSub ? 'onchange="_refreshSubfamPanel()"' : ''}>
        <span style="font-size:.875rem;font-family:inherit">${lbl}${hasSub ? ' <span style="font-size:.68rem;color:#a0856a">▾ sous-familles</span>' : ''}</span>
      </label>`;
  }).join('');

  _showAdminPanel(`
    <div style="font-weight:700;font-size:.95rem;margin-bottom:.5rem;color:#1a1a1a">Familles du produit</div>
    <p style="font-size:.78rem;color:#999;margin:0 0 .9rem">
      Plusieurs familles possibles. "Tout" affiche toujours tout.
    </p>
    <div style="display:flex;flex-direction:column;gap:.4rem">
      ${checkboxes}
    </div>
    <div id="subfam-section" style="margin-top:.75rem"></div>
    <div style="display:flex;gap:.55rem;margin-top:1.1rem;justify-content:flex-end">
      <button id="fam-cancel-btn" style="${_AEB_CANCEL}">Annuler</button>
      <button id="fam-save-btn" style="${_AEB_SAVE}">Enregistrer</button>
    </div>`);

  window._refreshSubfamPanel = function() {
    const checked = Array.from(document.querySelectorAll('input[name="fam-cb"]:checked')).map(cb => cb.value);
    const hasSubs = checked.filter(f => SUB_FILTERS[f]);
    const el = document.getElementById('subfam-section');
    if (!el) return;
    if (!hasSubs.length) { el.innerHTML = ''; return; }
    const curSel = Array.from(document.querySelectorAll('input[name="subfam-cb"]:checked')).map(cb => cb.value);
    const initSel = curSel.length ? curSel : curSubfamArr;
    el.innerHTML = `
      <div style="font-size:.72rem;font-weight:700;color:#a0856a;text-transform:uppercase;letter-spacing:.07em;margin-bottom:.5rem">Sous-famille</div>
      ${hasSubs.map(fam => `
        <div style="margin-bottom:.6rem">
          <div style="font-size:.72rem;color:#aaa;margin-bottom:.3rem">${document.querySelector('.f-btn[data-filter="${fam}"]')?.textContent.trim()||fam}</div>
          <div style="display:flex;flex-wrap:wrap;gap:.35rem">
          ${(SUB_FILTERS[fam]||[]).map(sf => `
            <label style="display:flex;align-items:center;gap:.45rem;padding:.38rem .65rem;border:1.5px solid ${initSel.includes(sf.v)?'#3e2a14':'#e8e8e0'};border-radius:8px;cursor:pointer;background:${initSel.includes(sf.v)?'#faf9f7':'#fff'}">
              <input type="checkbox" name="subfam-cb" value="${sf.v}"${initSel.includes(sf.v)?' checked':''}
                style="width:14px;height:14px;accent-color:#3e2a14;cursor:pointer">
              <span style="font-size:.82rem">${sf.l}</span>
            </label>`).join('')}
          </div>
        </div>`).join('')}`;
  };
  _refreshSubfamPanel();

  document.getElementById('fam-cancel-btn')?.addEventListener('click', _closeAdminPanel);
  document.getElementById('fam-save-btn')?.addEventListener('click', () => _saveFamille(id));
};

window._saveFamille = function(id) {
  const famille   = Array.from(document.querySelectorAll('input[name="fam-cb"]:checked')).map(cb => cb.value);
  const subfamille = Array.from(document.querySelectorAll('input[name="subfam-cb"]:checked')).map(cb => cb.value);

  const edits = JSON.parse(localStorage.getItem('leclam_prod_edits') || '{}');
  edits[id]   = { ...(edits[id]||{}), famille, subfamille };
  localStorage.setItem('leclam_prod_edits', JSON.stringify(edits));

  const card = document.querySelector(`.p-card[data-id="${id}"]`);
  if (card) {
    if (famille.length)   card.dataset.famille    = famille.join(',');
    else                  delete card.dataset.famille;
    if (subfamille.length) card.dataset.subfamille = subfamille.join(',');
    else                   delete card.dataset.subfamille;
  }

  /* Mettre à jour le bouton dans la barre d'édition */
  const famBtn = document.getElementById(`aeb-fam-${id}`);
  if (famBtn) {
    const lbl = famille.length === 0 ? 'Famille'
      : famille.length === 1
        ? (document.querySelector(`.f-btn[data-filter="${famille[0]}"]`)?.textContent.trim() || famille[0])
        : famille.length + ' familles';
    famBtn.textContent = lbl;
    famBtn.classList.toggle('aeb-on', famille.length > 0);
  }

  _closeAdminPanel();
  applyFiltersAndSearch();
};

/* ── Panel fournisseur ── */
window._openFournisseurPanel = function(id) {
  _closeAdminPanel();
  const supMap  = JSON.parse(localStorage.getItem('leclam_suppliers')     || '{}');
  const list    = JSON.parse(localStorage.getItem('leclam_supplier_list') || '[]');
  const current = supMap[id] || '';
  const LBL_S   = 'font-size:.72rem;font-weight:700;color:#666;display:block;margin-bottom:.2rem';

  if (!list.length) {
    _showAdminPanel(`
      <div style="font-weight:700;font-size:.95rem;margin-bottom:.7rem;color:#1a1a1a">Fournisseur</div>
      <p style="font-size:.83rem;color:#888;margin-bottom:1rem">Aucun fournisseur défini.<br>Ajoutez-en depuis la page <a href="fournisseur.html" style="color:#3e2a14;font-weight:600">Fournisseurs</a>.</p>
      <div style="text-align:right"><button onclick="_closeAdminPanel()" style="${_AEB_CANCEL}">Fermer</button></div>`);
    return;
  }

  const radios = [{ id: '', name: '— Non assigné' }, ...list.map(s => ({ id: s.name, name: s.name }))];
  _showAdminPanel(`
    <div style="font-weight:700;font-size:.95rem;margin-bottom:.5rem;color:#1a1a1a">Fournisseur</div>
    <p style="font-size:.78rem;color:#999;margin:0 0 .85rem">Choisissez le fournisseur de ce produit.</p>
    <div style="display:flex;flex-direction:column;gap:.4rem">
      ${radios.map(s => `
        <label style="display:flex;align-items:center;gap:.65rem;padding:.55rem .7rem;
          border:1.5px solid ${current===s.id?'#3e2a14':'#e8e8e0'};border-radius:10px;cursor:pointer;
          background:${current===s.id?'#faf9f7':'#fff'};transition:border-color .15s"
          onmouseover="this.style.borderColor='#3e2a14'" onmouseout="this.style.borderColor='${current===s.id?'#3e2a14':'#e8e8e0'}'">
          <input type="radio" name="fourn-rb" value="${s.id}"${current===s.id?' checked':''}
            style="width:16px;height:16px;accent-color:#3e2a14;cursor:pointer;flex-shrink:0">
          <span style="font-size:.875rem;font-family:inherit">${s.name}</span>
        </label>`).join('')}
    </div>
    <div style="display:flex;gap:.55rem;margin-top:1.1rem;justify-content:flex-end">
      <button onclick="_closeAdminPanel()" style="${_AEB_CANCEL}">Annuler</button>
      <button onclick="_saveFournisseurEdit('${id}')" style="${_AEB_SAVE}">Enregistrer</button>
    </div>`);
};

window._saveFournisseurEdit = function(id) {
  const selected = document.querySelector('input[name="fourn-rb"]:checked')?.value || '';
  const supMap   = JSON.parse(localStorage.getItem('leclam_suppliers') || '{}');
  supMap[id]     = selected;
  localStorage.setItem('leclam_suppliers', JSON.stringify(supMap));

  const btn = document.getElementById(`aeb-fourn-${id}`);
  if (btn) {
    btn.textContent = selected || 'Fournisseur';
    btn.classList.toggle('aeb-on', !!selected);
  }
  _closeAdminPanel();
};

/* ── Sync photos → serveur (products-overrides.json) ── */
async function _patchProductImages(id, images) {
  const tok  = localStorage.getItem('leclam_token') || '';
  const csrf = localStorage.getItem('leclam_csrf')  || '';
  try {
    await fetch('/api/admin/products/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok, 'X-CSRF-Token': csrf },
      body: JSON.stringify({ images }),
      credentials: 'same-origin',
    });
  } catch(e) { console.warn('[photo sync]', e); }
}

/* ── Panel photos ── */
window._openPhotoPanel = function(id) {
  _closeAdminPanel();
  const card  = document.querySelector(`.p-card[data-id="${id}"]`);
  const track = card?.querySelector('.p-gallery-track');
  if (!track) return;

  const buildList = () => {
    const imgs = Array.from(card.querySelectorAll('.p-gallery-track img'));
    const isOnly = imgs.length <= 1;
    return imgs.map((img, i) => `
      <div style="display:flex;align-items:center;gap:.5rem;padding:.4rem;border:1.5px solid #e8e8e0;border-radius:9px">
        <img src="${img.src}" style="width:52px;height:52px;object-fit:cover;border-radius:7px;flex-shrink:0">
        <span style="flex:1;font-size:.78rem;color:#666">Photo ${i+1}</span>
        ${i > 0 && !isOnly
          ? `<button onclick="_movePhoto('${id}',${i},-1)" style="${_AEB_MOVE}">↑</button>`
          : `<span style="width:28px;display:inline-block"></span>`}
        ${i < imgs.length-1 && !isOnly
          ? `<button onclick="_movePhoto('${id}',${i},1)" style="${_AEB_MOVE}">↓</button>`
          : `<span style="width:28px;display:inline-block"></span>`}
        <button onclick="_trashPhoto('${id}','${img.getAttribute('src')}')"
          title="${isOnly ? 'Seule photo — déplacée en corbeille' : 'Mettre en corbeille'}"
          style="padding:.22rem .55rem;background:rgba(220,38,38,.15);color:#dc2626;border:1px solid rgba(220,38,38,.4);border-radius:20px;font-size:.75rem;cursor:pointer;font-family:inherit">🗑️</button>
      </div>`).join('');
  };
  window._buildPhotoList = buildList;

  _showAdminPanel(`
    <div style="font-weight:700;font-size:.95rem;margin-bottom:.85rem;color:#1a1a1a">Gérer les photos</div>
    <div id="adminPhotoList" style="display:flex;flex-direction:column;gap:.4rem">${buildList()}</div>
    <div style="margin-top:1.1rem;text-align:right">
      <button onclick="_closeAdminPanel()" style="${_AEB_SAVE}">Fermer</button>
    </div>`);
};

window._movePhoto = function(id, idx, dir) {
  const card  = document.querySelector(`.p-card[data-id="${id}"]`);
  const track = card?.querySelector('.p-gallery-track');
  if (!track) return;
  const imgs   = Array.from(track.querySelectorAll('img'));
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= imgs.length) return;

  if (dir === -1) track.insertBefore(imgs[idx], imgs[idx-1]);
  else           track.insertBefore(imgs[idx+1], imgs[idx]);

  /* Sauvegarder l'ordre */
  const newImgs  = Array.from(track.querySelectorAll('img'));
  const newOrder = newImgs.map(i => i.getAttribute('src'));
  const edits    = JSON.parse(localStorage.getItem('leclam_prod_edits') || '{}');
  edits[id] = { ...(edits[id]||{}), photoOrder: newOrder };
  localStorage.setItem('leclam_prod_edits', JSON.stringify(edits));
  _patchProductImages(id, newOrder);

  /* Réinitialiser la galerie (clone pour supprimer les vieux listeners) */
  const gallery = card.querySelector('.p-gallery');
  if (gallery) {
    const clone = gallery.cloneNode(true);
    gallery.replaceWith(clone);
    const t  = clone.querySelector('.p-gallery-track');
    const is = Array.from(clone.querySelectorAll('img'));
    const ds = clone.querySelectorAll('.p-gal-dot');
    if (is.length > 1) {
      let cur = 0;
      const go = i => {
        cur = (i + is.length) % is.length;
        t.style.transform = `translateX(-${cur*100}%)`;
        ds.forEach((d,j) => d.classList.toggle('active', j === cur));
      };
      clone.querySelector('.p-gal-prev')?.addEventListener('click', e => { e.stopPropagation(); go(cur-1); });
      clone.querySelector('.p-gal-next')?.addEventListener('click', e => { e.stopPropagation(); go(cur+1); });
      ds.forEach((d,i) => d.addEventListener('click', e => { e.stopPropagation(); go(i); }));
    }
  }

  /* Mettre à jour la liste dans le panel */
  const listEl = document.getElementById('adminPhotoList');
  if (listEl && window._buildPhotoList) listEl.innerHTML = window._buildPhotoList();
};

/* ── Appliquer les overrides au chargement ── */
function _applyProdOverrides() {
  const edits      = JSON.parse(localStorage.getItem('leclam_prod_edits') || '{}');
  const photoTrash = _getPhotoTrash();
  document.querySelectorAll('.p-card').forEach(card => {
    const id   = card.dataset.id;
    const edit = edits[id];
    if (edit) {
      if (edit.name)  { const e = card.querySelector('.p-name'); if (e) e.textContent = edit.name; }
      if (edit.sub)   { const e = card.querySelector('.p-sub');  if (e) e.textContent = edit.sub;  }
      if (edit.price) {
        const e = card.querySelector('.p-price');
        if (e) e.textContent = parseFloat(edit.price).toFixed(2).replace('.',',') + ' €';
        card.dataset.price = edit.price;
      }
      if (edit.famille !== undefined) {
        const famArr = Array.isArray(edit.famille) ? edit.famille : (edit.famille ? [edit.famille] : []);
        if (famArr.length) card.dataset.famille = famArr.join(',');
        else               delete card.dataset.famille;
      }
      if (edit.subfamille !== undefined) {
        const sfArr = Array.isArray(edit.subfamille) ? edit.subfamille : (edit.subfamille ? [edit.subfamille] : []);
        if (sfArr.length) card.dataset.subfamille = sfArr.join(',');
        else              delete card.dataset.subfamille;
      }
      if (edit.photoOrder?.length) {
        const track = card.querySelector('.p-gallery-track');
        if (track) {
          edit.photoOrder.forEach(src => {
            const img = Array.from(track.querySelectorAll('img')).find(i => i.getAttribute('src') === src);
            if (img) track.appendChild(img);
          });
        }
      }
    }
    /* Masquer les photos dans la corbeille */
    const trashedSrcs = photoTrash.filter(t => t.prodId === id).map(t => t.src);
    if (trashedSrcs.length) {
      const track = card.querySelector('.p-gallery-track');
      if (track) {
        Array.from(track.querySelectorAll('img')).forEach(img => {
          if (trashedSrcs.includes(img.getAttribute('src'))) img.remove();
        });
      }
    }
  });
}

/* ── Épuisé ── */
function _getEpuises() {
  try { return JSON.parse(localStorage.getItem('leclam_epuises')||'[]'); } catch { return []; }
}
function _isEpuise(id) { return _getEpuises().includes(id); }

window._toggleEpuise = function(id, btn) {
  let list = _getEpuises();
  const card = document.querySelector(`.p-card[data-id="${id}"]`);
  if (list.includes(id)) {
    list = list.filter(i => i !== id);
    card?.classList.remove('epuise');
    if (btn) { btn.textContent = 'Épuisé'; btn.classList.remove('aeb-on'); }
  } else {
    list.push(id);
    card?.classList.add('epuise');
    if (btn) { btn.textContent = 'Épuisé ✓'; btn.classList.add('aeb-on'); }
  }
  localStorage.setItem('leclam_epuises', JSON.stringify(list));
};

function _applyEpuises() {
  _getEpuises().forEach(id => {
    const card = document.querySelector(`.p-card[data-id="${id}"]`);
    if (card) card.classList.add('epuise');
  });
}

/* ── Suppression produit ── */
function _getDeleted(cat) {
  try { return JSON.parse(localStorage.getItem('leclam_deleted_'+cat)||'[]'); } catch { return []; }
}
function _saveDeleted(cat, ids) { localStorage.setItem('leclam_deleted_'+cat, JSON.stringify(ids)); }

window._confirmDelete = function(id, cat) {
  _showAdminPanel(`
    <h3 style="margin:0 0 .8rem;font-size:1.1rem;color:#dc2626">Supprimer ce produit ?</h3>
    <p style="font-size:.85rem;color:#555;margin:0 0 1.2rem">Le produit sera masqué sur la page. Vous pourrez le restaurer depuis le panneau admin.</p>
    <div style="display:flex;gap:.6rem;justify-content:flex-end">
      <button onclick="_closeAdminPanel()" style="padding:.45rem 1rem;border:1px solid #ddd;border-radius:8px;background:#f5f5f5;cursor:pointer;font-family:inherit;font-size:.85rem">Annuler</button>
      <button onclick="_doDelete('${id}','${cat}')" style="padding:.45rem 1rem;border:none;border-radius:8px;background:#dc2626;color:#fff;cursor:pointer;font-family:inherit;font-size:.85rem;font-weight:700">Supprimer</button>
    </div>`);
};


window._restoreOne = function(id, cat) {
  let ids = _getDeleted(cat);
  ids = ids.filter(i => i !== id);
  _saveDeleted(cat, ids);
  _closeAdminPanel();
  window._refreshCorbeilleBtn?.();
  location.reload();
};

window._restoreAll = function(cat) {
  _saveDeleted(cat, []);
  _closeAdminPanel();
  window._refreshCorbeilleBtn?.();
  location.reload();
};

window._doDelete = function(id, cat) {
  const ids = _getDeleted(cat);
  if (!ids.includes(id)) ids.push(id);
  _saveDeleted(cat, ids);
  /* Sauvegarder le nom pour affichage dans la corbeille */
  const card = document.querySelector(`.p-card[data-id="${id}"]`);
  const name = card?.querySelector('.p-name')?.textContent?.trim() || id;
  const names = JSON.parse(localStorage.getItem('leclam_deleted_names')||'{}');
  names[id] = name;
  localStorage.setItem('leclam_deleted_names', JSON.stringify(names));
  if (card) card.remove();
  _closeAdminPanel();
  _updateProdCount();
  window._refreshCorbeilleBtn?.();
};

function _applyDeleted(cat) {
  const ids = [...new Set([..._getDeleted(cat), ..._getPermaDeleted(cat)])];
  ids.forEach(id => {
    const card = document.querySelector(`.p-card[data-id="${id}"]`);
    if (card) card.remove();
  });
}

function _updateProdCount() {
  const el = document.querySelector('.prod-count');
  if (!el) return;
  const n = document.querySelectorAll('.p-card:not(.p-card-request)').length;
  el.textContent = n + ' article' + (n > 1 ? 's' : '');
}

/* ── Corbeille photos ── */
function _getPhotoTrash() {
  try { return JSON.parse(localStorage.getItem('leclam_photo_trash')||'[]'); } catch { return []; }
}
function _savePhotoTrash(items) { localStorage.setItem('leclam_photo_trash', JSON.stringify(items)); }

/* ── Suppression définitive articles ── */
function _getPermaDeleted(cat) {
  try { return JSON.parse(localStorage.getItem('leclam_perma_'+cat)||'[]'); } catch { return []; }
}
function _savePermaDeleted(cat, ids) { localStorage.setItem('leclam_perma_'+cat, JSON.stringify(ids)); }

/* Mettre une photo en corbeille */
window._trashPhoto = function(prodId, src) {
  const card = document.querySelector(`.p-card[data-id="${prodId}"]`);
  const name = card?.querySelector('.p-name')?.textContent?.trim() || prodId;
  const trash = _getPhotoTrash();
  if (!trash.find(t => t.prodId === prodId && t.src === src)) {
    trash.push({ prodId, src, name });
    _savePhotoTrash(trash);
  }
  /* Retirer du DOM */
  const track = card?.querySelector('.p-gallery-track');
  if (track) {
    const img = Array.from(track.querySelectorAll('img')).find(i => i.getAttribute('src') === src);
    if (img) img.remove();
  }
  /* Mettre à jour l'ordre sauvegardé + sync serveur */
  const edits = JSON.parse(localStorage.getItem('leclam_prod_edits')||'{}');
  const remaining = card ? Array.from(card.querySelectorAll('.p-gallery-track img')).map(i => i.getAttribute('src')) : [];
  edits[prodId] = { ...(edits[prodId]||{}), photoOrder: remaining };
  localStorage.setItem('leclam_prod_edits', JSON.stringify(edits));
  _patchProductImages(prodId, remaining);
  /* Rafraîchir */
  const listEl = document.getElementById('adminPhotoList');
  if (listEl && window._buildPhotoList) listEl.innerHTML = window._buildPhotoList();
  window._refreshCorbeilleBtn?.();
};

/* Restaurer une photo depuis la corbeille */
window._restorePhoto = async function(prodId, src) {
  let trash = _getPhotoTrash();
  trash = trash.filter(t => !(t.prodId === prodId && t.src === src));
  _savePhotoTrash(trash);
  /* Ajouter le src dans photoOrder pour qu'il réapparaisse au rechargement */
  const edits = JSON.parse(localStorage.getItem('leclam_prod_edits')||'{}');
  if (!edits[prodId]) edits[prodId] = {};
  if (!edits[prodId].photoOrder) edits[prodId].photoOrder = [];
  if (!edits[prodId].photoOrder.includes(src)) edits[prodId].photoOrder.push(src);
  localStorage.setItem('leclam_prod_edits', JSON.stringify(edits));
  await _patchProductImages(prodId, edits[prodId].photoOrder);
  _closeAdminPanel();
  window._refreshCorbeilleBtn?.();
  location.reload();
};

/* Supprimer une photo définitivement */
window._permaDeletePhoto = function(prodId, src) {
  const name = _getPhotoTrash().find(t => t.prodId===prodId && t.src===src)?.name || prodId;
  let trash = _getPhotoTrash();
  trash = trash.filter(t => !(t.prodId === prodId && t.src === src));
  _savePhotoTrash(trash);
  const cat = ['plaisir','malin','bebe'].find(c => prodId.startsWith(c)) || 'cat';
  _logHistory({ type:'photo', id:prodId, name, cat, src, action:'perma' });
  _openCorbeillePanel(cat);
  window._refreshCorbeilleBtn?.();
};

/* Supprimer un article définitivement (corbeille → historique) */
window._permaDeleteArticle = function(id, cat) {
  const names = JSON.parse(localStorage.getItem('leclam_deleted_names')||'{}');
  let ids = _getDeleted(cat);
  ids = ids.filter(i => i !== id);
  _saveDeleted(cat, ids);
  const perma = _getPermaDeleted(cat);
  if (!perma.includes(id)) perma.push(id);
  _savePermaDeleted(cat, perma);
  _logHistory({ type:'article', id, name: names[id]||id, cat, action:'perma' });
  _openCorbeillePanel(cat);
  window._refreshCorbeilleBtn?.();
};

/* Vider la corbeille articles */
window._emptyArticleTrash = function(cat) {
  const ids   = _getDeleted(cat);
  const names = JSON.parse(localStorage.getItem('leclam_deleted_names')||'{}');
  const perma = _getPermaDeleted(cat);
  _savePermaDeleted(cat, [...new Set([...perma, ...ids])]);
  ids.forEach(id => _logHistory({ type:'article', id, name: names[id]||id, cat, action:'vider' }));
  _saveDeleted(cat, []);
  _openCorbeillePanel(cat);
  window._refreshCorbeilleBtn?.();
};

/* Vider la corbeille photos */
window._emptyPhotoTrash = function(cat) {
  const toDelete = _getPhotoTrash().filter(t => t.prodId.startsWith(cat+'-'));
  toDelete.forEach(p => _logHistory({ type:'photo', id:p.prodId, name:p.name, cat, src:p.src, action:'vider' }));
  let trash = _getPhotoTrash();
  trash = trash.filter(t => !t.prodId.startsWith(cat+'-'));
  _savePhotoTrash(trash);
  _openCorbeillePanel(cat);
  window._refreshCorbeilleBtn?.();
};

/* ── Historique des suppressions définitives ── */
function _getHistory() {
  try { return JSON.parse(localStorage.getItem('leclam_history')||'[]'); } catch { return []; }
}
function _logHistory(entry) {
  const hist = _getHistory();
  const now  = new Date();
  const date = now.toLocaleDateString('fr-FR') + ' ' + now.toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'});
  hist.unshift({ ...entry, date });
  localStorage.setItem('leclam_history', JSON.stringify(hist.slice(0, 200)));
}

/* Restaurer un article depuis l'historique */
window._restoreFromHistory = function(id, cat) {
  let perma = _getPermaDeleted(cat);
  perma = perma.filter(i => i !== id);
  _savePermaDeleted(cat, perma);
  _closeAdminPanel();
  window._refreshCorbeilleBtn?.();
  location.reload();
};

/* Vider tout l'historique */
window._clearHistory = function(cat) {
  const hist = _getHistory().filter(h => h.cat !== cat);
  localStorage.setItem('leclam_history', JSON.stringify(hist));
  _openCorbeillePanel(cat);
};

/* ── Panneau corbeille unifié ── */
const _CB_BTN = 'padding:.3rem .7rem;border:none;border-radius:8px;font-size:.75rem;font-weight:700;cursor:pointer;font-family:inherit';
const _CB_TAB = 'padding:.38rem .9rem;border:none;border-radius:20px;font-size:.78rem;font-weight:700;cursor:pointer;font-family:inherit;transition:background .15s';

function _openCorbeillePanel(cat, activeTab) {
  const tab        = activeTab || 1;
  const articleIds = _getDeleted(cat);
  const photos     = _getPhotoTrash().filter(t => t.prodId.startsWith(cat+'-'));
  const names      = JSON.parse(localStorage.getItem('leclam_deleted_names')||'{}');

  const artRows = articleIds.length === 0
    ? `<p style="font-size:.82rem;color:#bbb;text-align:center;padding:1.2rem 0">Aucun article dans la corbeille</p>`
    : articleIds.map(id => `
        <div style="display:flex;align-items:center;gap:.5rem;padding:.45rem 0;border-bottom:1px solid #f0f0f0">
          <div style="flex:1;min-width:0">
            <div style="font-size:.82rem;font-weight:600;color:#1a1a1a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${names[id]||id}</div>
            <div style="font-size:.7rem;color:#aaa">${id}</div>
          </div>
          <button onclick="_restoreOne('${id}','${cat}')" title="Restaurer" style="${_CB_BTN};background:#dcfce7;color:#16a34a">↩️ Restaurer</button>
          <button onclick="_permaDeleteArticle('${id}','${cat}')" title="Supprimer définitivement" style="${_CB_BTN};background:#fee2e2;color:#dc2626">✕</button>
        </div>`).join('') +
      `<button onclick="_emptyArticleTrash('${cat}')" style="${_CB_BTN};background:#dc2626;color:#fff;margin-top:.85rem;width:100%">Vider la corbeille articles</button>`;

  const photoRows = photos.length === 0
    ? `<p style="font-size:.82rem;color:#bbb;text-align:center;padding:1.2rem 0">Aucune photo dans la corbeille</p>`
    : photos.map(p => `
        <div style="display:flex;align-items:center;gap:.55rem;padding:.45rem 0;border-bottom:1px solid #f0f0f0">
          <img src="${p.src}" style="width:44px;height:44px;object-fit:cover;border-radius:7px;flex-shrink:0" onerror="this.style.display='none'">
          <div style="flex:1;min-width:0">
            <div style="font-size:.8rem;font-weight:600;color:#1a1a1a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.name}</div>
            <div style="font-size:.7rem;color:#aaa">${p.prodId}</div>
          </div>
          <button onclick="_restorePhoto('${p.prodId}','${p.src}')" title="Restaurer" style="${_CB_BTN};background:#dcfce7;color:#16a34a">↩️</button>
          <button onclick="_permaDeletePhoto('${p.prodId}','${p.src}')" title="Supprimer définitivement" style="${_CB_BTN};background:#fee2e2;color:#dc2626">✕</button>
        </div>`).join('') +
      `<button onclick="_emptyPhotoTrash('${cat}')" style="${_CB_BTN};background:#dc2626;color:#fff;margin-top:.85rem;width:100%">Vider la corbeille photos</button>`;

  const tabStyle = (n) => `${_CB_TAB};background:${tab===n?'#1a1a1a':'#f0f0f0'};color:${tab===n?'#fff':'#555'}`;

  _showAdminPanel(`
    <div style="font-weight:700;font-size:1rem;margin-bottom:.9rem;color:#1a1a1a">Corbeille</div>
    <div style="display:flex;gap:.35rem;margin-bottom:.85rem;flex-wrap:wrap">
      <button id="corbTab1Btn" onclick="_corbeilleTab(1,'${cat}')" style="${tabStyle(1)}">
        Articles (${articleIds.length})
      </button>
      <button id="corbTab2Btn" onclick="_corbeilleTab(2,'${cat}')" style="${tabStyle(2)}">
        Photos (${photos.length})
      </button>
    </div>
    <div id="corbContent1" style="max-height:52vh;overflow-y:auto;display:${tab===1?'':'none'}">${artRows}</div>
    <div id="corbContent2" style="max-height:52vh;overflow-y:auto;display:${tab===2?'':'none'}">${photoRows}</div>
    <div style="margin-top:1rem;text-align:right">
      <button onclick="_closeAdminPanel()" style="${_CB_BTN};background:#f5f5f5;color:#555;border:1px solid #ddd">Fermer</button>
    </div>`);
}

window._corbeilleTab = function(n, cat) {
  [1,2].forEach(i => {
    document.getElementById('corbContent'+i).style.display = i===n ? '' : 'none';
    document.getElementById('corbTab'+i+'Btn').style.cssText =
      `${_CB_TAB};background:${i===n?'#1a1a1a':'#f0f0f0'};color:${i===n?'#fff':'#555'}`;
  });
};

/* ── Helpers panel ── */
function _showAdminPanel(html) {
  const ov = document.createElement('div');
  ov.id = 'adminEditOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:99998';
  ov.addEventListener('click', _closeAdminPanel);

  const panel = document.createElement('div');
  panel.id = 'adminEditPanel';
  panel.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
    background:#fff;border-radius:18px;padding:1.5rem 1.6rem;
    box-shadow:0 24px 64px rgba(0,0,0,.3);z-index:99999;
    min-width:300px;max-width:min(440px,92vw);max-height:85vh;overflow-y:auto`;
  panel.innerHTML = html;
  panel.addEventListener('click', e => e.stopPropagation());

  document.body.appendChild(ov);
  document.body.appendChild(panel);
}
window._closeAdminPanel = function() {
  document.getElementById('adminEditPanel')?.remove();
  document.getElementById('adminEditOverlay')?.remove();
};

/* ─────────────────────────────────────────
   TRADUCTION — Google Translate personnalisé
   ───────────────────────────────────────── */
function initLangSelector() {
  const identify = document.querySelector('.nav-identify');
  if (!identify) return;

  const LANGS = [
    { code: 'fr', flag: '🇫🇷', label: 'Français'  },
    { code: 'en', flag: '🇬🇧', label: 'English'   },
    { code: 'es', flag: '🇪🇸', label: 'Español'   },
    { code: 'de', flag: '🇩🇪', label: 'Deutsch'   },
    { code: 'it', flag: '🇮🇹', label: 'Italiano'  },
  ];

  const wrap = document.createElement('div');
  wrap.className = 'lang-selector';
  wrap.innerHTML = `
    <button class="lang-btn" aria-label="Changer de langue"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg></button>
    <div class="lang-dropdown">
      ${LANGS.map(l => `<button data-lang="${l.code}" class="${l.code === I18n.locale ? 'active' : ''}">${l.flag} ${l.label}</button>`).join('')}
    </div>`;
  identify.insertAdjacentElement('afterend', wrap);

  const dropdown = wrap.querySelector('.lang-dropdown');

  wrap.querySelector('.lang-btn').addEventListener('click', e => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });

  wrap.querySelectorAll('[data-lang]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      dropdown.classList.remove('open');
      wrap.querySelectorAll('[data-lang]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      I18n.setLocale(btn.dataset.lang);
    });
  });

  document.addEventListener('click', () => dropdown.classList.remove('open'));

  /* Mettre à jour le bouton actif quand i18n est chargé */
  document.addEventListener('i18nApplied', () => {
    wrap.querySelectorAll('[data-lang]').forEach(b => {
      b.classList.toggle('active', b.dataset.lang === I18n.locale);
    });
  });
}

/* ─────────────────────────────────────────
   INIT
   ───────────────────────────────────────── */
/* ─────────────────────────────────────────
   CACHE PRODUITS — sauvegarde les produits de la page
   dans leclam_all_products pour que fournisseur.html
   fonctionne sans serveur (ouverture directe en file://)
   ───────────────────────────────────────── */
/* Applique les prix et noms modifiés dans la gestion fournisseurs sur les cartes produit */
function applyProductOverrides() {
  try {
    const stored = JSON.parse(localStorage.getItem('leclam_all_products') || '[]');
    if (!stored.length) return;
    document.querySelectorAll('.p-card[data-id]:not(.p-card-request)').forEach(card => {
      const p = stored.find(x => x.id === card.dataset.id);
      if (!p) return;
      if (p.price != null) {
        card.dataset.price = p.price;
        const el = card.querySelector('.p-price');
        if (el) el.textContent = p.price.toFixed(2).replace('.', ',') + ' €';
      }
      if (p.name) {
        const el = card.querySelector('.p-name');
        if (el) el.textContent = p.name;
      }
    });
  } catch { /* ignore */ }
}

function cachePageProducts() {
  const cat = (document.body.className.match(/page-(\w+)/) || [])[1];
  if (!cat) return; /* pas une page catégorie */

  const cards = Array.from(document.querySelectorAll('.p-card:not(.p-card-request)'));
  if (!cards.length) return;

  const pageProds = cards.map(card => {
    const img = card.querySelector('.p-gallery-track img, .p-img img');
    return {
      id:    card.dataset.id,
      name:  card.querySelector('.p-name')?.textContent?.trim() || '—',
      price: parseFloat(card.dataset.price) || 0,
      cat,
      img:   img ? img.getAttribute('src') : null,
    };
  }).filter(p => p.id);

  try {
    const existing = JSON.parse(localStorage.getItem('leclam_all_products') || '[]');
    /* Remplacer les entrées de cette catégorie, conserver les autres */
    const others = existing.filter(p => p.cat !== cat);
    localStorage.setItem('leclam_all_products', JSON.stringify([...others, ...pageProds]));
  } catch { /* quota ou parse error → ignorer */ }
}

function _makeDraggable(el, handle) {
  let ox = 0, oy = 0, sx = 0, sy = 0;
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    sx = e.clientX - el.getBoundingClientRect().left;
    sy = e.clientY - el.getBoundingClientRect().top;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', () => document.removeEventListener('mousemove', onMove), { once:true });
  });
  function onMove(e) {
    el.style.left   = (e.clientX - sx) + 'px';
    el.style.top    = (e.clientY - sy) + 'px';
    el.style.right  = 'auto';
    el.style.bottom = 'auto';
  }
}



/* couleurs fixées dans le CSS — panneaux supprimés */

/* ── Rappel cookies refusés ── */
function initCookieWarning() {
  if (localStorage.getItem('leclam_cookie_consent') !== 'declined') return;

  const bar = document.createElement('div');
  bar.id = 'cookieWarning';
  bar.style.cssText = [
    'position:fixed', 'bottom:0', 'left:0', 'right:0', 'z-index:9998',
    'background:#7c4a00', 'color:#fff',
    'padding:.65rem 1.2rem', 'display:flex', 'align-items:center',
    'gap:.8rem', 'flex-wrap:wrap', 'justify-content:space-between',
    'font-family:inherit', 'font-size:.8rem', 'line-height:1.4',
    'box-shadow:0 -3px 16px rgba(0,0,0,.2)',
  ].join(';');
  bar.innerHTML = `
    <span style="flex:1;min-width:200px">${I18n.t('cookie.warning')}</span>
    <div style="display:flex;gap:.5rem;flex-shrink:0;align-items:center">
      <button id="cookieWarnAccept" style="padding:.38rem 1rem;background:#d9c4a0;color:#1a1a1a;border:none;border-radius:50px;font-size:.8rem;font-weight:700;cursor:pointer;font-family:inherit">${I18n.t('cookie.accept_reminder')}</button>
      <button id="cookieWarnDismiss" style="background:none;border:none;color:#ccc;font-size:1.1rem;cursor:pointer;line-height:1;padding:.2rem .4rem" aria-label="Fermer">×</button>
    </div>`;

  document.body.appendChild(bar);

  bar.querySelector('#cookieWarnAccept').addEventListener('click', () => {
    localStorage.setItem('leclam_cookie_consent', 'accepted');
    bar.style.transition = 'opacity .3s';
    bar.style.opacity = '0';
    setTimeout(() => bar.remove(), 300);
  });
  bar.querySelector('#cookieWarnDismiss').addEventListener('click', () => {
    bar.style.transition = 'opacity .3s';
    bar.style.opacity = '0';
    setTimeout(() => bar.remove(), 300);
  });
}

/* ── Bandeau consentement cookies (RGPD) ── */
function initCookieBanner() {
  if (localStorage.getItem('leclam_cookie_consent')) return;

  const banner = document.createElement('div');
  banner.id = 'cookieBanner';
  banner.style.cssText = [
    'position:fixed', 'bottom:0', 'left:0', 'right:0', 'z-index:9999',
    'background:#1a1a1a', 'color:#fff',
    'padding:1rem 1.2rem', 'display:flex', 'align-items:center',
    'gap:.8rem', 'flex-wrap:wrap', 'justify-content:space-between',
    'font-family:inherit', 'font-size:.82rem', 'line-height:1.45',
    'box-shadow:0 -4px 24px rgba(0,0,0,.25)',
  ].join(';');
  banner.innerHTML = `
    <span style="flex:1;min-width:200px">
      ${I18n.t('cookie.text')}
      <a href="cookies.html" style="color:#d9c4a0;text-decoration:underline;margin-left:.3rem">${I18n.t('cookie.learn_more')}</a>
    </span>
    <div style="display:flex;gap:.5rem;flex-shrink:0">
      <button id="cookieAccept" style="padding:.45rem 1.1rem;background:#d9c4a0;color:#1a1a1a;border:none;border-radius:50px;font-size:.82rem;font-weight:700;cursor:pointer;font-family:inherit">${I18n.t('cookie.accept')}</button>
      <button id="cookieDecline" style="padding:.45rem 1.1rem;background:transparent;color:#bbb;border:1px solid #555;border-radius:50px;font-size:.82rem;font-weight:600;cursor:pointer;font-family:inherit">${I18n.t('cookie.decline')}</button>
    </div>`;

  document.body.appendChild(banner);

  function dismiss(choice) {
    localStorage.setItem('leclam_cookie_consent', choice);
    banner.style.transition = 'opacity .3s';
    banner.style.opacity    = '0';
    setTimeout(() => banner.remove(), 300);
    /* Si refus : supprimer le cookie de session non essentiel (ex: analytics futurs) */
  }
  banner.querySelector('#cookieAccept').addEventListener('click',  () => dismiss('accepted'));
  banner.querySelector('#cookieDecline').addEventListener('click', () => dismiss('declined'));
}

/* ─────────────────────────────────────────
   BADGES STOCK FAIBLE
   Lit leclam_stocks { [productId]: count }
   et ajoute un badge rouge sur les cartes < 5
   ───────────────────────────────────────── */
function initStockBadges() {
  let stocks = {};
  try { stocks = JSON.parse(localStorage.getItem('leclam_stocks') || '{}'); } catch {}
  if (!Object.keys(stocks).length) return;

  document.querySelectorAll('.p-card[data-id]:not(.p-card-request)').forEach(card => {
    const id    = card.dataset.id;
    const count = stocks[id];
    if (count == null) return;
    const n = parseInt(count, 10);
    if (n > 5 || isNaN(n)) return;

    /* Supprimer badge existant pour éviter les doublons */
    card.querySelector('.p-stock-badge')?.remove();

    const badge = document.createElement('div');
    badge.className = 'p-stock-badge';
    badge.textContent = n <= 0 ? 'Rupture de stock' : `Plus que ${n} en stock`;
    badge.style.cssText = [
      'position:absolute', 'top:.55rem', 'left:.55rem',
      'z-index:4',
      `background:${n <= 0 ? '#dc2626' : '#f59e0b'}`,
      'color:#fff', 'font-size:.65rem', 'font-weight:800',
      'padding:.18rem .5rem', 'border-radius:20px',
      'letter-spacing:.02em', 'pointer-events:none',
    ].join(';');

    /* S'assurer que la carte est en position:relative */
    const pos = getComputedStyle(card).position;
    if (pos === 'static') card.style.position = 'relative';

    card.appendChild(badge);

    /* Désactiver le bouton si rupture */
    if (n <= 0) {
      const btn = card.querySelector('.p-atc');
      if (btn) { btn.disabled = true; btn.textContent = I18n.t('account.unavailable'); btn.style.opacity = '.5'; }
    }
  });
}

/* ─────────────────────────────────────────
   HISTORIQUE DE NAVIGATION (client)
   Clé : leclam_browse_history  (≠ leclam_history = corbeille admin)
   ───────────────────────────────────────── */
function _trackBrowse(card) {
  try {
    const id = card.dataset.id;
    if (!id) return;
    const img = card.querySelector('.p-gallery-track img, .p-img img');
    const item = {
      id,
      name:  card.querySelector('.p-name')?.textContent?.trim() || 'Produit',
      price: parseFloat(card.dataset.price) || 0,
      img:   img ? img.getAttribute('src') : null,
      emoji: card.querySelector('.p-img > span:first-child')?.textContent || '📦',
      ts:    Date.now(),
    };
    const history = JSON.parse(localStorage.getItem('leclam_browse_history') || '[]');
    const fresh   = history.filter(x => x.id !== id);
    fresh.unshift(item);
    localStorage.setItem('leclam_browse_history', JSON.stringify(fresh.slice(0, 12)));
  } catch {}
}

function renderRecentlyViewed() {
  const cat = (document.body.className.match(/page-(\w+)/) || [])[1];
  if (!cat) return; /* Seulement sur les pages catégorie */

  let history = [];
  try { history = JSON.parse(localStorage.getItem('leclam_browse_history') || '[]'); } catch {}
  /* Filtrer les produits de la page courante et limiter à 4 */
  const currentIds = new Set(Array.from(document.querySelectorAll('.p-card[data-id]')).map(c => c.dataset.id));
  const items = history.filter(x => currentIds.has(x.id)).slice(0, 4);
  if (items.length < 2) return; /* Moins de 2 produits vus → ne pas afficher */

  const container = document.querySelector('.products-grid') || document.querySelector('.products-section');
  if (!container) return;

  const section = document.createElement('section');
  section.style.cssText = 'padding:2rem 1rem 1rem;max-width:1200px;margin:0 auto';
  section.innerHTML = `
    <h2 style="font-size:1rem;font-weight:700;color:#3e2a14;margin-bottom:1rem;letter-spacing:.03em">Récemment consultés</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:.75rem">
      ${items.map(p => `
        <div onclick="document.querySelector('.p-card[data-id=\\'${p.id}\\']')?.click()"
          style="cursor:pointer;background:#fff;border-radius:12px;border:1px solid #eee;padding:.75rem;transition:box-shadow .15s"
          onmouseover="this.style.boxShadow='0 4px 16px rgba(0,0,0,.1)'" onmouseout="this.style.boxShadow=''">
          <div style="width:100%;aspect-ratio:1;background:#f8f7f5;border-radius:8px;overflow:hidden;margin-bottom:.5rem;display:flex;align-items:center;justify-content:center">
            ${p.img
              ? `<img src="${escHtml(p.img)}" style="width:100%;height:100%;object-fit:cover" loading="lazy">`
              : `<span style="font-size:2rem">${escHtml(p.emoji)}</span>`}
          </div>
          <div style="font-size:.75rem;font-weight:600;color:#1a1a1a;line-height:1.3;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${escHtml(p.name)}</div>
          <div style="font-size:.82rem;font-weight:800;color:#3e2a14;margin-top:.3rem">${fmtPrice(p.price)}</div>
        </div>`).join('')}
    </div>`;

  container.parentNode.insertBefore(section, container.nextSibling);
}

/* ─────────────────────────────────────────
   WISHLIST / FAVORIS
   Clé localStorage : leclam_wishlist (array d'items)
   ───────────────────────────────────────── */
function _getWishlist() {
  try { return JSON.parse(localStorage.getItem('leclam_wishlist') || '[]'); } catch { return []; }
}
function _saveWishlist(list) {
  localStorage.setItem('leclam_wishlist', JSON.stringify(list));
}

window.toggleWishlist = function(id, name, price, img, emoji) {
  let list = _getWishlist();
  const idx = list.findIndex(x => x.id === id);
  if (idx > -1) {
    /* Retirer */
    list.splice(idx, 1);
  } else {
    /* Ajouter */
    list.push({ id, name, price, img, emoji });
  }
  _saveWishlist(list);
  /* Mettre à jour visuellement tous les boutons ♡ pour cet id */
  _syncWishBtn(id, list);
};

function _syncWishBtn(id, list) {
  const isFav = (list || _getWishlist()).some(x => x.id === id);
  document.querySelectorAll(`.p-wish[data-id="${id}"]`).forEach(btn => {
    btn.innerHTML    = isFav
      ? '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="#ef4444" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>'
      : '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
    btn.title        = isFav ? I18n.t('wishlist.removed') : I18n.t('wishlist.added');
    btn.style.color  = isFav ? '' : '';
  });
}

function initWishlist() {
  const list = _getWishlist();
  /* Synchroniser l'état visuel de chaque bouton ♡ au chargement */
  document.querySelectorAll('.p-wish').forEach(btn => {
    const card = btn.closest('.p-card');
    const id   = btn.dataset.id || card?.dataset.id;
    if (!id) return;
    /* S'assurer que le dataset.id est défini sur le bouton */
    btn.dataset.id = id;
    _syncWishBtn(id, list);

    /* Empêcher le clic de propager vers la modal produit */
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const c     = btn.closest('.p-card');
      const name  = c?.querySelector('.p-name')?.textContent?.trim() || 'Produit';
      const price = parseFloat(c?.dataset.price) || 0;
      const imgEl = c?.querySelector('.p-gallery-track img') || c?.querySelector('.p-img img');
      const img   = imgEl ? imgEl.getAttribute('src') : null;
      const emoji = c?.querySelector('.p-img > span:first-child')?.textContent || '📦';
      toggleWishlist(id, name, price, img, emoji);
    });
  });
}

/* ─────────────────────────────────────────
   BADGE "NOUVEAU" — produits récemment ajoutés
   Critère : l'id se termine par un numéro >= 27
   ───────────────────────────────────────── */
function initNewBadges() {
  document.querySelectorAll('.p-card[data-id]:not(.p-card-request)').forEach(card => {
    const id  = card.dataset.id || '';
    const num = parseInt((id.match(/(\d+)$/) || [])[1], 10);
    if (isNaN(num) || num < 27) return;

    /* data-i18n assure la mise à jour automatique à chaque changement de langue */
    const existing = card.querySelector('.p-new-badge');
    if (existing) { if (!existing.dataset.i18n) existing.dataset.i18n = 'home.new_badge'; return; }

    const badge = document.createElement('div');
    badge.className = 'p-new-badge';
    badge.dataset.i18n = 'home.new_badge';
    badge.textContent = I18n.t('home.new_badge') || '';
    badge.style.cssText = [
      'position:absolute', 'top:.55rem', 'right:.55rem',
      'z-index:4',
      'background:#16a34a',
      'color:#fff', 'font-size:.62rem', 'font-weight:800',
      'padding:.18rem .5rem', 'border-radius:20px',
      'letter-spacing:.04em', 'pointer-events:none',
    ].join(';');

    const pos = getComputedStyle(card).position;
    if (pos === 'static') card.style.position = 'relative';

    card.appendChild(badge);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  _applyThemeColors();
  syncCsrfToken();
  renderSlides();

  /* Re-sync badge messages toutes les 60 secondes */
  setInterval(() => {
    const tok = localStorage.getItem('leclam_token');
    if (tok) syncMessages(tok);
  }, 60000);
  Cart.init();
  initNavbar();
  initCartDrawer();
  initFilters();
  initSearch();
  initProductGalleries();
  initProductModals();
  initProductTags();
  initStarRatings();
  initAdminEditMode();
  initLangSelector();
  applyProductOverrides();
  cachePageProducts();
  initCookieBanner();
  initCookieWarning();
  initStockBadges();
  initWishlist();
  initNewBadges();
  renderRecentlyViewed();
  const carousel = new Carousel(3000);
  carousel._syncSubNav();
  initSupportBubble();

  /* i18n — enregistrer le listener avant d'appeler init() */
  document.addEventListener('i18nApplied', () => { I18n.translatePage(); Cart._render(); }, { once: true });
  I18n.init();
  /* Précharger toutes les locales en arrière-plan pour un switch instantané */
  I18n.preloadLocales();
});

/* ── Bulle support flottante ── */
function initSupportBubble() {
  if (location.pathname.includes('messages.html') || location.pathname.includes('admin-messages.html')) return;
  const raw = localStorage.getItem('leclam_user');
  if (!raw) return;
  let user;
  try { user = JSON.parse(raw); } catch { return; }
  if (user.role === 'admin' || user.role === 'owner') return;

  function _cnt() {
    try {
      const th = JSON.parse(localStorage.getItem('leclam_threads') || '[]');
      const bc = JSON.parse(localStorage.getItem('leclam_broadcasts') || '[]');
      return th.filter(t => t.userId===user.email).reduce((s,t)=>s+(t.unreadClient||0),0)
           + bc.filter(b=>!(b.readBy||[]).includes(user.email)).length;
    } catch { return 0; }
  }

  const css = document.createElement('style');
  css.textContent = `
    #sprt-bubble{position:fixed;bottom:1.5rem;right:1.5rem;z-index:8900;width:52px;height:52px;border-radius:50%;background:#3e2a14;color:#d9c4a0;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(62,42,20,.35);text-decoration:none;transition:transform .18s,background .15s}
    #sprt-bubble:hover{background:#2a1c0d;transform:scale(1.07)}
    #sprt-bubble:active{transform:scale(.94)}
    #sprt-badge{position:absolute;top:-3px;right:-3px;min-width:18px;height:18px;background:#dc2626;color:#fff;border-radius:20px;font-size:.64rem;font-weight:800;display:flex;align-items:center;justify-content:center;padding:0 4px;border:2px solid #fff;pointer-events:none}
    #sprt-tip{position:absolute;right:58px;bottom:50%;transform:translateY(50%);background:#1a1a1a;color:#fff;font-size:.75rem;font-weight:600;padding:.35rem .7rem;border-radius:8px;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .15s}
    #sprt-bubble:hover #sprt-tip{opacity:1}
  `;
  document.head.appendChild(css);

  const btn = document.createElement('a');
  btn.id = 'sprt-bubble';
  btn.href = 'messages.html';
  btn.setAttribute('aria-label', 'Messages');
  btn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg><span id="sprt-tip">Support</span>`;
  document.body.appendChild(btn);

  function _refresh() {
    const n = _cnt();
    let badge = document.getElementById('sprt-badge');
    if (n > 0) {
      if (!badge) { badge = document.createElement('span'); badge.id='sprt-badge'; btn.appendChild(badge); }
      badge.textContent = n > 9 ? '9+' : n;
    } else if (badge) { badge.remove(); }
  }
  _refresh();
  window.addEventListener('storage', _refresh);
  setInterval(_refresh, 10000);
}
