// Edge Function: create-user
// The only place that holds the privileged key. It (1) works out who is calling from their sign-in token, (2) asks the
// database rules (admin_precheck_user) whether that caller may create this role in this shop, (3) creates the login,
// (4) creates the profile (admin_create_profile) and undoes the login if that fails.
// Only erasable TypeScript syntax, so the same file is pasted into the dashboard and also tested with Node (tests/create-user.test.mjs).

const ROLES = ['SaaSSA', 'SaaSAdmin', 'SaaSUser', 'AppSA', 'AppAdmin', 'AppUser'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A mobile-only login gets a made-up address, so a cashier needs no real mailbox. Change it in one place.
export const MOBILE_LOGIN_DOMAIN = 'login.shopbilling.app';

export function normalizeMobile(m) {
  if (m === undefined || m === null || m === '') return null;
  const digits = String(m).replace(/[\s-]/g, '');
  const full = /^\+91[0-9]{10}$/.test(digits) ? digits : /^91[0-9]{10}$/.test(digits) ? '+' + digits : /^[0-9]{10}$/.test(digits) ? '+91' + digits : null;
  return full;
}

// -> { ok: true, value } or { ok: false, error }
export function validate(b) {
  if (!b || typeof b !== 'object') return { ok: false, error: 'send a JSON body' };
  const role = String(b.role || '');
  if (!ROLES.includes(role)) return { ok: false, error: 'unknown role' };
  const shop = b.shop_id === undefined || b.shop_id === null || b.shop_id === '' ? null : String(b.shop_id);
  if (shop !== null && !UUID.test(shop)) return { ok: false, error: 'bad shop id' };
  const password = String(b.password || '');
  if (password.length < 8 || password.length > 72) return { ok: false, error: 'the password must be 8 to 72 characters' };
  const name = String(b.full_name || '').trim();
  if (name.length > 80) return { ok: false, error: 'the name is too long' };

  const mobile = normalizeMobile(b.mobile);
  if (b.mobile && mobile === null) return { ok: false, error: 'mobile must look like 9876543210 or +919876543210' };
  let email = String(b.email || '').trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'that email does not look right' };
  const loginEmail = email || null;                                               // only a REAL email is kept on the profile
  if (!email && mobile) email = mobile.slice(1) + '@' + MOBILE_LOGIN_DOMAIN;   // 919876543210@login...
  if (!email) return { ok: false, error: 'give an email or a mobile number' };
  return { ok: true, value: { role, shop, password, name, mobile, email, loginEmail } };
}

const json = (status, body, cors) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// deps: { getCaller(token) -> id|null, rpc(name, args) -> {error}, createUser({email,password}) -> {id}|{error}, deleteUser(id) }
export async function handle(req, deps, cors = {}) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'POST only' }, cors);

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const caller = token ? await deps.getCaller(token) : null;
  if (!caller) return json(401, { error: 'sign in first' }, cors);

  let body;
  try { body = await req.json(); } catch (_) { return json(400, { error: 'send a JSON body' }, cors); }
  const v = validate(body);
  if (!v.ok) return json(400, { error: v.error }, cors);
  const u = v.value;

  const pre = await deps.rpc('admin_precheck_user', { p_caller: caller, p_role: u.role, p_shop: u.shop });
  if (pre.error) return json(403, { error: 'you are not allowed to create that user' }, cors);

  const made = await deps.createUser({ email: u.email, password: u.password });
  if (made.error) {
    const dup = /already|registered|exists/i.test(made.error);
    return json(dup ? 409 : 400, { error: dup ? 'that email or mobile already has a login' : made.error }, cors);
  }

  const prof = await deps.rpc('admin_create_profile', {
    p_caller: caller, p_user: made.id, p_role: u.role, p_shop: u.shop, p_name: u.name, p_mobile: u.mobile, p_email: u.loginEmail,
  });
  if (prof.error) {
    await deps.deleteUser(made.id);                 // never leave a login without a profile
    const dup = /profile_mobile_uidx|profile_login_email_uidx|duplicate key/i.test(prof.error);
    const which = /email/i.test(prof.error) ? 'that email is already used' : 'that mobile number is already used';
    return json(dup ? 409 : 400, { error: dup ? which : 'could not save the user' }, cors);
  }
  return json(200, { user_id: made.id, email: u.email, must_change_password: true }, cors);
}

// ---- Supabase wiring (runs only inside Supabase, not under Node) ----
declare const Deno: any;
if (typeof Deno !== 'undefined') {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  const { createClient } = await import('jsr:@supabase/supabase-js@2');
  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const deps = {
    getCaller: async (token: string) => {
      const { data, error } = await admin.auth.getUser(token);
      return error || !data?.user ? null : data.user.id;
    },
    rpc: async (name: string, args: unknown) => {
      const { error } = await admin.rpc(name, args as Record<string, unknown>);
      return { error: error ? error.message : null };
    },
    createUser: async ({ email, password }: { email: string; password: string }) => {
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      return error || !data?.user ? { error: error ? error.message : 'could not create the login' } : { id: data.user.id };
    },
    deleteUser: async (id: string) => { await admin.auth.admin.deleteUser(id); },
  };
  Deno.serve((req: Request) => handle(req, deps, cors));
}
