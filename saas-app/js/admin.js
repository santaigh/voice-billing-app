/* Admin screens: shops, platform staff, counters and people. Buttons follow the role's permissions, but the database rules
   (row-level security and the user functions) are what actually decide; a hidden button is only a courtesy. */
(function () {
  'use strict';

  var A = window.ShopApp, sb = A.sb, $ = A.$, el = A.el, L = window.Logic;
  var manage = { shop: null, back: null };

  function can(p) { return !!A.state().perms[p]; }
  function me() { return A.state().user.id; }
  function myRole() { return A.state().profile.role_code; }

  // ---------------------------------------------------------------- one small dialog used by every form
  // o = { title, submit, fields: [{ id, label, type: text|password|select|check, value, options: [[value, label]], hint, mode }],
  //       onSubmit(values) -> Promise<null | error text>, done() }
  function dialog(o) {
    var box = $('dlg-fields'); box.textContent = '';
    $('dlg-title').textContent = o.title;
    $('dlg-go').textContent = o.submit || 'Save';
    $('dlg-msg').hidden = true;
    o.fields.forEach(function (f) {
      var wrap = el('div');
      if (f.type === 'check') {
        var lab = el('label', 'check'); var cb = el('input'); cb.type = 'checkbox'; cb.id = 'f-' + f.id; cb.checked = !!f.value;
        lab.appendChild(cb); lab.appendChild(el('span', '', f.label)); wrap.appendChild(lab);
      } else {
        var l = el('label', '', f.label); l.setAttribute('for', 'f-' + f.id); wrap.appendChild(l);
        var inp;
        if (f.type === 'select') {
          inp = el('select');
          f.options.forEach(function (op) { var opt = el('option', '', op[1]); opt.value = op[0]; if (op[0] === f.value) opt.selected = true; inp.appendChild(opt); });
        } else {
          inp = el('input'); inp.type = f.type || 'text'; inp.value = f.value == null ? '' : f.value;
          inp.autocomplete = f.type === 'password' ? 'new-password' : 'off';
          if (f.mode) inp.inputMode = f.mode;
          if (f.maxlength) inp.maxLength = f.maxlength;
        }
        inp.id = 'f-' + f.id; if (f.disabled) inp.disabled = true; wrap.appendChild(inp);
      }
      if (f.hint) wrap.appendChild(el('small', 'fieldhint', f.hint));
      box.appendChild(wrap);
    });
    $('dlg').hidden = false;
    var first = box.querySelector('input:not([disabled]), select'); if (first) first.focus();

    $('dlg-form').onsubmit = function (e) {
      e.preventDefault();
      var values = {};
      o.fields.forEach(function (f) { var x = $('f-' + f.id); values[f.id] = f.type === 'check' ? x.checked : x.value; });
      $('dlg-go').disabled = true; $('dlg-msg').hidden = true;
      Promise.resolve(o.onSubmit(values)).then(function (problem) {
        if (problem) { $('dlg-msg').textContent = problem; $('dlg-msg').hidden = false; return; }
        $('dlg').hidden = true; if (o.done) o.done();
      }).catch(function (err) { $('dlg-msg').textContent = L.friendlyDbError(err); $('dlg-msg').hidden = false; })
        .then(function () { $('dlg-go').disabled = false; });
    };
    $('dlg-cancel').onclick = function () { $('dlg').hidden = true; };
  }

  function row(main, sub, tags, acts, off) {
    var r = el('div', 'row' + (off ? ' off' : '')), m = el('div', 'main'), s = el('strong', '', main);
    (tags || []).forEach(function (t) { s.appendChild(el('span', 'tag' + (t === 'Off' || t === 'suspended' ? ' off' : ''), t)); });
    m.appendChild(s); if (sub) m.appendChild(el('small', '', sub));
    r.appendChild(m);
    var a = el('div', 'acts'); (acts || []).forEach(function (x) { var b = el('button', 'secondary', x[0]); b.type = 'button'; b.addEventListener('click', x[1]); a.appendChild(b); });
    r.appendChild(a);
    return r;
  }
  function fill(id, rows) { var box = $(id); box.textContent = ''; rows.forEach(function (r) { box.appendChild(r); }); }
  function problem(id, text) { var m = $(id); m.textContent = text || ''; m.hidden = !text; }
  function who(p) { return p.mobile || p.login_email || 'no login shown'; }

  // ---------------------------------------------------------------- platform: shops and platform staff
  function openPlatform() {
    A.show('shops');
    $('shop-add').hidden = !can('shop.manage');
    return Promise.all([
      sb.from('shop').select('id, code, name, city, status').order('code'),
      can('user.manage') ? sb.from('profile').select('user_id, role_code, full_name, mobile, login_email, active').is('shop_id', null).order('full_name') : Promise.resolve({ data: [] })
    ]).then(function (res) {
      if (res[0].error || res[1].error) { problem('shops-msg', 'Could not load. Check your internet connection and try again.'); return; }
      problem('shops-msg', '');
      var shops = res[0].data || [];
      fill('shops-list', shops.map(function (s) {
        var acts = [['Open', function () { openManage(s, openPlatform); }]];
        if (can('shop.manage')) acts.push(['Edit', function () { editShop(s); }]);
        return row(s.name, s.code + (s.city ? ' · ' + s.city : ''), s.status === 'active' ? [] : [s.status], acts, s.status !== 'active');
      }));
      $('shops-empty').hidden = shops.length > 0;

      var canStaff = can('user.manage'), staff = res[1].data || [];
      $('staff-title').hidden = !canStaff; $('staff-add').hidden = !L.assignableRoles(myRole(), 'platform').length;
      fill('staff-list', !canStaff ? [] : staff.map(function (p) {
        var self = p.user_id === me();
        var acts = !self && L.assignableRoles(myRole(), 'platform').length ? [['Edit', function () { editPerson(p, null, 'platform', openPlatform); }]] : [];
        return row(p.full_name || '(no name)', L.roleLabel(p.role_code) + ' · ' + who(p), (self ? ['You'] : []).concat(p.active ? [] : ['Off']), acts, !p.active);
      }));
    });
  }

  function addShop() {
    dialog({
      title: 'Add a shop', submit: 'Add shop',
      fields: [
        { id: 'code', label: 'Shop code', hint: '2 to 10 letters or digits, for example S01. It cannot be changed later.', maxlength: 10 },
        { id: 'name', label: 'Shop name', maxlength: 80 },
        { id: 'city', label: 'City (optional)', maxlength: 60 }
      ],
      onSubmit: function (v) {
        var code = v.code.trim().toUpperCase(), name = v.name.trim();
        if (!/^[A-Z0-9]{2,10}$/.test(code)) return 'The shop code must be 2 to 10 letters or digits.';
        if (!name) return 'Type the shop name.';
        return sb.from('shop').insert({ code: code, name: name, city: v.city.trim() || null }).then(function (r) { return r.error ? L.friendlyDbError(r.error) : null; });
      },
      done: openPlatform
    });
  }

  function editShop(s) {
    dialog({
      title: 'Edit ' + s.name, submit: 'Save',
      fields: [
        { id: 'code', label: 'Shop code', value: s.code, disabled: true },
        { id: 'name', label: 'Shop name', value: s.name, maxlength: 80 },
        { id: 'city', label: 'City (optional)', value: s.city || '', maxlength: 60 },
        { id: 'status', label: 'Status', type: 'select', value: s.status, options: [['active', 'Active'], ['suspended', 'Suspended (nobody there can sign in to bill)']] }
      ],
      onSubmit: function (v) {
        if (!v.name.trim()) return 'Type the shop name.';
        return sb.from('shop').update({ name: v.name.trim(), city: v.city.trim() || null, status: v.status }).eq('id', s.id)
          .then(function (r) { return r.error ? L.friendlyDbError(r.error) : null; });
      },
      done: openPlatform
    });
  }

  // ---------------------------------------------------------------- one shop: counters and people
  function openManage(shop, back) {
    manage.shop = shop; manage.back = back;
    $('manage-title').textContent = shop.name + ' (' + shop.code + ')';
    A.show('manage');
    return loadManage();
  }

  function loadManage() {
    var shop = manage.shop, showPeople = can('user.manage');
    $('counter-add').hidden = !can('counter.manage');
    $('people-title').hidden = !showPeople;
    $('person-add').hidden = !L.assignableRoles(myRole(), 'shop').length;
    return Promise.all([
      sb.from('counter').select('id, code, name, active').eq('shop_id', shop.id).order('code'),
      showPeople ? sb.from('profile').select('user_id, role_code, full_name, mobile, login_email, active').eq('shop_id', shop.id).order('full_name') : Promise.resolve({ data: [] })
    ]).then(function (res) {
      if (res[0].error || res[1].error) { problem('manage-msg', 'Could not load. Check your internet connection and try again.'); return; }
      problem('manage-msg', '');
      fill('counters-admin', (res[0].data || []).map(function (c) {
        var acts = can('counter.manage') ? [
          ['Rename', function () { renameCounter(c); }],
          [c.active ? 'Switch off' : 'Switch on', function () { setCounterActive(c, !c.active); }]
        ] : [];
        return row(c.name, 'Counter ' + c.code, c.active ? [] : ['Off'], acts, !c.active);
      }));
      if (!(res[0].data || []).length) fill('counters-admin', [el('p', 'hint', 'No counters yet.')]);
      fill('people-list', !showPeople ? [] : (res[1].data || []).map(function (p) {
        var self = p.user_id === me();
        var acts = !self && L.assignableRoles(myRole(), 'shop').length ? [['Edit', function () { editPerson(p, shop.id, 'shop', loadManage); }]] : [];
        return row(p.full_name || '(no name)', L.roleLabel(p.role_code) + ' · ' + who(p), (self ? ['You'] : []).concat(p.active ? [] : ['Off']), acts, !p.active);
      }));
    });
  }

  function addCounter() {
    dialog({
      title: 'Add a counter', submit: 'Add counter',
      fields: [
        { id: 'code', label: 'Counter code', hint: '1 to 6 letters or digits, for example C1. Part of every bill number.', maxlength: 6 },
        { id: 'name', label: 'Counter name', hint: 'For example Counter 1 or Front desk.', maxlength: 40 }
      ],
      onSubmit: function (v) {
        var code = v.code.trim().toUpperCase(), name = v.name.trim();
        if (!/^[A-Z0-9]{1,6}$/.test(code)) return 'The counter code must be 1 to 6 letters or digits.';
        if (!name) return 'Type the counter name.';
        return sb.from('counter').insert({ shop_id: manage.shop.id, code: code, name: name }).then(function (r) { return r.error ? L.friendlyDbError(r.error) : null; });
      },
      done: loadManage
    });
  }

  function renameCounter(c) {
    dialog({
      title: 'Rename ' + c.name, submit: 'Save',
      fields: [{ id: 'name', label: 'Counter name', value: c.name, maxlength: 40 }, { id: 'code', label: 'Counter code', value: c.code, disabled: true, hint: 'The code cannot be changed: old bills carry it.' }],
      onSubmit: function (v) {
        if (!v.name.trim()) return 'Type the counter name.';
        return sb.from('counter').update({ name: v.name.trim() }).eq('id', c.id).then(function (r) { return r.error ? L.friendlyDbError(r.error) : null; });
      },
      done: loadManage
    });
  }

  function setCounterActive(c, on) {
    if (!on && !window.confirm('Switch off ' + c.name + '? Nobody can pick it until you switch it on again. Old bills are not affected.')) return;
    sb.from('counter').update({ active: on }).eq('id', c.id).then(function (r) { if (r.error) problem('manage-msg', L.friendlyDbError(r.error)); else loadManage(); });
  }

  // ---------------------------------------------------------------- people
  function roleOptions(scope) { return L.assignableRoles(myRole(), scope).map(function (r) { return [r, L.roleLabel(r)]; }); }

  function addPerson(shopId, scope, after) {
    var shopRole = scope === 'shop';
    dialog({
      title: shopRole ? 'Add a person to ' + manage.shop.name : 'Add platform staff', submit: 'Create login',
      fields: [
        { id: 'name', label: 'Full name', maxlength: 80 },
        { id: 'mobile', label: 'Mobile number', mode: 'tel', hint: 'Give a mobile number, an email, or both. A mobile number is the easiest way for cashiers to sign in.' },
        { id: 'email', label: 'Email (optional)', mode: 'email' },
        { id: 'password', label: 'First password', type: 'password', hint: 'At least 8 characters. Tell the person; they must choose their own when they first sign in.' },
        { id: 'role', label: 'Role', type: 'select', value: shopRole ? 'AppUser' : 'SaaSUser', options: roleOptions(scope) }
      ],
      onSubmit: function (v) {
        if (!v.name.trim()) return 'Type the full name.';
        if (!v.mobile.trim() && !v.email.trim()) return 'Give a mobile number or an email.';
        if (v.mobile.trim() && !L.normalizeMobile(v.mobile)) return 'The mobile number must be 10 digits, for example 9876543210.';
        if (v.password.length < 8) return 'The first password needs at least 8 characters.';
        var body = { role: v.role, shop_id: shopId, password: v.password, full_name: v.name.trim(), mobile: v.mobile.trim() || undefined, email: v.email.trim() || undefined };
        return sb.functions.invoke('create-user', { body: body }).then(function (r) { return r.error ? functionError(r.error) : null; });
      },
      done: after
    });
  }

  // the function answers { error } with a status; turn that, or a missing function, into words
  function functionError(err) {
    var ctx = err && err.context;
    if (ctx && typeof ctx.json === 'function') {
      if (ctx.status === 404) return Promise.resolve('The user service is not set up yet. Ask the platform admin.');
      return ctx.json().then(function (j) { return (j && j.error) || 'Could not create the login.'; }, function () { return 'Could not create the login.'; });
    }
    return L.friendlyDbError(err);
  }

  function editPerson(p, shopId, scope, after) {
    dialog({
      title: 'Edit ' + (p.full_name || 'person'), submit: 'Save',
      fields: [
        { id: 'name', label: 'Full name', value: p.full_name, maxlength: 80 },
        { id: 'mobile', label: 'Mobile number', value: p.mobile ? p.mobile.replace('+91', '') : '', mode: 'tel', hint: 'This is a contact number. It does not change how the person signs in.' },
        { id: 'role', label: 'Role', type: 'select', value: p.role_code, options: roleOptions(scope) },
        { id: 'active', label: 'Can sign in', type: 'check', value: p.active }
      ],
      onSubmit: function (v) {
        var mobile = v.mobile.trim() ? L.normalizeMobile(v.mobile) : null;
        if (v.mobile.trim() && !mobile) return 'The mobile number must be 10 digits, for example 9876543210.';
        if (!v.name.trim()) return 'Type the full name.';
        return sb.rpc('update_user', { p_user: p.user_id, p_name: v.name.trim(), p_mobile: mobile, p_role: v.role, p_active: v.active })
          .then(function (r) { return r.error ? L.friendlyDbError(r.error) : null; });
      },
      done: after
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('shop-add').addEventListener('click', addShop);
    $('staff-add').addEventListener('click', function () { addPerson(null, 'platform', openPlatform); });
    $('counter-add').addEventListener('click', addCounter);
    $('person-add').addEventListener('click', function () { addPerson(manage.shop.id, 'shop', loadManage); });
    $('manage-back').addEventListener('click', function () { if (manage.back) manage.back(); });
  });

  window.Admin = { openPlatform: openPlatform, openManage: openManage };
})();
