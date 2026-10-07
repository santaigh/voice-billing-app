/* Cart and bill arithmetic. Pure functions. Money is handled in whole paise so totals never drift. */
(function (root) {
  'use strict';

  var DECIMAL_UNITS = { KG: 1, LTR: 1 };   // sold loose: 0.25 kg is fine; 2.5 packets is not
  var MAX_QTY = 100000, MAX_PRICE = 10000000;

  var UNIT_LABELS = { KG: 'Kg', LTR: 'Ltr', PKT: 'Pkt', PCS: 'Pcs' };
  function unitLabel(unit) { var u = String(unit || '').toUpperCase(); return UNIT_LABELS[u] || u; }

  function allowsDecimal(unit) { return !!DECIMAL_UNITS[String(unit || '').toUpperCase()]; }

  // Typed quantity -> number, or NaN. Up to 3 decimals for loose units, whole numbers otherwise.
  function parseQty(text, unit) {
    var s = String(text == null ? '' : text).trim().replace(',', '.');
    var re = allowsDecimal(unit) ? /^(\d+(\.\d{1,3})?|\.\d{1,3})$/ : /^\d+$/;
    if (!re.test(s)) return NaN;
    var n = Number(s);
    return n > 0 && n <= MAX_QTY ? n : NaN;
  }

  // Typed price in rupees -> number, or NaN. Up to 2 decimals.
  function parsePrice(text) {
    var s = String(text == null ? '' : text).trim().replace(',', '.');
    if (!/^(\d+(\.\d{1,2})?|\.\d{1,2})$/.test(s)) return NaN;
    var n = Number(s);
    return n > 0 && n <= MAX_PRICE ? n : NaN;
  }

  function toPaise(rupees) { return Math.round(rupees * 100); }

  function lineTotal(qty, pricePaise) { return Math.round(Math.round(qty * 1000) * pricePaise / 1000); }

  function formatMoney(paise) {
    return (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatQty(q) { return String(Math.round(q * 1000) / 1000); }

  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }

  function localDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2); }

  // Dates are stored as sortable 'YYYY-MM-DD' and always SHOWN as 'DD-MM-YYYY'.
  function displayDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? m[3] + '-' + m[2] + '-' + m[1] : String(iso || '');
  }

  // What a person typed -> 'YYYY-MM-DD', or '' if it is not a real date. Accepts 7-10-2026, 07/10/2026, 07.10.2026.
  function parseDisplayDate(text) {
    var m = /^\s*(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})\s*$/.exec(String(text || ''));
    if (!m) return '';
    var d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]), t = new Date(y, mo - 1, d);
    if (t.getFullYear() !== y || t.getMonth() !== mo - 1 || t.getDate() !== d) return '';   // 31-02-2026, 00-01-2026 ...
    return y + '-' + pad(mo, 2) + '-' + pad(d, 2);
  }

  function formatDateTime(d) {
    return pad(d.getDate(), 2) + '-' + pad(d.getMonth() + 1, 2) + '-' + d.getFullYear() + ' ' + pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2);
  }

  // '2026-10-07', 5 -> '07102026-005' (DDMMYYYY-NNN)
  function billNo(date, n) { return date.slice(8, 10) + date.slice(5, 7) + date.slice(0, 4) + '-' + pad(n, 3); }

  // the number after the dash, from either the old (20261007-005) or the new (07102026-005) style
  function seqOf(no) { return parseInt(String(no).split('-')[1], 10) || 0; }

  // How a bill's number is SHOWN: always DDMMYYYY-NNN, built from its date, so bills saved
  // before the change (stored as 20261007-005) read 07102026-005 as well.
  function label(b) { return billNo(b.date, seqOf(b.billNo)); }

  function formatTime(d) { return pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2); }

  // A cart line holds the raw typed text; this says whether it is billable and what it adds up to.
  function evalLine(line) {
    var qty = parseQty(line.qtyText, line.unit), price = parsePrice(line.priceText);
    var ok = isFinite(qty) && isFinite(price);
    return { ok: ok, qty: qty, qtyOk: isFinite(qty), price: price, priceOk: isFinite(price),
             pricePaise: ok ? toPaise(price) : NaN, totalPaise: ok ? lineTotal(qty, toPaise(price)) : NaN };
  }

  var api = { unitLabel: unitLabel, allowsDecimal: allowsDecimal, parseQty: parseQty, parsePrice: parsePrice, toPaise: toPaise, lineTotal: lineTotal,
              formatMoney: formatMoney, formatQty: formatQty, localDate: localDate, displayDate: displayDate, parseDisplayDate: parseDisplayDate, formatDateTime: formatDateTime,
              billNo: billNo, seqOf: seqOf, label: label, formatTime: formatTime, evalLine: evalLine };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Bill = api;
})(typeof window !== 'undefined' ? window : this);
