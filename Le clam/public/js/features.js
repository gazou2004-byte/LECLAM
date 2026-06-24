/* ================================================================
   LE CLAM — features.js
   Fonctionnalités e-commerce avancées (12 modules)
   ================================================================ */
'use strict';

/* ─────────────────────────────────────────────────────────────────
   FEATURE 2 : ANIMATION FLY-TO-CART
   Bulle animée de la carte produit vers l'icône panier
   ─────────────────────────────────────────────────────────────── */
function flyToCart(sourceEl) {
  const cartBtn = document.getElementById('cartToggle');
  if (!cartBtn || !sourceEl) return;

  const card = sourceEl.closest('.p-card');
  const srcRect  = (card || sourceEl).getBoundingClientRect();
  const cartRect = cartBtn.getBoundingClientRect();

  const bubble = document.createElement('div');
  bubble.className = 'fly-bubble';

  const imgEl = card?.querySelector('.p-gallery-track img') || card?.querySelector('.p-img img');
  if (imgEl) {
    bubble.style.backgroundImage    = `url(${imgEl.src})`;
    bubble.style.backgroundSize     = 'cover';
    bubble.style.backgroundPosition = 'center';
    bubble.style.backgroundColor    = '#3e2a14';
  } else {
    bubble.style.background = '#3e2a14';
    bubble.style.display    = 'flex';
    bubble.style.alignItems = 'center';
    bubble.style.justifyContent = 'center';
    bubble.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#d9c4a0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>';
  }

  const sx = srcRect.left  + srcRect.width  / 2 - 24;
  const sy = srcRect.top   + srcRect.height / 2 - 24;
  const ex = cartRect.left + cartRect.width  / 2 - 24;
  const ey = cartRect.top  + cartRect.height / 2 - 24;

  Object.assign(bubble.style, {
    position:      'fixed',
    zIndex:        '99999',
    width:         '48px',
    height:        '48px',
    borderRadius:  '50%',
    left:          `${sx}px`,
    top:           `${sy}px`,
    pointerEvents: 'none',
    boxShadow:     '0 4px 16px rgba(0,0,0,.35)',
    transition:    'left .55s cubic-bezier(.25,.46,.45,.94), top .55s cubic-bezier(.25,.46,.45,.94), transform .55s ease, opacity .2s linear .35s',
    opacity:       '1',
  });

  document.body.appendChild(bubble);

  requestAnimationFrame(() => requestAnimationFrame(() => {
    bubble.style.left      = `${ex}px`;
    bubble.style.top       = `${ey}px`;
    bubble.style.transform = 'scale(0.1)';
    bubble.style.opacity   = '0';
  }));

  setTimeout(() => bubble.remove(), 700);
}

/* Hook sur addToCart et addToCartFromModal */
(function() {
  const hookFly = name => {
    const orig = window[name];
    if (!orig) return;
    window[name] = function(btn) {
      flyToCart(btn);
      return orig.call(this, btn);
    };
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      hookFly('addToCart');
      hookFly('addToCartFromModal');
    });
  } else {
    hookFly('addToCart');
    hookFly('addToCartFromModal');
  }
})();

/* ─────────────────────────────────────────────────────────────────
   FEATURE 3 : SOUVENT ACHETÉ ENSEMBLE
   Injecté dans la modal produit via MutationObserver
   ─────────────────────────────────────────────────────────────── */
