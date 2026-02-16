/**
 * PredictFootball Auth Module
 * Shared authentication layer using Supabase Auth.
 *
 * Usage in any page:
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script src="/predict/auth.js"></script>
 *   <script>
 *     (async () => {
 *       const userId = await PFAuth.initAuth();
 *       // userId is the integer predict_users.id — use with existing API calls
 *     })();
 *   </script>
 */

(function () {
  'use strict';

  const SUPABASE_URL = 'https://cifnegfabbcywcxhtpfn.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpZm5lZ2ZhYmJjeXdjeGh0cGZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MDgyMDQsImV4cCI6MjA4NTM4NDIwNH0.Rkg8FrX3aW3r0MUWmtbQeduNChZQkfvg6a1hU3pYOGU';
  const STORAGE_KEY = 'pf_user';
  const LOGIN_PATH = '/predict/login.html';

  // Initialise Supabase client (singleton)
  let _sb = null;
  function sb() {
    if (!_sb) {
      if (!window.supabase || !window.supabase.createClient) {
        throw new Error('Supabase JS SDK not loaded. Include the CDN script before auth.js');
      }
      _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { flowType: 'implicit' }
      });
    }
    return _sb;
  }

  /* ---- Local cache helpers ---- */
  function getCachedUser() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function setCachedUser(obj) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  }

  function clearCachedUser() {
    localStorage.removeItem(STORAGE_KEY);
  }

  /* ---- Lookup predict_users row by email ---- */
  async function lookupUser(email) {
    // Normalise gmail/googlemail variants for lookup
    const variants = [email];
    if (email.endsWith('@googlemail.com')) {
      variants.push(email.replace('@googlemail.com', '@gmail.com'));
    } else if (email.endsWith('@gmail.com')) {
      variants.push(email.replace('@gmail.com', '@googlemail.com'));
    }
    const { data, error } = await sb()
      .from('predict_users')
      .select('id, adalo_id, email, username, full_name, is_admin, points, correct_results, incorrect_results')
      .in('email', variants)
      .maybeSingle();

    if (error) {
      console.error('predict_users lookup failed', error);
      return null;
    }
    return data; // null if no match
  }

  /* ---- Public API ---- */
  const PFAuth = {

    /** The Supabase client instance */
    get supabase() { return sb(); },

    /**
     * Initialise auth for the current page.
     *
     * 1. If a valid Supabase session exists → resolve userId
     * 2. Else if ?userId= URL param exists → use it (Adalo backward compat)
     * 3. Else → redirect to login page
     *
     * @returns {Promise<string>} The integer predict_users.id as a string
     */
    async initAuth() {
      // 1. Check Supabase session
      const { data: { session } } = await sb().auth.getSession();

      if (session && session.user) {
        const email = session.user.email;
        // Try cached user first
        const cached = getCachedUser();
        if (cached && cached.email === email && cached.userId) {
          return String(cached.userId);
        }
        // Lookup from DB
        const row = await lookupUser(email);
        if (row) {
          // Use adalo_id as the userId for Netlify function calls (Adalo backend compat)
          const effectiveId = row.adalo_id || row.id;
          setCachedUser({
            userId: effectiveId,
            email: row.email,
            username: row.username,
            fullName: row.full_name,
            isAdmin: row.is_admin
          });
          return String(effectiveId);
        }
        // Auth user exists but no predict_users row — shouldn't happen for migrated users
        console.error('Authenticated but no predict_users row for', email);
      }

      // 2. Fallback: URL param (backward compat with Adalo)
      const qs = new URLSearchParams(location.search);
      const urlUser = qs.get('userId');
      if (urlUser && urlUser !== 'undefined' && urlUser !== 'null' && urlUser.trim() !== '') {
        return urlUser.trim();
      }

      // 3. No auth — redirect to login
      const redirect = encodeURIComponent(location.href);
      location.href = `${LOGIN_PATH}?redirect=${redirect}`;
      // Return a never-resolving promise so the calling code doesn't continue
      return new Promise(() => {});
    },

    /** Get the cached user object (or null) */
    getUser() {
      return getCachedUser();
    },

    /** Sign out and redirect to login */
    async logout() {
      await sb().auth.signOut();
      clearCachedUser();
      location.href = LOGIN_PATH;
    },

    /** Check if current user is admin */
    isAdmin() {
      const u = getCachedUser();
      return u ? !!u.isAdmin : false;
    },

    /**
     * Render the TeleStats navigation bar. Call after initAuth().
     * Automatically detects the current page and highlights the active link.
     * Shows Admin link only for users with is_admin = true.
     *
     * @param {string} [containerSelector] - Optional selector to prepend nav into
     */
    renderNav(containerSelector) {
      const user = getCachedUser();
      if (!user) return;

      // Remove any existing nav to avoid duplicates
      const existing = document.querySelector('.ts-nav');
      if (existing) existing.remove();

      const target = containerSelector
        ? document.querySelector(containerSelector)
        : null;

      // Determine active page
      const path = location.pathname;
      const isHome = path.endsWith('/predict/') || path.endsWith('/predict/index.html');
      const isLeague = path.includes('league.html');
      const isHistory = path.includes('history.html');
      const isAdminPage = path.includes('admin.html') || path.includes('PicksCheck.html') || path.includes('admin_predictions.html');

      // Build admin link if user is admin
      const adminLink = user.isAdmin
        ? '<a href="/predict/admin.html" class="nav-admin ' + (isAdminPage ? 'active' : '') + '">Admin</a>'
        : '';

      const nav = document.createElement('nav');
      nav.className = 'ts-nav';
      nav.innerHTML =
        '<div class="ts-nav-inner">' +
          '<a href="/predict/" class="ts-nav-brand">' +
            '<img src="https://res.cloudinary.com/dbfvogb95/image/upload/v1770835428/Screenshot_2026-02-11_at_19.43.16_m7urul.png" alt="TeleStats"/>' +
            '<span>FIVES</span>' +
          '</a>' +
          '<div class="ts-nav-links">' +
            '<a href="/predict/"' + (isHome ? ' class="active"' : '') + '>Picks</a>' +
            '<a href="/predict/league.html"' + (isLeague ? ' class="active"' : '') + '>League</a>' +
            '<a href="/predict/history.html"' + (isHistory ? ' class="active"' : '') + '>History</a>' +
            adminLink +
          '</div>' +
          '<div class="ts-nav-user">' +
            '<span class="ts-nav-username">' + escapeHTML(user.username || user.email) + '</span>' +
            '<button class="ts-nav-logout" id="pf-logout-btn">Log out</button>' +
          '</div>' +
        '</div>';

      if (target) {
        target.prepend(nav);
      } else {
        document.body.prepend(nav);
      }

      document.getElementById('pf-logout-btn').onclick = () => PFAuth.logout();
    }
  };

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, m =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  // Expose globally
  window.PFAuth = PFAuth;
})();
