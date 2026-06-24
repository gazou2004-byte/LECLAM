/* chatbot.js — FAQ bulle flottante Le Clam */
(function () {
  'use strict';

  function _t(k) { return (typeof I18n !== 'undefined') ? I18n.t(k) : k; }

  function getFAQ() {
    return [
      { q: ['livraison', 'délai', 'quand', 'combien de temps', 'expédition', 'recevoir', 'delivery', 'shipping', 'Lieferung', 'consegna', 'entrega'], a: _t('chatbot.ans_delivery') },
      { q: ['retour', 'remboursement', 'rembourser', 'retourner', 'satisfait', 'insatisfait', 'return', 'refund', 'Rücksendung', 'reso', 'reembolso'], a: _t('chatbot.ans_returns') },
      { q: ['paiement', 'payer', 'carte', 'virement', 'sepa', 'paypal', 'crypto', 'bitcoin', 'payment', 'Zahlung', 'pagamento', 'pago'], a: _t('chatbot.ans_payment') },
      { q: ['suivi', 'suivre', 'colis', 'numéro de suivi', 'track', 'où est', 'tracking', 'Sendung', 'tracciamento', 'seguimiento'], a: _t('chatbot.ans_tracking') },
      { q: ['promo', 'code promo', 'réduction', 'remise', 'coupon', 'parrain'], a: _t('chatbot.ans_promo') },
      { q: ['compte', 'mot de passe', 'connexion', 'se connecter', 'inscription', 'créer un compte', 'account', 'login', 'Konto', 'account', 'cuenta'], a: _t('chatbot.ans_account') },
      { q: ['contact', 'joindre', 'aide', 'problème', 'question', 'support', 'email', 'mail', 'help', 'Hilfe', 'aiuto', 'ayuda'], a: _t('chatbot.ans_contact') },
      { q: ['stock', 'disponible', 'disponibilité', 'rupture', 'availability', 'Lager', 'disponibile', 'disponible'], a: _t('chatbot.ans_stock') },
      { q: ['anniversaire', 'cadeau anniversaire', 'promo anniversaire', 'birthday'], a: _t('chatbot.ans_birthday') },
      { q: ['bundle', 'pack', 'offre groupée', 'groupé'], a: _t('chatbot.ans_bundle') },
    ];
  }

  function matchFaq(input) {
    const text = input.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    let best = null, bestScore = 0;
    for (const entry of getFAQ()) {
      const score = entry.q.reduce((s, kw) => {
        const k = kw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        return s + (text.includes(k) ? 1 : 0);
      }, 0);
      if (score > bestScore) { bestScore = score; best = entry; }
    }
    return bestScore > 0 ? best.a : null;
  }

  /* ── Styles ── */
  const style = document.createElement('style');
  style.textContent = `
    #clam-chat-bubble { position:fixed; bottom:1.5rem; right:1.5rem; z-index:9999; }
    #clam-chat-btn { width:56px; height:56px; border-radius:50%; background:#3e2a14; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; box-shadow:0 4px 16px rgba(62,42,20,.35); transition:transform .18s; }
    #clam-chat-btn:hover { transform:scale(1.08); }
    #clam-chat-btn svg { width:26px; height:26px; }
    #clam-chat-notif { position:absolute; top:-4px; right:-4px; width:18px; height:18px; background:#e8608a; border-radius:50%; border:2px solid #fff; display:none; }
    #clam-chat-win { position:fixed; bottom:5rem; right:1.5rem; width:340px; max-width:calc(100vw - 2rem); background:#fff; border-radius:16px; box-shadow:0 8px 40px rgba(0,0,0,.16); border:1.5px solid #ede8e0; display:none; flex-direction:column; overflow:hidden; z-index:9998; max-height:500px; }
    #clam-chat-win.open { display:flex; }
    #clam-chat-head { background:#3e2a14; color:#d9c4a0; padding:.9rem 1.1rem; display:flex; justify-content:space-between; align-items:center; flex-shrink:0; }
    #clam-chat-head-title { font-weight:700; font-size:.9rem; }
    #clam-chat-head-sub { font-size:.7rem; opacity:.7; margin-top:.1rem; }
    #clam-chat-close { background:none; border:none; color:#d9c4a0; cursor:pointer; font-size:1.1rem; line-height:1; padding:.2rem; }
    #clam-chat-msgs { flex:1; overflow-y:auto; padding:.85rem; display:flex; flex-direction:column; gap:.65rem; }
    .cm-bubble { max-width:85%; padding:.6rem .85rem; border-radius:12px; font-size:.82rem; line-height:1.45; }
    .cm-bot { background:#f5f0e8; color:#1a1a1a; align-self:flex-start; border-bottom-left-radius:4px; }
    .cm-user { background:#3e2a14; color:#d9c4a0; align-self:flex-end; border-bottom-right-radius:4px; }
    .cm-chips { display:flex; flex-wrap:wrap; gap:.4rem; margin-top:.3rem; }
    .cm-chip { padding:.35rem .75rem; background:#fff; border:1.5px solid #d9c4a0; border-radius:20px; font-size:.75rem; color:#3e2a14; cursor:pointer; font-family:inherit; transition:background .15s; }
    .cm-chip:hover { background:#f5f0e8; }
    #clam-chat-foot { border-top:1px solid #eee; padding:.65rem .8rem; display:flex; gap:.5rem; flex-shrink:0; }
    #clam-chat-input { flex:1; border:1.5px solid #e0e0e0; border-radius:9px; padding:.5rem .75rem; font-size:.82rem; font-family:inherit; outline:none; }
    #clam-chat-input:focus { border-color:#3e2a14; }
    #clam-chat-send { background:#3e2a14; color:#d9c4a0; border:none; border-radius:9px; padding:.5rem .85rem; cursor:pointer; font-size:.82rem; font-weight:700; font-family:inherit; }
    #clam-chat-send:hover { background:#2a1c0d; }
  `;
  document.head.appendChild(style);

  let win, msgs, input, notif, _opened = false;

  function _initChatUI() {
    if (document.getElementById('clam-chat-bubble')) return;
    const wrap = document.createElement('div');
    wrap.id = 'clam-chat-bubble';
    wrap.innerHTML = `
      <div id="clam-chat-win">
        <div id="clam-chat-head">
          <div>
            <div id="clam-chat-head-title">${_t('chatbot.head_title')}</div>
            <div id="clam-chat-head-sub">${_t('chatbot.head_sub')}</div>
          </div>
          <button id="clam-chat-close" onclick="window._chatClose()">✕</button>
        </div>
        <div id="clam-chat-msgs"></div>
        <div id="clam-chat-foot">
          <input id="clam-chat-input" type="text" placeholder="${_t('chatbot.placeholder')}" maxlength="300">
          <button id="clam-chat-send">${_t('chatbot.send')}</button>
        </div>
      </div>
      <button id="clam-chat-btn" onclick="window._chatToggle()" aria-label="${_t('chatbot.open_assistant')}">
        <svg viewBox="0 0 24 24" fill="none" stroke="#d9c4a0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
        </svg>
        <div id="clam-chat-notif"></div>
      </button>
    `;
    document.body.appendChild(wrap);
    win   = document.getElementById('clam-chat-win');
    msgs  = document.getElementById('clam-chat-msgs');
    input = document.getElementById('clam-chat-input');
    notif = document.getElementById('clam-chat-notif');
    document.getElementById('clam-chat-send').addEventListener('click', send);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
  }

  document.addEventListener('i18nApplied', _initChatUI, { once: true });
  if (document.readyState !== 'loading') {
    setTimeout(_initChatUI, 300);
  } else {
    document.addEventListener('DOMContentLoaded', () => setTimeout(_initChatUI, 300));
  }

  function addMsg(text, side, chips) {
    const b = document.createElement('div');
    b.className = 'cm-bubble cm-' + side;
    b.textContent = text;
    msgs.appendChild(b);
    if (chips && chips.length) {
      const row = document.createElement('div');
      row.className = 'cm-chips';
      chips.forEach(c => {
        const btn = document.createElement('button');
        btn.className = 'cm-chip'; btn.textContent = c.label;
        btn.onclick = () => { addMsg(c.label, 'user'); setTimeout(() => botReply(c.label), 350); };
        row.appendChild(btn);
      });
      msgs.appendChild(row);
    }
    msgs.scrollTop = msgs.scrollHeight;
  }

  function botReply(text) {
    const answer = matchFaq(text);
    if (answer) {
      addMsg(answer, 'bot');
      addMsg(_t('chatbot.follow_up'), 'bot', [
        { label: _t('chatbot.yes_thanks') },
        { label: _t('chatbot.no_support') },
      ]);
    } else {
      addMsg(_t('chatbot.no_answer'), 'bot', [
        { label: _t('chatbot.contact_support') },
        { label: _t('chatbot.see_faq') },
      ]);
    }
  }

  function handleChipIntent(label) {
    if (label === _t('chatbot.yes_thanks')) {
      addMsg(_t('chatbot.perfect'), 'bot');
    } else if (label === _t('chatbot.no_support') || label === _t('chatbot.contact_support')) {
      addMsg(_t('chatbot.redirect_support'), 'bot');
      setTimeout(() => { window.location.href = 'mon-compte.html#support'; }, 900);
    } else if (label === _t('chatbot.see_faq')) {
      showFaqChips();
    } else {
      botReply(label);
    }
  }

  function showFaqChips() {
    addMsg(_t('chatbot.themes'), 'bot', [
      { label: _t('chatbot.faq_delivery') },
      { label: _t('chatbot.faq_returns') },
      { label: _t('chatbot.faq_payment') },
      { label: _t('chatbot.faq_tracking') },
    ]);
  }

  window._chatToggle = function () {
    if (!win) return;
    _opened = !_opened;
    win.classList.toggle('open', _opened);
    if (_opened && msgs.children.length === 0) {
      setTimeout(() => {
        addMsg(_t('chatbot.greeting'), 'bot');
        showFaqChips();
        notif.style.display = 'none';
      }, 150);
    }
  };

  window._chatClose = function () {
    _opened = false;
    if (win) win.classList.remove('open');
  };

  function send() {
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    addMsg(text, 'user');
    const knownChips = [
      _t('chatbot.yes_thanks'), _t('chatbot.no_support'), _t('chatbot.contact_support'),
      _t('chatbot.see_faq'), _t('chatbot.faq_delivery'), _t('chatbot.faq_returns'),
      _t('chatbot.faq_payment'), _t('chatbot.faq_tracking'),
    ];
    setTimeout(() => {
      if (knownChips.includes(text)) handleChipIntent(text);
      else botReply(text);
    }, 350);
  }

  /* Badge de bienvenue après 8 secondes */
  setTimeout(() => {
    if (!_opened && notif) notif.style.display = 'block';
  }, 8000);

})();