(function() {
  function injectFrequentlyBought(modal) {
    const body = modal.querySelector('.prod-modal-body');
    if (!body || body.querySelector('.fbt-section')) return;

    /* Récupérer l'id du produit ouvert */
    const atcBtn = body.querySelector('.prod-modal-atc');
    const openId = atcBtn?.dataset.cardId;
    if (!openId) return;

    /* Récupérer le filtre du produit source */
    const srcCard = document.querySelector(`.p-card[data-id="${openId}"]`);
    const srcFilters = (srcCard?.dataset.filter || '').split(',').filter(Boolean);

    /* Chercher des cartes du même filtre, exclure la carte source */
    const allCards = Array.from(document.querySelectorAll('.p-card:not(.p-card-request)'));
    const related = allCards.filter(c => {
      if (c.dataset.id === openId) return false;
      const tags = (c.dataset.filter || '').split(',');
      return srcFilters.some(f => tags.includes(f));
    });

    if (related.length < 1) return;

    /* Prendre 2 produits aléatoires parmi les liés */
    const shuffle = arr => arr.sort(() => Math.random() - 0.5);
    const picks = shuffle(related).slice(0, 2);

    const srcPrice = parseFloat(srcCard?.dataset.price) || 0;
    const totalPrice = picks.reduce((s, c) => s + (parseFloat(c.dataset.price) || 0), srcPrice);

    function cardHtml(card) {
      const id    = card.dataset.id;
      const name  = card.querySelector('.p-name')?.textContent?.trim() || 'Produit';
      const price = parseFloat(card.dataset.price) || 0;
      const imgEl = card.querySelector('.p-gallery-track img') || card.querySelector('.p-img img');
      const imgSrc = imgEl ? imgEl.src : '';
      const emoji = card.querySelector('.p-img > span:first-child')?.textContent || '📦';
      return `
        <div class="fbt-item" data-id="${id}">
          <div class="fbt-img">
            ${imgSrc
              ? `<img src="${imgSrc}" alt="${name}" loading="lazy">`
              : `<span>${emoji}</span>`}
          </div>
          <div class="fbt-info">
            <div class="fbt-name">${name}</div>
            <div class="fbt-price">${price.toFixed(2).replace('.', ',')} €</div>
          </div>
        </div>`;
    }

    const allIds = [openId, ...picks.map(c => c.dataset.id)];

    const section = document.createElement('div');
    section.className = 'fbt-section';
    const _fbt = k => (typeof I18n !== 'undefined') ? I18n.t(k) : k;
    section.innerHTML = `
      <h4 class="fbt-title"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:.3rem"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>${_fbt('features.fbt_title')}</h4>
      <div class="fbt-list">
        ${picks.map(c => cardHtml(c)).join('<span class="fbt-plus">+</span>')}
      </div>
      <button class="fbt-add-all" data-ids="${allIds.join(',')}">
        ${_fbt('features.fbt_add').replace('{{n}}', allIds.length).replace('{{price}}', totalPrice.toFixed(2).replace('.', ','))}
      </button>`;

    /* Insérer avant les avis */
    const reviews = body.querySelector('.prod-modal-reviews');
    body.insertBefore(section, reviews || null);

    section.querySelector('.fbt-add-all')?.addEventListener('click', function() {
      const ids = this.dataset.ids.split(',');
      ids.forEach(id => {
        const card = document.querySelector(`.p-card[data-id="${id}"]`);
        if (!card) return;
        const imgE = card.querySelector('.p-gallery-track img') || card.querySelector('.p-img img');
        window.Cart?.add({
          id,
          name:    card.querySelector('.p-name')?.textContent?.trim() || 'Produit',
          emoji:   card.querySelector('.p-img > span:first-child')?.textContent || '📦',
          price:   parseFloat(card.dataset.price) || 0,
          img:     imgE ? imgE.getAttribute('src') : null,
          weightG: parseInt(card.dataset.weight, 10) || 200,
        });
      });
      this.textContent = _fbt('features.fbt_added').replace('{{n}}', ids.length);
      this.style.background = '#16a34a';
      setTimeout(() => {
        this.textContent = _fbt('features.fbt_add').replace('{{n}}', ids.length).replace('{{price}}', totalPrice.toFixed(2).replace('.', ','));
        this.style.background = '';
      }, 2000);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const observer = new MutationObserver(mutations => {
      mutations.forEach(m => {
        m.addedNodes.forEach(node => {
          if (node.nodeType !== 1) return;
          const modal = node.id === 'prodModalOverlay'
            ? node.querySelector('.prod-modal')
            : node.querySelector?.('#prodModalOverlay .prod-modal');
          if (modal) setTimeout(() => injectFrequentlyBought(modal), 80);
        });
      });
    });
    observer.observe(document.body, { childList: true });
  });
})();

/* ─────────────────────────────────────────────────────────────────
   FEATURE 4 : FLASH SALES DYNAMIQUES
   Charge /api/flash-sales et applique remise + compte à rebours
   sur les .p-card correspondantes
   ─────────────────────────────────────────────────────────────── */
(function() {
  function pad(n) { return String(n).padStart(2, '0'); }

  function timeLeft(endMs) {
    const diff = endMs - Date.now();
    if (diff <= 0) return null;
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    return { h, m, s };
  }

  function renderCountdown(el, endMs) {
    const t = timeLeft(endMs);
    if (!t) { el.remove(); return; }
    el.textContent = t.h > 0
      ? `⚡ Offre expire dans ${t.h}h ${pad(t.m)}min`
      : `⚡ Offre expire dans ${pad(t.m)}min ${pad(t.s)}s`;
  }

  function applyFlashToCard(card, sale) {
    const origPrice = parseFloat(card.dataset.price);
    if (isNaN(origPrice)) return;

    const discounted = +(origPrice * (1 - sale.discount / 100)).toFixed(2);
    const endMs      = new Date(sale.end).getTime();

    /* Prix barré + nouveau prix */
    const priceEl = card.querySelector('.p-price');
    if (priceEl && !card.dataset.flashApplied) {
      const oldSpan = priceEl.querySelector('.p-old') || document.createElement('s');
      oldSpan.className = 'p-old';
      oldSpan.style.cssText = 'color:#aaa;font-size:.8em;margin-right:.35rem;font-weight:400';
      oldSpan.textContent = origPrice.toFixed(2).replace('.', ',') + ' €';
      priceEl.prepend(oldSpan);

      const newSpan = priceEl.querySelector('.p-price-val') || priceEl;
      const target  = priceEl.querySelector('.price-val, .p-price-val') || priceEl.childNodes[priceEl.childNodes.length - 1];
      if (target && target.nodeType === 3) {
        target.textContent = ' ' + discounted.toFixed(2).replace('.', ',') + ' €';
      }

      /* Badge flash */
      const badge = document.createElement('span');
      badge.className = 'p-badge flash-badge';
      badge.style.cssText = 'background:#c0392b;color:#fff;font-size:.65rem;padding:.15rem .4rem;border-radius:4px;margin-left:.3rem;font-weight:700';
      badge.textContent = '−' + sale.discount + '%';
      priceEl.appendChild(badge);

      card.dataset.flashApplied = '1';
      card.dataset.price = discounted;
    }

    /* Compte à rebours */
    if (!card.querySelector('.flash-countdown')) {
      const foot = card.querySelector('.p-foot');
      if (foot) {
        const timer = document.createElement('div');
        timer.className = 'promo-countdown flash-countdown';
        foot.insertAdjacentElement('afterend', timer);
        renderCountdown(timer, endMs);
        const iv = setInterval(() => {
          if (!document.contains(timer)) { clearInterval(iv); return; }
          renderCountdown(timer, endMs);
          if (!timeLeft(endMs)) { clearInterval(iv); location.reload(); }
        }, 1000);
      }
    }
  }

  async function initFlashSales() {
    try {
      const r = await fetch('/api/flash-sales');
      const d = await r.json();
      if (!d.ok || !d.sales.length) return;

      document.querySelectorAll('.p-card:not(.p-card-request)').forEach(card => {
        const id = card.dataset.id;
        if (!id) return;
        const sale = d.sales.find(s => s.productIds.includes(id));
        if (sale) applyFlashToCard(card, sale);
      });
    } catch { /* serveur injoignable — silencieux */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFlashSales);
  } else {
    initFlashSales();
  }
})();

/* ─────────────────────────────────────────────────────────────────
   FEATURE 5 : STOCK CRITIQUE ANIMÉ
   Améliore les badges stock existants avec pulsation
   (initStockBadges dans app.js crée .p-stock-badge)
   ─────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  /* Attendre que initStockBadges ait tourné */
  setTimeout(() => {
    document.querySelectorAll('.p-stock-badge').forEach(badge => {
      const card = badge.closest('.p-card');
      const id   = card?.dataset.id;
      let stocks = {};
      try { stocks = JSON.parse(localStorage.getItem('leclam_stocks') || '{}'); } catch {}
      const n = parseInt(stocks[id], 10);
      if (!isNaN(n) && n > 0 && n <= 3) {
        badge.classList.add('p-stock-pulse');
      }
    });
  }, 200);
});

