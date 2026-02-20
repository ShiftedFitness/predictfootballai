/**
 * TeleStats Navigation Component
 * Renders a consistent nav bar across all pages.
 *
 * Requires: ts-auth.js loaded first.
 *
 * Usage: TSNav.render()  — call after TSAuth.init()
 */

(function () {
  'use strict';

  const LOGO_URL = 'https://res.cloudinary.com/dbfvogb95/image/upload/v1770835428/Screenshot_2026-02-11_at_19.43.16_m7urul.png';

  const NAV_LINKS = [
    { label: 'Home', href: '/', match: (p) => p === '/' || p === '/index.html' },
    { label: 'Games', href: '/games/', match: (p) => p.startsWith('/games') },
    { label: 'Leaderboard', href: '/leaderboard/', match: (p) => p.startsWith('/leaderboard') },
    { label: 'Community', href: '/community/', match: (p) => p.startsWith('/community') }
  ];

  function esc(s) {
    return String(s).replace(/[&<>"']/g, m =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  function levelBadgeHTML(level, levelName) {
    const colors = {
      1: '#6F7A83', 2: '#9BA7B0', 3: '#00E5FF', 4: '#00B8D4',
      5: '#32FF7E', 6: '#FFD60A', 7: '#FF9F1C', 8: '#FF2E9F',
      9: '#E05555', 10: '#FFD60A'
    };
    const color = colors[level] || '#6F7A83';
    return `<span class="ts-level-badge" style="border-color:${color};color:${color}" title="${esc(levelName)}">${level}</span>`;
  }

  const TSNav = {
    /**
     * Render the navigation bar.
     * Replaces any existing .ts-header or .ts-nav elements.
     */
    render() {
      // Remove old nav/header
      document.querySelectorAll('.ts-nav, .ts-header').forEach(el => el.remove());

      const user = TSAuth.getUser();
      const path = location.pathname;
      const isAnon = TSAuth.isAnonymous();

      const linksHTML = NAV_LINKS.map(link => {
        const active = link.match(path) ? ' active' : '';
        return `<a href="${link.href}" class="ts-nav-link${active}">${link.label}</a>`;
      }).join('');

      let rightHTML;
      if (isAnon) {
        // Anonymous: single "Get Started" button
        rightHTML = `
          <div class="ts-nav-auth">
            <button class="ts-nav-login-btn" id="tsNavLoginBtn" style="background:var(--accent-yellow);color:#0B0F12;border:none;font-weight:700;padding:6px 16px;border-radius:6px;cursor:pointer;font-size:13px;">Get Started</button>
          </div>`;
      } else {
        const xp = TSAuth.getXPProgress();
        const isPaid = user.tier === 'paid';
        rightHTML = `
          <a href="/profile/" class="ts-nav-profile">
            ${levelBadgeHTML(xp.level, xp.levelName)}
            <span class="ts-nav-username">${esc(user.username || user.display_name || user.email || 'Player')}</span>
            <span class="ts-nav-xp">${(user.total_xp || 0).toLocaleString()} XP</span>
          </a>
          ${!isPaid ? '<a href="/upgrade/" class="ts-nav-pro-btn" title="Upgrade to Pro">PRO</a>' : ''}
          <button class="ts-nav-logout-btn" id="tsNavLogoutBtn" title="Log out">&#x2715;</button>`;
      }

      const nav = document.createElement('nav');
      nav.className = 'ts-nav';
      nav.innerHTML = `
        <div class="ts-nav-inner">
          <a href="/" class="ts-nav-brand">
            <img src="${LOGO_URL}" alt="TeleStats" class="ts-nav-logo"/>
          </a>
          <div class="ts-nav-links">${linksHTML}</div>
          <div class="ts-nav-right">${rightHTML}</div>
          <button class="ts-nav-hamburger" id="tsNavHamburger" aria-label="Menu">
            <span></span><span></span><span></span>
          </button>
        </div>
        <div class="ts-nav-mobile" id="tsNavMobile">
          ${linksHTML}
          ${isAnon
            ? '<a href="#" class="ts-nav-link" id="tsNavMobileLogin">Get Started</a>'
            : `<a href="/profile/" class="ts-nav-link">Profile</a>${user.tier !== 'paid' ? '<a href="/upgrade/" class="ts-nav-link" style="color:var(--accent-yellow)">Upgrade to Pro</a>' : ''}<a href="#" class="ts-nav-link" id="tsNavMobileLogout">Log Out</a>`
          }
        </div>`;

      document.body.prepend(nav);

      // Hamburger toggle
      const hamburger = document.getElementById('tsNavHamburger');
      const mobileMenu = document.getElementById('tsNavMobile');
      if (hamburger) {
        hamburger.addEventListener('click', () => {
          nav.classList.toggle('mobile-open');
        });
      }

      // Login button — show modal
      const loginBtn = document.getElementById('tsNavLoginBtn');
      const mobileLoginBtn = document.getElementById('tsNavMobileLogin');
      [loginBtn, mobileLoginBtn].forEach(btn => {
        if (btn) btn.addEventListener('click', (e) => { e.preventDefault(); TSNav.showAuthModal(); });
      });

      // Logout
      const logoutBtn = document.getElementById('tsNavLogoutBtn');
      const mobileLogoutBtn = document.getElementById('tsNavMobileLogout');
      [logoutBtn, mobileLogoutBtn].forEach(btn => {
        if (btn) btn.addEventListener('click', (e) => { e.preventDefault(); TSAuth.signOut(); });
      });

      // ── PWA: Register service worker ──
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
      }

      // ── PWA: Inject manifest + theme-color if not present ──
      if (!document.querySelector('link[rel="manifest"]')) {
        const ml = document.createElement('link');
        ml.rel = 'manifest';
        ml.href = '/manifest.json';
        document.head.appendChild(ml);
      }
      if (!document.querySelector('meta[name="theme-color"]')) {
        const tc = document.createElement('meta');
        tc.name = 'theme-color';
        tc.content = '#00E5FF';
        document.head.appendChild(tc);
      }
      if (!document.querySelector('link[rel="apple-touch-icon"]')) {
        const ati = document.createElement('link');
        ati.rel = 'apple-touch-icon';
        ati.href = '/icons/icon-192.svg';
        document.head.appendChild(ati);
      }

      // ── PWA: Install prompt ──
      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        const deferredPrompt = e;
        // Only show once per session
        if (sessionStorage.getItem('ts_install_dismissed')) return;

        const banner = document.createElement('div');
        banner.className = 'ts-install-banner';
        banner.innerHTML = `
          <span style="flex:1;font-size:13px;">Install TeleStats for quick access</span>
          <button id="tsInstallBtn" style="background:var(--accent-yellow);color:#0B0F12;border:none;padding:6px 14px;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer;">Install</button>
          <button id="tsInstallDismiss" style="background:none;border:none;color:var(--text-muted);font-size:18px;cursor:pointer;padding:0 4px;">&times;</button>`;
        banner.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 16px;background:var(--bg-card,#171F25);border-bottom:1px solid rgba(255,255,255,0.06);font-family:Inter,sans-serif;';
        nav.after(banner);

        document.getElementById('tsInstallBtn')?.addEventListener('click', async () => {
          deferredPrompt.prompt();
          await deferredPrompt.userChoice;
          banner.remove();
        });
        document.getElementById('tsInstallDismiss')?.addEventListener('click', () => {
          banner.remove();
          sessionStorage.setItem('ts_install_dismissed', '1');
        });
      });
    },

    /** Show login/signup modal — context-aware */
    showAuthModal(mode = 'login') {
      const user = TSAuth.getUser();
      const isAnon = TSAuth.isAnonymous();

      // If free user triggers signup, redirect to upgrade page
      if (!isAnon && user && user.tier === 'free' && mode === 'signup') {
        window.location.href = '/upgrade/';
        return;
      }
      // If paid user, redirect to profile
      if (!isAnon && user && user.tier === 'paid') {
        window.location.href = '/profile/';
        return;
      }

      // Remove existing
      const existing = document.getElementById('tsAuthModal');
      if (existing) existing.remove();

      const modal = document.createElement('div');
      modal.id = 'tsAuthModal';
      modal.className = 'ts-modal-overlay';
      modal.innerHTML = `
        <div class="ts-modal">
          <button class="ts-modal-close" id="tsAuthClose">&times;</button>
          <div class="ts-modal-tabs">
            <button class="ts-tab ${mode === 'login' ? 'active' : ''}" data-tab="login">Log In</button>
            <button class="ts-tab ${mode === 'signup' ? 'active' : ''}" data-tab="signup">Sign Up</button>
          </div>

          <div class="ts-tab-panel ${mode === 'login' ? 'active' : ''}" id="tsLoginPanel">
            <form id="tsLoginForm">
              <input type="email" placeholder="Email" required class="ts-input" id="tsLoginEmail"/>
              <input type="password" placeholder="Password" required class="ts-input" id="tsLoginPassword"/>
              <button type="submit" class="btn-primary ts-btn">Log In</button>
              <div class="ts-divider-text"><span>or</span></div>
              <button type="button" class="btn-secondary ts-btn" id="tsMagicLinkBtn">Send Magic Link</button>
              <div class="ts-auth-msg" id="tsLoginMsg"></div>
            </form>
          </div>

          <div class="ts-tab-panel ${mode === 'signup' ? 'active' : ''}" id="tsSignupPanel">
            <form id="tsSignupForm">
              <input type="text" placeholder="Username" required class="ts-input" id="tsSignupUsername" minlength="3" maxlength="20" pattern="[a-zA-Z0-9_]+"/>
              <input type="email" placeholder="Email" required class="ts-input" id="tsSignupEmail"/>
              <input type="password" placeholder="Password (6+ chars)" required class="ts-input" id="tsSignupPassword" minlength="6"/>
              <button type="submit" class="btn-primary ts-btn">Create Account</button>
              <p class="ts-auth-note">Your anonymous game progress will be saved to your new account.</p>
              <div class="ts-auth-msg" id="tsSignupMsg"></div>
              <div style="margin-top:12px;text-align:center;">
                <a href="/upgrade/#promo" style="color:var(--accent-cyan);font-size:12px;text-decoration:none;">Have a promo code?</a>
              </div>
            </form>
          </div>
        </div>`;

      document.body.appendChild(modal);

      // Tab switching
      modal.querySelectorAll('.ts-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          modal.querySelectorAll('.ts-tab').forEach(t => t.classList.remove('active'));
          modal.querySelectorAll('.ts-tab-panel').forEach(p => p.classList.remove('active'));
          tab.classList.add('active');
          document.getElementById(tab.dataset.tab === 'login' ? 'tsLoginPanel' : 'tsSignupPanel').classList.add('active');
        });
      });

      // Close
      document.getElementById('tsAuthClose').addEventListener('click', () => modal.remove());
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

      // Login form
      document.getElementById('tsLoginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = document.getElementById('tsLoginMsg');
        msg.textContent = 'Logging in...';
        msg.className = 'ts-auth-msg';
        const result = await TSAuth.signIn(
          document.getElementById('tsLoginEmail').value,
          document.getElementById('tsLoginPassword').value
        );
        if (result.error) { msg.textContent = result.error; msg.className = 'ts-auth-msg error'; }
        else { modal.remove(); location.reload(); }
      });

      // Magic link
      document.getElementById('tsMagicLinkBtn').addEventListener('click', async () => {
        const email = document.getElementById('tsLoginEmail').value;
        const msg = document.getElementById('tsLoginMsg');
        if (!email) { msg.textContent = 'Enter your email first'; msg.className = 'ts-auth-msg error'; return; }
        msg.textContent = 'Sending...';
        const result = await TSAuth.signInMagicLink(email);
        if (result.error) { msg.textContent = result.error; msg.className = 'ts-auth-msg error'; }
        else { msg.textContent = 'Check your email for the magic link!'; msg.className = 'ts-auth-msg success'; }
      });

      // Signup form
      document.getElementById('tsSignupForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = document.getElementById('tsSignupMsg');
        msg.textContent = 'Creating account...';
        msg.className = 'ts-auth-msg';
        const result = await TSAuth.signUp(
          document.getElementById('tsSignupEmail').value,
          document.getElementById('tsSignupPassword').value,
          document.getElementById('tsSignupUsername').value
        );
        if (result.error) { msg.textContent = result.error; msg.className = 'ts-auth-msg error'; }
        else { modal.remove(); location.reload(); }
      });
    },

    /**
     * Show the play limit reached overlay.
     * @param {string} gameType
     */
    showPlayLimitOverlay(gameType) {
      const existing = document.getElementById('tsPlayLimitOverlay');
      if (existing) existing.remove();

      const isAnon = TSAuth.isAnonymous();
      const overlay = document.createElement('div');
      overlay.id = 'tsPlayLimitOverlay';
      overlay.className = 'ts-modal-overlay';
      overlay.innerHTML = `
        <div class="ts-modal ts-limit-modal">
          <h2>Daily Limit Reached</h2>
          <p>${isAnon
            ? 'Anonymous users get 3 plays per day. Create a free account to get 5 plays per game!'
            : 'You\'ve used all your plays for today. Upgrade to unlimited or invite friends!'
          }</p>
          <div class="ts-limit-actions">
            ${isAnon
              ? '<button class="btn-primary ts-btn" id="tsLimitSignup">Create Free Account</button>'
              : '<a href="/upgrade/" class="btn-primary ts-btn">Upgrade — £4.99</a>'
            }
            <button class="btn-secondary ts-btn" id="tsLimitClose">Back to Games</button>
          </div>
        </div>`;

      document.body.appendChild(overlay);

      if (isAnon) {
        document.getElementById('tsLimitSignup').addEventListener('click', () => {
          overlay.remove();
          TSNav.showAuthModal('signup');
        });
      }
      document.getElementById('tsLimitClose').addEventListener('click', () => {
        overlay.remove();
        window.location.href = '/games/';
      });
    },

    /**
     * Show XP earned toast after a game.
     * @param {Object} xpResult - from logGameSession
     */
    showXPToast(xpResult) {
      if (!xpResult || xpResult.error) return;

      const toast = document.createElement('div');
      toast.className = 'ts-xp-toast';

      let html = `<div class="ts-xp-amount">+${xpResult.xp_earned} XP</div>`;
      if (xpResult.streak_bonus > 0) {
        html += `<div class="ts-xp-streak">\uD83D\uDD25 Streak bonus +${xpResult.streak_bonus}</div>`;
      }
      if (xpResult.levelled_up) {
        html += `<div class="ts-xp-levelup">\u2B50 Level Up! ${xpResult.new_level_name}</div>`;
      }

      toast.innerHTML = html;
      document.body.appendChild(toast);

      // Animate in
      requestAnimationFrame(() => toast.classList.add('show'));

      // Remove after 3s
      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
      }, 3000);
    },

    /**
     * Show share card after a game.
     * @param {Object} result - Game result data
     */
    showShareCard(result) {
      const existing = document.getElementById('tsShareCard');
      if (existing) existing.remove();

      const text = TSData.generateShareText(result);
      const card = document.createElement('div');
      card.id = 'tsShareCard';
      card.className = 'ts-share-card';
      card.innerHTML = `
        <pre class="ts-share-text">${esc(text)}</pre>
        <div class="ts-share-actions">
          <button class="btn-primary ts-btn ts-share-btn" id="tsShareBtn">
            ${navigator.share ? 'Share' : 'Copy to Clipboard'}
          </button>
        </div>`;

      // Find the results area or append to body
      const resultsArea = document.getElementById('step3') || document.querySelector('.results') || document.body;
      resultsArea.appendChild(card);

      document.getElementById('tsShareBtn').addEventListener('click', async () => {
        const btn = document.getElementById('tsShareBtn');
        const res = await TSData.shareResult(result);
        if (res.shared) btn.textContent = 'Shared!';
        else if (res.copied) btn.textContent = 'Copied!';
        else btn.textContent = 'Failed';
        setTimeout(() => btn.textContent = navigator.share ? 'Share' : 'Copy to Clipboard', 2000);
      });
    }
  };

  window.TSNav = TSNav;
})();
