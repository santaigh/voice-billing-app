/* Thin wrapper over the browser's speech recognition (Chrome: Google's speech service, needs internet). */
(function (root) {
  'use strict';

  var SR = root.SpeechRecognition || root.webkitSpeechRecognition;
  var LANGS = [{ code: 'en-IN', label: 'EN' }, { code: 'ta-IN', label: 'தமிழ்' }];

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

  // handlers: onStart(), onInterim(text), onFinal([alternatives, best first]), onError(code), onEnd()
  // Returns { stop() }. Exactly one of onFinal / onError fires per listen.
  function listen(lang, h) {
    var rec = new SR(), settled = false;
    rec.lang = lang;
    rec.interimResults = true;
    rec.maxAlternatives = 3;
    rec.continuous = false;
    rec.onstart = function () { h.onStart(); };
    rec.onresult = function (e) {
      var res = e.results[e.results.length - 1];
      if (res.isFinal) {
        settled = true;
        var alts = [];
        for (var i = 0; i < res.length; i++) alts.push(res[i].transcript);
        h.onFinal(alts);
      } else h.onInterim(res[0].transcript);
    };
    rec.onerror = function (e) { if (!settled) { settled = true; h.onError(e.error); } };
    rec.onend = function () { if (!settled) { settled = true; h.onError('no-speech'); } h.onEnd(); };
    try { rec.start(); } catch (e) { settled = true; h.onError('start-failed'); h.onEnd(); }
    return { stop: function () { try { rec.stop(); } catch (e) { /* already stopped */ } } };
  }

  root.Voice = { supported: !!SR, langs: LANGS, getLang: getLang, nextLang: nextLang, listen: listen };
})(typeof window !== 'undefined' ? window : this);