/* ─────────────────────────────────────────────────────────────────
   FEATURE 6 : EXIT INTENT POPUP
   Affiché une seule fois si la souris sort par le haut
   ─────────────────────────────────────────────────────────────── */
(function() {
  const KEY = 'leclam_exit_seen';

  document.addEventListener('DOMContentLoaded', () => {
    if (localStorage.getItem(KEY)) return;

    let triggered = false;

    document.addEventListener('mouseleave', e => {
      if (triggered || e.clientY > 5) return;
      triggered = true;
      localStorage.setItem(KEY, '1');
      showExitPopup();
    });
  });

  function showExitPopup() {
    /* Activer le code promo dans localStorage pour qu'il soit reconnu par app.js */
    try {
      const promos = JSON.parse(localStorage.getItem('leclam_promo_codes') || '{}');
      if (!promos['SAVE10']) {
        promos['SAVE10'] = { type: 'percent', value: 10 };
        localStorage.setItem('leclam_promo_codes', JSON.stringify(promos));
      }
    } catch {}

    const _ex = k => (typeof I18n !== 'undefined') ? I18n.t(k) : k;
    const overlay = document.createElement('div');
    overlay.className = 'exit-overlay';
    overlay.innerHTML = `
      <div class="exit-card">
        <button class="exit-close" aria-label="${_ex('product.close')}">✕</button>
        <div class="exit-emoji"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#3e2a14" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/></svg></div>
        <h2 class="exit-title">${_ex('features.exit_wait')}</h2>
        <p class="exit-sub">${_ex('features.exit_offer')}</p>
        <div class="exit-code">SAVE10</div>
        <p class="exit-hint">${_ex('features.exit_hint')}</p>
        <button class="exit-copy" onclick="navigator.clipboard?.writeText('SAVE10').then(()=>{this.textContent=I18n.t('orders.copied');setTimeout(()=>this.textContent=I18n.t('orders.copy_ref'),2000)})">
          ${_ex('orders.copy_ref')}
        </button>
        <button class="exit-dismiss">${_ex('features.exit_dismiss')}</button>
      </div>`;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));

    const close = () => {
      overlay.classList.remove('open');
      setTimeout(() => overlay.remove(), 300);
    };

    overlay.querySelector('.exit-close')?.addEventListener('click', close);
    overlay.querySelector('.exit-dismiss')?.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  }
})();

