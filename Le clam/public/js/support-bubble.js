/* ── Bulle support flottante ── */
(function () {
  /* Ne pas afficher sur la page messagerie */
  if (location.pathname.includes('messages.html')) return;

  const raw = localStorage.getItem('leclam_user');
  if (!raw) return;
  const user = JSON.parse(raw);
  if (user.role === 'admin' || user.role === 'owner') return;

  function _unreadCount() {
    try {
      const threads = JSON.parse(localStorage.getItem('leclam_threads') || '[]');
      const bcasts  = JSON.parse(localStorage.getItem('leclam_broadcasts') || '[]');
      const tu = threads.filter(t => t.userId === user.email).reduce((s, t) => s + (t.unreadClient || 0), 0);
      const bu = bcasts.filter(b => !(b.readBy || []).includes(user.email)).length;
      return tu + bu;
    } catch { return 0; }
  }

  const style = document.createElement('style');
  style.textContent = `
    #support-bubble {
      position: fixed;
      bottom: 1.5rem;
      right: 1.5rem;
      z-index: 9000;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 52px; height: 52px;
      border-radius: 50%;
      background: #3e2a14;
      color: #d9c4a0;
      box-shadow: 0 4px 20px rgba(62,42,20,.35);
      cursor: pointer;
      border: none;
      transition: transform .18s, background .15s, box-shadow .15s;
      text-decoration: none;
    }
    #support-bubble:hover {
      background: #2a1c0d;
      transform: scale(1.07);
      box-shadow: 0 6px 28px rgba(62,42,20,.45);
    }
    #support-bubble:active { transform: scale(.94); }
    #support-bubble-badge {
      position: absolute;
      top: -3px; right: -3px;
      min-width: 18px; height: 18px;
      background: #dc2626; color: #fff;
      border-radius: 20px;
      font-size: .66rem; font-weight: 800;
      display: flex; align-items: center; justify-content: center;
      padding: 0 4px;
      border: 2px solid #fff;
      pointer-events: none;
    }
    #support-bubble-tooltip {
      position: absolute;
      right: 58px; bottom: 50%;
      transform: translateY(50%);
      background: #1a1a1a; color: #fff;
      font-size: .76rem; font-weight: 600;
      padding: .38rem .75rem; border-radius: 8px;
      white-space: nowrap;
      opacity: 0; pointer-events: none;
      transition: opacity .15s;
      font-family: inherit;
    }
    #support-bubble:hover #support-bubble-tooltip { opacity: 1; }
  `;
  document.head.appendChild(style);

  const btn = document.createElement('a');
  btn.id = 'support-bubble';
  btn.href = 'messages.html';
  btn.setAttribute('aria-label', 'Support & Messages');
  btn.innerHTML = `
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
    </svg>
    <span id="support-bubble-tooltip">Support</span>
  `;
  document.body.appendChild(btn);

  function _refresh() {
    const n = _unreadCount();
    let badge = document.getElementById('support-bubble-badge');
    if (n > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.id = 'support-bubble-badge';
        btn.appendChild(badge);
      }
      badge.textContent = n > 9 ? '9+' : n;
    } else if (badge) {
      badge.remove();
    }
  }

  _refresh();
  /* Refresh badge on storage changes (other tabs) */
  window.addEventListener('storage', _refresh);
  /* Refresh periodically */
  setInterval(_refresh, 8000);
})();
