/* Sign-in, forced password change, counter picker. Every screen reads only what the database's security rules allow. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var SCREENS = ['login', 'password', 'blocked', 'counters', 'shop', 'shops', 'manage'];
  var cfg = window.APP_CONFIG;
  var sb = window.SHOP_CLIENT || window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  var state = { user: null, profile: null, shop: null, counter: null, typedPassword: '', perms: {} };

  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; }
  function say(id, text) { var m = $(id); m.textContent = text || ''; m.hidden = !text; }

  function show(name) {
    SCREENS.forEach(function (s) { $('screen-' + s).hidden = s !== name; });
    $('bar').hidden = name === 'login';
    if (state.user) {
      var p = state.profile;
      $('who-name').textContent = (p && p.full_name) || state.user.email || '';
      $('who-detail').textContent = [p ? p.role_code : '', state.shop ? state.shop.name : '', state.counter ? state.counter.name : ''].filter(Boolean).join(' · ');
    }
  }

  function counterKey() { return 'sb.counter.' + (state.user ? state.user.id : ''); }
  function rememberCounter(id) { try { if (id) localStorage.setItem(counterKey(), id); else localStorage.removeItem(counterKey()); } catch (e) { /* private mode: fine */ } }
  function rememberedCounter() { try { return localStorage.getItem(counterKey()); } catch (e) { return null; } }

  // ---- routing: ask the database who this is, then send them where their role goes ----
  function route() {
    return sb.auth.getSession().then(function (r) {
      var session = r.data && r.data.session;
      if (!session) { state = { user: null, profile: null, shop: null, counter: null, typedPassword: '', perms: {} }; return show('login'); }
      state.user = session.user;
      return sb.from('profile').select('user_id, shop_id, role_code, full_name, active, must_change_password').eq('user_id', session.user.id).maybeSingle()
        .then(function (p) {
          if (p.error) return blocked('Could not load your account', 'Check your internet connection and try again.', true);
          state.profile = p.data;
          var next = window.Logic.nextScreen(p.data);
          if (next === 'no-profile') return blocked('No access yet', 'You are signed in, but this login is not attached to a shop. Ask the person who gave you this login.');
          if (next === 'inactive') return blocked('This login is switched off', 'Ask your shop owner or the platform admin to switch it back on.');
          if (next === 'change-password') return show('password');
          return loadPerms().then(function () {
            if (next === 'platform-home') return window.Admin.openPlatform();
            return loadShopThenCounters();
          });
        });
    }).catch(function () { blocked('Could not load your account', 'Check your internet connection and try again.', true); });
  }

  // what this role may do (the buttons follow it; the database enforces it either way)
  function loadPerms() {
    return sb.from('role_permission').select('permission_code').eq('role_code', state.profile.role_code).then(function (r) {
      state.perms = {};
      ((r && r.data) || []).forEach(function (x) { state.perms[x.permission_code] = true; });
    });
  }

  function blocked(title, text, retry) {
    $('blocked-title').textContent = title;
    $('blocked-text').textContent = text;
    $('blocked-retry').hidden = !retry;
    show('blocked');
  }

  // ---- sign in ----
  function onLogin(e) {
    e.preventDefault();
    var email = window.Logic.toLoginEmail($('login-id').value);
    var pw = $('login-pw').value;
    if (!email) return say('login-msg', 'Type your email, or your 10-digit mobile number.');
    if (!pw) return say('login-msg', 'Type your password.');
    say('login-msg', ''); $('login-go').disabled = true;
    sb.auth.signInWithPassword({ email: email, password: pw }).then(function (r) {
      if (r.error) { say('login-msg', window.Logic.friendlyAuthError(r.error)); return; }
      state.typedPassword = pw; $('login-pw').value = '';
      return route();
    }).catch(function (err) { say('login-msg', window.Logic.friendlyAuthError(err)); })
      .then(function () { $('login-go').disabled = false; });
  }

  // ---- forced password change ----
  function onPassword(e) {
    e.preventDefault();
    var a = $('pw-new').value, b = $('pw-again').value;
    var problem = window.Logic.checkNewPassword(a, b, state.typedPassword);
    if (problem) return say('pw-msg', problem);
    say('pw-msg', ''); $('pw-go').disabled = true;
    sb.auth.updateUser({ password: a }).then(function (r) {
      if (r.error) { say('pw-msg', window.Logic.friendlyAuthError(r.error)); return; }
      return sb.rpc('password_changed').then(function (c) {
        if (c.error) { say('pw-msg', 'Your password was changed, but we could not finish. Sign out and sign in again.'); return; }
        state.typedPassword = ''; $('pw-new').value = ''; $('pw-again').value = '';
        return route();
      });
    }).catch(function (err) { say('pw-msg', window.Logic.friendlyAuthError(err)); })
      .then(function () { $('pw-go').disabled = false; });
  }

  // ---- shop people: shop, then counters ----
  function loadShopThenCounters() {
    return sb.from('shop').select('id, code, name').eq('id', state.profile.shop_id).maybeSingle().then(function (s) {
      if (s.error) return blocked('Could not load your shop', 'Check your internet connection and try again.', true);
      if (!s.data) return blocked('Your shop is not available', 'The shop may be switched off. Ask the platform admin.');
      state.shop = s.data;
      return sb.from('counter').select('id, code, name').eq('shop_id', state.shop.id).eq('active', true).order('code').then(function (c) {
        if (c.error) return blocked('Could not load the counters', 'Check your internet connection and try again.', true);
        var list = c.data || [];
        var remembered = rememberedCounter();
        var mine = list.filter(function (x) { return x.id === remembered; })[0];
        if (mine) return chooseCounter(mine, true);
        renderCounters(list);
      });
    });
  }

  function renderCounters(list) {
    state.counter = null;
    $('counters-shop').textContent = state.shop.name + ' (' + state.shop.code + ')';
    var box = $('counters-list'); box.textContent = '';
    list.forEach(function (c) {
      var b = el('button', '', c.name); b.type = 'button';
      b.appendChild(el('small', '', 'Counter ' + c.code));
      b.addEventListener('click', function () { chooseCounter(c, false); });
      box.appendChild(b);
    });
    $('counters-empty').hidden = list.length > 0;
    say('counters-msg', '');
    show('counters');
  }

  function chooseCounter(c, quiet) {
    // end any session this person left open, then record the new one; the sign-in already works even if this note fails
    return sb.from('counter_session').update({ closed_at: new Date().toISOString() }).eq('user_id', state.user.id).is('closed_at', null)
      .then(function () { return sb.from('counter_session').insert({ shop_id: state.shop.id, counter_id: c.id, user_id: state.user.id }); })
      .then(function (r) {
        if (r.error && !quiet) { say('counters-msg', 'Could not open that counter. Check your internet connection and try again.'); return; }
        state.counter = c; rememberCounter(c.id);
        $('shop-title').textContent = state.shop.name;
        $('shop-counter').textContent = c.name + ' (' + c.code + ')';
        $('manage-open').hidden = !(state.perms['counter.manage'] || state.perms['user.manage']);
        show('shop');
      });
  }

  function changeCounter() {
    sb.from('counter_session').update({ closed_at: new Date().toISOString() }).eq('user_id', state.user.id).is('closed_at', null)
      .then(function () { rememberCounter(null); return loadShopThenCounters(); });
  }

  function signOut() {
    var done = function () { rememberCounter(null); state = { user: null, profile: null, shop: null, counter: null, typedPassword: '', perms: {} }; $('login-id').value = ''; show('login'); };
    var close = state.user ? sb.from('counter_session').update({ closed_at: new Date().toISOString() }).eq('user_id', state.user.id).is('closed_at', null) : Promise.resolve();
    Promise.resolve(close).catch(function () { /* best effort */ }).then(function () { return sb.auth.signOut(); }).then(done, done);
  }

  window.ShopApp = { sb: sb, state: function () { return state; }, show: show, say: say, el: el, $: $, route: route };

  document.addEventListener('DOMContentLoaded', function () {
    $('login-form').addEventListener('submit', onLogin);
    $('pw-form').addEventListener('submit', onPassword);
    $('signout').addEventListener('click', signOut);
    $('change-counter').addEventListener('click', changeCounter);
    $('manage-open').addEventListener('click', function () { window.Admin.openManage(state.shop, function () { show('shop'); }); });
    $('blocked-retry').addEventListener('click', route);
    route();
  });
})();