/* ─────────────────────────────────────────────────────────────────
   FEATURE 8 : PARTAGE WISHLIST
   URL : ?wishlist=id1,id2,... → import automatique
   Bouton "Partager" dans le panier / wishlist
   ─────────────────────────────────────────────────────────────── */
(function() {
  /* Import automatique depuis URL */
  const params = new URLSearchParams(location.search);
  const shared = params.get('wishlist');
  if (shared) {
    try {
      const ids = shared.split(',').filter(Boolean);
      const list = JSON.parse(localStorage.getItem('leclam_wishlist') || '[]');
      let added = 0;
      ids.forEach(id => {
        const card = document.querySelector(`.p-card[data-id="${id}"]`);
        if (!card || list.find(x => x.id === id)) return;
        const imgEl = card.querySelector('.p-gallery-track img') || card.querySelector('.p-img img');
        list.push({
          id,
          name:  card.querySelector('.p-name')?.textContent?.trim() || 'Produit',
          price: parseFloat(card.dataset.price) || 0,
          img:   imgEl ? imgEl.getAttribute('src') : null,
          emoji: card.querySelector('.p-img > span:first-child')?.textContent || '📦',
        });
        added++;
      });
      if (added > 0) {
        localStorage.setItem('leclam_wishlist', JSON.stringify(list));
        const toast = document.createElement('div');
        toast.className = 'loyalty-toast';
        const _wl = k => (typeof I18n !== 'undefined') ? I18n.t(k) : k;
        toast.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:.3rem"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>${_wl('features.wishlist_imported').replace('{{n}}', added)}`;
        document.body.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('show'));
        setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 400); }, 4000);
      }
    } catch {}
    /* Nettoyer l'URL sans recharger */
    const clean = new URL(location.href);
    clean.searchParams.delete('wishlist');
    history.replaceState(null, '', clean);
  }

  /* Bouton "Partager ma wishlist" — injecté dans la page */
  document.addEventListener('DOMContentLoaded', () => {
    const wishGrid = document.querySelector('.wish-grid, .wishlist-grid, .products-grid');
    if (!wishGrid) return;

    const shareBtn = document.createElement('button');
    shareBtn.className  = 'wish-share-btn';
    const _shareSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:.35rem"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>';
    shareBtn.innerHTML = _shareSvg + I18n.t('referral.share');
    shareBtn.addEventListener('click', () => {
      try {
        const list = JSON.parse(localStorage.getItem('leclam_wishlist') || '[]');
        if (!list.length) {
          alert(I18n.t('wishlist.empty'));
          return;
        }
        const ids = list.map(x => x.id).join(',');
        const url = `${location.origin}${location.pathname}?wishlist=${ids}`;
        navigator.clipboard?.writeText(url).then(() => {
          shareBtn.textContent = I18n.t('referral.copied');
          setTimeout(() => { shareBtn.innerHTML = _shareSvg + I18n.t('referral.share'); }, 2500);
        });
      } catch {}
    });

    const filters = document.querySelector('.filters');
    if (filters) filters.insertAdjacentElement('afterend', shareBtn);
  });
})();

