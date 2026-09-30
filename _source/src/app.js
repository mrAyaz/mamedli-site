(function () {
  'use strict';
  var root = document.documentElement;
  var T = window.__UI__ || {};
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var store = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }
  };

  /* ---------- theme ---------- */
  var sys = window.matchMedia('(prefers-color-scheme: dark)');
  var themeBtn = document.getElementById('theme-toggle');
  function effective() { return root.getAttribute('data-theme') || (sys.matches ? 'dark' : 'light'); }
  function labelTheme() {
    if (!themeBtn) return;
    var dark = effective() === 'dark';
    var label = dark ? T.toLight : T.toDark;
    themeBtn.setAttribute('aria-label', label);
    themeBtn.setAttribute('title', label);
    themeBtn.setAttribute('aria-pressed', String(dark));
  }
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var next = effective() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      store.set('theme', next);
      labelTheme();
    });
  }
  var onSys = function () { if (!store.get('theme')) { root.removeAttribute('data-theme'); labelTheme(); } };
  if (sys.addEventListener) sys.addEventListener('change', onSys); else if (sys.addListener) sys.addListener(onSys);
  labelTheme();
  requestAnimationFrame(function () { requestAnimationFrame(function () { root.classList.add('theme-ready'); }); });

  /* ---------- disclosure helper (language popover, mobile menu) ---------- */
  function disclosure(btn, panel, opts) {
    if (!btn || !panel) return null;
    opts = opts || {};
    function isOpen() { return btn.getAttribute('aria-expanded') === 'true'; }
    function open() {
      panel.hidden = false; btn.setAttribute('aria-expanded', 'true');
      if (opts.openLabel) btn.setAttribute('aria-label', opts.closeLabel);
      var first = panel.querySelector('a, button'); if (first && opts.focusFirst) first.focus();
    }
    function close(returnFocus) {
      if (!isOpen()) return;
      panel.hidden = true; btn.setAttribute('aria-expanded', 'false');
      if (opts.openLabel) btn.setAttribute('aria-label', opts.openLabel);
      if (returnFocus) btn.focus();
    }
    btn.addEventListener('click', function (e) { e.stopPropagation(); isOpen() ? close(false) : open(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isOpen()) close(true); });
    document.addEventListener('click', function (e) { if (isOpen() && !panel.contains(e.target) && !btn.contains(e.target)) close(false); });
    return { close: close, isOpen: isOpen };
  }

  var langBtn = document.getElementById('lang-btn');
  var langMenu = document.getElementById('lang-menu');
  disclosure(langBtn, langMenu, { focusFirst: false });

  var menuBtn = document.getElementById('menu-btn');
  var mobileNav = document.getElementById('mobile-nav');
  var menu = disclosure(menuBtn, mobileNav, { openLabel: T.openMenu, closeLabel: T.closeMenu, focusFirst: true });
  if (mobileNav && menu) {
    mobileNav.addEventListener('click', function (e) { if (e.target.closest('a')) menu.close(true); });
    window.addEventListener('resize', function () { if (window.innerWidth >= 1100) menu.close(false); });
  }

  /* ---------- current section: nav state + keep section on language switch ---------- */
  var sections = Array.prototype.slice.call(document.querySelectorAll('main section[id]'));
  var current = '';
  function setCurrent(id) {
    if (id === current) return;
    current = id;
    document.querySelectorAll('.nav-desktop a').forEach(function (a) {
      if (a.getAttribute('href') === '#' + id) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    });
  }
  if ('IntersectionObserver' in window) {
    var secObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) setCurrent(en.target.id); });
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach(function (s) { secObs.observe(s); });
  }
  if (langMenu) {
    langMenu.addEventListener('click', function (e) {
      var a = e.target.closest('a[data-lang]'); if (!a) return;
      store.set('lang', a.getAttribute('data-lang'));
      var base = a.getAttribute('href').split('#')[0];
      var hash = current && current !== 'top' ? '#' + current : '';
      a.setAttribute('href', base + hash);
    });
  }

  /* ---------- reveal on entry (once) ---------- */
  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en, i) {
        if (!en.isIntersecting) return;
        var el = en.target;
        el.style.transitionDelay = Math.min(i * 60, 240) + 'ms';
        el.classList.add('in');
        io.unobserve(el);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('in'); });
  }

  /* ---------- light parallax on the hero drawing (desktop only) ---------- */
  var visual = document.querySelector('.hero-visual');
  var desk = window.matchMedia('(min-width: 1024px) and (pointer: fine)');
  if (visual && !reduce) {
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking || !desk.matches) return;
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        var y = Math.min(window.scrollY, 900);
        visual.style.transform = 'translate3d(0,' + (y * 0.08).toFixed(1) + 'px,0)';
      });
    }, { passive: true });
  }

  /* ---------- copy email ---------- */
  var copyBtn = document.getElementById('copy-email');
  var mail = document.getElementById('email');
  var status = document.getElementById('copy-status');
  if (copyBtn && mail) {
    copyBtn.hidden = false;
    copyBtn.addEventListener('click', function () {
      var text = mail.textContent.trim();
      function ok() { status.textContent = T.copied; setTimeout(function () { status.textContent = ''; }, 2400); }
      function fail() {
        status.textContent = T.copyFail;
        var r = document.createRange(); r.selectNodeContents(mail);
        var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      }
      try { navigator.clipboard.writeText(text).then(ok, fail); } catch (e) { fail(); }
    });
  }
})();
