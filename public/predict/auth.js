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
    const { data, error } = await sb()
      .from('predict_users')
      .select('id, email, username, full_name, is_admin, points, correct_results, incorrect_results')
      .eq('email', email)
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
          setCachedUser({
            userId: row.id,
            email: row.email,
            username: row.username,
            fullName: row.full_name,
            isAdmin: row.is_admin
          });
          return String(row.id);
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

    /** Render a small nav bar with logout. Call after initAuth(). */
    renderNav(containerSelector) {
      const user = getCachedUser();
      if (!user) return;

      const target = containerSelector
        ? document.querySelector(containerSelector)
        : null;

      const nav = document.createElement('div');
      nav.className = 'pf-nav';
      nav.innerHTML = `
        <div style="
          max-width:750px; width:100%; margin:8px auto 0; padding:0 12px;
          display:flex; justify-content:space-between; align-items:center;
          font-family:Inter,system-ui,Arial; font-size:13px; color:#aaa;
        ">
          <span>${escapeHTML(user.username || user.email)}</span>
          <div style="display:flex; gap:12px; align-items:center;">
            <a href="/predict/" style="color:#aaa; text-decoration:none;">Picks</a>
            <a href="/predict/league.html" style="color:#aaa; text-decoration:none;">Tables</a>
            <a href="/predict/history.html" style="color:#aaa; text-decoration:none;">History</a>
            <button id="pf-logout-btn" style="
              background:none; border:1px solid #555; color:#aaa; padding:4px 10px;
              border-radius:6px; cursor:pointer; font-size:12px;
            ">Log out</button>
          </div>
        </div>
      `;

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
