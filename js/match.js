/* Finds the products a spoken phrase most likely means. Pure; Fuse is passed in. */
(function (root) {
  'use strict';

  // Speech engines spell Tamil in English letters many ways (sakkarai / chakkarai / sakarai,
  // thengai / tengai, vazhai / valai). Fold the common variants together before comparing.
  function fold(s) {
    return String(s || '').toLowerCase()
      .replace(/(.)\1+/g, '$1')                    // kk -> k, ll -> l, ee -> e, oo -> o
      .replace(/zh/g, 'l').replace(/th/g, 't').replace(/dh/g, 'd').replace(/bh/g, 'b').replace(/kh/g, 'k').replace(/gh/g, 'g')
      .replace(/ph/g, 'f').replace(/w/g, 'v').replace(/ai/g, 'i').replace(/au/g, 'o').replace(/ch/g, 's').replace(/c/g, 'k')
      .replace(/\s+/g, ' ').trim();
  }

  function build(Fuse, products, Search) {
    var docs = products.map(function (p, i) {
      return { i: i, name: fold(p.name_en), ta: String(p.name_ta || '').trim(), aliases: (p.aliases || []).map(fold) };
    });
    var fuse = new Fuse(docs, {
      keys: [{ name: 'name', weight: 0.4 }, { name: 'ta', weight: 0.3 }, { name: 'aliases', weight: 0.3 }],
      includeScore: true, threshold: 0.35, ignoreLocation: true, minMatchCharLength: 2
    });
    return { products: products, fuse: fuse, Search: Search };
  }

  // Up to `limit` products, best first: exact/prefix/word matches, then fuzzy ones to fill the list.
  function find(index, phrase, limit) {
    limit = limit || 3;
    if (String(phrase || '').trim().length < 2) return [];   // a single letter is noise, not a product
    var out = [], seen = {};
    function add(p) { if (!seen[p.code] && out.length < limit) { seen[p.code] = 1; out.push(p); } }
    index.Search.findScored(index.products, phrase, limit).filter(function (r) { return r.s <= 2; }).forEach(function (r) { add(r.p); });
    var q = fold(phrase);
    if (q.length >= 2 && out.length < limit) {
      index.fuse.search(q).forEach(function (r) { add(index.products[r.item.i]); });
    }
    return out;
  }

  var api = { build: build, find: find, fold: fold };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Match = api;
})(typeof window !== 'undefined' ? window : this);
