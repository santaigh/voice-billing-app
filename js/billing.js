/* Billing screen: search, cart, Generate Bill, receipt. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;   // textContent only: product names are never parsed as HTML
    return e;
  }

  var products = [], cart = [], shopName = '', busy = false, matchIndex = null, listening = null;

  // ---- search ----
  // entries: [{ p, hint, pick }]. Used for typed results and for voice suggestions alike.
  function renderList(entries, more) {
    var ul = $('bill-results');
    ul.textContent = '';
    entries.forEach(function (en) {
      var li = el('li'), b = el('button', 'result');
      b.type = 'button';
      var left = el('span', 'r-left');
      left.appendChild(el('span', 'r-en', en.p.name_en));
      if (en.p.name_ta) left.appendChild(el('span', 'r-ta', en.p.name_ta));
      b.appendChild(left);
      b.appendChild(el('span', 'r-price', en.hint));
      b.addEventListener('click', en.pick);
      li.appendChild(b);
      ul.appendChild(li);
    });
    if (more) {
      var li2 = el('li'), mb = el('button', 'result more', more.label);
      mb.type = 'button';
      mb.addEventListener('click', more.pick);
      li2.appendChild(mb);
      ul.appendChild(li2);
    }
    ul.hidden = !entries.length;
  }

  function priceHint(p) { return '₹' + p.price.toFixed(2) + ' / ' + p.unit; }

  function showResults() {
    var found = Search.find(products, $('bill-search').value, 8), q = $('bill-search').value.trim();
    renderList(found.map(function (p) { return { p: p, hint: priceHint(p), pick: function () { addToCart(p); } }; }));
    $('bill-nomatch').hidden = !q || found.length > 0;
  }

  function clearSearch() {
    $('bill-search').value = '';
    showResults();
    $('bill-search').focus();
  }

  // ---- cart ----
  // qty: how many to add (default 1). Adding a product already in the cart adds to its quantity.
  function addToCart(p, qty) {
    qty = qty || 1;
    var line = cart.filter(function (l) { return l.code === p.code; })[0];
    if (line) {
      var q = Bill.parseQty(line.qtyText, line.unit);
      line.qtyText = Bill.formatQty(isFinite(q) ? q + qty : qty);
    } else {
      cart.push({ code: p.code, name_en: p.name_en, unit: p.unit, qtyText: Bill.formatQty(qty), priceText: p.price.toFixed(2) });
    }
    render();
    clearSearch();
  }

  function render() {
    var ul = $('bill-cart');
    ul.textContent = '';
    cart.forEach(function (line, i) {
      var li = el('li', 'line'), head = el('div', 'l-head');
      head.appendChild(el('strong', 'l-name', line.name_en));
      var rm = el('button', 'l-remove', '✕');
      rm.type = 'button';
      rm.setAttribute('aria-label', 'Remove ' + line.name_en);
      rm.addEventListener('click', function () { cart.splice(i, 1); render(); });
      head.appendChild(rm);

      var row = el('div', 'l-row');
      var qty = el('input', 'l-qty');
      qty.value = line.qtyText;
      qty.setAttribute('inputmode', Bill.allowsDecimal(line.unit) ? 'decimal' : 'numeric');
      qty.setAttribute('aria-label', 'Quantity of ' + line.name_en);
      var price = el('input', 'l-price');
      price.value = line.priceText;
      price.setAttribute('inputmode', 'decimal');
      price.setAttribute('aria-label', 'Price of ' + line.name_en);
      var total = el('span', 'l-total');
      [qty, price].forEach(function (inp) {
        inp.addEventListener('focus', function () { inp.select(); });
        inp.addEventListener('input', function () {
          line.qtyText = qty.value; line.priceText = price.value;
          updateTotals();
        });
      });
      row.appendChild(qty);
      row.appendChild(el('span', 'l-unit', line.unit));
      row.appendChild(el('span', 'l-x', '×'));
      row.appendChild(el('span', 'l-rs', '₹'));
      row.appendChild(price);
      row.appendChild(total);

      li.appendChild(head);
      li.appendChild(row);
      ul.appendChild(li);
      line.ui = { qty: qty, price: price, total: total };
    });
    $('bill-empty').hidden = cart.length > 0;
    updateTotals();
  }

  function updateTotals() {
    var sum = 0, allOk = cart.length > 0;
    cart.forEach(function (line) {
      var r = Bill.evalLine(line);
      line.ui.qty.classList.toggle('invalid', !r.qtyOk);
      line.ui.price.classList.toggle('invalid', !r.priceOk);
      line.ui.total.textContent = r.ok ? Bill.formatMoney(r.totalPaise) : '—';
      if (r.ok) sum += r.totalPaise; else allOk = false;
    });
    $('bill-total').textContent = Bill.formatMoney(sum);
    $('bill-generate').disabled = !allOk || busy;
    var bad = cart.length > 0 && !allOk;
    $('bill-msg').hidden = !bad;
    if (bad) {
      $('bill-msg').className = 'status warn';
      $('bill-msg').textContent = 'Fix the highlighted quantity or price. Loose items (kg, litre) allow decimals; packets and pieces need whole numbers.';
    }
  }

  // ---- generate + receipt ----
  function generate() {
    if (busy || !cart.length) return;
    var lines = cart.map(function (l) { var r = Bill.evalLine(l); return { name: l.name_en, unit: l.unit, qty: r.qty, price: r.price, amountPaise: r.totalPaise, ok: r.ok }; });
    if (!lines.every(function (l) { return l.ok; })) return;
    var totalPaise = lines.reduce(function (s, l) { return s + l.amountPaise; }, 0), now = new Date();
    busy = true; updateTotals();
    Store.saveBill(totalPaise / 100, now).then(function (bill) {
      cart = []; render();
      showReceipt({ bill: bill, now: now, lines: lines, totalPaise: totalPaise });
      window.print();
    }).catch(function () {
      $('bill-msg').hidden = false;
      $('bill-msg').className = 'status bad';
      $('bill-msg').textContent = 'The bill could not be saved, so nothing was printed. Your items are still here — try again.';
    }).then(function () { busy = false; updateTotals(); });
  }

  function showReceipt(r) {
    var paper = $('receipt-paper');
    paper.textContent = '';
    if (shopName) paper.appendChild(el('div', 'r-shop', shopName));
    paper.appendChild(el('div', 'r-meta', 'Bill No: ' + r.bill.billNo));
    paper.appendChild(el('div', 'r-meta', Bill.formatDateTime(r.now)));
    paper.appendChild(el('hr'));
    r.lines.forEach(function (l) {
      paper.appendChild(el('div', 'r-name', l.name));
      var calc = el('div', 'r-calc');
      calc.appendChild(el('span', '', Bill.formatQty(l.qty) + ' ' + l.unit + ' × ' + Bill.formatMoney(Bill.toPaise(l.price))));
      calc.appendChild(el('span', '', Bill.formatMoney(l.amountPaise)));
      paper.appendChild(calc);
    });
    paper.appendChild(el('hr'));
    var tot = el('div', 'r-total');
    tot.appendChild(el('span', '', 'TOTAL'));
    tot.appendChild(el('span', '', '₹ ' + Bill.formatMoney(r.totalPaise)));
    paper.appendChild(tot);
    paper.appendChild(el('hr'));
    paper.appendChild(el('div', 'r-thanks', 'Thank you!'));
    $('receipt-overlay').hidden = false;
    document.body.classList.add('receipt-open');
  }

  function closeReceipt() {
    $('receipt-overlay').hidden = true;
    document.body.classList.remove('receipt-open');
    $('bill-search').focus();
  }

  // ---- voice ----
  function setHeard(text, kind) {
    var h = $('voice-heard');
    h.textContent = text;
    h.className = 'heard ' + (kind || '');
    h.hidden = !text;
  }

  var VOICE_ERRORS = {
    'not-allowed': 'The microphone is blocked. Allow it for this site in Chrome settings, then try again.',
    'service-not-allowed': 'The microphone is blocked. Allow it for this site in Chrome settings, then try again.',
    'no-speech': "Didn't catch that. Tap the mic and try again, or type the name.",
    'network': 'Voice needs internet. Type the product name instead.',
    'audio-capture': 'No microphone found.',
    'language-not-supported': 'This language is not available for voice on this device.'
  };

  function setMic(on) {
    var b = $('bill-mic');
    b.classList.toggle('listening', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.setAttribute('aria-label', on ? 'Stop listening' : 'Speak a product name');
    $('bill-lang').disabled = on;
  }

  function onSpoken(alts) {
    // Try what the engine heard best first; fall back to its other guesses if nothing matches.
    var parsed = null, cands = [];
    for (var i = 0; i < alts.length && !cands.length; i++) {
      parsed = Parse.parse(alts[i]);
      cands = parsed.phrase ? Match.find(matchIndex, parsed.phrase, 3) : [];
    }
    var said = '“' + alts[0].trim() + '”';
    if (!cands.length) {
      var first = Parse.parse(alts[0]);
      $('bill-search').value = first.phrase;
      renderList([]);
      setHeard('Heard ' + said + ' — no matching product. Try again, or edit the text above.', 'warn');
      return;
    }
    $('bill-search').value = parsed.phrase;
    var heard = 'Heard ' + said + (parsed.qty !== null ? ' → ' + Bill.formatQty(parsed.qty) + (parsed.unit ? ' ' + parsed.unit : '') : '') + '. Tap the right product:';
    setHeard(heard, 'ok');
    var entries = cands.map(function (p) {
      var q = Parse.qtyFor(parsed, p);
      return {
        p: p,
        hint: (q.note ? '⚠ ' : '') + Bill.formatQty(q.qty) + ' ' + p.unit + ' · ₹' + p.price.toFixed(2),
        pick: function () { addToCart(p, q.qty); setHeard(q.note, q.note ? 'warn' : ''); }
      };
    });
    var all = Search.find(products, parsed.phrase, 8);
    renderList(entries, all.length > cands.length ? { label: 'See all matches for “' + parsed.phrase + '”', pick: function () { setHeard(''); showResults(); } } : null);
  }

  function toggleMic() {
    if (listening) { listening.stop(); return; }
    setHeard('');
    listening = Voice.listen(Voice.getLang().code, {
      onStart: function () { setMic(true); setHeard('Listening…', 'live'); },
      onInterim: function (t) { setHeard('Listening… “' + t + '”', 'live'); },
      onFinal: function (alts) { onSpoken(alts); },
      onError: function (code) { if (code !== 'aborted') { renderList([]); setHeard(VOICE_ERRORS[code] || 'Voice did not work (' + code + '). Type the name instead.', 'bad'); } },
      onEnd: function () { listening = null; setMic(false); }
    });
  }

  function init() {
    $('bill-search').addEventListener('input', showResults);
    $('bill-search').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      var first = Search.find(products, $('bill-search').value, 1)[0];
      if (first) addToCart(first);
    });
    $('bill-generate').addEventListener('click', generate);
    $('bill-mic').addEventListener('click', toggleMic);
    $('bill-lang').textContent = Voice.getLang().label;
    $('bill-lang').addEventListener('click', function () { $('bill-lang').textContent = Voice.nextLang().label; });
    if (!Voice.supported) {
      $('bill-mic').disabled = true; $('bill-lang').disabled = true;
      setHeard("Voice isn't available in this browser. Use Chrome on Android, or type the product name.", 'warn');
    }
    $('receipt-print').addEventListener('click', function () { window.print(); });
    $('receipt-new').addEventListener('click', closeReceipt);
    render();
  }

  window.Billing = {
    init: init,
    setShop: function (name) { shopName = name; },
    setProducts: function (list) {
      products = list;
      $('bill-noproducts').hidden = list.length > 0;
      $('bill-search').disabled = !list.length;
      $('bill-mic').disabled = !list.length || !Voice.supported;
      matchIndex = list.length ? Match.build(Fuse, list, Search) : null;
      showResults();
    }
  };
})();
