// node saas-app/test/logic.test.js
const assert = require('assert');
const L = require('../js/logic.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('mobile numbers normalise to +91 form', () => {
  assert.strictEqual(L.normalizeMobile('9876543210'), '+919876543210');
  assert.strictEqual(L.normalizeMobile(' +91 98765-43210 '), '+919876543210');
  assert.strictEqual(L.normalizeMobile('919876543210'), '+919876543210');
  assert.strictEqual(L.normalizeMobile('98765'), null);
  assert.strictEqual(L.normalizeMobile(''), null);
});

t('the sign-in box takes an email or a mobile', () => {
  assert.strictEqual(L.toLoginEmail('  Ravi@Shop.COM '), 'ravi@shop.com');
  assert.strictEqual(L.toLoginEmail('9876543210'), '919876543210@' + L.MOBILE_LOGIN_DOMAIN);
  assert.strictEqual(L.toLoginEmail('+91 9876543210'), '919876543210@' + L.MOBILE_LOGIN_DOMAIN);
  assert.strictEqual(L.toLoginEmail('not an email@'), null);
  assert.strictEqual(L.toLoginEmail('12345'), null);
  assert.strictEqual(L.toLoginEmail(''), null);
});

t('the made-up mobile address matches what the create-user function builds', () => {
  const fs = require('fs'), path = require('path');
  const fn = fs.readFileSync(path.join(__dirname, '../../supabase/functions/create-user/index.ts'), 'utf8');
  assert.ok(fn.includes("MOBILE_LOGIN_DOMAIN = '" + L.MOBILE_LOGIN_DOMAIN + "'"), 'the two domains must be identical or mobile logins never match');
});

t('auth errors become plain words', () => {
  assert.match(L.friendlyAuthError({ message: 'Invalid login credentials' }), /not right/);
  assert.match(L.friendlyAuthError({ message: 'Email not confirmed' }), /not confirmed/);
  assert.match(L.friendlyAuthError({ message: 'Failed to fetch' }), /internet/);
  assert.match(L.friendlyAuthError({ message: 'email rate limit exceeded' }), /Too many/);
  assert.match(L.friendlyAuthError({ message: 'something odd' }), /Could not sign in/);
  assert.match(L.friendlyAuthError(null), /Could not sign in/);
});

t('where each kind of person goes after signing in', () => {
  assert.strictEqual(L.nextScreen(null), 'no-profile');
  assert.strictEqual(L.nextScreen({ active: false, role_code: 'AppUser' }), 'inactive');
  assert.strictEqual(L.nextScreen({ active: true, must_change_password: true, role_code: 'AppUser' }), 'change-password');
  assert.strictEqual(L.nextScreen({ active: true, must_change_password: false, role_code: 'AppUser' }), 'pick-counter');
  assert.strictEqual(L.nextScreen({ active: true, must_change_password: false, role_code: 'AppSA' }), 'pick-counter');
  assert.strictEqual(L.nextScreen({ active: true, must_change_password: false, role_code: 'SaaSAdmin' }), 'platform-home');
  assert.strictEqual(L.nextScreen({ active: true, must_change_password: false, role_code: 'SaaSSA' }), 'platform-home');
  // an inactive user must never get past the block, even with the password flag set
  assert.strictEqual(L.nextScreen({ active: false, must_change_password: true, role_code: 'SaaSSA' }), 'inactive');
});

t('new password rules', () => {
  assert.match(L.checkNewPassword('short', 'short'), /8 characters/);
  assert.match(L.checkNewPassword('Welcome123$', 'Welcome123#'), /not the same/);
  assert.match(L.checkNewPassword('Welcome123$', 'Welcome123$', 'Welcome123$'), /new password/);
  assert.match(L.checkNewPassword('aaaaaaaa', 'aaaaaaaa'), /too easy/);
  assert.match(L.checkNewPassword('password1', 'password1'), /too easy/);
  assert.strictEqual(L.checkNewPassword('Tr1cky-Pass', 'Tr1cky-Pass', 'Welcome123$'), null);
});

t('which roles each person may hand out', () => {
  assert.deepStrictEqual(L.assignableRoles('AppSA', 'shop'), ['AppSA', 'AppAdmin', 'AppUser']);
  assert.deepStrictEqual(L.assignableRoles('AppSA', 'platform'), []);
  assert.deepStrictEqual(L.assignableRoles('AppAdmin', 'shop'), []);
  assert.deepStrictEqual(L.assignableRoles('AppUser', 'shop'), []);
  assert.deepStrictEqual(L.assignableRoles('SaaSAdmin', 'shop'), ['AppSA', 'AppAdmin', 'AppUser']);
  assert.deepStrictEqual(L.assignableRoles('SaaSAdmin', 'platform'), []);
  assert.deepStrictEqual(L.assignableRoles('SaaSUser', 'shop'), []);
  assert.deepStrictEqual(L.assignableRoles('SaaSSA', 'platform'), ['SaaSSA', 'SaaSAdmin', 'SaaSUser']);
  assert.strictEqual(L.roleLabel('AppUser'), 'Cashier');
  assert.strictEqual(L.roleLabel('AppSA'), 'Shop owner');
});

t('the form offers exactly what the database rules allow', () => {
  // mirror of can_assign_role in supabase/migrations/0002_user_admin.sql
  const db = (caller, role) => {
    const platformRole = /^SaaS/.test(role);
    if (platformRole) return caller === 'SaaSSA';
    return ['SaaSSA', 'SaaSAdmin', 'AppSA'].includes(caller);
  };
  for (const caller of ['SaaSSA', 'SaaSAdmin', 'SaaSUser', 'AppSA', 'AppAdmin', 'AppUser']) {
    for (const role of ['SaaSSA', 'SaaSAdmin', 'SaaSUser', 'AppSA', 'AppAdmin', 'AppUser']) {
      const scope = /^SaaS/.test(role) ? 'platform' : 'shop';
      assert.strictEqual(L.assignableRoles(caller, scope).includes(role), db(caller, role), caller + ' -> ' + role);
    }
  }
});

t('database errors become plain words', () => {
  assert.match(L.friendlyDbError({ code: '23505', message: 'duplicate key value violates unique constraint "shop_code_key"' }), /shop code/);
  assert.match(L.friendlyDbError({ code: '23505', message: 'duplicate key ... "counter_shop_id_code_key"' }), /counter with that code/);
  assert.match(L.friendlyDbError({ code: '42501', message: 'new row violates row-level security policy' }), /not allowed/);
  assert.match(L.friendlyDbError({ code: '23514', message: 'violates check constraint "shop_code_check"' }), /letters and digits/);
  assert.match(L.friendlyDbError({ message: 'you cannot deactivate yourself or change your own role' }), /your own login/);
  assert.match(L.friendlyDbError({ message: 'mobile must look like +919876543210' }), /10 digits/);
  assert.match(L.friendlyDbError({ message: 'weird' }), /Could not save/);
});

console.log(n + ' tests passed');
