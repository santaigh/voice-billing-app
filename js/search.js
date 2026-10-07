/* Typed product search over name, Tamil name, code and aliases. Pure function. */
(function (root) {
  'use strict';

  function norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

  // lower score = better match; -1 = no match
  function score(p, tokens, q) {
    var name = norm(p.name_en), ta = norm(p.name_ta), code = norm(p.code);
    var hay = [name, ta, code].concat(p.aliases || []).join(' | ');
    for (var i = 0; i < tokens.length; i++) if (hay.indexOf(tokens[i]) === -1) return -1;
    if (name === q || ta === q || code === q || (p.aliases || []).indexOf(q) !== -1) return 0;
    if (name.indexOf(q) === 0 || ta.indexOf(q) === 0 || (p.aliases || []).some(function (a) { return a.indexOf(q) === 0; })) return 1;
    var words = (name + ' ' + ta).split(' ');
    if (tokens.every(function (t) { return words.some(function (w) { return w.indexOf(t) === 0; }); })) return 2;
    return 3;
  }

  // [{p, s}] best first. s: 0 exact, 1 starts with, 2 starts a word, 3 merely contains
  function findScored(products, query, limit) {
    var q = norm(query);
    if (!q) return [];
    var tokens = q.split(' ');
    return products.map(function (p) { return { p: p, s: score(p, tokens, q) }; })
      .filter(function (r) { return r.s >= 0; })
      .sort(function (a, b) { return a.s - b.s || (a.p.name_en < b.p.name_en ? -1 : a.p.name_en > b.p.name_en ? 1 : 0); })
      .slice(0, limit || 8);
  }

  function find(products, query, limit) {
    return findScored(products, query, limit).map(function (r) { return r.p; });
  }

  var api = { find: find, findScored: findScored };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Search = api;
})(typeof window !== 'undefined' ? window : this);
