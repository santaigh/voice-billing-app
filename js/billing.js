/* Billing screen: live voice, the growing bill table, Generate Bill / "bill confirm", receipt. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;   // textContent only: product names are never parsed as HTML
    return e;
  }

  var TRASH = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M9 3a1 1 0 0 0-1 1v1H4.5a1 1 0 1 0 0 2H5l.8 12.1A2 2 0 0 0 7.8 21h8.4a2 2 0 0 0 2-1.9L19 7h.5a1 1 0 1 0 0-2H16V4a1 1 0 0 0-1-1H9zm1 2h4v0H10V5zM9.5 10a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1zm5 0a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1z"/></svg>';
  var CONFIRM_SECONDS = 3, UNDO_MS = 7000, SAVED_MS = 60000;

  var products = [], cart = [], shopName = '', busy = false, matchIndex = null, liveCtl = null;
  var undoState = null, undoTimer = null, confirmTimer = null, confirmLeft = 0, lastReceipt = null, savedTimer = null;

  // ---- search (typing) and the suggestion list ----
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
    renderList(found.map(function (p) { return { p: p, hint: priceHint(p), pick: function () { addToCart(p, 1, { focus: true }); } }; }));
    $('bill-nomatch').hidden = !q || found.length > 0;
  }

  function clearSearch(focus) {
    $('bill-search').value = '';
    showResults();
    if (focus) $('bill-search').focus();   // only for typed picks: a voice add must not pop the keyboard up
  }

  // ---- the bill table ----
  function productName(l) { return l.name_ta ? l.name_en + ' - ' + l.name_ta : l.name_en; }

  // qty: how many to add (default 1). A product already on the bill gets the quantity added to its row.
  // Returns { wasNew } so an add can be undone.
  function addToCart(p, qty, opts) {
    opts = opts || {};
    qty = qty || 1;
    billChanged();
    var line = cart.filter(function (l) { return l.code === p.code; })[0], wasNew = !line;
    if (line) {
      var q = Bill.parseQty(line.qtyText, line.unit);
      line.qtyText = Bill.formatQty(isFinite(q) ? q + qty : qty);
    } else {
      cart.push({ code: p.code, name_en: p.name_en, name_ta: p.name_ta || '', unit: p.unit, qtyText: Bill.formatQty(qty), priceText: p.price.toFixed(2) });
    }
    render(p.code);
    clearSearch(opts.focus);
    return { wasNew: wasNew };
  }

  function removeLine(i) { billChanged(); cart.splice(i, 1); render(); }

  function render(flashCode) {
    var tbody = $('bill-cart');
    tbody.textContent = '';
    cart.forEach(function (line, i) {
      var tr = el('tr', 'line');
      tr.setAttribute('data-code', line.code);
      tr.appendChild(el('td', 'c-sno', String(i + 1)));

      var price = el('input', 'l-price');
      price.value = line.priceText;
      price.setAttribute('inputmode', 'decimal');
      price.setAttribute('aria-label', 'Price of ' + line.name_en);
      var tdAmt = el('td', 'c-amt');
      tdAmt.appendChild(price);
      tr.appendChild(tdAmt);

      tr.appendChild(el('td', 'c-name', productName(line)));

      var qty = el('input', 'l-qty');
      qty.value = line.qtyText;
      qty.setAttribute('inputmode', Bill.allowsDecimal(line.unit) ? 'decimal' : 'numeric');
      qty.setAttribute('aria-label', 'Quantity of ' + line.name_en);
      var tdQty = el('td', 'c-qty');
      tdQty.appendChild(qty);
      tdQty.appendChild(el('span', 'l-unit', Bill.unitLabel(line.unit)));
      tr.appendChild(tdQty);

      var total = el('span', 'l-total');
      var tdTotal = el('td', 'c-total');
      tdTotal.appendChild(total);
      tr.appendChild(tdTotal);

      var rm = el('button', 'l-remove');
      rm.type = 'button';
      rm.innerHTML = TRASH;                                   // constant markup, no data in it
      rm.setAttribute('aria-label', 'Remove ' + line.name_en);
      rm.addEventListener('click', function () { removeLine(i); });
      var tdOps = el('td', 'c-ops');
      tdOps.appendChild(rm);
      tr.appendChild(tdOps);

      [qty, price].forEach(function (inp) {
        inp.addEventListener('focus', function () { inp.select(); });
        inp.addEventListener('input', function () {
          billChanged();
          line.qtyText = qty.value; line.priceText = price.value;
          updateTotals();
        });
      });

      tbody.appendChild(tr);
      line.ui = { qty: qty, price: price, total: total };
      if (flashCode && line.code === flashCode) {
        tr.classList.add('flash');
        if (tr.scrollIntoView) tr.scrollIntoView({ block: 'nearest' });
      }
    });
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
    $('bill-foot-total').textContent = Bill.formatMoney(sum);
    $('bill-table').hidden = cart.length === 0;
    $('bill-generate').disabled = !allOk || busy;
    var bad = cart.length > 0 && !allOk;
    $('bill-msg').hidden = !bad;
    if (bad) {
      $('bill-msg').className = 'status warn';
      $('bill-msg').textContent = 'Fix the highlighted quantity or price. Loose items (kg, litre) allow decimals; packets and pieces need whole numbers.';
    }
  }

  function billable() {
    return cart.length > 0 && cart.every(function (l) { return Bill.evalLine(l).ok; });
  }

  // Anything that changes the bill calls this: a pending "bill confirm" must not save a bill that is no longer what was confirmed.
  function billChanged() {
    if (confirmTimer) stopConfirm('The bill changed, so the confirmation was cancelled. Say “bill confirm” again when ready.');
  }

  // ---- undo for voice adds ----
  function showUndo(p, qty, info) {
    undoState = { code: p.code, qty: qty, wasNew: info.wasNew };
    $('undo-text').textContent = 'Added ' + p.name_en + ' · ' + Bill.formatQty(qty) + ' ' + Bill.unitLabel(p.unit);
    $('undo-bar').hidden = false;
    clearTimeout(undoTimer);
    undoTimer = setTimeout(hideUndo, UNDO_MS);
  }

  function hideUndo() { clearTimeout(undoTimer); undoState = null; $('undo-bar').hidden = true; }

  function doUndo() {
    var u = undoState;
    hideUndo();
    if (!u) return;
    billChanged();
    for (var i = 0; i < cart.length; i++) {
      if (cart[i].code !== u.code) continue;
      var q = Bill.parseQty(cart[i].qtyText, cart[i].unit), left = isFinite(q) ? Math.round((q - u.qty) * 1000) / 1000 : 0;
      if (u.wasNew || left <= 0) cart.splice(i, 1); else cart[i].qtyText = Bill.formatQty(left);
      break;
    }
    render();
  }

  // ---- "bill confirm": a short countdown, then the same thing as Generate Bill ----
  function paintConfirm() {
    $('confirm-text').textContent = 'Saving bill ₹ ' + $('bill-total').textContent + ' in ' + confirmLeft + '… say “cancel” to stop';
    $('confirm-bar').hidden = false;
  }

  function stopConfirm(msg) {
    if (confirmTimer) { clearInterval(confirmTimer); confirmTimer = null; }
    $('confirm-bar').hidden = true;
    if (msg) setHeard(msg, 'warn');
  }

  function requestConfirm() {
    if (confirmTimer) return;
    if (!cart.length) { setHeard('Heard “bill confirm” — but the bill is empty.', 'warn'); return; }
    if (!billable()) { setHeard('Cannot confirm yet: fix the highlighted quantity or price.', 'warn'); return; }
    confirmLeft = CONFIRM_SECONDS;
    paintConfirm();
    setHeard('', '');
    confirmTimer = setInterval(function () {
      confirmLeft--;
      if (confirmLeft <= 0) { stopConfirm(); generate(); } else paintConfirm();
    }, 1000);
  }

  // ---- generate + receipt ----
  function generate() {
    stopConfirm();
    if (busy || !cart.length) return;
    var lines = cart.map(function (l) { var r = Bill.evalLine(l); return { name: l.name_en, unit: l.unit, qty: r.qty, price: r.price, amountPaise: r.totalPaise, ok: r.ok }; });
    if (!lines.every(function (l) { return l.ok; })) return;
    var totalPaise = lines.reduce(function (s, l) { return s + l.amountPaise; }, 0), now = new Date();
    busy = true; updateTotals();
    Store.saveBill(totalPaise / 100, now).then(function (bill) {
      lastReceipt = { bill: bill, now: now, lines: lines, totalPaise: totalPaise };
      cart = []; render(); hideUndo();
      showSaved(bill, totalPaise);                              // saved and closed: ready for the next customer; printing is a separate step
    }).catch(function () {
      $('bill-msg').hidden = false;
      $('bill-msg').className = 'status bad';
      $('bill-msg').textContent = 'The bill could not be saved. Your items are still here — try again.';
    }).then(function () { busy = false; updateTotals(); });
  }

  // ---- bill saved: print on request ("print bill" or the Print button) ----
  function showSaved(bill, totalPaise) {
    $('saved-text').textContent = 'Bill ' + bill.billNo + ' saved · ₹ ' + Bill.formatMoney(totalPaise) + ' — say “print bill”';
    $('saved-bar').hidden = false;
    clearTimeout(savedTimer);
    savedTimer = setTimeout(hideSaved, SAVED_MS);
  }

  function hideSaved() { clearTimeout(savedTimer); $('saved-bar').hidden = true; }

  // Prints the last CONFIRMED bill, never the one still being built.
  function printLast() {
    if (!lastReceipt) { setHeard('No confirmed bill to print yet. Say “bill confirm” first.', 'warn'); return; }
    hideSaved();
    setHeard('Printing bill ' + lastReceipt.bill.billNo + '…', 'ok');
    showReceipt(lastReceipt);
    window.print();
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
  }

  // ---- live voice ----
  var LIVE_HINT = '● LIVE — say a product, e.g. “Maida 2 kg”. “Bill confirm” saves the bill, “print bill” prints it.';
  var VOICE_ERRORS = {
    'not-allowed': 'The microphone is blocked. Allow it for this site in Chrome settings, then tap the mic again.',
    'service-not-allowed': 'The microphone is blocked. Allow it for this site in Chrome settings, then tap the mic again.',
    'network': 'Voice needs internet, so listening stopped. Type the product name, or tap the mic again when online.',
    'audio-capture': 'No microphone found.',
    'language-not-supported': 'This language is not available for voice on this device.',
    'unstable': 'The microphone keeps cutting out, so live listening stopped. Tap the mic to start again.',
    'start-failed': 'Could not start the microphone. Tap the mic to try again.'
  };

  function setHeard(text, kind) {
    var h = $('voice-heard');
    h.textContent = text;
    h.className = 'heard ' + (kind || '');
    h.hidden = !text;
  }

  function setMic(on) {
    var b = $('bill-mic');
    b.classList.toggle('listening', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.setAttribute('aria-label', on ? 'Stop live listening' : 'Start live listening');
    $('bill-lang').disabled = on;
    $('voice-live').hidden = !on;
    if (on) $('voice-live').textContent = LIVE_HINT;
  }

  // One finished phrase from the microphone. alts = the engine's guesses, best first.
  function handleSpoken(alts) {
    if (!alts.length || !matchIndex) return;
    if (!$('receipt-overlay').hidden) return;                     // receipt still open: not for the next customer yet
    if (confirmTimer && Parse.isCancel(alts)) { stopConfirm(''); setHeard('Cancelled. The bill is still open.', 'ok'); return; }
    if (Parse.isConfirm(alts)) { requestConfirm(); return; }
    if (Parse.isPrint(alts)) { printLast(); return; }

    var parsed = null, dec = { candidates: [], auto: null };
    for (var i = 0; i < alts.length && !dec.candidates.length; i++) {
      parsed = Parse.parse(alts[i]);
      dec = parsed.phrase ? Match.decide(matchIndex, parsed.phrase, 3) : dec;
    }
    var said = '“' + alts[0].trim() + '”';
    if (!dec.candidates.length) {                                // chatter or something unknown: ignore it quietly
      setHeard('Heard ' + said + ' — no product matched, ignored.', 'muted');
      return;
    }

    if (dec.auto) {
      var q = Parse.qtyFor(parsed, dec.auto);
      if (!q.note) {                                             // clear and unambiguous: add it
        var wasPending = !!confirmTimer;
        var info = addToCart(dec.auto, q.qty);
        showUndo(dec.auto, q.qty, info);
        setHeard('Heard ' + said + ' → added.' + (wasPending ? ' Confirmation cancelled — say “bill confirm” again when ready.' : ''), 'ok');
        return;
      }
    }

    // Several products could be meant (or the unit did not fit): ask, and keep listening.
    $('bill-search').value = parsed.phrase;
    setHeard('Heard ' + said + (parsed.qty !== null ? ' → ' + Bill.formatQty(parsed.qty) + (parsed.unit ? ' ' + parsed.unit : '') : '') + '. Tap the right product:', 'ok');
    var entries = dec.candidates.map(function (p) {
      var qq = Parse.qtyFor(parsed, p);
      return {
        p: p,
        hint: (qq.note ? '⚠ ' : '') + Bill.formatQty(qq.qty) + ' ' + Bill.unitLabel(p.unit) + ' · ₹' + p.price.toFixed(2),
        pick: function () { var inf = addToCart(p, qq.qty); showUndo(p, qq.qty, inf); setHeard(qq.note, qq.note ? 'warn' : ''); }
      };
    });
    var all = Search.find(products, parsed.phrase, 8);
    renderList(entries, all.length > dec.candidates.length ? { label: 'See all matches for “' + parsed.phrase + '”', pick: function () { setHeard(''); showResults(); } } : null);
  }

  function toggleMic() {
    if (liveCtl) { liveCtl.stop(); return; }
    setHeard('');
    liveCtl = Voice.live(Voice.getLang().code, {
      onStart: function () { setMic(true); },
      onInterim: function (t) { $('voice-live').textContent = '● LIVE · “' + t.trim() + '”'; },
      onFinal: function (alts) { $('voice-live').textContent = LIVE_HINT; handleSpoken(alts); },
      onError: function (code) { renderList([]); setHeard(VOICE_ERRORS[code] || 'Voice did not work (' + code + '). Type the name instead.', 'bad'); },
      onStop: function () { liveCtl = null; setMic(false); }
    });
  }

  function init() {
    $('bill-search').addEventListener('input', showResults);
    $('bill-search').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      var first = Search.find(products, $('bill-search').value, 1)[0];
      if (first) addToCart(first, 1, { focus: true });
    });
    $('bill-generate').addEventListener('click', generate);
    $('bill-mic').addEventListener('click', toggleMic);
    $('bill-lang').textContent = Voice.getLang().label;
    $('bill-lang').addEventListener('click', function () { $('bill-lang').textContent = Voice.nextLang().label; });
    if (!Voice.supported) {
      $('bill-mic').disabled = true; $('bill-lang').disabled = true;
      setHeard("Voice isn't available in this browser. Use Chrome on Android, or type the product name.", 'warn');
    }
    $('undo-btn').addEventListener('click', doUndo);
    $('confirm-cancel').addEventListener('click', function () { stopConfirm(''); setHeard('Cancelled. The bill is still open.', 'ok'); });
    $('receipt-print').addEventListener('click', function () { window.print(); });
    $('receipt-new').addEventListener('click', closeReceipt);
    $('saved-print').addEventListener('click', printLast);
    window.addEventListener('afterprint', function () { if (!$('receipt-overlay').hidden) closeReceipt(); });   // print dialog closed: back to billing
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
