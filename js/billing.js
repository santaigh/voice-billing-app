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

  var products = [], cart = [], shopName = '', busy = false;

  // ---- search ----
  function showResults() {
    var ul = $('bill-results'), found = Search.find(products, $('bill-search').value, 8);
    ul.textContent = '';
    found.forEach(function (p) {
      var li = el('li'), b = el('button', 'result');
      b.type = 'button';
      var left = el('span', 'r-left');
      left.appendChild(el('span', 'r-en', p.name_en));
      if (p.name_ta) left.appendChild(el('span', 'r-ta', p.name_ta));
      b.appendChild(left);
      b.appendChild(el('span', 'r-price', '₹' + p.price.toFixed(2) + ' / ' + p.unit));
      b.addEventListener('click', function () { addToCart(p); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    var q = $('bill-search').value.trim();
    ul.hidden = !found.length;
    $('bill-nomatch').hidden = !q || found.length > 0;
  }

  function clearSearch() {
    $('bill-search').value = '';
    showResults();
    $('bill-search').focus();
  }

  // ---- cart ----
  function addToCart(p) {
    var line = cart.filter(function (l) { return l.code === p.code; })[0];
    if (line) {
      var q = Bill.parseQty(line.qtyText, line.unit);
      line.qtyText = Bill.formatQty(isFinite(q) ? q + 1 : 1);   // same product again = one more
    } else {
      cart.push({ code: p.code, name_en: p.name_en, unit: p.unit, qtyText: '1', priceText: p.price.toFixed(2) });
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

  function init() {
    $('bill-search').addEventListener('input', showResults);
    $('bill-search').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      var first = Search.find(products, $('bill-search').value, 1)[0];
      if (first) addToCart(first);
    });
    $('bill-generate').addEventListener('click', generate);
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
      showResults();
    }
  };
})();
