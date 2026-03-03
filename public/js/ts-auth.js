/**
 * TeleStats Auth Module
 * Shared authentication layer for all TeleStats pages.
 *
 * Usage:
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script src="/js/ts-auth.js"></script>
 *   <script>
 *     await TSAuth.init();
 *     const user = TSAuth.getUser();
 *   </script>
 */

(function () {
  'use strict';

  const SUPABASE_URL = 'https://cifnegfabbcywcxhtpfn.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpZm5lZ2ZhYmJjeXdjeGh0cGZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MDgyMDQsImV4cCI6MjA4NTM4NDIwNH0.Rkg8FrX3aW3r0MUWmtbQeduNChZQkfvg6a1hU3pYOGU';
  const STORAGE_KEY = 'ts_user';
  const ANON_KEY = 'ts_anon_id';

  // ── Supabase client (singleton) ──
  let _sb = null;
  function sb() {
    if (!_sb) {
      if (!window.supabase || !window.supabase.createClient) {
        throw new Error('Supabase JS SDK not loaded. Include the CDN script before ts-auth.js');
      }
      _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { flowType: 'implicit' }
      });
    }
    return _sb;
  }

  /** Fresh client for AbortError retries (Supabase v2 bug) */
  function createFreshClient() {
    return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        flowType: 'implicit',
        detectSessionInUrl: false,
        autoRefreshToken: false,
        persistSession: true
      }
    });
  }

  async function safeGetSession() {
    try {
      const result = await sb().auth.getSession();
      return result.data?.session || null;
    } catch (e) {
      if (e.name === 'AbortError') {
        console.warn('[TSAuth] getSession AbortError — retrying');
        _sb = createFreshClient();
        try {
          const result = await _sb.auth.getSession();
          return result.data?.session || null;
        } catch (e2) {
          console.warn('[TSAuth] getSession retry failed:', e2.message);
          return null;
        }
      }
      console.warn('[TSAuth] getSession failed:', e.message);
      return null;
    }
  }

  async function safeSetSession(accessToken, refreshToken) {
    const trySet = async (client) => {
      const { data, error } = await client.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      });
      if (error) throw error;
      return data.session;
    };
    try {
      return await trySet(sb());
    } catch (e) {
      if (e.name === 'AbortError') {
        console.warn('[TSAuth] setSession AbortError — retrying');
        _sb = createFreshClient();
        try { return await trySet(_sb); }
        catch (e2) { console.warn('[TSAuth] setSession retry failed:', e2.message); return null; }
      }
      console.warn('[TSAuth] setSession failed:', e.message);
      return null;
    }
  }

  // ── Local cache ──
  function getCached() {
    try { const r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : null; }
    catch { return null; }
  }
  function setCached(obj) { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...obj, _ts: Date.now() })); }
  function clearCached() { localStorage.removeItem(STORAGE_KEY); }

  function getAnonId() { return localStorage.getItem(ANON_KEY); }
  function setAnonId(id) { localStorage.setItem(ANON_KEY, id); }

  // ── API base URL ──
  function apiBase() {
    return window.location.hostname === 'localhost'
      ? 'http://localhost:8888/.netlify/functions'
      : '/.netlify/functions';
  }

  // ── Ensure anonymous user exists (via server-side function to bypass RLS) ──
  async function ensureAnonUser() {
    const existingId = getAnonId();
    try {
      const res = await fetch(apiBase() + '/ensure-anon-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anonId: existingId || undefined })
      });
      const result = await res.json();
      if (!res.ok || !result.user) {
        console.error('[TSAuth] ensure-anon-user failed:', result.error || 'Unknown error');
        return null;
      }
      const user = result.user;
      setAnonId(user.id);
      setCached({ ...user, isAnonymous: true });
      return user;
    } catch (e) {
      console.error('[TSAuth] Failed to create anonymous user:', e.message);
      return null;
    }
  }

  // ── Lookup ts_users row by auth_id ──
  async function lookupByAuth(authId) {
    const { data, error } = await sb()
      .from('ts_users')
      .select('*')
      .eq('auth_id', authId)
      .maybeSingle();
    if (error) { console.error('[TSAuth] user lookup failed:', error); return null; }
    return data;
  }

  // ── Current state ──
  let _currentUser = null; // ts_users row
  let _authSession = null; // Supabase auth session

  // ── Public API ──
  const TSAuth = {
    get supabase() { return sb(); },

    /**
     * Initialise auth. Does NOT redirect — supports anonymous play.
     * Returns the ts_users row (or creates an anonymous one).
     */
    async init() {
      // 1. Check for magic link hash tokens
      let session = await safeGetSession();
      if (!session && location.hash) {
        const hp = new URLSearchParams(location.hash.substring(1));
        const at = hp.get('access_token');
        const rt = hp.get('refresh_token');
        if (at && rt) {
          session = await safeSetSession(at, rt);
          if (session) history.replaceState(null, '', location.pathname + location.search);
        }
      }

      // 2. Authenticated user
      if (session && session.user) {
        _authSession = session;
        const cached = getCached();
        const fresh = cached && cached.auth_id === session.user.id && cached._ts && (Date.now() - cached._ts) < 3600000;
        if (fresh) { _currentUser = cached; return _currentUser; }

        clearCached();
        let row = await lookupByAuth(session.user.id);
        if (!row) {
          // First login — create/migrate ts_users row via server function (bypasses RLS)
          const anonId = getAnonId();
          try {
            const res = await fetch(apiBase() + '/register-user', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                authId: session.user.id,
                email: session.user.email,
                anonId: anonId || undefined
              })
            });
            const result = await res.json();
            if (res.ok && result.user) {
              row = result.user;
              if (result.migrated) localStorage.removeItem(ANON_KEY);
            } else {
              console.error('[TSAuth] register-user fallback failed:', result.error);
            }
          } catch (e) {
            console.error('[TSAuth] register-user fallback error:', e.message);
          }
        }
        if (row) {
          _currentUser = row;
          setCached(row);

          // Process referral code from URL if present
          const ref = new URLSearchParams(location.search).get('ref');
          if (ref && !row.referred_by) {
            await TSAuth.redeemReferral(ref);
          }
        }
        // Set up auth state change listener for token refresh
        sb().auth.onAuthStateChange((event, session) => {
          if (event === 'TOKEN_REFRESHED' && session) {
            _authSession = session;
            console.log('[TSAuth] Token refreshed');
          }
          if (event === 'SIGNED_OUT') {
            _currentUser = null;
            _authSession = null;
            clearCached();
          }
        });

        // Proactive token refresh every 45 minutes for long sessions
        setInterval(async () => {
          try {
            const { data } = await sb().auth.refreshSession();
            if (data?.session) _authSession = data.session;
          } catch (e) {
            console.warn('[TSAuth] Periodic refresh failed:', e.message);
          }
        }, 45 * 60 * 1000);

        return _currentUser;
      }

      // 3. No auth — anonymous play
      clearCached();
      _currentUser = await ensureAnonUser();
      return _currentUser;
    },

    /** Get current user object (ts_users row) */
    getUser() { return _currentUser || getCached(); },

    /** Get user's ts_users.id */
    getUserId() {
      const u = _currentUser || getCached();
      return u ? u.id : getAnonId();
    },

    /** Check if current user is anonymous */
    isAnonymous() {
      const u = this.getUser();
      return !u || u.tier === 'anonymous';
    },

    /** Get user tier */
    getTier() {
      const u = this.getUser();
      return u ? u.tier : 'anonymous';
    },

    /** Determine which scopes a user can access based on tier */
    getAllowedScopes() {
      const tier = this.getTier();
      const user = this.getUser();
      if (tier === 'paid') return { all: true };
      if (tier === 'free' && user?.referral_unlocked) return { all: true };
      if (tier === 'free') return { leagues: ['epl'], clubsFor: ['epl'] };
      // anonymous: random only
      return { randomOnly: true };
    },

    /** Check if a specific scope ID is allowed for the current user */
    isScopeAllowed(scopeId) {
      const allowed = this.getAllowedScopes();
      if (allowed.all) return true;
      if (allowed.randomOnly) return false;
      // EPL scopes: epl_alltime, epl_club_*, or generic club names under EPL
      if (!scopeId) return false;
      const id = scopeId.toLowerCase();
      if (allowed.leagues) {
        for (const league of allowed.leagues) {
          if (id.startsWith(league + '_') || id === league) return true;
        }
      }
      return false;
    },

    /** Check if user can play a game type today */
    async canPlay(gameType) {
      const userId = this.getUserId();
      if (!userId) return true; // No user tracking yet
      const { data, error } = await sb().rpc('can_user_play', { p_user_id: userId, p_game_type: gameType });
      if (error) { console.error('[TSAuth] canPlay error:', error); return true; }
      return data;
    },

    /** Sign up with email + password */
    async signUp(email, password, username) {
      const { data: authData, error: authError } = await sb().auth.signUp({ email, password });
      if (authError) return { error: authError.message };

      // Create/migrate ts_users row via server-side function (bypasses RLS)
      const anonId = getAnonId();
      try {
        const res = await fetch(apiBase() + '/register-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            authId: authData.user.id,
            email,
            username,
            anonId: anonId || undefined
          })
        });
        const data = await res.json();
        if (!res.ok) return { error: data.error || 'Registration failed' };
        if (data.migrated) localStorage.removeItem(ANON_KEY);
        _currentUser = data.user;
        setCached(data.user);
        return { user: data.user };
      } catch (e) {
        return { error: 'Network error during registration' };
      }
    },

    /** Sign in with email + password */
    async signIn(email, password) {
      const { data, error } = await sb().auth.signInWithPassword({ email, password });
      if (error) return { error: error.message };
      _authSession = data.session;
      const row = await lookupByAuth(data.user.id);
      if (row) { _currentUser = row; setCached(row); }
      return { user: row };
    },

    /** Send magic link */
    async signInMagicLink(email) {
      const redirectTo = window.location.origin + (window.location.pathname || '/');
      const { error } = await sb().auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
      if (error) return { error: error.message };
      return { success: true };
    },

    /** Sign out */
    async signOut() {
      await sb().auth.signOut();
      clearCached();
      _currentUser = null;
      _authSession = null;
      location.reload();
    },

    /** Refresh user profile from DB */
    async refreshProfile() {
      const userId = this.getUserId();
      if (!userId) return null;
      const isAnon = this.isAnonymous();
      const query = isAnon
        ? sb().from('ts_users').select('*').eq('id', userId)
        : sb().from('ts_users').select('*').eq('auth_id', _authSession?.user?.id);
      const { data } = await query.maybeSingle();
      if (data) { _currentUser = data; setCached(data); }
      return data;
    },

    /** Redeem a referral code (via server function to bypass RLS) */
    async redeemReferral(code) {
      const userId = this.getUserId();
      if (!userId) return { error: 'No user' };
      try {
        const res = await fetch(apiBase() + '/redeem-referral', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, userId })
        });
        const data = await res.json();
        if (!res.ok) return { error: data.error || 'Failed to redeem referral' };
        await this.refreshProfile();
        return { success: true };
      } catch (e) {
        return { error: 'Network error during referral redemption' };
      }
    },

    /** Redeem a promo code for Pro access */
    async redeemPromo(code) {
      const userId = this.getUserId();
      if (!userId) return { error: 'No user' };
      try {
        const res = await fetch(apiBase() + '/redeem-promo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, userId })
        });
        const data = await res.json();
        if (!res.ok) return { error: data.error || 'Failed to redeem' };
        await this.refreshProfile();
        return { success: true, message: data.message };
      } catch (e) {
        return { error: 'Network error' };
      }
    },

    /** Get XP progress to next level */
    getXPProgress() {
      const u = this.getUser();
      if (!u) return { current: 0, next: 100, pct: 0, level: 1, levelName: 'Grassroots' };
      const levels = [
        { level: 1, xp: 0 }, { level: 2, xp: 100 }, { level: 3, xp: 300 },
        { level: 4, xp: 600 }, { level: 5, xp: 1000 }, { level: 6, xp: 2000 },
        { level: 7, xp: 3500 }, { level: 8, xp: 5500 }, { level: 9, xp: 8000 },
        { level: 10, xp: 12000 }
      ];
      const currentLevel = levels.find(l => l.level === (u.level || 1)) || levels[0];
      const nextLevel = levels.find(l => l.level === (u.level || 1) + 1);
      const xpInLevel = (u.total_xp || 0) - currentLevel.xp;
      const xpNeeded = nextLevel ? nextLevel.xp - currentLevel.xp : 1;
      return {
        current: u.total_xp || 0,
        xpInLevel,
        xpNeeded,
        pct: nextLevel ? Math.min(100, Math.round((xpInLevel / xpNeeded) * 100)) : 100,
        level: u.level || 1,
        levelName: u.level_name || 'Grassroots',
        isMaxLevel: !nextLevel
      };
    }
  };

  window.TSAuth = TSAuth;
})();
