/* Bills screen: list by day, totals, backup warning, Export to Excel. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  }

  var niceDate = Bill.displayDate;     // every date on screen reads DD-MM-YYYY
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  var all = [], exported = {}, shown = [], paintedKey = '';

  // The chosen range, from the two text boxes (DD-MM-YYYY). A blank box means "no limit" on that side;
  // reversed boxes are simply swapped. Returns null while a box holds something that is not a real date.
  function range() {
    var out = [];
    for (var i = 0; i < 2; i++) {
      var box = $(i ? 'bills-to' : 'bills-from'), text = box.value.trim();
      out.push(text === '' ? '' : Bill.parseDisplayDate(text) || null);
      if (out[i] === null) return null;
    }
    if (out[0] && out[1] && out[0] > out[1]) out.reverse();
    return out;
  }

  function selected() {
    var r = range() || ['', ''];
    return Export.sortBills(all.filter(function (x) { return (!r[0] || x.date >= r[0]) && (!r[1] || x.date <= r[1]); }));
  }

  function status(msg, kind) {
    var s = $('bills-status');
    s.textContent = msg;
    s.className = 'status ' + (kind || '');
    s.hidden = !msg;
  }

  function pending() { return Export.pendingDays(all, exported, Bill.localDate(new Date())); }

  function paintBadge() { $('bills-dot').hidden = pending().length === 0; }

  function paint() {
    shown = selected();
    // Redraw only when something on screen would change. Otherwise a tap is lost: leaving a date box (which
    // fires 'change') would rebuild the list under the finger and swallow the tap on View / Print.
    var key = (range() || ['', '']).join('>') + '|' + Bill.localDate(new Date()) + '|' + JSON.stringify(exported) + '|' +
      shown.map(function (b) { return b.billNo + ':' + b.total + ':' + (b.items ? b.items.length : 0); }).join(',');
    if (key === paintedKey) return;
    paintedKey = key;
    var days = Export.dayTotals(shown), today = Bill.localDate(new Date());
    var sum = days.reduce(function (s, d) { return s + d.paise; }, 0);

    // "07-10-2026 - 3 bills · ₹ 1,604.00" for one day, "04-10-2026 - 07-10-2026 - 3 bills · ₹ 1,604.00" for a range
    var r = range() || ['', ''];
    var span = '';
    if (shown.length) {
      var from = r[0] || days[0].date, to = r[1] || days[days.length - 1].date;
      span = (from === to ? niceDate(to) : niceDate(from) + ' - ' + niceDate(to)) + ' - ';
    }
    $('bills-summary').textContent = shown.length ? span + plural(shown.length, 'bill') + ' · ₹ ' + Bill.formatMoney(sum) : '';
    $('bills-empty').hidden = shown.length > 0;
    $('bills-export').disabled = shown.length === 0;
    $('bills-delete').disabled = all.length === 0;                        // deletes EVERYTHING, whatever range is shown
    $('bills-export').textContent = shown.length ? 'Export to Excel (' + plural(shown.length, 'bill') + ')' : 'Export to Excel';

    var list = $('bills-list');
    list.textContent = '';
    days.slice().reverse().forEach(function (d) {          // newest day first on screen
      var sec = el('section', 'day'), head = el('div', 'day-head');
      head.appendChild(el('strong', '', niceDate(d.date)));
      head.appendChild(el('span', 'day-sum', plural(d.count, 'bill') + ' · ₹ ' + Bill.formatMoney(d.paise)));
      var done = (exported[d.date] || 0) >= d.count;
      var badge = el('span', 'badge ' + (done ? 'ok' : d.date < today ? 'warn' : ''), done ? '✓ exported' : d.date < today ? 'not exported' : 'today');
      head.appendChild(badge);
      sec.appendChild(head);

      // SNo | Bill No | Grand Total | Ops (View, Print); newest bill first
      var table = el('table', 'billrows'), hr = el('tr');
      [['c-sno', 'SNo'], ['c-bn', 'Bill No'], ['c-gt', 'Grand Total'], ['c-ops', 'Ops']].forEach(function (c) { hr.appendChild(el('th', c[0], c[1])); });
      table.appendChild(el('thead')).appendChild(hr);
      var tbody = el('tbody');
      shown.filter(function (b) { return b.date === d.date; }).reverse().forEach(function (b, i) {
        var tr = el('tr'), label = Bill.label(b), hasItems = !!(b.items && b.items.length);
        tr.appendChild(el('td', 'c-sno', String(i + 1)));
        tr.appendChild(el('td', 'c-bn', label));
        tr.appendChild(el('td', 'c-gt', Bill.formatMoney(Math.round(b.total * 100))));
        var ops = el('td', 'c-ops');
        var view = el('button', 'op op-view', 'View');
        view.type = 'button'; view.setAttribute('aria-label', 'View bill ' + label);
        view.addEventListener('click', function () { openView(b); });
        var print = el('button', 'op op-print', 'Print');
        print.type = 'button'; print.setAttribute('aria-label', 'Print bill ' + label);
        if (hasItems) print.addEventListener('click', function () { Billing.printBill(b); });
        else { print.disabled = true; print.title = 'The items of this older bill were not saved, so it cannot be reprinted.'; }
        ops.appendChild(view); ops.appendChild(print);
        tr.appendChild(ops);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      sec.appendChild(table);
      list.appendChild(sec);
    });

    var p = pending();
    $('bills-warn').hidden = p.length === 0;
    if (p.length) {
      $('bills-warn-text').textContent = 'Not backed up: ' + plural(p.length, 'earlier day') + ' with bills (' +
        p.map(niceDate).join(', ') + '). Clearing Chrome data would delete them.';
    }
    paintBadge();
  }

  function refresh() {
    return Promise.all([Store.loadBills(), Store.getExported()]).then(function (r) {
      all = r[0]; exported = r[1]; paint();
    }).catch(function () {
      status('Could not read the saved bills from this device.', 'bad');
    });
  }

  function download(bills) {
    var out = XLSX.write(Export.buildWorkbook(XLSX, bills), { type: 'array', bookType: 'xlsx' });
    var blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = Export.fileName(bills);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    return Export.fileName(bills);
  }

  function exportBills(bills) {
    if (!bills.length) return;
    var name;
    try { name = download(bills); } catch (e) { status('The Excel file could not be created.', 'bad'); return; }
    // "exported" means the file was handed to the browser's downloads; we cannot see whether it was kept
    Store.markExported(Export.dayTotals(bills)).then(refresh).then(function () {
      status('Exported ' + plural(bills.length, 'bill') + ' to ' + name + '. Check your Downloads.', 'ok');
    });
  }

  function setRange(from, to) {
    $('bills-from').value = Bill.displayDate(from); $('bills-to').value = Bill.displayDate(to);
    $('bills-range-error').hidden = true;
  }

  // Typing aid: digits only (a number pad has no dash key) -> 07102026 becomes 07-10-2026 as you type.
  function autoDash(box, e) {
    if (e && e.inputType && e.inputType.indexOf('delete') === 0) return;      // let Backspace work normally
    var v = box.value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { box.value = Bill.displayDate(v); return; }   // pasted 2026-10-07
    if (/[^0-9]/.test(v.replace(/[-\/.]/g, ''))) return;                    // letters: leave alone, it will be flagged
    var d = v.replace(/[^0-9]/g, '').slice(0, 8);
    box.value = d.length <= 2 ? d : d.length <= 4 ? d.slice(0, 2) + '-' + d.slice(2) : d.slice(0, 2) + '-' + d.slice(2, 4) + '-' + d.slice(4);
  }

  function boxChanged(box, final) {
    var r = range(), bad = r === null;
    var wrong = box.value.trim() !== '' && Bill.parseDisplayDate(box.value) === '';
    box.classList.toggle('invalid', wrong && (final || box.value.length >= 10));   // no red while a date is still being typed
    if (bad && !final) return;                                               // still typing: no complaint yet
    $('bills-range-error').hidden = !bad;
    if (bad) return;
    if (final && box.value.trim() !== '') box.value = Bill.displayDate(Bill.parseDisplayDate(box.value));   // 7/10/2026 -> 07-10-2026
    status('');
    paint();
  }

  function wireDateBox(id) {
    var box = $(id), native = $(id + '-native');
    box.addEventListener('input', function (e) { $('bills-range-error').hidden = true; autoDash(box, e); boxChanged(box, false); });   // editing clears the complaint; leaving the box with a bad date brings it back
    box.addEventListener('change', function () { boxChanged(box, true); });
    $(id + '-pick').addEventListener('click', function () {                  // calendar: the browser's own picker fills the box
      native.value = Bill.parseDisplayDate(box.value) || '';
      try { native.showPicker(); } catch (e) { native.focus(); native.click(); }
    });
    native.addEventListener('change', function () { box.value = Bill.displayDate(native.value); boxChanged(box, true); });
  }

  // ---- View: the bill as a read-only table, same layout as the billing screen ----
  var viewing = null;

  function openView(b) {
    viewing = b;
    var items = b.items || [];
    $('view-title').textContent = 'Bill ' + Bill.label(b);
    $('view-sub').textContent = niceDate(b.date) + (b.time ? ' ' + b.time : '');
    var body = $('view-body');
    body.textContent = '';
    items.forEach(function (it, i) {
      var tr = el('tr');
      tr.appendChild(el('td', 'c-sno', String(i + 1)));
      tr.appendChild(el('td', 'c-amt', Bill.formatMoney(Math.round(it.price * 100))));
      tr.appendChild(el('td', 'c-name', it.name_ta ? it.name_en + ' - ' + it.name_ta : it.name_en));
      tr.appendChild(el('td', 'c-qty', Bill.formatQty(it.qty) + ' ' + Bill.unitLabel(it.unit)));
      tr.appendChild(el('td', 'c-total', Bill.formatMoney(Math.round(it.amount * 100))));
      body.appendChild(tr);
    });
    $('view-total').textContent = Bill.formatMoney(Math.round(b.total * 100));
    $('view-note').hidden = items.length > 0;
    $('view-print').disabled = items.length === 0;
    $('view-overlay').hidden = false;
  }

  function closeView() { $('view-overlay').hidden = true; viewing = null; }

  // ---- Google Sheet status line ----
  function paintCloud(s) {
    var line = $('cloud-line');
    line.hidden = !s.connected;
    if (!s.connected) return;
    var text, now = true;
    function n(c, w) { return c + ' ' + w + (c === 1 ? '' : 's'); }
    if (s.busy) { text = '⟳ Sending to the Google Sheet…'; now = false; }
    else if (s.error) text = '⚠ ' + s.error + (s.retrying ? ' (' + n(s.pending, 'bill') + ' waiting)' : '');
    else if (s.failed) text = '⚠ ' + n(s.failed, 'bill') + ' could not be sent: ' + s.firstFailure;
    else if (s.pending) text = '⏳ ' + n(s.pending, 'bill') + ' waiting to send';
    else { text = '✓ Google Sheet is up to date'; now = false; }
    $('cloud-text').textContent = text;
    $('cloud-now').hidden = !now;
    var open = $('cloud-open');
    open.hidden = !s.sheetUrl;
    if (s.sheetUrl) open.href = s.sheetUrl;
  }

  // ---- Delete all bills (fresh start) ----
  function deleteMsg(text, kind) {
    var m = $('delete-msg');
    m.textContent = text;
    m.className = 'status ' + (kind || '');
    m.hidden = !text;
  }

  function confirmTyped() { return $('delete-confirm').value.trim().toUpperCase() === 'DELETE'; }

  function openDelete() {
    var cloud = Cloud.status().connected, today = Bill.localDate(new Date());
    $('delete-what').textContent = 'This permanently deletes ' + (all.length === 1 ? '1 bill' : all.length + ' bills') + ' saved on this device, and the bill numbers start again at ' +
      Bill.billNo(today, 1) + '. It cannot be undone.';
    $('delete-sheet-row').hidden = !cloud;
    $('delete-sheet').checked = true;
    $('delete-confirm').value = '';
    $('delete-go').disabled = true;
    deleteMsg('');
    $('delete-overlay').hidden = false;
    $('delete-confirm').focus();
  }

  function closeDelete() { $('delete-overlay').hidden = true; }

  function doDelete() {
    if (!confirmTyped()) return;
    var wantSheet = Cloud.status().connected && $('delete-sheet').checked, sheetDone = false;
    $('delete-go').disabled = true; $('delete-cancel').disabled = true;
    deleteMsg(wantSheet ? 'Clearing the Google Sheet, then this device…' : 'Deleting…', '');
    // The sheet goes first: if it cannot be cleared, nothing is deleted anywhere and the owner can try again.
    (wantSheet ? Cloud.clearSheet() : Promise.resolve()).then(function () {
      sheetDone = wantSheet;
      return Store.clearBills();
    }).then(function () {
      Billing.forget();
      return Cloud.refreshStatus();
    }).then(refresh).then(function () {
      closeDelete();
      status('All bills deleted' + (sheetDone ? ' and the Google Sheet rows cleared' : '') + '. The next bill is ' + Bill.billNo(Bill.localDate(new Date()), 1) + '.', 'ok');
    }, function (err) {
      deleteMsg((sheetDone ? 'The Google Sheet rows were cleared, but deleting the bills on this device failed: ' : '') + (err && err.message ? err.message : 'Something went wrong.') +
        (sheetDone ? '' : ' Nothing was deleted.'), 'bad');
      $('delete-go').disabled = !confirmTyped();
    }).then(function () { $('delete-cancel').disabled = false; });
  }

  function init() {
    var today = Bill.localDate(new Date());
    $('bills-delete').addEventListener('click', openDelete);
    $('delete-cancel').addEventListener('click', closeDelete);
    $('delete-confirm').addEventListener('input', function () { $('delete-go').disabled = !confirmTyped(); });
    $('delete-go').addEventListener('click', doDelete);
    $('delete-export').addEventListener('click', function () { exportBills(Export.sortBills(all)); deleteMsg('The Excel file was downloaded. Check your Downloads folder, then type DELETE.', 'ok'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('delete-overlay').hidden && !$('delete-cancel').disabled) closeDelete(); });
    Cloud.onChange(paintCloud); paintCloud(Cloud.status());
    $('cloud-now').addEventListener('click', function () { Cloud.syncNow(); });
    setRange(today, today);
    $('view-close').addEventListener('click', closeView);
    $('view-print').addEventListener('click', function () { if (viewing) Billing.printBill(viewing); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('view-overlay').hidden && $('receipt-overlay').hidden) closeView(); });
    wireDateBox('bills-from'); wireDateBox('bills-to');
    $('bills-today').addEventListener('click', function () { var d = Bill.localDate(new Date()); setRange(d, d); status(''); paint(); });
    $('bills-export').addEventListener('click', function () { exportBills(shown); });
    $('bills-warn-go').addEventListener('click', function () {
      var p = pending();                                   // every day still owed a backup, oldest to newest
      if (!p.length) return;
      setRange(p[0], p[p.length - 1]);
      var a = p[0], b = p[p.length - 1];
      exportBills(Export.sortBills(all.filter(function (x) { return x.date >= a && x.date <= b; })));
    });
    return refresh();
  }

  window.Bills = { init: init, refresh: refresh };
})();
