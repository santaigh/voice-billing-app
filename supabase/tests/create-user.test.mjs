// node tests/create-user.test.mjs : the create-user Edge Function's logic, with a fake database (no network, no Supabase)
import assert from 'node:assert';
import { handle, validate, normalizeMobile, MOBILE_LOGIN_DOMAIN } from '../functions/create-user/index.ts';

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok -', name); };
const SHOP = 'a0000000-0000-0000-0000-00000000000a';
const good = { role: 'AppUser', shop_id: SHOP, password: 'Welcome123$', full_name: 'Ravi', mobile: '9876543210' };

// a fake world: records every call so we can see what happened and in which order
function world(over = {}) {
  const calls = [];
  const deps = {
    getCaller: async (tok) => (tok === 'good-token' ? 'caller-1' : null),
    rpc: async (name, args) => { calls.push([name, args]); return { error: over[name] || null }; },
    createUser: async (a) => { calls.push(['createUser', a]); return over.createUser ? { error: over.createUser } : { id: 'new-user-1' }; },
    deleteUser: async (id) => { calls.push(['deleteUser', id]); },
  };
  return { calls, deps };
}
const post = (body, token = 'good-token') => new Request('http://x/create-user', {
  method: 'POST', headers: { Authorization: token ? 'Bearer ' + token : '', 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const run = async (req, w) => { const r = await handle(req, w.deps); return { status: r.status, body: await r.json() }; };

await t('mobile numbers are normalised to +91 form', () => {
  assert.strictEqual(normalizeMobile('9876543210'), '+919876543210');
  assert.strictEqual(normalizeMobile('+91 98765-43210'), '+919876543210');
  assert.strictEqual(normalizeMobile('919876543210'), '+919876543210');
  assert.strictEqual(normalizeMobile(''), null);
  assert.strictEqual(normalizeMobile('12345'), null);
});

await t('a mobile-only login gets a made-up address; a real email is kept', () => {
  assert.strictEqual(validate(good).value.email, '919876543210@' + MOBILE_LOGIN_DOMAIN);
  assert.strictEqual(validate({ ...good, email: ' Ravi@Shop.com ' }).value.email, 'ravi@shop.com');
});

await t('bad input is refused with a reason', () => {
  assert.match(validate({ ...good, role: 'Root' }).error, /role/);
  assert.match(validate({ ...good, shop_id: 'nope' }).error, /shop/);
  assert.match(validate({ ...good, password: 'short' }).error, /password/);
  assert.match(validate({ ...good, mobile: '123' }).error, /mobile/);
  assert.match(validate({ ...good, mobile: undefined }).error, /email or a mobile/);
  assert.match(validate({ ...good, email: 'not-an-email' }).error, /email/);
  assert.match(validate(null).error, /JSON/);
});

await t('no sign-in token: 401 and nothing is called', async () => {
  const w = world(); const r = await run(post(good, ''), w);
  assert.strictEqual(r.status, 401); assert.strictEqual(w.calls.length, 0);
});

await t('a token that is not a real user: 401', async () => {
  const w = world(); assert.strictEqual((await run(post(good, 'forged'), w)).status, 401); assert.strictEqual(w.calls.length, 0);
});

await t('the rules say no: 403, and NO login is created', async () => {
  const w = world({ admin_precheck_user: 'not allowed' }); const r = await run(post(good), w);
  assert.strictEqual(r.status, 403);
  assert.deepStrictEqual(w.calls.map((c) => c[0]), ['admin_precheck_user']);
});

await t('the happy path: precheck, create login, create profile, in that order, as the verified caller', async () => {
  const w = world(); const r = await run(post(good), w);
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.user_id, 'new-user-1'); assert.strictEqual(r.body.must_change_password, true);
  assert.deepStrictEqual(w.calls.map((c) => c[0]), ['admin_precheck_user', 'createUser', 'admin_create_profile']);
  assert.strictEqual(w.calls[0][1].p_caller, 'caller-1');
  assert.strictEqual(w.calls[2][1].p_caller, 'caller-1');
  assert.strictEqual(w.calls[2][1].p_mobile, '+919876543210');
  assert.strictEqual(w.calls[2][1].p_email, null, 'a mobile-only login stores no email on the profile');
  assert.strictEqual(w.calls[2][1].p_shop, SHOP);
});

await t('a real email is stored on the profile; the made-up address never is', async () => {
  const w = world(); await run(post({ ...good, email: 'Ravi@Shop.com' }), w);
  assert.strictEqual(w.calls[2][1].p_email, 'ravi@shop.com');
  assert.strictEqual(w.calls[1][1].email, 'ravi@shop.com');
  const w2 = world(); await run(post(good), w2);
  assert.ok(w2.calls[1][1].email.endsWith('@' + MOBILE_LOGIN_DOMAIN));
});

await t('an email already used by another profile: 409 with an email message', async () => {
  const w = world({ admin_create_profile: 'duplicate key value violates unique constraint "profile_login_email_uidx"' });
  const r = await run(post({ ...good, email: 'a@b.co' }), w);
  assert.strictEqual(r.status, 409); assert.match(r.body.error, /email/);
  assert.strictEqual(w.calls.at(-1)[0], 'deleteUser');
});

await t('the caller id comes from the token, never from the request body', async () => {
  const w = world(); await run(post({ ...good, caller: 'evil', p_caller: 'evil', user_id: 'evil' }), w);
  assert.ok(w.calls.every((c) => !JSON.stringify(c).includes('evil')));
});

await t('the profile step fails: the new login is deleted again', async () => {
  const w = world({ admin_create_profile: 'boom' }); const r = await run(post(good), w);
  assert.strictEqual(r.status, 400);
  assert.deepStrictEqual(w.calls.map((c) => c[0]), ['admin_precheck_user', 'createUser', 'admin_create_profile', 'deleteUser']);
  assert.strictEqual(w.calls[3][1], 'new-user-1');
});

await t('a mobile number already in use: 409 with a clear message, and the login is removed', async () => {
  const w = world({ admin_create_profile: 'duplicate key value violates unique constraint "profile_mobile_uidx"' });
  const r = await run(post(good), w);
  assert.strictEqual(r.status, 409); assert.match(r.body.error, /mobile/);
  assert.strictEqual(w.calls.at(-1)[0], 'deleteUser');
});

await t('an email that already has a login: 409, no profile is attempted', async () => {
  const w = world({ createUser: 'A user with this email address has already been registered' });
  const r = await run(post(good), w);
  assert.strictEqual(r.status, 409);
  assert.ok(!w.calls.some((c) => c[0] === 'admin_create_profile'));
});

await t('only POST (and the browser pre-flight OPTIONS) are accepted; broken JSON is a 400', async () => {
  const w = world();
  assert.strictEqual((await handle(new Request('http://x', { method: 'GET' }), w.deps)).status, 405);
  assert.strictEqual((await handle(new Request('http://x', { method: 'OPTIONS' }), w.deps, { 'Access-Control-Allow-Origin': '*' })).status, 200);
  assert.strictEqual((await run(post('{not json'), w)).status, 400);
});

console.log(n + ' tests passed');
