/* Tab switching, the Products screen and the shop-name setting. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt; // textContent only: sheet data is never parsed as HTML
    return e;
  }

  // ---- tabs ----
  function showTab(name) {
    ['billing', 'bills', 'products'].forEach(function (t) {
      $('screen-' + t).hidden = t !== name;
      var b = $('tab-' + t);
      b.setAttribute('aria-selected', t === name ? 'true' : 'false');
    });
    document.body.classList.toggle('billing-tab', name === 'billing');
    if (name === 'bills' && window.Bills) Bills.refresh();
    try { sessionStorage.setItem('tab', name); } catch (e) { /* private mode: fine */ }
  }

  // ---- products screen ----
  var shown = { count: 0, info: null };
  function renderProducts(products, info) {
    shown = { count: products.length, info: info };
    $('prod-summary').textContent = products.length
      ? products.length + (products.length === 1 ? ' product' : ' products') + (info ? ' · ' + info.fileName + ' · ' + Bill.formatDateTime(new Date(info.loadedAt)) : '')
      : 'No products loaded yet.';
    $('prod-empty').hidden = products.length > 0;

    var body = $('prod-body');
    body.textContent = '';
    products.forEach(function (p) {
      var tr = el('tr');
      var name = el('td', 'name');
      name.appendChild(el('div', '', p.name_en));
      if (p.name_ta) name.appendChild(el('div', 'ta', p.name_ta));
      tr.appendChild(name);
      tr.appendChild(el('td', 'unit', p.unit));
      tr.appendChild(el('td', 'price', p.price.toFixed(2)));
      body.appendChild(tr);
    });
    $('prod-table').hidden = products.length === 0;
  }

  function renderErrors(errors) {
    var box = $('prod-errors');
    box.textContent = '';
    box.hidden = errors.length === 0;
    if (!errors.length) return;
    box.appendChild(el('strong', '', errors.length + ' row' + (errors.length > 1 ? 's' : '') + ' skipped'));
    var ul = el('ul');
    errors.forEach(function (e) {
      ul.appendChild(el('li', '', 'Row ' + e.row + (e.code ? ' (' + e.code + ')' : '') + ': ' + e.message));
    });
    box.appendChild(ul);
  }

  function status(msg, kind) {
    var s = $('prod-status');
    s.textContent = msg;
    s.className = 'status ' + (kind || '');
    s.hidden = !msg;
  }

  function onFile(file) {
    if (!file) return;
    if (masterUrl() && shown.count && !window.confirm('Loading this file replaces your ' + shown.count + ' products. The shop price list will replace it again the next time the app opens online.\n\nContinue?')) { $('prod-file').value = ''; return; }
    status('Reading ' + file.name + '…');
    file.arrayBuffer().then(function (buf) {
      var result = Catalog.parseWorkbook(window.XLSX, buf);
      renderErrors(result.errors);
      if (!result.products.length) {
        status('No valid products in ' + file.name + '. Your previous list was kept.', 'bad');
        return;
      }
      var info = { fileName: file.name, loadedAt: Date.now() };
      return Store.saveProducts(result.products, info).then(function () {
        renderProducts(result.products, info);
        Billing.setProducts(result.products);
        status('Loaded ' + result.products.length + (result.products.length === 1 ? ' product' : ' products') +
          (result.errors.length ? ', skipped ' + result.errors.length + '.' : '.'), result.errors.length ? 'warn' : 'ok');
      });
    }).catch(function (err) {
      renderErrors([]);
      status(err.message + ' Your previous list was kept.', 'bad');
    }).then(function () { $('prod-file').value = ''; });
  }

  // ---- the shop's master price list (Google Sheet CSV) ----
  var masterBusy = false;
  function masterUrl() { return window.APP_CONFIG && window.APP_CONFIG.MASTER_URL; }

  // the line under the Products heading: where the prices come from and how fresh they are
  function paintMaster(state) {
    var when = shown.info && shown.info.fileName === 'Shop price list' ? Bill.formatDateTime(new Date(shown.info.loadedAt)) : '';
    $('master-line').textContent = state === 'busy' ? 'Checking the shop price list…'
      : state === 'ok' ? 'Prices from the shop list · updated ' + when
      : when ? 'Using the saved price list · last updated ' + when + ' (could not reach the shop list)'
      : 'No price list yet. Connect to the internet once.';
    $('master-refresh').disabled = state === 'busy';
    $('prod-empty-master').hidden = !masterUrl();
    $('prod-empty-file').hidden = !!masterUrl();
  }

  function refreshMaster() {
    var url = masterUrl();
    if (!url || masterBusy) return Promise.resolve();
    masterBusy = true;
    paintMaster('busy');
    return Master.refresh(url).then(function (r) {
      if (r.skipped) return;
      if (!r.ok) { paintMaster('old'); status(r.message + ' Using the saved price list.', 'warn'); return; }
      var info = { fileName: 'Shop price list', loadedAt: Date.now() };
      return Store.saveProducts(r.products, info).then(function () {
        renderProducts(r.products, info);
        renderErrors(r.errors);
        Billing.setProducts(r.products);
        paintMaster('ok');
        status('Prices updated from the shop list' + (r.errors.length ? ', skipped ' + r.errors.length + ' row(s).' : '.'), r.errors.length ? 'warn' : 'ok');
      });
    }).catch(function () { paintMaster('old'); status('Could not save the new price list. Using the saved one.', 'warn'); })
      .then(function () { masterBusy = false; });
  }

  // ---- Google Sheet box (Products tab) ----
  function cloudMsg(text, kind) {
    var m = $('cloud-msg');
    m.textContent = text;
    m.className = 'status ' + (kind || '');
    m.hidden = !text;
  }

  function initCloud() {
    Cloud.onChange(function (s) {
      $('cloud-sendall').disabled = !s.connected || s.busy;
      $('cloud-disconnect').disabled = !s.connected;
      $('cloud-key').placeholder = s.connected ? 'saved on this device — type a new one to replace it' : 'paste the KEY from the script';
      if (s.connected && !$('cloud-url').value) $('cloud-url').value = s.url;
      $('cloud-conn').textContent = s.connected
        ? '✓ Connected (' + (s.mode === 'blind' ? 'blind mode' : 'normal') + '). Every confirmed bill is sent to the sheet.'
        : 'Not connected. Set it up once with the steps in cloud/SETUP.md, then paste the two values here.';
      $('cloud-sheet').hidden = !s.sheetUrl;
      if (s.sheetUrl) $('cloud-sheet-link').href = s.sheetUrl;
    });

    $('cloud-save').addEventListener('click', function () {
      cloudMsg('Testing the connection…', '');
      $('cloud-save').disabled = true;
      Cloud.connect($('cloud-url').value, $('cloud-key').value).then(function (r) {
        $('cloud-key').value = '';
        cloudMsg(r.mode === 'blind'
          ? '✓ Connected in blind mode: this browser does not let the page read Google\'s reply, so each bill is confirmed with a second request. The sheet has ' + r.bills + ' bill(s) so far.'
          : '✓ Connected. The sheet has ' + r.bills + ' bill(s) so far. Press “Send all existing bills” to add the ones already saved here.', 'ok');
      }, function (err) { cloudMsg(err.message, 'bad'); }).then(function () { $('cloud-save').disabled = false; });
    });

    $('cloud-sendall').addEventListener('click', function () {
      cloudMsg('Sending…', '');
      Cloud.sendAll().then(function (r) {
        var s = Cloud.status();
        if (s.error) cloudMsg(s.error, 'warn');
        else if (s.failed) cloudMsg(s.failed + ' bill(s) could not be sent: ' + s.firstFailure, 'warn');
        else cloudMsg('✓ All saved bills are in the sheet (it skips any it already had).', 'ok');
      }, function (err) { cloudMsg(err.message, 'bad'); });
    });

    $('cloud-disconnect').addEventListener('click', function () {
      if (!window.confirm('Disconnect the Google Sheet?\n\nBills still waiting to be sent will not be sent. All bills stay saved on this device.')) return;
      Cloud.disconnect().then(function () { $('cloud-url').value = ''; cloudMsg('Disconnected.', ''); });
    });
  }

  function init() {
    ['billing', 'bills', 'products'].forEach(function (t) {
      $('tab-' + t).addEventListener('click', function () { showTab(t); });
    });
    $('prod-load').addEventListener('click', function () { $('prod-file').click(); });
    $('master-box').hidden = !masterUrl();                                   // no link configured: the screen is the old Excel-only one
    $('excel-alt').classList.toggle('nomaster', !masterUrl());
    $('excel-alt').open = !masterUrl();
    $('master-refresh').addEventListener('click', refreshMaster);
    if (masterUrl()) paintMaster('old');
    $('prod-file').addEventListener('change', function (e) { onFile(e.target.files[0]); });

    var start = 'products';
    try { start = sessionStorage.getItem('tab') || start; } catch (e) { /* ignore */ }
    showTab(start);

    Billing.init();
    Bills.init();
    initCloud();
    Cloud.init();
    $('shop-name').addEventListener('change', function () {
      var name = $('shop-name').value.trim();
      Billing.setShop(name);
      Store.setShop(name).then(function () { $('shop-saved').hidden = false; setTimeout(function () { $('shop-saved').hidden = true; }, 1500); });
    });
    Store.getShop().then(function (name) { $('shop-name').value = name; Billing.setShop(name); });

    Store.loadProducts().then(function (r) { renderProducts(r.products, r.info); Billing.setProducts(r.products); })
      .catch(function () { status('Could not open the on-device storage. Products will not be remembered.', 'bad'); })
      .then(refreshMaster);                                                  // saved list first (works offline), then the newest from the shop
    window.addEventListener('online', refreshMaster);

    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* app still works online */ });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
