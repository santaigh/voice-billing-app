/* Live (continuous) speech recognition using the browser's own engine (Chrome: Google's speech service, needs internet).
   One tap starts it; it keeps listening, quietly restarting whenever Chrome ends the session, until stop() is called. */
(function (root) {
  'use strict';

  var SR = root.SpeechRecognition || root.webkitSpeechRecognition;
  var LANGS = [{ code: 'en-IN', label: 'EN' }, { code: 'ta-IN', label: 'தமிழ்' }];
  // A session that ends within minRunMs of starting counts as "cutting out"; maxQuick in a row gives up.
  var config = { minRunMs: 1500, maxQuick: 4, restartDelayMs: 250 };

  function getLang() {
    var saved = '';
    try { saved = localStorage.getItem('voice-lang') || ''; } catch (e) { /* private mode */ }
    return LANGS.filter(function (l) { return l.code === saved; })[0] || LANGS[0];
  }

  function nextLang() {
    var cur = getLang(), next = LANGS[(LANGS.indexOf(cur) + 1) % LANGS.length];
    try { localStorage.setItem('voice-lang', next.code); } catch (e) { /* ignore */ }
    return next;
  }

  // handlers: onStart(), onInterim(text), onFinal([alternatives, best first]), onError(code), onStop()
  // onStop fires exactly once, after stop() or after a fatal error (which is reported through onError first).
  // Returns { stop() }.
  function live(lang, h) {
    var stopped = false, finished = false, rec = null, startedAt = 0, quick = 0, first = true, timer = null,
        wake = null, waitingVisible = false;

    function holdScreen() {
      try {
        if (!root.navigator.wakeLock || wake) return;
        root.navigator.wakeLock.request('screen').then(function (s) { if (stopped) s.release(); else wake = s; }, function () { /* not allowed: fine */ });
      } catch (e) { /* unsupported */ }
    }
    function releaseScreen() { try { if (wake) wake.release(); } catch (e) { /* ignore */ } wake = null; }

    function finish() {
      if (finished) return;
      finished = true; stopped = true;
      clearTimeout(timer);
      releaseScreen();
      root.document.removeEventListener('visibilitychange', onVisibility);
      h.onStop();
    }
    function fatal(code) { if (finished) return; stopped = true; try { rec.abort(); } catch (e) { /* ignore */ } h.onError(code); finish(); }

    function onVisibility() {
      if (stopped) return;
      if (!root.document.hidden) { holdScreen(); if (waitingVisible) { waitingVisible = false; begin(); } }
    }

    function begin() {
      var r = new SR(), handled = 0;
      rec = r;
      r.lang = lang; r.continuous = true; r.interimResults = true; r.maxAlternatives = 3;
      r.onstart = function () {
        startedAt = Date.now();
        if (first) { first = false; h.onStart(); }
      };
      r.onresult = function (e) {
        // Handle each final result once, by its index in this session. (Some Android Chrome versions re-send the
        // whole list on every event; counting by index keeps a repeat from being added twice.)
        var res = e.results;
        for (var i = handled; i < res.length; i++) {
          if (!res[i].isFinal) { h.onInterim(res[i][0].transcript); break; }
          var alts = [];
          for (var k = 0; k < res[i].length; k++) alts.push(res[i][k].transcript);
          handled = i + 1;
          h.onFinal(alts);
        }
      };
      r.onerror = function (e) {
        if (r !== rec || e.error === 'aborted' || e.error === 'no-speech') return;   // no-speech: Chrome ends the session; we restart it
        fatal(e.error);
      };
      r.onend = function () {
        if (r !== rec || stopped) return;
        quick = Date.now() - startedAt < config.minRunMs ? quick + 1 : 0;
        if (quick >= config.maxQuick) { fatal('unstable'); return; }
        if (root.document.hidden) { waitingVisible = true; return; }   // app in the background: pick up when it is back
        timer = setTimeout(function () { if (!stopped) begin(); }, config.restartDelayMs);
      };
      try { r.start(); } catch (e) { fatal('start-failed'); }
    }

    root.document.addEventListener('visibilitychange', onVisibility);
    holdScreen();
    begin();
    return {
      stop: function () {
        if (finished) return;
        stopped = true;
        try { rec.stop(); } catch (e) { /* already stopped */ }
        finish();
      }
    };
  }

  root.Voice = { supported: !!SR, langs: LANGS, config: config, getLang: getLang, nextLang: nextLang, live: live };
})(typeof window !== 'undefined' ? window : this);
