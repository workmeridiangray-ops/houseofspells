// House of Spells — shared header: mega menu, live search, cart badge, mobile drawer.
(function () {
  var LOGO = '<svg width="26" height="26" viewBox="0 0 26 26" fill="none"><path d="M14.5 3C10 3 6.5 6.8 6.5 11.5C6.5 16.2 10.3 20 15 20C17.2 20 19.2 19.1 20.6 17.7C19 20.9 15.7 23 12 23C6.5 23 2 18.5 2 13C2 7.5 6.5 3 12 3C12.9 3 13.7 3.1 14.5 3.3V3Z" fill="#DCC8FF"/><circle cx="20" cy="6" r="1.3" fill="#F2D3A1"/><circle cx="23" cy="10" r="0.8" fill="#F2D3A1"/></svg>';
  var SEARCH = '<svg width="18" height="18" viewBox="0 0 19 19" fill="none"><circle cx="8.5" cy="8.5" r="6" stroke="currentColor" stroke-width="1.6"/><path d="M13 13L17 17" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  var BAG = '<svg width="20" height="20" viewBox="0 0 19 19" fill="none"><path d="M4 6h13l-1.3 8.2a2 2 0 0 1-2 1.7H7.3a2 2 0 0 1-2-1.7L4 6Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M6.5 6V5a3 3 0 0 1 6 0v1" stroke="currentColor" stroke-width="1.5"/></svg>';
  var CHEV = '<svg width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var path = location.pathname.split('/').pop() || 'index.html';
  var hasDrawer = (path === 'index.html');
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function inr(n) { return '₹' + Math.round(n).toLocaleString('en-IN'); }
  function catUrl(name) { return 'shop.html?cat=' + encodeURIComponent(name); }
  function on(p) { return path === p ? ' class="on"' : ''; }

  var html =
    '<div class="hs-announce">Free shipping over <b>₹999</b> · Cash on Delivery across India</div>' +
    '<div class="hs-header" role="banner"><div class="hs-bar">' +
      '<button class="hs-icon hs-burger" aria-label="Open menu" id="hsBurger"><svg width="20" height="20" viewBox="0 0 19 19" fill="none"><path d="M2.5 5.5h14M2.5 9.5h14M2.5 13.5h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>' +
      '<a href="index.html" class="hs-logo">' + LOGO + '<span>House of Spells<small>CRYSTALS &amp; RITUAL GOODS</small></span></a>' +
      '<nav class="hs-links" aria-label="Primary">' +
        '<button class="hs-trigger" id="hsShop" aria-expanded="false" aria-haspopup="true">Shop ' + CHEV + '</button>' +
        '<a href="shop.html?cat=' + encodeURIComponent('Crystals & Gemstones') + '">Crystals</a>' +
        '<a href="shop.html?cat=Jewellery">Jewellery</a>' +
        '<a href="shop.html?cat=Candles">Candles</a>' +
        '<a href="journal.html"' + on('journal.html') + '>Journal</a>' +
        '<a href="index.html#about">About</a>' +
      '</nav>' +
      '<div class="hs-search" id="hsSearch"><form action="shop.html" method="get" role="search" autocomplete="off"><input type="search" name="q" id="hsQ" placeholder="Search crystals, candles, tarot…" aria-label="Search products"><button type="submit" aria-label="Search">' + SEARCH + '</button></form><div class="hs-sugg" id="hsSugg"></div></div>' +
      '<div class="hs-actions"><button class="hs-icon hs-searchbtn" id="hsSearchBtn" aria-label="Search">' + SEARCH + '</button>' +
        (hasDrawer ? '<button class="hs-icon" id="cartToggle" aria-label="Open cart">' : '<a class="hs-icon" href="cart.html" aria-label="Cart">') +
        BAG + '<span class="hs-badge zero" id="cartCount">0</span>' + (hasDrawer ? '</button>' : '</a>') +
      '</div>' +
    '</div>' +
    '<div class="hs-mega" id="hsMega"><div class="hs-mega-in"><div><h4>Shop by category</h4><div class="hs-cats" id="hsCats"></div></div><div><h4>Popular right now</h4><div class="hs-picks" id="hsPicks"></div></div></div></div>' +
    '</div><div class="hs-scrim" id="hsScrim"></div>' +
    '<aside class="hs-drawer" id="hsDrawer" aria-label="Menu"><div class="hs-dhead"><span>House of Spells</span><button class="hs-icon" id="hsClose" aria-label="Close menu"><svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 3l12 12M15 3L3 15" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button></div><div class="hs-dbody" id="hsDBody"></div></aside>';

  var host = document.createElement('div');
  host.innerHTML = html;
  while (host.firstChild) document.body.insertBefore(host.firstChild, document.body.firstChild);
  // order: announce, header, scrim, drawer were inserted in reverse; fix order
  var ann = document.querySelector('.hs-announce'), hdr = document.querySelector('.hs-header');
  document.body.insertBefore(hdr, document.body.firstChild); document.body.insertBefore(ann, hdr);

  var $ = function (id) { return document.getElementById(id); };
  var mega = $('hsMega'), shopBtn = $('hsShop'), scrim = $('hsScrim'), drawer = $('hsDrawer');

  // ---- data (cached per tab) ----
  function cached(key, url, ttl) {
    try { var c = JSON.parse(sessionStorage.getItem(key) || 'null'); if (c && Date.now() - c.t < ttl) return Promise.resolve(c.d); } catch (e) {}
    return fetch(url).then(function (r) { return r.json(); }).then(function (d) { try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), d: d })); } catch (e) {} return d; });
  }
  var catsP = cached('hs_cats', '/store/categories', 600000).catch(function () { return []; });
  var picksP = null;
  function loadPicks() { return picksP || (picksP = cached('hs_picks', '/store/picks', 600000).catch(function () { return []; })); }

  function catLinks(cats, cls) {
    return cats.filter(function (c) { return c.count > 0; }).sort(function (a, b) { return (/^Misc/.test(a.name) ? 1 : 0) - (/^Misc/.test(b.name) ? 1 : 0); }).map(function (c) {
      return '<a href="' + catUrl(c.name) + '">' + esc(c.name) + '<span>' + c.count.toLocaleString('en-IN') + '</span></a>';
    }).join('');
  }
  catsP.then(function (cats) {
    $('hsCats').innerHTML = catLinks(cats) + '<a class="viewall" href="shop.html">View all products →</a>';
    $('hsDBody').innerHTML = '<a href="shop.html">Shop all products</a><h4>Categories</h4>' + catLinks(cats) +
      '<h4>More</h4><a href="journal.html">Journal</a><a href="index.html#about">About us</a><a href="contact.html">Contact</a><a href="shipping-policy.html">Shipping</a><a href="returns-and-refunds.html">Returns &amp; Refunds</a><a href="cart.html">Cart</a>';
  });

  // ---- mega menu ----
  function openMega() {
    mega.classList.add('open'); shopBtn.setAttribute('aria-expanded', 'true'); scrim.classList.add('open');
    loadPicks().then(function (p) {
      if ($('hsPicks').dataset.done) return; $('hsPicks').dataset.done = 1;
      $('hsPicks').innerHTML = p.slice(0, 4).map(function (x) {
        return '<a class="hs-pick" href="product.html?slug=' + encodeURIComponent(x.slug) + '"><img loading="lazy" src="' + esc(x.image) + '" alt="' + esc(x.name) + '"><div class="n">' + esc(x.name) + '</div><div class="p">' + inr(x.price) + '</div></a>';
      }).join('');
    });
  }
  function closeMega() { mega.classList.remove('open'); shopBtn.setAttribute('aria-expanded', 'false'); if (!drawer.classList.contains('open')) scrim.classList.remove('open'); }
  var hoverT;
  shopBtn.addEventListener('click', function () { mega.classList.contains('open') ? closeMega() : openMega(); });
  shopBtn.addEventListener('mouseenter', function () { clearTimeout(hoverT); openMega(); });
  [shopBtn, mega].forEach(function (el) {
    el.addEventListener('mouseleave', function () { hoverT = setTimeout(closeMega, 180); });
    el.addEventListener('mouseenter', function () { clearTimeout(hoverT); });
  });
  scrim.addEventListener('click', function () { closeMega(); closeDrawer(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeMega(); closeDrawer(); hideSugg(); } });

  // ---- mobile drawer ----
  function openDrawer() { drawer.classList.add('open'); scrim.classList.add('open'); }
  function closeDrawer() { drawer.classList.remove('open'); if (!mega.classList.contains('open')) scrim.classList.remove('open'); }
  $('hsBurger').addEventListener('click', openDrawer);
  $('hsClose').addEventListener('click', closeDrawer);

  // ---- search ----
  var q = $('hsQ'), sugg = $('hsSugg'), box = $('hsSearch'), timer, seq = 0, act = -1;
  try { var m = /[?&]q=([^&]*)/.exec(location.search); if (m && path === 'shop.html') q.value = decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) {}
  function hideSugg() { sugg.classList.remove('open'); act = -1; }
  function render(items, term, total) {
    if (!items.length) { sugg.innerHTML = '<div class="msg">No products found for “' + esc(term) + '”.</div>'; return; }
    sugg.innerHTML = items.map(function (x) {
      return '<a href="product.html?slug=' + encodeURIComponent(x.slug) + '"><img loading="lazy" src="' + esc(x.image) + '" alt=""><div><div class="n">' + esc(x.name) + '</div><div class="c">' + esc(x.category) + '</div></div><div class="p">' + inr(x.price) + '</div></a>';
    }).join('') + '<a class="all" href="shop.html?q=' + encodeURIComponent(term) + '">See all ' + (total ? total.toLocaleString('en-IN') + ' ' : '') + 'results →</a>';
  }
  function run() {
    var term = q.value.trim();
    if (term.length < 2) { hideSugg(); return; }
    var my = ++seq; sugg.classList.add('open'); sugg.innerHTML = '<div class="msg">Searching…</div>';
    fetch('/store/catalog?take=6&q=' + encodeURIComponent(term)).then(function (r) { return r.json(); })
      .then(function (d) { if (my === seq) render(d.items || [], term, d.total); })
      .catch(function () { if (my === seq) sugg.innerHTML = '<div class="msg">Search is unavailable right now.</div>'; });
  }
  q.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(run, 280); });
  q.addEventListener('focus', function () { if (q.value.trim().length >= 2 && sugg.innerHTML) sugg.classList.add('open'); });
  q.addEventListener('keydown', function (e) {
    var links = sugg.querySelectorAll('a'); if (!links.length || !sugg.classList.contains('open')) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); act = (act + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
      links.forEach(function (l, i) { l.classList.toggle('act', i === act); });
    } else if (e.key === 'Enter' && act >= 0) { e.preventDefault(); location.href = links[act].href; }
  });
  document.addEventListener('click', function (e) { if (!box.contains(e.target) && e.target !== $('hsSearchBtn')) { hideSugg(); box.classList.remove('mob'); } });
  $('hsSearchBtn').addEventListener('click', function (e) { e.stopPropagation(); box.classList.add('mob'); q.focus(); });

  // ---- cart badge ----
  var badge = $('cartCount');
  function sync() { var n = (badge.textContent || '0').trim(); badge.classList.toggle('zero', n === '0' || n === ''); }
  new MutationObserver(sync).observe(badge, { childList: true, characterData: true, subtree: true });
  try { var c = JSON.parse(localStorage.getItem('lunar_lore_cart_v1') || '{}'); badge.textContent = Object.keys(c).reduce(function (s, k) { return s + (c[k].qty || 0); }, 0); } catch (e) {}
  sync();
})();