/* ─────────────────────────────────────────────────────────────────
   FEATURE 10 : PWA INSTALLABLE
   manifest.json + service worker enregistré ici
   ─────────────────────────────────────────────────────────────── */
(function() {
  /* Injecter <link rel="manifest"> si absent */
  if (!document.querySelector('link[rel="manifest"]')) {
    const link = document.createElement('link');
    link.rel  = 'manifest';
    link.href = '/manifest.json';
    document.head.appendChild(link);
  }

  /* Enregistrer le service worker */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  /* Prompt d'installation */
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;

    /* Bouton dans la navbar */
    document.addEventListener('DOMContentLoaded', () => showInstallBtn());
    if (document.readyState !== 'loading') showInstallBtn();
  });

  function showInstallBtn() {
    if (document.getElementById('pwaInstallBtn')) return;
    const btn = document.createElement('button');
    btn.id        = 'pwaInstallBtn';
    btn.className = 'pwa-install-btn';
    const _pwa = k => (typeof I18n !== 'undefined') ? I18n.t(k) : k;
    btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:.35rem"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' + _pwa('features.install');
    btn.setAttribute('title', _pwa('features.install_title'));
    btn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') btn.remove();
      deferredPrompt = null;
    });
    const navActions = document.querySelector('.nav-actions');
    const mobileBtn  = navActions?.querySelector('.mobile-menu-btn');
    navActions?.insertBefore(btn, mobileBtn || null);
  }
})();

/* ─────────────────────────────────────────────────────────────────
   FEATURE 11 : RECHERCHE AVANCÉE — FILTRE PRIX
   Slider min/max injecté dans la section filtres
   ─────────────────────────────────────────────────────────────── */
