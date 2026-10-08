/* Pure rules for the sign-in flow: no DOM, no network. Tested with node saas-app/test/logic.test.js */
(function (root) {
  'use strict';

  // Must match MOBILE_LOGIN_DOMAIN in supabase/functions/create-user/index.ts
  var MOBILE_LOGIN_DOMAIN = 'login.shopbilling.app';
  var PLATFORM_ROLES = ['SaaSSA', 'SaaSAdmin', 'SaaSUser'];

  // 9876543210 / +91 98765-43210 / 919876543210 -> +919876543210, else null
  function normalizeMobile(m) {
    var d = String(m == null ? '' : m).replace(/[\s-]/g, '');
    if (/^\+91[0-9]{10}$/.test(d)) return d;
    if (/^91[0-9]{10}$/.test(d)) return '+' + d;
    if (/^[0-9]{10}$/.test(d)) return '+91' + d;
    return null;
  }

  // What the person typed in the one "Email or mobile" box -> the email Supabase signs in with, or null
  function toLoginEmail(identifier) {
    var s = String(identifier == null ? '' : identifier).trim();
    if (!s) return null;
    if (s.indexOf('@') >= 0) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s.toLowerCase() : null;
    var mobile = normalizeMobile(s);
    return mobile ? mobile.slice(1) + '@' + MOBILE_LOGIN_DOMAIN : null;
  }

  // Supabase's English errors -> words a shop owner understands
  function friendlyAuthError(err) {
    var m = String((err && err.message) || err || '');
    if (/invalid login credentials/i.test(m)) return 'The email or mobile number, or the password, is not right.';
    if (/email not confirmed/i.test(m)) return 'This login is not confirmed yet. Ask the person who created it.';
    if (/rate limit|too many/i.test(m)) return 'Too many tries. Wait a minute and try again.';
    if (/failed to fetch|network|load failed/i.test(m)) return 'No internet connection. Try again when you are online.';
    if (/same password|different from the old/i.test(m)) return 'Choose a password you have not used before.';
    if (/weak|at least|short/i.test(m)) return 'That password is too short or too easy. Use at least 8 characters.';
    return 'Could not sign in. Please try again.';
  }


  // Which roles may this caller hand out? ('shop' = people inside a shop, 'platform' = platform staff.) The database enforces the
  // same rules (can_assign_role); this only decides what the form offers.
  function assignableRoles(callerRole, scope) {
    var shopRoles = ['AppSA', 'AppAdmin', 'AppUser'];
    if (scope === 'platform') return callerRole === 'SaaSSA' ? ['SaaSSA', 'SaaSAdmin', 'SaaSUser'] : [];
    return callerRole === 'SaaSSA' || callerRole === 'SaaSAdmin' || callerRole === 'AppSA' ? shopRoles : [];
  }

  var ROLE_LABELS = { SaaSSA: 'Platform super admin', SaaSAdmin: 'Platform admin', SaaSUser: 'Platform support',
                      AppSA: 'Shop owner', AppAdmin: 'Manager', AppUser: 'Cashier' };
  function roleLabel(code) { return ROLE_LABELS[code] || code; }

  // Database errors -> plain words
  function friendlyDbError(err) {
    var m = String((err && err.message) || err || ''), c = err && err.code;
    if (c === '23505' || /duplicate key|already exists/i.test(m)) {
      if (/shop_code/i.test(m)) return 'That shop code is already used.';
      if (/counter_shop_id_code/i.test(m)) return 'This shop already has a counter with that code.';
      return 'That value is already used.';
    }
    if (c === '42501' || /row-level security|permission denied|not allowed/i.test(m)) return 'You are not allowed to do that.';
    if (c === '23514' || /check constraint/i.test(m)) return 'Check the entries: codes use letters and digits only, with no spaces.';
    if (/failed to fetch|network/i.test(m)) return 'No internet connection. Try again when you are online.';
    if (/yourself/i.test(m)) return 'You cannot switch off or change the role of your own login.';
    if (/mobile must look/i.test(m)) return 'The mobile number must be 10 digits, for example 9876543210.';
    return 'Could not save. Please try again.';
  }

  function isPlatform(role) { return PLATFORM_ROLES.indexOf(role) >= 0; }

  // Where a signed-in person goes next. profile may be null (signed in but no profile row).
  function nextScreen(profile) {
    if (!profile) return 'no-profile';
    if (profile.active === false) return 'inactive';
    if (profile.must_change_password) return 'change-password';
    return isPlatform(profile.role_code) ? 'platform-home' : 'pick-counter';
  }

  // null when fine, else the message
  function checkNewPassword(a, b, current) {
    a = String(a == null ? '' : a); b = String(b == null ? '' : b);
    if (a.length < 8) return 'Use at least 8 characters.';
    if (a.length > 72) return 'Use at most 72 characters.';
    if (a !== b) return 'The two passwords are not the same.';
    if (current && a === current) return 'Choose a new password, not the one you just used.';
    if (/^(.)\1+$/.test(a) || /^(12345678|password|qwertyui)/i.test(a)) return 'That password is too easy to guess.';
    return null;
  }

  var api = { normalizeMobile: normalizeMobile, toLoginEmail: toLoginEmail, friendlyAuthError: friendlyAuthError,
              isPlatform: isPlatform, assignableRoles: assignableRoles, roleLabel: roleLabel, friendlyDbError: friendlyDbError, nextScreen: nextScreen, checkNewPassword: checkNewPassword, MOBILE_LOGIN_DOMAIN: MOBILE_LOGIN_DOMAIN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Logic = api;
})(typeof window !== 'undefined' ? window : this);
