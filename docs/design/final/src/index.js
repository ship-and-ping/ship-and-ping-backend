/* ===== 최종 화면 모음: PC / 휴대폰 전환, 한 장씩 / 모두 펼치기 ===== */
(function (SP) {
  var E = SP.entries, cur = 0, mode = 'one', theme = 'both', view = 'pc', pcw = 1440;
  function pcFrames(e) {
    var path = SP.deskPath(e);
    if (e.deskBig) {
      /* 창 1440을 브라우저에서 200%로 확대하면 실제로 쓰는 폭은 720 → 태블릿 배치(메뉴 접힘, 한 열) */
      var t = function (th) { return SP.browser(th, SP.deskHtml(e), path, e.anim, { width: 720, big: true, cap: '창 1440을 200%로 확대(실제 폭 720, 태블릿 배치)' }); };
      return t('light') + t('dark');
    }
    /* 배치는 프레임 실제 너비로 CSS가 고른다(컨테이너 쿼리). 캡션은 설명용 */
    var lay = pcw >= 1024 ? 'PC 배치' : pcw >= 640 ? '태블릿 배치' : '휴대폰 배치';
    return SP.browser('light', SP.deskHtml(e), path, e.anim, { width: pcw, cap: lay }) + SP.browser('dark', SP.deskHtml(e), path, e.anim, { width: pcw, cap: lay });
  }
  /* 화면을 바꾸면 초점: 보이는 첫 프레임 안 그 화면의 제목(data-ft: PC 본문 h1 / 휴대폰 머리말 제목)으로.
     그래서 다음 Tab은 메뉴가 아니라 본문 첫 조작 요소로 간다. 화면 안 제목이 없으면 갤러리 제목으로 */
  function focusTitle() {
    var t = null;
    document.querySelectorAll('#mount [data-ft]').forEach(function (el) { if (!t && el.offsetParent !== null) t = el; });
    if (!t) t = document.getElementById('h-' + E[cur].id);
    if (t) { try { t.focus({ preventScroll: true }); } catch (err) { t.focus(); } }
  }
  function draw(i) {
    var e = E[i];
    var frames = view === 'pc' ? '<div class="pcs">' + pcFrames(e) + '</div>'
      : '<div class="frames">' + SP.phone('light', e.mobile(), { anim: e.anim, big: e.big }) + SP.phone('dark', e.mobile(), { anim: e.anim, big: e.big }) + '</div>';
    return '<article class="entry" id="' + e.id + '" aria-labelledby="h-' + e.id + '"><h1 id="h-' + e.id + '" tabindex="-1">' + e.title + '</h1><p class="desc">' + e.desc + '</p><p class="desc"><a href="live.html#' + e.id + '" target="_blank" rel="noopener">이 화면을 실제 브라우저 창 너비로 열기</a> — 창을 1023px·639px 아래로 줄이면 태블릿·휴대폰 배치로 바뀌어요.</p>' + (e.anim ? '<p><button class="pg-btn" data-replay>움직임 다시 보기</button></p>' : '') + frames + '</article>';
  }
  function render() {
    var m = document.getElementById('mount');
    m.innerHTML = mode === 'all' ? E.map(function (e, i) { return draw(i); }).join('') : draw(cur);
    document.querySelectorAll('[data-anim]').forEach(function (el) { el.classList.add('play'); });
    document.querySelectorAll('.nav a').forEach(function (a, i) { a.setAttribute('aria-current', String(mode === 'one' && i === cur)); });
    document.getElementById('pos').textContent = mode === 'one' ? (cur + 1) + ' / ' + E.length : '전체 ' + E.length + '장';
    document.getElementById('prev').disabled = mode !== 'one' || cur === 0;
    document.getElementById('next').disabled = mode !== 'one' || cur === E.length - 1;
    document.querySelectorAll('[data-pcw]').forEach(function (b) { b.disabled = view !== 'pc'; });
    SP.fit();
  }
  /* 화면을 바꾸면 초점을 새 화면 제목(h1)으로 옮긴다(BODY로 돌아가지 않게). 처음 열 때(focus=false)는 옮기지 않음 */
  function go(i, push, focus) {
    cur = Math.max(0, Math.min(E.length - 1, i));
    if (push !== false) { try { history.replaceState(null, '', '#' + E[cur].id); } catch (err) {} }
    render(); window.scrollTo(0, 0);
    if (focus !== false) focusTitle();
  }
  SP.initIndex = function () {
    var nav = document.getElementById('list'), g = '', out = '';
    E.forEach(function (e, i) { if (e.group !== g) { g = e.group; out += '<h2>' + g + '</h2>'; } out += '<a href="#' + e.id + '" data-i="' + i + '">' + e.title.replace(g + ': ', '').replace(/^S\d+ /, '') + '</a>'; });
    nav.innerHTML = out;
    nav.addEventListener('click', function (ev) { var a = ev.target.closest('a[data-i]'); if (!a) return; ev.preventDefault(); mode = 'one'; setMode(); go(+a.getAttribute('data-i')); });
    document.getElementById('prev').addEventListener('click', function () { go(cur - 1); });
    document.getElementById('next').addEventListener('click', function () { go(cur + 1); });
    document.addEventListener('keydown', function (ev) { if (mode !== 'one' || /INPUT|TEXTAREA/.test(ev.target.tagName)) return; if (ev.key === 'ArrowRight') go(cur + 1); if (ev.key === 'ArrowLeft') go(cur - 1); });
    function setMode() { document.querySelectorAll('[data-mode]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === mode)); }); }
    var pressOnly = function (sel, b) { document.querySelectorAll(sel).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); };
    document.querySelectorAll('[data-mode]').forEach(function (b) { b.addEventListener('click', function () { mode = b.getAttribute('data-mode'); setMode(); render(); }); });
    document.querySelectorAll('[data-view]').forEach(function (b) { b.addEventListener('click', function () { view = b.getAttribute('data-view'); pressOnly('[data-view]', b); render(); }); });
    document.querySelectorAll('[data-pcw]').forEach(function (b) { b.addEventListener('click', function () { pcw = +b.getAttribute('data-pcw'); pressOnly('[data-pcw]', b); render(); }); });
    document.querySelectorAll('[data-pt]').forEach(function (b) { b.addEventListener('click', function () {
      theme = b.getAttribute('data-pt'); pressOnly('[data-pt]', b);
      document.body.classList.toggle('hide-dark', theme === 'light'); document.body.classList.toggle('hide-light', theme === 'dark');
      document.documentElement.setAttribute('data-page-theme', theme === 'dark' ? 'dark' : 'light'); SP.fit();
    }); });
    /* 화면 안 링크(예: 기능 행 → #s6, 왼쪽 메뉴)를 누르면 그 화면으로 넘어간다 */
    window.addEventListener('hashchange', function () { var id = location.hash.replace('#', ''); E.forEach(function (e, i) { if (e.id === id) { mode = 'one'; setMode(); go(i, false); } }); });
    var h = location.hash.replace('#', ''), idx = 0;
    E.forEach(function (e, i) { if (e.id === h) idx = i; });
    go(idx, false, false);
  };
})(window.SP);