(function() {
  let minPrice = 0;
  let maxPrice = Infinity;

  function getPriceRange() {
    const prices = Array.from(document.querySelectorAll('.p-card:not(.p-card-request)[data-price]'))
      .map(c => parseFloat(c.dataset.price) || 0);
    return { min: Math.floor(Math.min(...prices, 0)), max: Math.ceil(Math.max(...prices, 999)) };
  }

  /* Patch applyFiltersAndSearch pour inclure le filtre prix */
  const patchFilter = () => {
    if (typeof window.applyFiltersAndSearch !== 'function') return;
    const orig = window.applyFiltersAndSearch;
    window.applyFiltersAndSearch = function() {
      orig();
      /* Re-masquer les cartes hors plage prix après le filtre texte/catégorie */
      let hiddenByPrice = 0;
      document.querySelectorAll('.p-card:not(.p-card-request)').forEach(card => {
        const p = parseFloat(card.dataset.price) || 0;
        if (p < minPrice || p > maxPrice) {
          card.style.display = 'none';
          hiddenByPrice++;
        }
      });
      /* Corriger le compteur */
      if (hiddenByPrice > 0) {
        const countEl = document.querySelector('.prod-count');
        if (countEl) {
          const n = Math.max(0, (parseInt(countEl.textContent, 10) || 0) - hiddenByPrice);
          countEl.textContent = n + ' article' + (n !== 1 ? 's' : '');
        }
      }
    };
  };

  function applyPriceFilter() {
    /* Appelle la version patchée qui gère tout */
    if (typeof window.applyFiltersAndSearch === 'function') window.applyFiltersAndSearch();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const filters = document.querySelector('.filters');
    if (!filters) return;

    patchFilter();

    const range = getPriceRange();
    minPrice = range.min;
    maxPrice = range.max;

    const _pf = k => (typeof I18n !== 'undefined') ? I18n.t(k) : k;
    const wrap = document.createElement('div');
    wrap.className = 'price-filter-wrap';
    wrap.innerHTML = `
      <div class="price-filter-label">
        <span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:.25rem"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>${_pf('features.price')}</span>
        <span class="price-filter-vals" id="pfVals">${range.min} – ${range.max} €</span>
      </div>
      <div class="price-filter-sliders">
        <input type="range" class="pf-slider" id="pfMin"
          min="${range.min}" max="${range.max}" value="${range.min}" step="1">
        <input type="range" class="pf-slider" id="pfMax"
          min="${range.min}" max="${range.max}" value="${range.max}" step="1">
      </div>
      <button class="pf-reset" id="pfReset">${_pf('features.reset')}</button>`;

    filters.insertAdjacentElement('afterend', wrap);

    const pfMin   = document.getElementById('pfMin');
    const pfMax   = document.getElementById('pfMax');
    const pfVals  = document.getElementById('pfVals');
    const pfReset = document.getElementById('pfReset');

    function onSlide() {
      let lo = parseInt(pfMin.value, 10);
      let hi = parseInt(pfMax.value, 10);
      if (lo > hi) { const tmp = lo; lo = hi; hi = tmp; pfMin.value = lo; pfMax.value = hi; }
      minPrice = lo;
      maxPrice = hi;
      pfVals.textContent = `${lo} – ${hi} €`;
      const active = lo > range.min || hi < range.max;
      wrap.classList.toggle('pf-active', active);
      applyPriceFilter();
    }

    pfMin.addEventListener('input', onSlide);
    pfMax.addEventListener('input', onSlide);
    pfReset.addEventListener('click', () => {
      pfMin.value = range.min;
      pfMax.value = range.max;
      minPrice    = range.min;
      maxPrice    = range.max;
      pfVals.textContent = `${range.min} – ${range.max} €`;
      wrap.classList.remove('pf-active');
      /* Nettoyer le flag prix */
      document.querySelectorAll('[data-price-hidden]').forEach(c => delete c.dataset.priceHidden);
      if (typeof applyFiltersAndSearch === 'function') applyFiltersAndSearch();
    });
  });
})();

