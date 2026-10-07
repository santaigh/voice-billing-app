/* Bills list helpers and the Excel export. Pure functions: XLSX is passed in. */
(function (root) {
  'use strict';

  // 'YYYYMMDD-001' -> 1
  function seq(billNo) { return parseInt(String(billNo).split('-')[1], 10) || 0; }

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

  function buildWorkbook(XLSX, bills) {
    var sorted = sortBills(bills), wb = XLSX.utils.book_new();
    var rows = [['date', 'bill_no', 'total']].concat(sorted.map(function (b) { return [dateCell(b.date), b.billNo, b.total]; }));
    var ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 12 }];
    for (var r = 2; r <= rows.length; r++) ws['C' + r].z = '0.00';
    XLSX.utils.book_append_sheet(wb, ws, 'Bills');

    var days = dayTotals(sorted), sum = 0, count = 0;
    var drows = [['date', 'bills', 'total']].concat(days.map(function (d) { sum += d.paise; count += d.count; return [dateCell(d.date), d.count, d.paise / 100]; }));
    drows.push(['TOTAL', count, sum / 100]);
    var ds = XLSX.utils.aoa_to_sheet(drows);
    ds['!cols'] = [{ wch: 12 }, { wch: 8 }, { wch: 12 }];
    for (var q = 2; q <= drows.length; q++) ds['C' + q].z = '0.00';
    XLSX.utils.book_append_sheet(wb, ds, 'Daily totals');
    return wb;
  }

  var api = { sortBills: sortBills, dayTotals: dayTotals, pendingDays: pendingDays, fileName: fileName, buildWorkbook: buildWorkbook };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Export = api;
})(typeof window !== 'undefined' ? window : this);
