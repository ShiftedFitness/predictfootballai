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
        // Anonymous: single "Log In" button
        rightHTML = `
          <div class="ts-nav-auth">
            <button class="ts-nav-login-btn" id="tsNavLoginBtn" style="background:var(--accent-yellow);color:#0B0F12;border:none;font-weight:700;padding:6px 16px;border-radius:6px;cursor:pointer;font-size:13px;">Log In</button>
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
          ${!isPaid ? '<a href="/upgrade/" class="ts-nav-pro-btn" title="Upgrade to Pro">Get Pro</a>' : '<span class="ts-nav-pro-badge" title="Pro Member">Pro</span>'}
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
            ? '<a href="#" class="ts-nav-link" id="tsNavMobileLogin">Log In</a>'
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

      // ── Mobile install prompt (iOS + Android) ──
      this.showInstallPrompt();

      // ── Footer: database last updated ──
      this.renderFooterMeta();

      // ── Welcome screen after email confirmation ──
      if (TSAuth._justConfirmedEmail) {
        TSAuth._justConfirmedEmail = false;
        this.showWelcomeOverlay();
      }
    },

    /**
     * Show the welcome overlay for newly confirmed users.
     * Explains their entitlements and prompts upgrade.
     */
    showWelcomeOverlay() {
      const existing = document.getElementById('tsWelcomeOverlay');
      if (existing) existing.remove();

      const user = TSAuth.getUser();
      const username = user?.username || user?.display_name || 'Player';

      const welcome = document.createElement('div');
      welcome.id = 'tsWelcomeOverlay';
      welcome.className = 'ts-modal-overlay';
      welcome.innerHTML = `
        <div class="ts-modal" style="text-align:center;padding:32px 24px;max-width:420px;">
          <div style="font-size:36px;margin-bottom:12px;">\u26BD</div>
          <h2 style="font-family:'Space Mono',monospace;font-size:1.15rem;margin-bottom:4px;color:var(--accent-cyan);">Welcome, ${esc(username)}!</h2>
          <p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;line-height:1.5;">
            Your email is confirmed and your account is active.
          </p>
          <div style="background:rgba(0,229,255,.06);border:1px solid rgba(0,229,255,.12);border-radius:10px;padding:16px;margin-bottom:16px;text-align:left;">
            <div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:var(--accent-cyan);margin-bottom:8px;font-weight:700;">Your Free Plan includes:</div>
            <div style="font-size:13px;color:var(--fg);line-height:1.8;">
              \u2705 All EPL categories<br/>
              \u2705 5 plays per game per day<br/>
              \u2705 XP, levels & leaderboard<br/>
              \u2705 Community games access<br/>
              \u274C Other leagues (La Liga, Bundesliga, etc.)<br/>
              \u274C Unlimited plays
            </div>
          </div>
          <div style="display:flex;gap:8px;justify-content:center;">
            <button id="tsWelcomePlay" class="btn-primary ts-btn" style="flex:1;max-width:160px;">Start Playing</button>
            <a href="/upgrade/" class="btn-secondary ts-btn" style="flex:1;max-width:160px;text-align:center;line-height:2.4;text-decoration:none;">Upgrade to Pro</a>
          </div>
        </div>`;

      document.body.appendChild(welcome);
      document.getElementById('tsWelcomePlay')?.addEventListener('click', () => {
        welcome.remove();
        window.location.href = '/games/';
      });
      welcome.addEventListener('click', (e) => { if (e.target === welcome) welcome.remove(); });
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
              <div style="text-align:right;margin:-4px 0 8px;">
                <button type="button" id="tsForgotPasswordBtn" style="background:none;border:none;color:var(--accent-cyan);font-size:12px;cursor:pointer;padding:0;text-decoration:underline;">Forgot password?</button>
              </div>
              <div class="ts-divider-text"><span>or</span></div>
              <button type="button" class="btn-secondary ts-btn" id="tsMagicLinkBtn">Send Magic Link</button>
              <div class="ts-auth-msg" id="tsLoginMsg"></div>
            </form>
            <div id="tsForgotPanel" style="display:none;">
              <p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;">Enter your email and we'll send you a password reset link.</p>
              <input type="email" placeholder="Email" required class="ts-input" id="tsForgotEmail"/>
              <button type="button" class="btn-primary ts-btn" id="tsSendResetBtn">Send Reset Link</button>
              <div class="ts-auth-msg" id="tsForgotMsg"></div>
              <button type="button" id="tsBackToLogin" style="background:none;border:none;color:var(--accent-cyan);font-size:12px;cursor:pointer;margin-top:8px;text-decoration:underline;">Back to login</button>
            </div>
          </div>

          <div class="ts-tab-panel ${mode === 'signup' ? 'active' : ''}" id="tsSignupPanel">
            <form id="tsSignupForm">
              <input type="email" placeholder="Email" required class="ts-input" id="tsSignupEmail"/>
              <input type="text" placeholder="Username" required class="ts-input" id="tsSignupUsername" minlength="3" maxlength="20" pattern="[a-zA-Z0-9_]+"/>
              <div class="ts-username-status" id="tsUsernameStatus" style="font-size:11px;margin:-4px 0 8px 4px;min-height:16px;"></div>
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
        if (result.error) {
          const errLower = result.error.toLowerCase();
          if (errLower.includes('email not confirmed') || errLower.includes('not confirmed')) {
            msg.innerHTML = 'Please confirm your email first. Check your inbox for the confirmation link, or <button type="button" id="tsResendFromLogin" style="background:none;border:none;color:var(--accent-cyan);cursor:pointer;padding:0;text-decoration:underline;font-size:inherit;">resend it</button>.';
            msg.className = 'ts-auth-msg error';
            document.getElementById('tsResendFromLogin')?.addEventListener('click', async () => {
              const email = document.getElementById('tsLoginEmail').value;
              if (!email) return;
              try {
                await TSAuth.supabase.auth.resend({ type: 'signup', email });
                msg.textContent = 'Confirmation email resent! Check your inbox.';
                msg.className = 'ts-auth-msg success';
              } catch { msg.textContent = 'Failed to resend — try again'; }
            });
          } else if (errLower.includes('invalid') || errLower.includes('credentials')) {
            msg.innerHTML = 'Invalid email or password. <button type="button" id="tsLoginForgot" style="background:none;border:none;color:var(--accent-cyan);cursor:pointer;padding:0;text-decoration:underline;font-size:inherit;">Reset password?</button>';
            msg.className = 'ts-auth-msg error';
            document.getElementById('tsLoginForgot')?.addEventListener('click', () => {
              document.getElementById('tsForgotPasswordBtn')?.click();
            });
          } else {
            msg.textContent = result.error;
            msg.className = 'ts-auth-msg error';
          }
        } else { modal.remove(); location.reload(); }
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

      // Forgot password toggle
      document.getElementById('tsForgotPasswordBtn').addEventListener('click', () => {
        document.getElementById('tsLoginForm').style.display = 'none';
        document.getElementById('tsForgotPanel').style.display = 'block';
        // Pre-fill email if they already typed one
        const loginEmail = document.getElementById('tsLoginEmail').value;
        if (loginEmail) document.getElementById('tsForgotEmail').value = loginEmail;
      });
      document.getElementById('tsBackToLogin').addEventListener('click', () => {
        document.getElementById('tsLoginForm').style.display = '';
        document.getElementById('tsForgotPanel').style.display = 'none';
      });

      // Send password reset link
      document.getElementById('tsSendResetBtn').addEventListener('click', async () => {
        const email = document.getElementById('tsForgotEmail').value;
        const msg = document.getElementById('tsForgotMsg');
        if (!email) { msg.textContent = 'Enter your email first'; msg.className = 'ts-auth-msg error'; return; }
        msg.textContent = 'Sending reset link...';
        msg.className = 'ts-auth-msg';
        try {
          const { error } = await TSAuth.supabase.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + '/account/reset-password/'
          });
          if (error) { msg.textContent = error.message; msg.className = 'ts-auth-msg error'; }
          else { msg.textContent = 'Check your email for the reset link!'; msg.className = 'ts-auth-msg success'; }
        } catch (e) { msg.textContent = 'Failed to send reset link'; msg.className = 'ts-auth-msg error'; }
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
        else {
          // Replace signup form with "check your email" message
          const panel = document.getElementById('tsSignupPanel');
          if (panel) {
            panel.innerHTML = `
              <div style="text-align:center;padding:24px 8px;">
                <div style="font-size:36px;margin-bottom:12px;">\u2709\uFE0F</div>
                <h3 style="font-family:'Space Mono',monospace;font-size:1rem;margin-bottom:8px;color:var(--accent-cyan);">Check Your Email</h3>
                <p style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin-bottom:16px;">
                  We've sent a confirmation link to<br/>
                  <strong style="color:var(--fg);">${document.getElementById('tsSignupEmail')?.value || 'your email'}</strong>
                </p>
                <p style="font-size:12px;color:var(--text-muted);line-height:1.5;">
                  Click the link in your email to activate your account.<br/>
                  Once confirmed, you'll be able to log in and start playing.
                </p>
                <div style="margin-top:20px;padding:12px;border-radius:8px;background:rgba(0,229,255,.06);border:1px solid rgba(0,229,255,.15);">
                  <div style="font-size:11px;color:var(--text-muted);">Didn't receive it? Check your spam folder or</div>
                  <button id="tsResendConfirm" style="background:none;border:none;color:var(--accent-cyan);font-size:12px;cursor:pointer;padding:4px 0;text-decoration:underline;">resend confirmation email</button>
                </div>
              </div>`;
            // Resend handler
            document.getElementById('tsResendConfirm')?.addEventListener('click', async () => {
              const btn = document.getElementById('tsResendConfirm');
              btn.textContent = 'Sending...';
              try {
                await TSAuth.supabase.auth.resend({ type: 'signup', email: result.user?.email || '' });
                btn.textContent = 'Sent! Check your inbox.';
              } catch { btn.textContent = 'Failed — try again'; }
            });
          }
        }
      });

      // ── Username autofill from email ──
      const signupEmail = document.getElementById('tsSignupEmail');
      const signupUsername = document.getElementById('tsSignupUsername');
      const usernameStatus = document.getElementById('tsUsernameStatus');
      let usernameManuallyEdited = false;
      let usernameCheckTimeout = null;

      signupUsername.addEventListener('input', () => { usernameManuallyEdited = true; });
      signupUsername.addEventListener('focus', () => { usernameManuallyEdited = true; });

      signupEmail.addEventListener('input', () => {
        if (usernameManuallyEdited) return;
        const email = signupEmail.value;
        const atIndex = email.indexOf('@');
        if (atIndex < 1) return;

        let base = email.substring(0, atIndex)
          .replace(/[^a-zA-Z0-9_]/g, '')
          .substring(0, 20);
        if (base.length < 3) return;

        signupUsername.value = base;

        // Check availability with debounce
        clearTimeout(usernameCheckTimeout);
        usernameCheckTimeout = setTimeout(async () => {
          usernameStatus.textContent = 'Checking...';
          usernameStatus.style.color = 'var(--text-muted)';
          try {
            const { data } = await TSAuth.supabase
              .from('ts_users')
              .select('id')
              .eq('username', base)
              .maybeSingle();

            if (data) {
              // Username taken — append random digits
              base = base.substring(0, 16) + Math.floor(Math.random() * 9000 + 1000);
              signupUsername.value = base;
              usernameStatus.textContent = 'Suggested: ' + base;
              usernameStatus.style.color = 'var(--accent-yellow)';
            } else {
              usernameStatus.textContent = 'Available';
              usernameStatus.style.color = 'var(--accent-green, #32FF7E)';
            }
          } catch {
            usernameStatus.textContent = '';
          }
        }, 500);
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
    },

    /**
     * Create a roulette-style random scope selector.
     * @param {Array} scopes - Array of { id, label } objects
     * @param {Function} onSelect - Called with selected scope when animation finishes
     * @returns {HTMLElement} Container element to insert into DOM
     */
    createRouletteSelector(scopes, onSelect) {
      const container = document.createElement('div');
      container.className = 'ts-roulette-container';
      container.innerHTML = `
        <button class="ts-roulette-btn" id="tsRouletteBtn">🎰 Random Category</button>
        <div class="ts-roulette-display" id="tsRouletteDisplay"></div>`;

      const btn = container.querySelector('#tsRouletteBtn');
      const display = container.querySelector('#tsRouletteDisplay');

      btn.addEventListener('click', () => {
        if (!scopes || scopes.length === 0) return;
        btn.disabled = true;
        display.style.display = 'flex';
        display.classList.add('spinning');
        display.classList.remove('landed');

        let iterations = 0;
        const totalIterations = 20 + Math.floor(Math.random() * 10);
        let delay = 60;

        function tick() {
          const randomScope = scopes[Math.floor(Math.random() * scopes.length)];
          display.textContent = randomScope.label;
          iterations++;

          if (iterations >= totalIterations) {
            display.classList.remove('spinning');
            display.classList.add('landed');
            btn.disabled = false;
            // Final selection — flash highlight then pause before loading
            const finalScope = scopes[Math.floor(Math.random() * scopes.length)];
            display.textContent = '\u26BD ' + finalScope.label + ' \u26BD';
            display.style.color = 'var(--accent-cyan)';
            display.style.transform = 'scale(1.15)';
            display.style.transition = 'transform 0.3s ease, color 0.3s ease';
            // Hold for 2 seconds so user can read the selection
            setTimeout(() => {
              display.style.transform = 'scale(1)';
              onSelect(finalScope);
            }, 2000);
          } else {
            delay = 60 + (iterations * 8); // Decelerating
            setTimeout(tick, delay);
          }
        }
        tick();
      });

      return container;
    },

    /**
     * Show a plays remaining counter on the page.
     * @param {number} remaining
     * @param {number} limit
     * @returns {HTMLElement}
     */
    createPlaysCounter(remaining, limit) {
      const counter = document.createElement('div');
      counter.id = 'tsPlaysRemaining';
      counter.className = 'ts-plays-counter';
      if (limit === Infinity) {
        counter.textContent = 'Unlimited plays';
      } else {
        const isAnon = TSAuth.isAnonymous();
        counter.textContent = `${remaining} play${remaining !== 1 ? 's' : ''} remaining today`;
        if (isAnon && remaining < limit) {
          counter.innerHTML += ' · <a href="#" style="color:var(--accent-cyan);text-decoration:underline;font-size:inherit;" onclick="TSNav.showAuthModal(\'signup\');return false;">Sign up for more</a>';
        }
        if (remaining <= 1) counter.classList.add('ts-plays-low');
      }
      return counter;
    },

    /**
     * Fetch and render "Database last updated" in footer.
     */
    async renderFooterMeta() {
      const footer = document.querySelector('footer');
      if (!footer) return;

      try {
        const API_BASE = window.location.hostname === 'localhost'
          ? 'http://localhost:8888/.netlify/functions' : '/.netlify/functions';
        const res = await fetch(API_BASE + '/meta');
        if (!res.ok) return;
        const meta = await res.json();
        const info = meta.current_season_last_updated;
        if (info && info.value !== 'never') {
          const d = new Date(info.updated_at);
          const formatted = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
          let el = document.getElementById('tsLastUpdated');
          if (!el) {
            el = document.createElement('div');
            el.id = 'tsLastUpdated';
            el.style.cssText = 'margin-top:4px;opacity:0.5;font-size:0.75em;';
            footer.appendChild(el);
          }
          el.textContent = 'Database updated: ' + formatted;
        }
      } catch { /* silent */ }
    },

    /**
     * Show iOS-specific install prompt (Safari has no beforeinstallprompt).
     */
    showInstallPrompt() {
      const isMobileOrTablet = /Android|iPad|iPhone|iPod/i.test(navigator.userAgent) && !window.MSStream;
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches
                        || window.navigator.standalone;
      const isGamePage = /\/games\/\w+\.html/.test(window.location.pathname);
      if (!isMobileOrTablet || isStandalone || isGamePage || sessionStorage.getItem('ts_install_dismissed')) return;

      const nav = document.querySelector('.ts-nav');
      if (!nav) return;

      const isIOS = /iPad|iPhone|iPod/i.test(navigator.userAgent);
      const installText = isIOS
        ? 'Add TeleStats to your Home Screen: tap <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg> then "Add to Home Screen"'
        : 'Add TeleStats to your Home Screen: tap ⋮ then "Install app" or "Add to Home Screen"';

      const banner = document.createElement('div');
      banner.className = 'ts-install-banner';
      banner.innerHTML = `
        <span style="flex:1;font-size:13px;">${installText}</span>
        <button id="tsInstallDismiss" style="background:none;border:none;color:var(--text-muted);font-size:18px;cursor:pointer;padding:0 4px;">&times;</button>`;
      banner.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 16px;background:var(--bg-card,#171F25);border-bottom:1px solid rgba(255,255,255,0.06);font-family:Inter,sans-serif;';
      nav.after(banner);

      document.getElementById('tsInstallDismiss')?.addEventListener('click', () => {
        banner.remove();
        sessionStorage.setItem('ts_install_dismissed', '1');
      });
    },

    /**
     * Show a persistent game context banner so users know what they're playing.
     * @param {string} categoryLabel - e.g. "West Ham Players — Premier League Era"
     * @param {string} gameType - e.g. "bullseye", "xi", "hol"
     */
    showGameContext(categoryLabel, gameType) {
      const existing = document.getElementById('tsGameContext');
      if (existing) existing.remove();
      if (!categoryLabel) return;

      const typeLabels = {
        bullseye: 'Bullseye', xi: 'Starting XI', hol: 'Higher or Lower',
        alpha: 'Alphabet', quiz: 'Pop Quiz', whoami: 'Who Am I?'
      };

      const bar = document.createElement('div');
      bar.id = 'tsGameContext';
      bar.style.cssText = 'position:fixed;top:56px;left:0;right:0;z-index:90;background:linear-gradient(90deg,rgba(0,229,255,.15),rgba(50,255,126,.10));border-bottom:1px solid rgba(0,229,255,.25);padding:10px 16px;text-align:center;font-size:15px;font-family:"Space Mono",monospace;backdrop-filter:blur(8px);';
      bar.innerHTML = '<span style="color:var(--accent-cyan);font-weight:700;">' + (typeLabels[gameType] || gameType) + '</span>'
        + ' <span style="color:var(--text-secondary);margin:0 8px;">\u2014</span> '
        + '<span style="color:#fff;font-weight:600;">' + categoryLabel + '</span>';

      document.body.prepend(bar);
    },

    /**
     * Show a post-game prompt for anonymous users to sign up.
     */
    showPostGameSignup() {
      if (!window.TSAuth || !TSAuth.isAnonymous()) return;
      const existing = document.getElementById('tsPostGameSignup');
      if (existing) existing.remove();

      const isCommunity = new URLSearchParams(window.location.search).has('community');
      const headline = isCommunity ? 'Enjoyed the game?' : 'Want to choose your own games?';
      const subtitle = isCommunity
        ? 'Create a free account to track your stats, earn XP, and play more games.'
        : 'Sign up for free to unlock all EPL categories, track your XP, and climb the leaderboard.';

      const overlay = document.createElement('div');
      overlay.id = 'tsPostGameSignup';
      overlay.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:200;background:linear-gradient(0deg,rgba(11,15,18,.98) 60%,transparent);padding:32px 20px 24px;text-align:center;';
      overlay.innerHTML = `
        <div style="max-width:400px;margin:0 auto;">
          <div style="font-size:20px;margin-bottom:8px;">\u26BD</div>
          <div style="font-size:16px;font-weight:700;margin-bottom:6px;color:var(--fg);">${headline}</div>
          <div style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">${subtitle}</div>
          <button id="tsPostGameSignupBtn" style="padding:12px 32px;border-radius:10px;background:var(--accent-cyan);border:none;color:#000;font-weight:700;font-size:15px;cursor:pointer;margin-bottom:8px;">Sign Up Free</button>
          <div><button id="tsPostGameDismiss" style="background:none;border:none;color:var(--text-muted);font-size:12px;cursor:pointer;padding:8px;">Keep playing as guest</button></div>
        </div>`;

      document.body.appendChild(overlay);

      document.getElementById('tsPostGameSignupBtn')?.addEventListener('click', () => {
        overlay.remove();
        TSNav.showAuthModal('signup');
      });
      document.getElementById('tsPostGameDismiss')?.addEventListener('click', () => {
        overlay.remove();
      });
    }
  };

  window.TSNav = TSNav;
})();
