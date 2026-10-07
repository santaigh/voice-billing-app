/* Bills list helpers and the Excel export. Pure functions: XLSX is passed in. */
(function (root) {
  'use strict';

  var Bill = root.Bill || (typeof require !== 'undefined' ? require('./bill.js') : null);

  // the number within the day, from either bill-number style
  function seq(billNo) { return Bill.seqOf(billNo); }

  // Oldest first: by date, then by the number within the day (numeric, so -1000 comes after -999)
  function sortBills(bills) {
    return bills.slice().sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : seq(a.billNo) - seq(b.billNo);
    });
  }

  // [{date, count, paise}] oldest first. Sums whole paise so the total never drifts.
  function dayTotals(bills) {
    var by = {};
    bills.forEach(function (b) {
      var d = by[b.date] || (by[b.date] = { date: b.date, count: 0, paise: 0 });
      d.count++; d.paise += Math.round(b.total * 100);
    });
    return Object.keys(by).sort().map(function (k) { return by[k]; });
  }

  // Past days (before `today`) holding bills that no export has covered yet.
  // exported: { 'YYYY-MM-DD': number of that day's bills the last export contained }
  function pendingDays(bills, exported, today) {
    return dayTotals(bills).filter(function (d) { return d.date < today && d.count > (exported[d.date] || 0); })
      .map(function (d) { return d.date; });
  }

  function show(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso); return m ? m[3] + '-' + m[2] + '-' + m[1] : iso; }

  // 'bills-07-10-2026.xlsx' for one day, 'bills-04-10-2026_to_07-10-2026.xlsx' for a range
  function fileName(bills) {
    if (!bills.length) return 'bills.xlsx';
    var days = dayTotals(bills), first = show(days[0].date), last = show(days[days.length - 1].date);
    return first === last ? 'bills-' + first + '.xlsx' : 'bills-' + first + '_to_' + last + '.xlsx';
  }

  // A real Excel date (serial number) that Excel shows as 07-10-2026 whatever the PC's regional settings.
  function dateCell(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return iso;
    return { t: 'n', v: Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000), z: 'dd-mm-yyyy' };
  }

  function productName(it) { return it.name_ta ? it.name_en + ' - ' + it.name_ta : it.name_en; }

  // Sheet "Bills": one row per bill (date, bill number, total).
  // Sheet "Bill items": one row per item of every bill; bills saved before items were kept have no rows there.
  // Dates are real Excel dates shown as dd-mm-yyyy; bill numbers read DDMMYYYY-NNN.
  function buildWorkbook(XLSX, bills) {
    var sorted = sortBills(bills), wb = XLSX.utils.book_new();
    var rows = [['date', 'bill_no', 'total']].concat(sorted.map(function (b) { return [dateCell(b.date), Bill.label(b), b.total]; }));
    var ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 12 }];
    for (var r = 2; r <= rows.length; r++) ws['C' + r].z = '0.00';
    XLSX.utils.book_append_sheet(wb, ws, 'Bills');

    var irows = [['date', 'bill_no', 'sno', 'product_name', 'qty', 'unit', 'amt', 't_amount']];
    sorted.forEach(function (b) {
      (b.items || []).forEach(function (it, i) {
        irows.push([dateCell(b.date), Bill.label(b), i + 1, productName(it), it.qty, Bill.unitLabel(it.unit), it.price, it.amount]);
      });
    });
    var is = XLSX.utils.aoa_to_sheet(irows);
    is['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 5 }, { wch: 34 }, { wch: 8 }, { wch: 6 }, { wch: 10 }, { wch: 11 }];
    for (var q = 2; q <= irows.length; q++) { is['G' + q].z = '0.00'; is['H' + q].z = '0.00'; }
    XLSX.utils.book_append_sheet(wb, is, 'Bill items');
    return wb;
  }

  var api = { sortBills: sortBills, dayTotals: dayTotals, pendingDays: pendingDays, fileName: fileName, buildWorkbook: buildWorkbook };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Export = api;
})(typeof window !== 'undefined' ? window : this);