/* ─────────────────────────────────────────────────────────────────
   FEATURE : BUNDLES (PACKS PRODUITS)
   Charge /api/bundles et injecte une section Pack sous la grille
   ─────────────────────────────────────────────────────────────── */
(function() {
  const STYLE = `
    .bundles-section { margin: 2rem 0 1rem; }
    .bundles-section h3 { font-size: 1rem; font-weight: 700; color: #3e2a14; margin-bottom: 1rem; display:flex;align-items:center;gap:.5rem; }
    .bundles-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; }
    .bundle-offer { background:#fff; border:2px solid #d9c4a0; border-radius:16px; padding:1.1rem 1.2rem; display:flex; flex-direction:column; gap:.75rem; position:relative; overflow:hidden; }
    .bundle-offer::before { content:''; position:absolute; top:0; left:0; right:0; height:4px; background:linear-gradient(90deg,#3e2a14,#c8a87a); }
    .bundle-offer-badge { position:absolute; top:.75rem; right:.85rem; background:#c0392b; color:#fff; font-size:.68rem; font-weight:800; padding:.15rem .5rem; border-radius:20px; }
    .bundle-offer-name { font-weight: 700; font-size:.95rem; color:#1a1a1a; margin-right:3rem; }
    .bundle-offer-products { display:flex; flex-wrap:wrap; gap:.4rem; }
    .bundle-prod-chip { background:#f5f0e8; border-radius:6px; padding:.2rem .55rem; font-size:.75rem; color:#3e2a14; font-weight:600; }
    .bundle-offer-price { display:flex; align-items:baseline; gap:.5rem; }
    .bundle-price-old { color:#bbb; font-size:.82rem; text-decoration:line-through; }
    .bundle-price-new { color:#3e2a14; font-size:1.15rem; font-weight:800; }
    .bundle-price-save { color:#16a34a; font-size:.78rem; font-weight:700; }
    .bundle-atc { width:100%; padding:.7rem; background:#3e2a14; color:#d9c4a0; border:none; border-radius:50px; font-size:.88rem; font-weight:700; cursor:pointer; font-family:inherit; transition:background .2s,transform .15s; }
    .bundle-atc:hover { background:#2a1c0d; transform:translateY(-1px); }
    .bundle-atc.added { background:#16a34a; }
  `;

  function injectStyles() {
    if (document.getElementById('bundle-styles')) return;
    const s = document.createElement('style');
    s.id = 'bundle-styles';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  function fmtPrice(n) { return n.toFixed(2).replace('.', ',') + ' €'; }

  function addBundleToCart(bundle, products) {
    const btn = document.getElementById('bundle-btn-' + bundle.id);
    if (btn) { btn.textContent = I18n.t('product.added'); btn.classList.add('added'); setTimeout(() => { btn.textContent = I18n.t('product.add_to_cart'); btn.classList.remove('added'); }, 2500); }
    products.forEach(p => {
      if (!window.Cart) return;
      Cart.add({ id: p.id, name: p.name, emoji: p.emoji || '📦', price: p.discountedPrice, weightG: p.weightG || 200 });
    });
  }

  async function initBundles() {
    const grid = document.querySelector('.products-grid');
    if (!grid) return;

    try {
      const r = await fetch('/api/bundles');
      const d = await r.json();
      if (!d.ok || !d.bundles.length) return;

      /* Récupère les IDs de produits présents sur la page */
      const pageIds = new Set([...document.querySelectorAll('.p-card[data-id]')].map(c => c.dataset.id));

      /* Filtre les bundles dont tous les produits sont sur cette page */
      const relevant = d.bundles.filter(b => b.productIds.every(id => pageIds.has(id)));
      if (!relevant.length) return;

      injectStyles();

      /* Récupère les infos produits depuis les cartes DOM */
      function getProductInfo(id) {
        const card = document.querySelector(`.p-card[data-id="${id}"]`);
        if (!card) return null;
        const price = parseFloat(card.dataset.price) || 0;
        return {
          id,
          name: card.querySelector('.p-name')?.textContent?.trim() || id,
          emoji: card.querySelector('.p-img > span:first-child')?.textContent || '📦',
          price,
          weightG: parseInt(card.dataset.weight, 10) || 200,
        };
      }

      const section = document.createElement('div');
      section.className = 'bundles-section';
      const _bn = k => (typeof I18n !== 'undefined') ? I18n.t(k) : k;
      section.innerHTML = `<h3>${_bn('features.bundles_title')}</h3><div class="bundles-grid" id="bundles-grid-inner"></div>`;
      grid.insertAdjacentElement('afterend', section);
      const inner = section.querySelector('#bundles-grid-inner');

      relevant.forEach(bundle => {
        const products = bundle.productIds.map(getProductInfo).filter(Boolean);
        if (products.length < 2) return;

        const totalOriginal   = products.reduce((s, p) => s + p.price, 0);
        const totalDiscounted = totalOriginal * (1 - bundle.discount / 100);
        const saving          = totalOriginal - totalDiscounted;

        products.forEach(p => { p.discountedPrice = +(p.price * (1 - bundle.discount / 100)).toFixed(2); });

        const card = document.createElement('div');
        card.className = 'bundle-offer';
        card.innerHTML = `
          <span class="bundle-offer-badge">−${bundle.discount}%</span>
          <div class="bundle-offer-name">${bundle.name}</div>
          <div class="bundle-offer-products">
            ${products.map(p => `<span class="bundle-prod-chip">${p.emoji} ${p.name}</span>`).join('')}
          </div>
          <div class="bundle-offer-price">
            <span class="bundle-price-old">${fmtPrice(totalOriginal)}</span>
            <span class="bundle-price-new">${fmtPrice(totalDiscounted)}</span>
            <span class="bundle-price-save">${_bn('features.bundle_save').replace('{{price}}', fmtPrice(saving))}</span>
          </div>
          <button class="bundle-atc" id="bundle-btn-${bundle.id}" onclick="void 0">
            ${_bn('features.bundle_add')}
          </button>`;

        card.querySelector('.bundle-atc').addEventListener('click', () => addBundleToCart(bundle, products));
        inner.appendChild(card);
      });

    } catch { /* silencieux */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBundles);
  } else {
    initBundles();
  }
})();

/* ─────────────────────────────────────────────────────────────────
   FEATURE : SYNC PANIER ABANDONNÉ
   Envoie l'état du panier au serveur quand l'utilisateur est connecté
   ─────────────────────────────────────────────────────────────── */
(function() {
  let _syncTimer = null;

  function syncCart() {
    const token = localStorage.getItem('leclam_token');
    if (!token) return; /* pas connecté — rien à faire */
    const items = JSON.parse(localStorage.getItem('leclam_cart') || '[]');
    const total = items.reduce((s, i) => s + (i.price || 0) * (i.qty || 1), 0);

    fetch('/api/cart/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
        'X-CSRF-Token': localStorage.getItem('leclam_csrf') || '',
      },
      body: JSON.stringify({ items, total }),
    }).catch(() => {}); /* silencieux */
  }

  function scheduleSync() {
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(syncCart, 3000); /* debounce 3s après dernière modif */
  }

  /* Écoute les changements localStorage (panier modifié) */
  window.addEventListener('storage', e => {
    if (e.key === 'leclam_cart') scheduleSync();
  });

  /* Écoute les clics "Ajouter au panier" sur la même page */
  document.addEventListener('click', e => {
    if (e.target.closest('.p-atc, .js-atc, [onclick*="addToCart"], .bundle-atc')) {
      scheduleSync();
    }
  });

  /* Sync initiale au chargement (pour détecter un panier déjà en cours) */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(syncCart, 5000));
  } else {
    setTimeout(syncCart, 5000);
  }
})();
