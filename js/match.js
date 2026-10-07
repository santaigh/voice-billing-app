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
    // every folded full name / alias, per product: a spoken phrase equal to one of these is an exact match.
    // Codes are left out: folding would make P001 and P011 the same word.
    var keys = docs.map(function (d) {
      return [d.name, fold(d.ta)].concat(d.aliases).filter(Boolean);
    });
    return { products: products, fuse: fuse, Search: Search, keys: keys };
  }

  // Products whose name, Tamil name, code or alias IS the phrase (spelling variants included).
  function exactMatches(index, phrase) {
    var fq = fold(phrase), seen = {}, out = [];
    index.Search.findScored(index.products, phrase, 1000).forEach(function (r) {
      if (r.s === 0) { seen[r.p.code] = 1; out.push(r.p); }
    });
    index.products.forEach(function (p, i) {
      if (!seen[p.code] && index.keys[i].indexOf(fq) !== -1) { seen[p.code] = 1; out.push(p); }
    });
    return out;
  }

  // Up to `limit` products, best first: exact matches, then starts-with / word matches, then fuzzy ones.
  function find(index, phrase, limit) {
    limit = limit || 3;
    if (String(phrase || '').trim().length < 2) return [];   // a single letter is noise, not a product
    var out = [], seen = {};
    function add(p) { if (!seen[p.code] && out.length < limit) { seen[p.code] = 1; out.push(p); } }
    exactMatches(index, phrase).forEach(add);
    index.Search.findScored(index.products, phrase, limit).filter(function (r) { return r.s <= 2; }).forEach(function (r) { add(r.p); });
    var q = fold(phrase);
    if (q.length >= 2 && out.length < limit) {
      index.fuse.search(q).forEach(function (r) { add(index.products[r.item.i]); });
    }
    return out;
  }

  // { candidates, auto }. `auto` is set only when it is safe to add without asking:
  //   - exactly one product IS what was said (name, Tamil name, code or alias, spelling variants included), or
  //   - nothing is exact and exactly one product starts with / contains the phrase as a word (phrase 3+ letters).
  // A fuzzy-only match never qualifies: a mis-heard word could land on the wrong item.
  function decide(index, phrase, limit) {
    var candidates = find(index, phrase, limit || 3), auto = null;
    if (!candidates.length) return { candidates: [], auto: null };
    var exact = exactMatches(index, phrase);
    if (exact.length === 1) auto = exact[0];
    else if (!exact.length && String(phrase).trim().length >= 3) {
      var precise = index.Search.findScored(index.products, phrase, 1000).filter(function (r) { return r.s <= 2; });
      if (precise.length === 1) auto = precise[0].p;
    }
    if (auto) candidates = [auto].concat(candidates.filter(function (c) { return c !== auto; })).slice(0, limit || 3);
    return { candidates: candidates, auto: auto };
  }

  var api = { build: build, find: find, decide: decide, fold: fold };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Match = api;
})(typeof window !== 'undefined' ? window : this);
