/* ===== 쉽앤핑 시안 공통: 예시 데이터, 아이콘, 프레임, 페이지 동작 ===== */
window.SP = window.SP || {};
(function (SP) {
  /* 브랜드 자산: docs/design/brand/ 의 원본(퍼플 배경 512px)을 아이콘 타일로만 쓴다 */
  SP.IMG = { sheep: '../brand/ship-and-ping-sheep.png', wordmark: '../brand/ship-and-ping-wordmark.png' };
  /* 예시 데이터 — PRD 4장 시나리오와 기능명세서 3장 문구를 그대로 쓴다 */
  SP.D = {
    app: '모임모아',
    features: [
      { name: '로그인', route: 'POST /api/auth/login', uses: 612, fail: 2, now: '0.6초', usual: '0.5초', st: 'ok' },
      { name: '모임 목록', route: 'GET /api/meetings', uses: 1204, fail: 0, now: '0.3초', usual: '0.3초', st: 'ok' },
      { name: '모임 상세', route: 'GET /api/meetings/:id', uses: 840, fail: 0, now: '0.4초', usual: '0.4초', st: 'ok' },
      { name: '모임 신청', route: 'POST /api/meetings/:id/join', uses: 88, fail: 0, now: '0.9초', usual: '0.8초', st: 'ok', deep: true },
      { name: '분석', route: 'POST /api/analyze', uses: 132, fail: 0, now: '3.4초', usual: '1.1초', st: 'bad' },
      { name: '모임 만들기', route: 'POST /api/meetings', uses: 21, fail: 0, now: '0.7초', usual: '0.6초', st: 'ok' },
      { name: '사진 올리기', route: 'POST /api/upload', uses: 7, fail: 0, now: '', usual: '', learning: '지금까지 7건, 0.9~2.1초', st: 'ok' },
      { name: '댓글 쓰기', route: 'POST /api/meetings/:id/comments', uses: 0, fail: 0, now: '', usual: '', st: 'wait' }
    ],
    unnamed: { route: 'GET /api/cron/cleanup', uses: 3 },
    problem: {
      title: '분석이 느려졌어요',
      sentence: '분석이 느려졌어요. 평소 1.1초 → 최근 30분 3.4초 (24건)',
      usual: '1.1초', recent: '3.4초', count: 24, since: '오늘 14:05부터',
      resolved: '업데이트 후 분석 15건 모두 평소 속도로 끝났어요',
      oldVer: '8b1e0d4', badVer: '3f2a9c1', newVer: 'a71c03e',
      timeline: [
        ['14:05', '처음 감지', '분석이 평소보다 2배 넘게 느려졌어요'],
        ['14:06', '알림 보냄', '슬랙 #모임모아-알림 채널로 보냈어요'],
        ['15:10', '새 버전 감지', '고친 버전이 배포됐어요'],
        ['15:32', '해결됐어요', '업데이트 후 15건 모두 평소 속도']
      ],
      errors: ['14:07 TimeoutError: upstream request exceeded 3000ms', '14:11 TimeoutError: upstream request exceeded 3000ms', '14:19 SlowQuery: analyze_results scan 2.9s']
    }
  };
  SP.aiText = function () {
    var p = SP.D.problem;
    return '[쉽앤핑 문제 보고]\n기능: 분석 (POST /api/analyze)\n상태: 최근 30분 24건 중 보통 3.4초 (평소 1.1초) — 2026-11-24 14:05부터\n앱 버전: ' + p.badVer + ' (문제 시작 전 버전: ' + p.oldVer + ')\n오류 기록 (최근 3개, 개인정보 가림):\n- ' + p.errors.join('\n- ') + '\n요청: 위 기능이 왜 느려졌는지 코드를 조사해 원인을 설명하고 고쳐 줘.\n문제 시작 전 버전과 지금 버전 사이 바뀐 코드부터 봐 줘. 고친 뒤 배포하면 쉽앤핑이 실제 사용 결과로 확인한다.';
  };
  SP.esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  /* 아이콘 (직접 그린 선 아이콘, 장식용은 aria-hidden) */
  var I = function (d, s) { return '<svg aria-hidden="true" width="' + (s || 18) + '" height="' + (s || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>'; };
  SP.ic = {
    ok: function (s) { return I('<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.6 2.6L16 9.6"/>', s); },
    bad: function (s) { return I('<path d="M12 3.5 2.8 19.5h18.4z"/><path d="M12 10v4"/><path d="M12 17.2v.1"/>', s); },
    wait: function (s) { return I('<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>', s); },
    copy: function (s) { return I('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>', s); },
    check: function (s) { return I('<path d="m5 12.5 4.5 4.5L19 7.5"/>', s); },
    chev: function (s) { return I('<path d="m9 6 6 6-6 6"/>', s); },
    back: function (s) { return I('<path d="m15 6-6 6 6 6"/>', s); },
    bell: function (s) { return I('<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9"/><path d="M10 19.5a2 2 0 0 0 4 0"/>', s); },
    gear: function (s) { return I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 14H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1A2 2 0 1 1 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>', s); },
    pen: function (s) { return I('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>', s); },
    eyeoff: function (s) { return I('<path d="M3 3l18 18"/><path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c5.5 0 9 6 9 6a15 15 0 0 1-2.4 3.1M6.6 6.6C4.3 8 3 12 3 12s3.5 6 9 6a9 9 0 0 0 4.1-1"/>', s); },
    apps: function (s) { return I('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>', s); },
    replay: function (s) { return I('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>', s); },
    plus: function (s) { return I('<path d="M12 5v14M5 12h14"/>', s); },
    lock: function (s) { return I('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', s); }
  };
  SP.statusIcons = '<svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true"><rect x="0" y="8" width="3" height="4" rx="1" fill="currentColor"/><rect x="5" y="5.5" width="3" height="6.5" rx="1" fill="currentColor"/><rect x="10" y="3" width="3" height="9" rx="1" fill="currentColor"/><rect x="15" y="0" width="3" height="12" rx="1" fill="currentColor"/></svg>' +
    '<svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true"><path d="M8 11.5 5.6 9a3.4 3.4 0 0 1 4.8 0zM3.2 6.6a6.8 6.8 0 0 1 9.6 0l-1.4 1.4a4.8 4.8 0 0 0-6.8 0zM.8 4.2a10.2 10.2 0 0 1 14.4 0l-1.4 1.4a8.2 8.2 0 0 0-11.6 0z" fill="currentColor"/></svg>' +
    '<svg width="27" height="13" viewBox="0 0 27 13" aria-hidden="true"><rect x=".5" y=".5" width="23" height="12" rx="3.5" fill="none" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="17" height="9" rx="2" fill="currentColor"/><rect x="24.5" y="4.5" width="1.6" height="4" rx=".8" fill="currentColor" opacity=".45"/></svg>';

  /* 프레임 */
  SP.phone = function (opt, theme, inner, label) {
    return '<figure class="t-' + theme + '" style="margin:0"><figcaption class="cap">휴대폰 · ' + (theme === 'light' ? '밝은 모드' : '어두운 모드') + '</figcaption>' +
      '<div class="phone"><div class="screen opt-' + opt + '" data-theme="' + theme + '">' +
      '<div class="sb" aria-hidden="true"><span>9:41</span><span class="island"></span><span class="ic">' + SP.statusIcons + '</span></div>' +
      '<div class="body">' + inner + '</div><div class="home" aria-hidden="true"><i></i></div></div></div></figure>';
  };
  SP.browser = function (opt, theme, inner, path, label) {
    return '<figure class="t-' + theme + '" style="margin:0 0 28px"><figcaption class="cap">PC 브라우저 · ' + (theme === 'light' ? '밝은 모드' : '어두운 모드') + '</figcaption>' +
      '<div class="pc-fit"><div class="browser ' + (theme === 'dark' ? 'dark-chrome' : '') + '"><div class="chrome" aria-hidden="true"><span class="dots"><i></i><i></i><i></i></span><span class="url">' + SP.ic.lock(12) + 'ship-and-ping.pages.dev' + path + '</span><span style="width:52px"></span></div>' +
      '<div class="viewport opt-' + opt + '" data-theme="' + theme + '">' + inner + '</div></div></div></figure>';
  };

  /* PC 프레임을 화면 폭에 맞춰 줄인다 (CSS zoom) */
  SP.fit = function () {
    document.querySelectorAll('.pc-fit').forEach(function (w) {
      var b = w.firstElementChild; if (!b) return;
      var z = Math.min(1, w.clientWidth / 1240);
      b.style.zoom = z;
    });
  };
  window.addEventListener('resize', function () { SP.fit(); });

  /* 동작: 복사 버튼, 움직임 다시 보기 */
  var live;
  function say(msg) { if (!live) { live = document.createElement('div'); live.className = 'sr'; live.setAttribute('aria-live', 'polite'); document.body.appendChild(live); } live.textContent = ''; setTimeout(function () { live.textContent = msg; }, 30); }
  document.addEventListener('click', function (e) {
    var c = e.target.closest('[data-copy]');
    if (c) {
      if (c.getAttribute('aria-busy') === 'true') return; /* 중복 누름 방지 */
      var text = c.getAttribute('data-copy') === 'connect' ? '[쉽앤핑 연결 요청] (시안용 예시 문장)' : SP.aiText();
      try { if (navigator.clipboard) navigator.clipboard.writeText(text).catch(function () {}); } catch (err) {}
      c.setAttribute('data-done', 'true'); c.setAttribute('aria-busy', 'true');
      var lbl = c.querySelector('.lbl'), old = lbl ? lbl.textContent : '';
      if (lbl) lbl.textContent = '복사했어요';
      say('복사했어요. 코딩 AI 대화창에 붙여넣으세요.');
      setTimeout(function () { c.removeAttribute('data-done'); c.removeAttribute('aria-busy'); if (lbl) lbl.textContent = old; }, 2600);
      return;
    }
    var r = e.target.closest('[data-replay]');
    if (r) {
      var key = r.getAttribute('data-replay');
      document.querySelectorAll('[data-anim="' + key + '"]').forEach(function (el) { el.classList.remove('play'); void el.offsetWidth; el.classList.add('play'); });
      say(key === 's4' ? '첫 기록 도착 장면을 다시 보여 줘요' : '해결 장면을 다시 보여 줘요');
    }
  });

  /* 시안 하나의 화면 3장을 휴대폰(밝음·어두움) + PC(밝음·어두움)로 그린다 */
  SP.renderOption = function (key, mount) {
    var o = SP.opts[key]; var out = '';
    o.screens.forEach(function (s) {
      out += '<section aria-labelledby="h-' + key + s.id + '"><h2 id="h-' + key + s.id + '">' + s.title + '</h2><p class="note">' + s.desc + '</p>' +
        (s.replay ? '<p><button class="pg-btn" data-replay="' + s.replay + '">' + SP.ic.replay(14) + ' 움직임 다시 보기</button></p>' : '') +
        '<div class="row">' + SP.phone(key, 'light', s.mobile(), o.name + ' ' + s.title) + SP.phone(key, 'dark', s.mobile(), o.name + ' ' + s.title) + '</div>' +
        '<h3>PC 브라우저</h3>' + SP.browser(key, 'light', s.pc(), s.path, o.name + ' ' + s.title) + SP.browser(key, 'dark', s.pc(), s.path, o.name + ' ' + s.title) + '</section>';
    });
    mount.innerHTML = out;
    setTimeout(SP.fit, 0);
    document.querySelectorAll('[data-anim]').forEach(function (el) { el.classList.add('play'); });
  };
  SP.specTable = function (key) {
    var o = SP.opts[key], s = o.spec, r = '';
    [['콘셉트', s.concept], ['움직임', s.motion], ['색 토큰', s.colors], ['글꼴', s.fonts], ['글자 크기 단계', s.type], ['간격', s.space], ['모서리', s.radius], ['그림자', s.shadow], ['대비 확인', s.contrast], ['난이도·위험', s.risk], ['추천 순위', s.rank]].forEach(function (x) { r += '<tr><th scope="row">' + x[0] + '</th><td>' + x[1] + '</td></tr>'; });
    return '<table class="spec-table">' + r + '</table>';
  };
  SP.themeSeg = function (onChange) {
    document.querySelectorAll('[data-pt]').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('[data-pt]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        onChange(b.getAttribute('data-pt'));
      });
    });
  };
  SP.opts = SP.opts || {};
})(window.SP);
