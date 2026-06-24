/* products-render.js — Rendu dynamique des grilles produits Le Clam
   S'exécute synchronement en bas du body (DOM déjà parsé).
   Dépend de products-data.js (window.PRODUCTS_DATA) chargé avant. */
(function () {
  'use strict';

  var SVG_HEART = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
  var SVG_PREV  = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
  var SVG_NEXT  = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';

  function fmtPrice(p) {
    return p.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }

  function escAttr(s) {
    return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function buildCard(p) {
    /* ── Attributs data- du wrapper ── */
    var attrs = 'data-id="' + p.id + '" data-price="' + p.price + '"';
    if (p.oldPrice != null)  attrs += ' data-old-price="' + p.oldPrice + '"';
    attrs += ' data-filter="' + escAttr(p.filter) + '"';
    if (p.famille)           attrs += ' data-famille="'    + escAttr(p.famille)    + '"';
    if (p.subfamille)        attrs += ' data-subfamille="' + escAttr(p.subfamille) + '"';
    if (p.rating  != null)   attrs += ' data-rating="'    + p.rating    + '"';
    if (p.reviews != null)   attrs += ' data-reviews="'   + p.reviews   + '"';
    if (p.weight  != null)   attrs += ' data-weight="'    + p.weight    + '"';
    if (p.desc)              attrs += ' data-desc="'      + escAttr(p.desc) + '"';

    /* ── Galerie images ── */
    var imgs = p.images.map(function (src) {
      return '<img src="' + escAttr(src) + '" alt="' + escAttr(p.name_fr || '') + '" loading="lazy">';
    }).join('');

    var multi = p.images.length > 1;
    var dots  = '';
    if (multi) {
      for (var i = 0; i < p.images.length; i++) {
        dots += '<button class="p-gal-dot' + (i === 0 ? ' active' : '') + '"></button>';
      }
    }
    var nav = multi
      ? '<button class="p-gal-btn p-gal-prev" aria-label="Photo précédente" data-i18n="product.photo_prev" data-i18n-attr="aria-label">' + SVG_PREV + '</button>'
      + '<button class="p-gal-btn p-gal-next" aria-label="Photo suivante" data-i18n="product.photo_next" data-i18n-attr="aria-label">' + SVG_NEXT + '</button>'
      + '<div class="p-gal-dots">' + dots + '</div>'
      : '';

    /* ── Textes (fallback FR, I18n remplace au chargement) ── */
    var name = p.name_fr || '';
    var sub  = p.sub_fr  || '';

    return '<div class="p-card" ' + attrs + '>'
      + '<div class="p-img"><div class="p-gallery">'
      + '<div class="p-gallery-track">' + imgs + '</div>'
      + nav
      + '</div>'
      + '<button class="p-wish">' + SVG_HEART + '</button>'
      + '</div>'
      + '<div class="p-info">'
      + '<div class="p-name" data-i18n="products.' + p.id + '_name">' + escAttr(name) + '</div>'
      + '<div class="p-sub"  data-i18n="products.' + p.id + '_sub">'  + escAttr(sub)  + '</div>'
      + '<div class="p-foot"><div><span class="p-price">' + fmtPrice(p.price) + '</span></div>'
      + '<button class="atc-btn" onclick="addToCart(this)" data-i18n="product.add">Ajouter</button>'
      + '</div></div></div>';
  }

  function renderCategory(category, gridId) {
    var data = window.PRODUCTS_DATA;
    if (!data || !data[category] || !data[category].length) return;
    var grid = document.getElementById(gridId) || document.querySelector('.products-grid');
    if (!grid) return;

    var html = data[category].map(buildCard).join('');
    grid.insertAdjacentHTML('beforeend', html);
  }

  window.renderCategory = renderCategory;

  /* Auto-détection et rendu immédiat (scripts en bas du body = DOM disponible) */
  var cls = document.body ? document.body.className : '';
  var cat = cls.indexOf('page-plaisir') >= 0 ? 'plaisir'
          : cls.indexOf('page-malin')   >= 0 ? 'malin'
          : cls.indexOf('page-bebe')    >= 0 ? 'bebe'
          : null;
  if (cat) renderCategory(cat, 'productsGrid');

})();
