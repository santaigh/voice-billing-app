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

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function niceDate(d) { return d.slice(8) + ' ' + MONTHS[Number(d.slice(5, 7)) - 1] + ' ' + d.slice(0, 4); }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  var all = [], exported = {}, shown = [];

  // The chosen range. An empty box means "no limit" on that side; reversed boxes are simply swapped.
  function selected() {
    var a = $('bills-from').value, b = $('bills-to').value;
    if (a && b && a > b) { var t = a; a = b; b = t; }
    return Export.sortBills(all.filter(function (x) { return (!a || x.date >= a) && (!b || x.date <= b); }));
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
    var days = Export.dayTotals(shown), today = Bill.localDate(new Date());
    var sum = days.reduce(function (s, d) { return s + d.paise; }, 0);

    $('bills-summary').textContent = shown.length
      ? plural(shown.length, 'bill') + ' · ₹ ' + Bill.formatMoney(sum)
      : '';
    $('bills-empty').hidden = shown.length > 0;
    $('bills-export').disabled = shown.length === 0;
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
      var ul = el('ul', 'bill-rows');
      shown.filter(function (b) { return b.date === d.date; }).reverse().forEach(function (b) {
        var li = el('li');
        li.appendChild(el('span', 'bn', b.billNo));
        li.appendChild(el('span', 'bt', Bill.formatMoney(Math.round(b.total * 100))));
        ul.appendChild(li);
      });
      sec.appendChild(ul);
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

  function setRange(from, to) { $('bills-from').value = from; $('bills-to').value = to; }

  function init() {
    var today = Bill.localDate(new Date());
    setRange(today, today);
    ['bills-from', 'bills-to'].forEach(function (id) { $(id).addEventListener('change', function () { status(''); paint(); }); });
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
