/* ===== 쉽앤핑 최종 화면: 아이콘, 예시 데이터, 부품 함수, 프레임 ===== */
window.SP = window.SP || {};
(function (SP) {
  SP.IMG = { sheep: '../brand/ship-and-ping-sheep.png', wordmark: '../brand/ship-and-ping-wordmark.png' };
  var esc = SP.esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  /* 아이콘: 직접 그린 선 아이콘 하나의 굵기(2)로 통일. 장식이면 aria-hidden */
  var I = function (d, s) { return '<svg aria-hidden="true" width="' + (s || 18) + '" height="' + (s || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>'; };
  var ic = SP.ic = {
    ok: function (s) { return I('<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.6 2.6L16 9.6"/>', s); },
    bad: function (s) { return I('<path d="M12 3.5 2.8 19.5h18.4z"/><path d="M12 10v4"/><path d="M12 17.2v.1"/>', s); },
    wait: function (s) { return I('<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>', s); },
    copy: function (s) { return I('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>', s); },
    check: function (s) { return I('<path d="m5 12.5 4.5 4.5L19 7.5"/>', s); },
    chev: function (s) { return I('<path d="m9 6 6 6-6 6"/>', s); },
    back: function (s) { return I('<path d="m15 6-6 6 6 6"/>', s); },
    bell: function (s) { return I('<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9"/><path d="M10 19.5a2 2 0 0 0 4 0"/>', s); },
    gear: function (s) { return I('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>', s); },
    pen: function (s) { return I('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>', s); },
    eyeoff: function (s) { return I('<path d="M3 3l18 18"/><path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c5.5 0 9 6 9 6a15 15 0 0 1-2.4 3.1M6.6 6.6C4.3 8 3 12 3 12s3.5 6 9 6a9 9 0 0 0 4.1-1"/>', s); },
    plus: function (s) { return I('<path d="M12 5v14M5 12h14"/>', s); },
    lock: function (s) { return I('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', s); },
    info: function (s) { return I('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.8v.1"/>', s); },
    retry: function (s) { return I('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>', s); },
    mail: function (s) { return I('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>', s); },
    slack: function (s) { return I('<rect x="9.5" y="3" width="3.5" height="8" rx="1.75"/><rect x="11" y="13" width="3.5" height="8" rx="1.75"/><rect x="3" y="11" width="8" height="3.5" rx="1.75"/><rect x="13" y="9.5" width="8" height="3.5" rx="1.75"/>', s); },
    key: function (s) { return I('<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l2 2M15 8l2 2"/>', s); },
    google: function (s) { return I('<path d="M20.5 12.2c0-.6-.1-1.2-.2-1.7H12v3.3h4.8a4.2 4.2 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.6-3.9 2.6-6.5z"/><path d="M12 21c2.4 0 4.5-.8 5.9-2.2L15 16.5c-.8.5-1.8.9-3 .9-2.3 0-4.3-1.6-5-3.7H4v2.3A9 9 0 0 0 12 21z"/><path d="M7 13.7a5.4 5.4 0 0 1 0-3.4V8H4a9 9 0 0 0 0 8z"/><path d="M12 6.6c1.3 0 2.5.5 3.4 1.3L18 5.4A9 9 0 0 0 4 8l3 2.3c.7-2.1 2.7-3.7 5-3.7z"/>', s); }
  };
  var stTxt = SP.stTxt = { ok: '괜찮아요', bad: '문제 있어요', wait: '기록을 기다려요' };

  /* 예시 데이터 — PRD 4장 시나리오 */
  SP.D = {
    features: [
      { name: '분석', route: 'POST /api/analyze', uses: 132, fail: 0, now: '3.4초', usual: '1.1초', st: 'bad' },
      { name: '모임 목록', route: 'GET /api/meetings', uses: 1204, fail: 0, now: '0.3초', usual: '0.3초', st: 'ok' },
      { name: '모임 상세', route: 'GET /api/meetings/:id', uses: 840, fail: 0, now: '0.4초', usual: '0.4초', st: 'ok' },
      { name: '로그인', route: 'POST /api/auth/login', uses: 612, fail: 2, now: '0.6초', usual: '0.5초', st: 'ok' },
      { name: '모임 신청', route: 'POST /api/meetings/:id/join', uses: 88, fail: 0, now: '0.9초', usual: '0.8초', st: 'ok', deep: true },
      { name: '모임 만들기', route: 'POST /api/meetings', uses: 21, fail: 0, now: '0.7초', usual: '0.6초', st: 'ok' },
      { name: '사진 올리기', route: 'POST /api/upload', uses: 7, fail: 0, learning: '지금까지 7건, 0.9~2.1초', st: 'ok' },
      { name: '댓글 쓰기', route: 'POST /api/meetings/:id/comments', uses: 0, fail: 0, st: 'wait' }
    ],
    unnamed: { route: 'GET /api/cron/cleanup', uses: 3 },
    oldVer: '8b1e0d4', badVer: '3f2a9c1', newVer: 'a71c03e',
    errors: ['14:07 TimeoutError: upstream request exceeded 3000ms', '14:11 TimeoutError: upstream request exceeded 3000ms', '14:19 SlowQuery: analyze_results scan 2.9s']
  };
  SP.aiText = function (again) {
    var D = SP.D;
    return '[쉽앤핑 문제 보고]\n기능: 분석 (POST /api/analyze)\n상태: 최근 30분 24건 중 보통 3.4초 (평소 1.1초) — 2026-11-24 14:05부터\n앱 버전: ' + (again ? D.newVer + ' (고치려고 배포한 버전, 이전 시도 ' + D.badVer + ')' : D.badVer) + ' (문제 시작 전 버전: ' + D.oldVer + ')\n오류 기록 (최근 3개, 개인정보 가림):\n- ' + D.errors.join('\n- ') + '\n요청: 위 기능이 왜 느려졌는지 코드를 조사해 원인을 설명하고 고쳐 줘.' + (again ? '\n이전 수정(' + D.newVer + ') 뒤에도 5건 중 2건이 느렸어. 이전 수정에서 놓친 부분을 봐 줘.' : '\n문제 시작 전 버전과 지금 버전 사이 바뀐 코드부터 봐 줘.') + ' 고친 뒤 배포하면 쉽앤핑이 실제 사용 결과로 확인한다.';
  };

  /* ---------- 부품 함수 (design-system.md 4장 이름과 같음) ---------- */
  var K = SP.K = {};
  K.status = function (st, t) { return '<span class="sp-status ' + st + '">' + ic[st](15) + (t || stTxt[st]) + '</span>'; };
  K.swapStatus = function (a, at, b, bt) { return '<span class="sp-swap"><span class="from">' + K.status(a, at) + '</span><span class="to">' + K.status(b, bt) + '</span></span>'; };
  /* 큰 문장 카드 + 양: o = { meta, headline, body, ring, pc, side } */
  K.say = function (o) {
    var av = '<span class="sp-av' + (o.ring ? ' ring' : '') + '"><img src="' + SP.IMG.sheep + '" alt="" width="36" height="36"></span>';
    var main = '<div class="meta">' + (o.meta || '') + '</div>' + o.headline + (o.body || '');
    var card = o.pc ? '<div class="sp-hero pc"><div style="display:flex;flex-direction:column;gap:14px;min-width:0">' + main + '</div>' + (o.side || '') + '</div>' : '<div class="sp-hero">' + main + (o.side || '') + '</div>';
    return '<section class="sp-say" aria-label="쉽앤핑이 알려 드려요">' + av + card + '</section>';
  };
  K.cmp = function (a, b, cls) {
    return '<div class="sp-cmp" role="img" aria-label="' + a[0] + ' ' + a[1] + '초, ' + b[0] + ' ' + b[1] + '초"><span class="v old"><span class="lb">' + a[0] + '</span><span class="n">' + a[1] + '<small>초</small></span></span><span class="arr" aria-hidden="true">→</span><span class="v ' + (cls || 'bad') + '"><span class="lb">' + b[0] + '</span><span class="n">' + b[1] + '<small>초</small></span></span></div>';
  };
  K.frow = function (f) {
    var rt = f.st === 'wait' ? '<span class="rt"><small>아직 없어요</small></span>' : f.learning ? '<span class="rt"><small>평소 속도<br>익히는 중</small></span>' : '<span class="rt">' + f.now + '<small>평소 ' + f.usual + '</small></span>';
    var sub = f.st === 'wait' ? '아직 사용 기록이 없어요' : f.learning ? f.learning : '사용 ' + f.uses.toLocaleString() + '건, 실패 ' + f.fail + '건' + (f.deep ? ', 깊게 보는 중' : '');
    return '<li class="sp-frow ' + f.st + '"><span class="si ' + f.st + '">' + ic[f.st](20) + '<span class="sr">' + stTxt[f.st] + '</span></span><span class="nm">' + f.name + '<small>' + sub + '</small></span>' + rt + '</li>';
  };
  K.unnamedRow = function () { return '<li class="sp-frow wait"><span class="si wait">' + ic.pen(18) + '</span><span class="nm">이름 없는 기능 1개<small>사용 3건</small></span><button class="sp-edit">이름 붙이기</button></li>'; };
  K.copy = function (label, kind, extra) { return '<button class="sp-btn sp-copy' + (extra || '') + '" data-copy="' + (kind || 'ai') + '">' + ic.copy(18) + '<span class="lbl">' + label + '</span></button>'; };
  K.steps = function (items, doneUpTo, nowAt) {
    return '<ol class="sp-steps">' + items.map(function (t, i) {
      var c = i < doneUpTo ? 'done' : (i === nowAt ? 'now' : '');
      return '<li class="' + c + '"><span class="num">' + (c === 'done' ? ic.check(14) + '<span class="sr">끝남</span>' : (i + 1)) + '</span><span>' + t + '</span></li>';
    }).join('') + '</ol>';
  };
  K.field = function (o) {
    var id = 'f' + (SP.uid = (SP.uid || 0) + 1);
    return '<div class="sp-field"><label for="' + id + '">' + o.label + (o.opt ? ' <span class="opt">(선택)</span>' : '') + '</label>' + (o.example ? '<span class="help" id="' + id + 'h">' + o.example + '</span>' : '') +
      '<input class="sp-input" id="' + id + '" value="' + esc(o.value || '') + '"' + (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') + (o.err ? ' aria-invalid="true" aria-describedby="' + id + 'e"' : (o.example || o.help ? ' aria-describedby="' + id + 'h"' : '')) + '>' +
      (o.help && !o.example ? '<span class="help" id="' + id + 'h">' + o.help + '</span>' : '') + (o.err ? '<span class="err" id="' + id + 'e" role="alert">' + ic.bad(16) + o.err + '</span>' : '') + '</div>';
  };
  K.banner = function (kind, text, act) { return '<div class="sp-banner ' + kind + '" role="' + (kind === 'warn' ? 'alert' : 'status') + '">' + (kind === 'warn' ? ic.bad(18) : ic.info(18)) + '<div>' + text + (act ? '<br><button class="act">' + act + '</button>' : '') + '</div></div>'; };
  K.error = function (title, body, acts) { return '<div class="sp-error" role="alert">' + ic.bad(20) + '<div class="body"><b>' + title + '</b><span class="sp-sub" style="color:var(--sp-ink)">' + body + '</span>' + (acts ? '<div class="acts">' + acts + '</div>' : '') + '</div></div>'; };
  K.empty = function (title, body, act) { return '<div class="sp-empty"><b>' + title + '</b><span class="sp-sub">' + body + '</span>' + (act || '') + '</div>'; };
  K.hdr = function (title, sub, back, right) {
    return '<header class="sp-hdr">' + (back ? '<button class="sp-ibtn" aria-label="' + back + '">' + ic.back(22) + '</button>' : '<img class="sp-tile" src="' + SP.IMG.sheep + '" alt="" width="30" height="30">') + '<span class="t">' + title + (sub ? '<small>' + sub + '</small>' : '') + '</span>' + (right === undefined ? '<button class="sp-ibtn" aria-label="앱 설정">' + ic.gear(20) + '</button>' : right) + '</header>';
  };
  K.top = function (crumb) { return '<header class="sp-top"><img class="sp-tile" src="' + SP.IMG.sheep + '" alt="" width="30" height="30"><span class="crumb">내 앱 › <b>' + crumb + '</b></span><span style="flex:1"></span><button class="sp-ibtn" aria-label="알림 설정">' + ic.bell(20) + '</button><button class="sp-ibtn" aria-label="앱 설정">' + ic.gear(20) + '</button></header>'; };

  /* ---------- 프레임 ---------- */
  var sbIcons = '<svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true"><rect x="0" y="8" width="3" height="4" rx="1" fill="currentColor"/><rect x="5" y="5.5" width="3" height="6.5" rx="1" fill="currentColor"/><rect x="10" y="3" width="3" height="9" rx="1" fill="currentColor"/><rect x="15" y="0" width="3" height="12" rx="1" fill="currentColor"/></svg><svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true"><path d="M8 11.5 5.6 9a3.4 3.4 0 0 1 4.8 0zM3.2 6.6a6.8 6.8 0 0 1 9.6 0l-1.4 1.4a4.8 4.8 0 0 0-6.8 0zM.8 4.2a10.2 10.2 0 0 1 14.4 0l-1.4 1.4a8.2 8.2 0 0 0-11.6 0z" fill="currentColor"/></svg><svg width="27" height="13" viewBox="0 0 27 13" aria-hidden="true"><rect x=".5" y=".5" width="23" height="12" rx="3.5" fill="none" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="17" height="9" rx="2" fill="currentColor"/></svg>';
  SP.phone = function (theme, inner, opts) {
    opts = opts || {};
    return '<figure class="t-' + theme + '" style="margin:0"><figcaption class="cap">휴대폰, ' + (theme === 'light' ? '밝은 모드' : '어두운 모드') + (opts.big ? ', 글자 200%' : '') + '</figcaption><div class="phone"><div class="sp' + (opts.big ? ' text-200' : '') + '" data-theme="' + theme + '"' + (opts.anim ? ' data-anim="' + opts.anim + '"' : '') + '><div class="sb" aria-hidden="true"><span>9:41</span><span class="island"></span><span class="ic">' + sbIcons + '</span></div><div class="scr">' + inner + '</div><div class="home" aria-hidden="true"><i></i></div></div></div></figure>';
  };
  SP.browser = function (theme, inner, path, anim) {
    return '<figure class="t-' + theme + '" style="margin:0"><figcaption class="cap">PC 브라우저, ' + (theme === 'light' ? '밝은 모드' : '어두운 모드') + '</figcaption><div class="pc-fit"><div class="browser' + (theme === 'dark' ? ' dark' : '') + '"><div class="chrome" aria-hidden="true"><span class="dots"><i></i><i></i><i></i></span><span class="url">' + ic.lock(12) + 'ship-and-ping.pages.dev' + path + '</span><span style="width:52px"></span></div><div class="sp" data-theme="' + theme + '"' + (anim ? ' data-anim="' + anim + '"' : '') + '>' + inner + '</div></div></div></figure>';
  };
  SP.fit = function () { document.querySelectorAll('.pc-fit').forEach(function (w) { var b = w.firstElementChild; if (b) b.style.zoom = Math.min(1, w.clientWidth / 1240); }); };
  window.addEventListener('resize', function () { SP.fit(); });

  /* ---------- 동작: 복사(중복 누름 방지), 스위치, 움직임 다시 보기 ---------- */
  var live;
  SP.say = function (msg) { if (!live) { live = document.createElement('div'); live.className = 'sr'; live.setAttribute('aria-live', 'polite'); live.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)'; document.body.appendChild(live); } live.textContent = ''; setTimeout(function () { live.textContent = msg; }, 30); };
  document.addEventListener('click', function (e) {
    var c = e.target.closest('[data-copy]');
    if (c) {
      if (c.getAttribute('data-state') === 'done') return;
      var kind = c.getAttribute('data-copy');
      var text = kind === 'again' ? SP.aiText(true) : kind === 'ai' ? SP.aiText(false) : '[쉽앤핑 ' + (kind === 'check' ? '연결 확인' : '연결 요청') + '] (시안용 예시 문장)';
      try { if (navigator.clipboard) navigator.clipboard.writeText(text).catch(function () {}); } catch (err) {}
      var lbl = c.querySelector('.lbl'), old = lbl ? lbl.textContent : '';
      c.setAttribute('data-state', 'done'); if (lbl) lbl.textContent = '복사했어요';
      SP.say('복사했어요. 코딩 AI 대화창에 붙여넣으세요.');
      setTimeout(function () { c.removeAttribute('data-state'); if (lbl) lbl.textContent = old; }, 2600);
      return;
    }
    var sw = e.target.closest('.sp-switch');
    if (sw) { sw.setAttribute('aria-checked', String(sw.getAttribute('aria-checked') !== 'true')); return; }
    var r = e.target.closest('[data-replay]');
    if (r) { document.querySelectorAll('[data-anim]').forEach(function (el) { el.classList.remove('play'); void el.offsetWidth; el.classList.add('play'); }); SP.say('움직임을 다시 보여 줘요'); }
  });
})(window.SP);
