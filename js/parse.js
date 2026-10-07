/* Turns what the cashier said into {qty, unit, phrase}. Pure functions.
   "rendu kilo sakkarai" -> qty 2, unit KG, phrase "sakkarai". */
(function (root) {
  'use strict';

  var NUMBERS = {
    // English
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    half: 0.5, quarter: 0.25,
    // Tamil, written in English letters
    onnu: 1, ondru: 1, oru: 1, rendu: 2, irandu: 2, moonu: 3, mundru: 3, munu: 3, naalu: 4, naangu: 4,
    anju: 5, ainthu: 5, aaru: 6, arru: 6, ezhu: 7, ettu: 8, ombathu: 9, onbadhu: 9, pathu: 10, patthu: 10,
    arai: 0.5, kaal: 0.25, mukkaal: 0.75, onnara: 1.5, ondrarai: 1.5, rendara: 2.5, irandarai: 2.5,
    // Tamil script
    'ஒன்று': 1, 'ஒரு': 1, 'ஒண்ணு': 1, 'இரண்டு': 2, 'ரெண்டு': 2, 'மூன்று': 3, 'மூணு': 3, 'நான்கு': 4, 'நாலு': 4,
    'ஐந்து': 5, 'அஞ்சு': 5, 'ஆறு': 6, 'ஏழு': 7, 'எட்டு': 8, 'ஒன்பது': 9, 'பத்து': 10,
    'அரை': 0.5, 'கால்': 0.25, 'முக்கால்': 0.75, 'ஒன்றரை': 1.5, 'இரண்டரை': 2.5
  };

  var UNITS = {
    kg: 'KG', kgs: 'KG', kilo: 'KG', kilos: 'KG', kilogram: 'KG', kilograms: 'KG', 'கிலோ': 'KG',
    g: 'G', gm: 'G', gms: 'G', gram: 'G', grams: 'G', 'கிராம்': 'G',
    l: 'LTR', ltr: 'LTR', litre: 'LTR', litres: 'LTR', liter: 'LTR', liters: 'LTR', 'லிட்டர்': 'LTR',
    ml: 'ML', millilitre: 'ML', millilitres: 'ML', milliliter: 'ML', milliliters: 'ML', 'மில்லி': 'ML',
    packet: 'PKT', packets: 'PKT', pkt: 'PKT', pack: 'PKT', packs: 'PKT', 'பாக்கெட்': 'PKT',
    piece: 'PCS', pieces: 'PCS', pcs: 'PCS', nos: 'PCS', number: 'PCS', numbers: 'PCS', 'எண்': 'PCS'
  };

  var FILLER = {};
  ('a an the and of for to me please give i want need kudu kudunga kodu venum vendum thaanga tharuga ' +
   'கொடு கொடுங்க தாங்க வேண்டும் வேணும்').split(' ').forEach(function (w) { FILLER[w] = 1; });
  var CONNECTORS = { and: 1, a: 1 };

  function tokenize(text) {
    var s = String(text || '').toLowerCase()
      .replace(/(\d)([a-z஀-௿])/g, '$1 $2').replace(/([a-z஀-௿])(\d)/g, '$1 $2')   // "2kg" -> "2 kg"
      .replace(/[^a-z0-9஀-௿./,\s]/g, ' ').replace(/[.,]+(\s|$)/g, ' ');                       // drop punctuation, keep 2.5
    return s.split(/\s+/).filter(Boolean).map(function (w) {
      var t = { w: w }, m;
      if (/^\d+([.,]\d+)?$/.test(w)) t.n = Number(w.replace(',', '.'));
      else if ((m = /^(\d+)\/(\d+)$/.exec(w)) && Number(m[2])) t.n = Number(m[1]) / Number(m[2]);
      else if (Object.prototype.hasOwnProperty.call(NUMBERS, w)) t.n = NUMBERS[w];
      if (Object.prototype.hasOwnProperty.call(UNITS, w)) t.u = UNITS[w];
      return t;
    });
  }

  // "three quarter(s)" is 0.75, not 3.25
  var QUARTERS = { quarter: 1, quarters: 1, fourth: 1, fourths: 1 };
  function mergeThreeQuarters(tokens) {
    var out = [];
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i], nx = tokens[i + 1];
      if (t.w === 'three' && nx && QUARTERS[nx.w]) { out.push({ w: 'three quarter', n: 0.75 }); i++; } else out.push(t);
    }
    return out;
  }

  function parse(text) {
    var tokens = mergeThreeQuarters(tokenize(text)), used = [], qty = null, unit = null, i, j;

    // first group of number words/digits: "one and a half", "2", "rendu"
    for (i = 0; i < tokens.length && tokens[i].n === undefined; i++);
    if (i < tokens.length) {
      var sum = 0;
      j = i;
      for (;;) {
        if (j < tokens.length && tokens[j].n !== undefined) { sum += tokens[j].n; used[j] = 1; j++; continue; }
        var k = j;
        while (k < tokens.length && CONNECTORS[tokens[k].w]) k++;
        if (k > j && k < tokens.length && tokens[k].n !== undefined) { for (; j < k; j++) used[j] = 1; continue; }
        break;
      }
      qty = sum;
    }

    // the unit: right after the number if there, else the first unit word anywhere
    var at = -1;
    if (qty !== null && j < tokens.length && tokens[j].u) at = j;
    else for (i = 0; i < tokens.length; i++) if (tokens[i].u && !used[i]) { at = i; break; }
    if (at >= 0) { unit = tokens[at].u; used[at] = 1; }

    var phrase = tokens.filter(function (t, idx) { return !used[idx] && !FILLER[t.w]; })
      .map(function (t) { return t.w; }).join(' ');
    return { qty: qty, unit: unit, phrase: phrase };
  }

  // What quantity should the cart line get for this product?
  // Returns { qty, note }. note is set when what was said does not fit how the product is sold;
  // the quantity then falls back to 1 rather than guessing.
  var TO_BASE = { G: ['KG', 1000], ML: ['LTR', 1000] };
  function qtyFor(parsed, product) {
    if (parsed.qty === null) return { qty: 1, note: '' };
    var q = parsed.qty, said = parsed.unit, sold = product.unit;
    if (said && TO_BASE[said] && TO_BASE[said][0] === sold) q = q / TO_BASE[said][1];
    else if (said && said !== sold && !(said === 'PKT' && sold === 'PCS') && !(said === 'PCS' && sold === 'PKT')) {
      // "500 gram" of an item sold by the packet: the number means nothing here, so never carry it over
      return { qty: 1, note: 'You said ' + parsed.qty + ' ' + said + ' but ' + product.name_en + ' is sold per ' + sold + '. Quantity set to 1 — check it.' };
    }
    var decimalOk = sold === 'KG' || sold === 'LTR';
    q = Math.round(q * 1000) / 1000;
    if (q <= 0 || (!decimalOk && q !== Math.floor(q))) {
      return { qty: 1, note: 'Could not use quantity ' + parsed.qty + ' for ' + product.name_en + ' (sold per ' + sold + '); set to 1.' };
    }
    return { qty: q, note: '' };
  }

  var api = { parse: parse, qtyFor: qtyFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Parse = api;
})(typeof window !== 'undefined' ? window : this);
