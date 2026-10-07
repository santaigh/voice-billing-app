/* Reads products.xlsx and checks every row. Pure functions: no DOM, no storage. */
(function (root) {
  'use strict';

  var REQUIRED = ['code', 'name_en', 'price'];

  function text(v) {
    return v === undefined || v === null ? '' : String(v).trim();
  }

  // 48, "48", "₹48.50", "1,250" -> number; anything else -> NaN
  function parsePrice(v) {
    if (typeof v === 'number') return v;
    var s = text(v).replace(/[₹,\s]/g, '').replace(/^rs\.?/i, '');
    return s === '' ? NaN : Number(s);
  }

  function parseAliases(v) {
    var seen = {};
    return text(v).split(/[,;|]/).map(function (a) { return a.trim().toLowerCase(); })
      .filter(function (a) { if (!a || seen[a]) return false; seen[a] = true; return true; });
  }

  // rows: array of objects keyed by header. Excel row number = index + 2 (row 1 is the header).
  function validateRows(rows) {
    var products = [], errors = [], seen = {};
    rows.forEach(function (r, i) {
      var rowNo = i + 2;
      var code = text(r.code), name = text(r.name_en), price = parsePrice(r.price);
      if (!code && !name && text(r.price) === '') return; // fully blank row: ignore silently
      function fail(msg) { errors.push({ row: rowNo, code: code, message: msg }); }
      if (!code) return fail('code is missing');
      if (!name) return fail('name_en is missing');
      if (!isFinite(price)) return fail('price is missing or not a number');
      if (price <= 0) return fail('price must be above 0');
      var key = code.toLowerCase();
      if (seen[key]) return fail('duplicate code (first one on row ' + seen[key] + ' was kept)');
      seen[key] = rowNo;
      products.push({
        code: code,
        name_en: name,
        name_ta: text(r.name_ta),
        unit: text(r.unit).toUpperCase() || 'PCS',
        price: Math.round(price * 100) / 100,
        aliases: parseAliases(r.aliases)
      });
    });
    return { products: products, errors: errors };
  }

  // buffer: ArrayBuffer of an .xlsx file. Throws Error with a readable message on a bad file.
  function parseWorkbook(XLSX, buffer) {
    var wb;
    try { wb = XLSX.read(buffer, { type: 'array' }); }
    catch (e) { throw new Error('This file could not be read as an Excel sheet.'); }
    if (!wb.SheetNames.length) throw new Error('The workbook has no sheets.');
    var sheet = wb.Sheets[wb.SheetNames[0]];
    var rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
    if (!rows.length) throw new Error('The first sheet has no product rows.');
    // normalise header names: "Name_EN " -> "name_en"
    rows = rows.map(function (r) {
      var o = {};
      Object.keys(r).forEach(function (k) { o[k.trim().toLowerCase()] = r[k]; });
      return o;
    });
    var missing = REQUIRED.filter(function (c) { return !(c in rows[0]); });
    if (missing.length) throw new Error('Missing column(s): ' + missing.join(', ') + '. Expected: code, name_en, name_ta, unit, price, aliases.');
    return validateRows(rows);
  }

  var api = { validateRows: validateRows, parseWorkbook: parseWorkbook, parsePrice: parsePrice };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Catalog = api;
})(typeof window !== 'undefined' ? window : this);
