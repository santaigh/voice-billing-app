/* A pretend Supabase client for looking at the screens without a real account. TEST ONLY: loaded by test/preview.html, never by index.html.
   ?as=owner | owner-new | manager | cashier | inactive | noprofile | platform | support | nocounters   (&signedin=1 starts signed in)
   &fn=ok | missing | dup   what the create-user function answers */
(function () {
  var q = new URLSearchParams(location.search), as = q.get('as') || 'owner', fnMode = q.get('fn') || 'ok';
  var UID = 'u-1', seq = 100;
  var PERMS = {
    SaaSSA: ['shop.view', 'shop.manage', 'user.manage', 'counter.manage', 'product.view', 'bill.view', 'report.view'],
    SaaSAdmin: ['shop.view', 'shop.manage', 'user.manage', 'counter.manage', 'product.view', 'bill.view'],
    SaaSUser: ['shop.view', 'product.view', 'bill.view'],
    AppSA: ['shop.view', 'user.manage', 'counter.manage', 'product.view', 'product.import', 'bill.create', 'bill.view', 'bill.void', 'report.view'],
    AppAdmin: ['shop.view', 'counter.manage', 'product.view', 'product.import', 'bill.create', 'bill.view', 'bill.void', 'report.view'],
    AppUser: ['shop.view', 'product.view', 'bill.create', 'bill.view']
  };
  var db = {
    shop: [{ id: 's-1', code: 'S01', name: 'Murugan Stores', city: 'Karur', status: 'active' }, { id: 's-2', code: 'S02', name: 'Annai Bakery', city: 'Salem', status: 'active' }],
    counter: [{ id: 'c-1', shop_id: 's-1', code: 'C1', name: 'Counter 1', active: true }, { id: 'c-2', shop_id: 's-1', code: 'C2', name: 'Counter 2', active: true }, { id: 'c-3', shop_id: 's-1', code: 'C3', name: 'Old counter', active: false }],
    profile: [], counter_session: [], role_permission: []
  };
  Object.keys(PERMS).forEach(function (r) { PERMS[r].forEach(function (p) { db.role_permission.push({ role_code: r, permission_code: p }); }); });

  var roleOf = { owner: 'AppSA', 'owner-new': 'AppSA', manager: 'AppAdmin', cashier: 'AppUser', inactive: 'AppSA', platform: 'SaaSAdmin', support: 'SaaSUser', superadmin: 'SaaSSA', nocounters: 'AppSA', noprofile: 'AppSA' };
  var me = { user_id: UID, shop_id: 's-1', role_code: roleOf[as] || 'AppSA', full_name: 'Me (' + as + ')', mobile: null, login_email: 'me@example.com', active: true, must_change_password: as === 'owner-new' };
  if (as === 'inactive') me.active = false;
  if (/^(platform|support|superadmin)$/.test(as)) me.shop_id = null;
  if (as === 'nocounters') db.counter = [];
  if (as !== 'noprofile') db.profile.push(me);
  db.profile.push(
    { user_id: 'u-2', shop_id: 's-1', role_code: 'AppUser', full_name: 'Ravi', mobile: '+919876543210', login_email: null, active: true, must_change_password: false },
    { user_id: 'u-3', shop_id: 's-1', role_code: 'AppAdmin', full_name: 'Meena', mobile: null, login_email: 'meena@shop.com', active: false, must_change_password: false },
    { user_id: 'u-4', shop_id: 's-2', role_code: 'AppSA', full_name: 'Bakery Owner', mobile: '+919000000002', login_email: null, active: true, must_change_password: false },
    { user_id: 'u-5', shop_id: null, role_code: 'SaaSAdmin', full_name: 'Platform Colleague', mobile: null, login_email: 'colleague@platform.com', active: true, must_change_password: false }
  );
  var signedIn = q.get('signedin') === '1';
  var calls = (window.STUB_CALLS = []);

  function query(table) {
    var filters = [], patch = null, ins = null, single = false;
    var api = {
      select: function () { return api; },
      eq: function (c, v) { filters.push(function (r) { return r[c] === v; }); return api; },
      is: function (c, v) { filters.push(function (r) { return (r[c] === undefined ? null : r[c]) === v; }); return api; },
      order: function () { return api; },
      update: function (p) { patch = p; return api; },
      insert: function (row) { ins = row; return api; },
      maybeSingle: function () { single = true; return api; },
      then: function (ok, bad) {
        var out, match = function (r) { return filters.every(function (f) { return f(r); }); };
        if (ins) {
          var dup = (table === 'shop' && db.shop.some(function (s) { return s.code === ins.code; })) ||
                    (table === 'counter' && db.counter.some(function (c) { return c.shop_id === ins.shop_id && c.code === ins.code; }));
          if (dup) out = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "' + (table === 'shop' ? 'shop_code_key' : 'counter_shop_id_code_key') + '"' } };
          else { var row = Object.assign({ id: table[0] + '-' + (++seq), active: true, status: 'active' }, ins); db[table].push(row); calls.push(['insert', table, ins]); out = { data: null, error: null }; }
        } else if (patch) {
          db[table].filter(match).forEach(function (r) { Object.assign(r, patch); });
          calls.push(['update', table, patch]); out = { data: null, error: null };
        } else {
          var data = db[table].filter(match);
          out = { data: single ? (data[0] || null) : data, error: null };
        }
        return Promise.resolve(out).then(ok, bad);
      }
    };
    return api;
  }

  window.SHOP_CLIENT = {
    auth: {
      getSession: function () { return Promise.resolve({ data: { session: signedIn ? { user: { id: UID, email: 'owner@example.com' } } : null } }); },
      signInWithPassword: function (a) {
        calls.push(['signIn', a.email]);
        if (a.password === 'wrong') return Promise.resolve({ error: { message: 'Invalid login credentials' } });
        signedIn = true; return Promise.resolve({ data: {}, error: null });
      },
      updateUser: function (a) {
        calls.push(['updateUser']);
        return Promise.resolve({ data: {}, error: a.password === 'Same-Old-Pass1' ? { message: 'New password should be different from the old password.' } : null });
      },
      signOut: function () { signedIn = false; calls.push(['signOut']); return Promise.resolve({ error: null }); }
    },
    from: query,
    rpc: function (name, args) {
      calls.push(['rpc', name, args]);
      if (name === 'password_changed') me.must_change_password = false;
      if (name === 'update_user') {
        var t = db.profile.filter(function (p) { return p.user_id === args.p_user; })[0];
        if (!t) return Promise.resolve({ error: { code: '42501', message: 'not allowed' } });
        t.full_name = args.p_name; t.mobile = args.p_mobile; t.role_code = args.p_role; t.active = args.p_active;
      }
      return Promise.resolve({ error: null });
    },
    functions: {
      invoke: function (name, opts) {
        calls.push(['invoke', name, opts.body]);
        var respond = function (status, body) { return Promise.resolve({ data: null, error: { name: 'FunctionsHttpError', context: { status: status, json: function () { return Promise.resolve(body); } } } }); };
        if (fnMode === 'missing') return respond(404, { code: 'NOT_FOUND' });
        if (fnMode === 'dup') return respond(409, { error: 'that mobile number is already used' });
        db.profile.push({ user_id: 'u-' + (++seq), shop_id: opts.body.shop_id, role_code: opts.body.role, full_name: opts.body.full_name, mobile: opts.body.mobile ? '+91' + opts.body.mobile.replace(/\D/g, '').slice(-10) : null, login_email: opts.body.email || null, active: true, must_change_password: true });
        return Promise.resolve({ data: { user_id: 'new' }, error: null });
      }
    }
  };
})();
