/* ===== 최종 화면 모음: 한 장씩 넘겨 보기 / 모두 펼치기 ===== */
(function (SP) {
  var E = SP.entries, cur = 0, mode = 'one', theme = 'both';
  function draw(i) {
    var e = E[i];
    var phones = '<div class="frames">' + SP.phone('light', e.mobile(), { anim: e.anim, big: e.big }) + SP.phone('dark', e.mobile(), { anim: e.anim, big: e.big }) + '</div>';
    var pcs = e.pc ? '<div class="pcs"><h2 style="font-size:17px;margin:0">PC 브라우저</h2>' + SP.browser('light', e.pc(), e.id === 's5' ? '/apps/moim' : '/apps/moim/problems/42', e.anim) + SP.browser('dark', e.pc(), e.id === 's5' ? '/apps/moim' : '/apps/moim/problems/42', e.anim) + '</div>' : '';
    return '<article class="entry" id="' + e.id + '" aria-labelledby="h-' + e.id + '"><h1 id="h-' + e.id + '">' + e.title + '</h1><p class="desc">' + e.desc + '</p>' + (e.anim ? '<p><button class="pg-btn" data-replay>움직임 다시 보기</button></p>' : '') + phones + pcs + '</article>';
  }
  function render() {
    var m = document.getElementById('mount');
    m.innerHTML = mode === 'all' ? E.map(function (e, i) { return draw(i); }).join('') : draw(cur);
    document.querySelectorAll('[data-anim]').forEach(function (el) { el.classList.add('play'); });
    document.querySelectorAll('.nav a').forEach(function (a, i) { a.setAttribute('aria-current', String(mode === 'one' && i === cur)); });
    document.getElementById('pos').textContent = mode === 'one' ? (cur + 1) + ' / ' + E.length : '전체 ' + E.length + '장';
    document.getElementById('prev').disabled = mode !== 'one' || cur === 0;
    document.getElementById('next').disabled = mode !== 'one' || cur === E.length - 1;
    SP.fit();
  }
  function go(i, push) { cur = Math.max(0, Math.min(E.length - 1, i)); if (push !== false) { try { history.replaceState(null, '', '#' + E[cur].id); } catch (err) {} } render(); window.scrollTo(0, 0); }
  SP.initIndex = function () {
    var nav = document.getElementById('list'), g = '', out = '';
    E.forEach(function (e, i) { if (e.group !== g) { g = e.group; out += '<h2>' + g + '</h2>'; } out += '<a href="#' + e.id + '" data-i="' + i + '">' + e.title.replace(g + ': ', '').replace(/^S\d+ /, '') + '</a>'; });
    nav.innerHTML = out;
    nav.addEventListener('click', function (ev) { var a = ev.target.closest('a[data-i]'); if (!a) return; ev.preventDefault(); mode = 'one'; setMode(); go(+a.getAttribute('data-i')); });
    document.getElementById('prev').addEventListener('click', function () { go(cur - 1); });
    document.getElementById('next').addEventListener('click', function () { go(cur + 1); });
    document.addEventListener('keydown', function (ev) { if (mode !== 'one' || /INPUT|TEXTAREA/.test(ev.target.tagName)) return; if (ev.key === 'ArrowRight') go(cur + 1); if (ev.key === 'ArrowLeft') go(cur - 1); });
    function setMode() { document.querySelectorAll('[data-mode]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === mode)); }); }
    document.querySelectorAll('[data-mode]').forEach(function (b) { b.addEventListener('click', function () { mode = b.getAttribute('data-mode'); setMode(); render(); }); });
    document.querySelectorAll('[data-pt]').forEach(function (b) { b.addEventListener('click', function () {
      theme = b.getAttribute('data-pt');
      document.querySelectorAll('[data-pt]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      document.body.classList.toggle('hide-dark', theme === 'light'); document.body.classList.toggle('hide-light', theme === 'dark');
      document.documentElement.setAttribute('data-page-theme', theme === 'dark' ? 'dark' : 'light'); SP.fit();
    }); });
    var h = location.hash.replace('#', ''), idx = 0;
    E.forEach(function (e, i) { if (e.id === h) idx = i; });
    go(idx, false);
  };
})(window.SP);
