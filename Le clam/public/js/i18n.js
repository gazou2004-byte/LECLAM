/* ── Le Clam — Internationalisation ─────────────────────────────────
   Inclure AVANT app.js sur chaque page.
   Langues supportées : fr (défaut), en
   Usage : t('clé.sous.clé')  — window.t est disponible immédiatement.
   Changement de langue : i18n.setLang('en')  (reload automatique)
──────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const SUPPORTED = ['fr', 'en'];
  const DEFAULT   = 'fr';

  /* ── Détection de la langue ── */
  const _lang = (function () {
    const s = localStorage.getItem('leclam_lang');
    if (s && SUPPORTED.includes(s)) return s;
    const b = (navigator.language || navigator.userLanguage || '').slice(0, 2).toLowerCase();
    return SUPPORTED.includes(b) ? b : DEFAULT;
  }());

  /* ── Chargement synchrone des traductions (fichiers ~5 Ko, cache navigateur) ── */
  let _tr = {};
  (function () {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', '/js/locales/' + _lang + '.json', false);
      xhr.send(null);
      if (xhr.status === 200) { _tr = JSON.parse(xhr.responseText); return; }
    } catch (_) {}
    /* Fallback FR */
    if (_lang !== DEFAULT) {
      try {
        const xhr2 = new XMLHttpRequest();
        xhr2.open('GET', '/js/locales/' + DEFAULT + '.json', false);
        xhr2.send(null);
        if (xhr2.status === 200) _tr = JSON.parse(xhr2.responseText);
      } catch (_) {}
    }
  }());

  /* ── Résolution de clé "a.b.c" ── */
  function t(key, vars) {
    const val = String(key).split('.').reduce(function (o, k) {
      return (o && o[k] !== undefined && o[k] !== null) ? o[k] : undefined;
    }, _tr);
    let str = (val !== undefined) ? String(val) : key;
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        str = str.split('{{' + k + '}}').join(String(vars[k]));
      });
    }
    return str;
  }

  /* ── Application des data-i18n dans le DOM ── */
  function apply(root) {
    var el, els, i;
    root = root || document;
    els = root.querySelectorAll('[data-i18n]');
    for (i = 0; i < els.length; i++) {
      el = els[i];
      el.textContent = t(el.getAttribute('data-i18n'));
    }
    els = root.querySelectorAll('[data-i18n-html]');
    for (i = 0; i < els.length; i++) {
      el = els[i];
      el.innerHTML = t(el.getAttribute('data-i18n-html'));
    }
    els = root.querySelectorAll('[data-i18n-ph]');
    for (i = 0; i < els.length; i++) {
      el = els[i];
      el.placeholder = t(el.getAttribute('data-i18n-ph'));
    }
    els = root.querySelectorAll('[data-i18n-aria]');
    for (i = 0; i < els.length; i++) {
      el = els[i];
      el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
    }
    els = root.querySelectorAll('[data-i18n-title]');
    for (i = 0; i < els.length; i++) {
      el = els[i];
      el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    }
  }

  /* ── Changement de langue (reload) ── */
  function setLang(lang) {
    if (!SUPPORTED.includes(lang)) return;
    localStorage.setItem('leclam_lang', lang);
    location.reload();
  }

  /* ── Injection du sélecteur de langue dans la navbar ── */
  function _injectSwitcher() {
    var navActions = document.querySelector('.nav-actions');
    if (!navActions || document.getElementById('langSwitcher')) return;
    var sw = document.createElement('div');
    sw.id = 'langSwitcher';
    sw.style.cssText = 'display:flex;align-items:center;gap:2px;margin-right:.2rem';
    sw.innerHTML = SUPPORTED.map(function (l) {
      var active = l === _lang;
      return '<button onclick="i18n.setLang(\'' + l + '\')" ' +
        'style="padding:.18rem .42rem;border-radius:5px;border:1.5px solid ' +
        (active ? '#3e2a14' : 'transparent') + ';background:' +
        (active ? '#f0e8d8' : 'transparent') + ';color:' +
        (active ? '#3e2a14' : '#aaa') + ';font-size:.68rem;font-weight:700;cursor:pointer;' +
        'font-family:inherit;letter-spacing:.05em;transition:all .15s;line-height:1"' +
        (active ? ' disabled' : '') + '>' + l.toUpperCase() + '</button>';
    }).join('');
    var mobileBtn = navActions.querySelector('.mobile-menu-btn');
    navActions.insertBefore(sw, mobileBtn || null);
  }

  /* ── Init ── */
  document.documentElement.lang = _lang;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      apply();
      _injectSwitcher();
    });
  } else {
    apply();
    _injectSwitcher();
  }

  /* ── API publique ── */
  window.t = t;
  window.i18n = {
    t: t,
    setLang: setLang,
    apply: apply,
    get lang() { return _lang; },
    supported: SUPPORTED
  };

}());
