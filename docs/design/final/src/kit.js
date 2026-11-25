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
    exit: function (s) { return I('<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="m10 16-4-4 4-4"/><path d="M6 12h10"/>', s); },
    question: function (s) { return I('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.4"/><path d="M12 16.8v.1"/>', s); },
    user: function (s) { return I('<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>', s); },
    apps: function (s) { return I('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>', s); },
    home: function (s) { return I('<path d="M4 11 12 4l8 7"/><path d="M6 10v10h12V10"/>', s); },
    list: function (s) { return I('<path d="M9 7h11M9 12h11M9 17h11"/><path d="M4.5 7h.1M4.5 12h.1M4.5 17h.1"/>', s); },
    menu: function (s) { return I('<path d="M4 7h16M4 12h16M4 17h16"/>', s); },
    google: function (s) { return I('<path d="M20.5 12.2c0-.6-.1-1.2-.2-1.7H12v3.3h4.8a4.2 4.2 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.6-3.9 2.6-6.5z"/><path d="M12 21c2.4 0 4.5-.8 5.9-2.2L15 16.5c-.8.5-1.8.9-3 .9-2.3 0-4.3-1.6-5-3.7H4v2.3A9 9 0 0 0 12 21z"/><path d="M7 13.7a5.4 5.4 0 0 1 0-3.4V8H4a9 9 0 0 0 0 8z"/><path d="M12 6.6c1.3 0 2.5.5 3.4 1.3L18 5.4A9 9 0 0 0 4 8l3 2.3c.7-2.1 2.7-3.7 5-3.7z"/>', s); }
  };
  var stTxt = SP.stTxt = { ok: '괜찮아요', bad: '문제 있어요', wait: '기록을 기다려요' };

  /* 예시 데이터 — PRD 4장 시나리오. 화면마다 같은 숫자를 쓴다(기능 8개 + 이름 없는 기능 1개) */
  SP.D = {
    features: [
      { name: '분석', route: 'POST /api/analyze', uses: 132, fail: 4, now: '3.4초', usual: '1.1초', st: 'bad' },
      { name: '모임 목록', route: 'GET /api/meetings', uses: 1204, fail: 0, now: '0.3초', usual: '0.3초', st: 'ok' },
      { name: '모임 상세', route: 'GET /api/meetings/:id', uses: 840, fail: 0, now: '0.4초', usual: '0.4초', st: 'ok' },
      { name: '로그인', route: 'POST /api/auth/login', uses: 612, fail: 2, now: '0.6초', usual: '0.5초', st: 'ok' },
      { name: '모임 신청', route: 'POST /api/meetings/:id/join', uses: 88, fail: 1, now: '0.9초', usual: '0.8초', st: 'ok', deep: { ok: 84, fail: 1, stop: 3, unk: 0 } },
      { name: '모임 만들기', route: 'POST /api/meetings', uses: 21, fail: 0, now: '0.7초', usual: '0.6초', st: 'ok' },
      { name: '사진 올리기', route: 'POST /api/upload', uses: 7, fail: 0, learning: '지금까지 7건, 0.9~2.1초', st: 'ok' },
      { name: '댓글 쓰기', route: 'POST /api/meetings/:id/comments', uses: 0, fail: 0, st: 'wait' }
    ],
    unnamed: { route: 'GET /api/cron/cleanup', uses: 3 },
    /* 버전: 5d0e7b2(11/22~어제 15:40) → 8b1e0d4(어제 15:40~, 문제 시작 전) → 3f2a9c1(오늘 13:50~, 문제) → a71c03e(15:10 고친 버전) */
    olderVer: '5d0e7b2', oldVer: '8b1e0d4', badVer: '3f2a9c1', newVer: 'a71c03e',
    errorsWorse: ['19:52 TimeoutError: upstream request exceeded 3000ms', '19:58 SlowQuery: analyze_results scan 6.4s', '20:01 TimeoutError: upstream request exceeded 3000ms', '20:04 SlowQuery: analyze_results scan 7.0s', '20:08 TimeoutError: upstream request exceeded 3000ms'],
    /* 오류 예시는 기능명세서 6.3처럼 최근 5개. 실패 4건(TimeoutError) + 느린 조회 1건 */
    errors: ['14:07 TimeoutError: upstream request exceeded 3000ms', '14:11 TimeoutError: upstream request exceeded 3000ms', '14:19 SlowQuery: analyze_results scan 2.9s', '14:23 TimeoutError: upstream request exceeded 3000ms', '14:28 TimeoutError: upstream request exceeded 3000ms'],
    keyPub: 'sp_pub_3f9a········', keySrv: 'sp_srv_8c21········', ingest: '{수집 주소}'
  };

  /* ---------- 요청문 전문 (기능명세서 6.1·6.2·6.3 틀) ----------
     시안에서는 키 뒷부분·수집 주소를 가렸다. 실제 화면은 이 자리에 값을 채워 복사한다. */
  SP.texts = {
    connect: function () {
      var D = SP.D;
      return '[쉽앤핑 연결 요청]\n내 웹앱에 쉽앤핑 모니터링을 연결해 줘. 앱 기능은 바꾸지 말고 기록 전송만 추가해.\n\n' +
        '1. 서버(API 라우트, 서버 함수)가 있으면 모든 요청에 대해, 없으면 브라우저에서 데이터 저장·조회 요청에 대해\n   주소 형태(route), method, status, 걸린 시간(ms), 오류 종류·메시지를 기록해.\n' +
        '2. 30초마다 또는 50건마다 묶어서 POST ' + D.ingest + '/v1/ingest 로 보내.\n   헤더 Authorization: Bearer {키}  (서버는 서버 키를 환경변수 SHIPPING_SERVER_KEY로, 브라우저는 수집 키)\n   수집 키: ' + D.keyPub + '\n   서버 키: ' + D.keySrv + '\n   형식: {형식 예시 JSON — 실제 요청문에서 채워짐}\n' +
        '3. app_version에는 배포마다 바뀌는 값(커밋 해시나 빌드 시각)을 넣어.\n' +
        '4. 절대 보내지 말 것: 입력값, 요청·응답 본문, 쿠키, 토큰, 쿼리 문자열, 주소 안의 실제 값(→ :id).\n' +
        '5. 전송 실패가 앱 동작을 막지 않게 해.\n' +
        '6. 앱 코드를 읽고 주소별 기능 이름(한국어, 사용자가 부르는 이름)을 만들어 POST ' + D.ingest + '/v1/feature-map 으로 한 번 보내.\n' +
        '7. 끝나면 확인 방법: 앱을 한 번 써 보고, 응답 202가 왔는지 알려 줘.\n' +
        '서버 키는 코드에 직접 쓰지 말고 환경변수로. 깃에 올리지 마.';
    },
    check: function () {
      var D = SP.D;
      return '[쉽앤핑 연결 확인]\n쉽앤핑 연결이 동작하는지 확인해 줘.\n' +
        '1. 기록 전송 코드가 지금 배포된 버전에 들어 있는지 확인해.\n' +
        '2. 앱을 한 번 써 보고 POST ' + D.ingest + '/v1/ingest 요청이 나가는지, 응답이 202인지 알려 줘.\n' +
        '3. 401이면 키가 틀렸거나 폐기된 것, 400이면 형식이 틀린 것이야. 응답의 error 내용을 알려 주고 고쳐 줘.\n' +
        '4. 기능 이름표(POST ' + D.ingest + '/v1/feature-map)를 보냈는지도 확인해.\n' +
        '확인 결과에 입력값, 쿠키, 토큰, 키 값은 넣지 마.';
    },
    /* 깊게 보기 요청문은 S8 화면의 세 칸 값으로 만든다(칸을 고치면 미리 보기·복사 내용이 같이 바뀜) */
    deep: function (root) {
      var D = SP.D, v = SP.deepVals(root);
      return '[쉽앤핑 깊게 보기 추가 요청]\n내 앱의 "' + v.name + '" 기능이 실제로 끝까지 됐는지 쉽앤핑에 알려 주는 코드를 추가해 줘. 앱 기능은 바꾸지 마.\n' +
        '- 시작: ' + v.start + ' → attempt_start 를 보내 (feature_key "deep-1", attempt_id 새 UUID, ts)\n' +
        '- 실제 성공: ' + v.ok + ' → attempt_result, result "success"\n' +
        '- 저장이 실패하면 result "failure". 실패한 단계 이름은 step에, 오류 종류·메시지는 error_kind·error_message에\n' +
        '- 사용자가 취소하거나 화면을 떠나면 result "abandon"\n' +
        '- 성공은 실제 저장이 끝난 곳(서버가 있으면 서버, 없으면 저장 응답을 받은 브라우저)에서 보내.\n  서버에서 보낼 때는 source "server"와 서버 키(환경변수 SHIPPING_SERVER_KEY), 브라우저에서는 source "browser"와 수집 키 ' + D.keyPub + '\n' +
        '- 보내는 곳과 묶는 방식은 처음 연결 때와 같아: POST ' + D.ingest + '/v1/ingest\n' +
        '- 절대 보내지 말 것: 입력값(이름·전화·이메일), 요청·응답 본문, 쿠키, 토큰, 사용자 계정 ID.\n' +
        '- 끝나면 확인 방법: ' + v.name + '을(를) 한 번 해 보고, 응답 202가 왔는지 알려 줘.';
    },
    ai: function () { return SP.aiText('first'); },
    again: function () { return SP.aiText('again'); },
    worse: function () { return SP.aiText('worse'); }
  };
  /* S8 세 칸 값 읽기. 화면 밖(처음 그릴 때)이면 기본값 */
  SP.deepDefault = { name: '모임 신청', start: '신청 버튼을 누를 때', ok: '참가자 명단에 저장됐을 때' };
  SP.deepVals = function (root) {
    var v = { name: SP.deepDefault.name, start: SP.deepDefault.start, ok: SP.deepDefault.ok };
    /* 화면의 칸이 있으면 그 값을 그대로 쓴다. 빈 칸은 예시로 채우지 않고 '(입력 필요)'로 보여 준다 */
    v.missing = false;
    if (root && root.querySelectorAll) root.querySelectorAll('[data-deep]').forEach(function (i) { var t = i.value.trim(); if (!t) { t = SP.NEED; v.missing = true; } v[i.getAttribute('data-deep')] = t; });
    return v;
  };
  SP.NEED = '(입력 필요)';
  /* AI에 보낼 내용(6.3). mode: first 처음 / again 새 버전에서도 느림 / worse 더 나빠져 다시 알림 — 화면 숫자와 같게 */
  SP.aiText = function (mode) {
    var D = SP.D;
    if (mode === true) mode = 'again'; if (!mode) mode = 'first';
    var state = {
      first: '최근 30분 24건 중 보통 3.4초 (평소 1.1초) — 2026-11-24 14:05부터',
      again: '새 버전 ' + D.newVer + '에서 5건 중 2건이 느림, 보통 2.8초 (평소 1.1초) — 문제는 2026-11-24 14:05부터',
      worse: '최근 30분 31건 중 보통 7.1초 (평소 1.1초, 처음 알림 때 3.4초) — 2026-11-24 14:05부터, 20:10에 더 나빠져 다시 알림'
    }[mode];
    var ver = mode === 'again' ? D.newVer + ' (고치려고 배포한 버전, 이전 시도 ' + D.badVer + ')' : D.badVer;
    var errs = mode === 'worse' ? D.errorsWorse : D.errors;
    var ask = { first: '\n문제 시작 전 버전과 지금 버전 사이 바뀐 코드부터 봐 줘.', again: '\n이전 수정(' + D.newVer + ') 뒤에도 5건 중 2건이 느렸어. 이전 수정에서 놓친 부분을 봐 줘.', worse: '\n처음 알림(3.4초) 뒤 배포 없이 7.1초까지 더 느려졌어. 사용량이나 데이터가 늘면 느려지는 부분(반복 조회, 인덱스 없는 조회)부터 봐 줘.' }[mode];
    return '[쉽앤핑 문제 보고]\n기능: 분석 (POST /api/analyze)\n상태: ' + state + '\n앱 버전: ' + ver + ' (문제 시작 전 버전: ' + D.oldVer + ')\n오류 기록 (최근 5개, 개인정보 가림):\n- ' + errs.join('\n- ') + '\n요청: 위 기능이 왜 느려졌는지 코드를 조사해 원인을 설명하고 고쳐 줘.' + ask + ' 고친 뒤 배포하면 쉽앤핑이 실제 사용 결과로 확인한다.';
  };

  /* ---------- 부품 함수 (design-system.md 4장 이름과 같음) ---------- */
  var K = SP.K = {};
  K.status = function (st, t) { return '<span class="sp-status ' + st + '">' + ic[st](15) + (t || stTxt[st]) + '</span>'; };
  K.swapStatus = function (a, at, b, bt) { return '<span class="sp-swap"><span class="from">' + K.status(a, at) + '</span><span class="to">' + K.status(b, bt) + '</span></span>'; };
  /* ---------- 양 SVG (D4: 상자에서 꺼낸 양) ----------
     앱 아이콘 PNG를 바탕으로 같은 모양을 브랜드 색만으로 다시 그렸다. 배경 없음.
     부위별 묶음: .pings(뿔에서 퍼지는 레이더 핑) .bod(숨쉬기·폴짝) .legs .wool .horn .head .eye(깜빡임)
     흰 몸은 밝은 바탕에서도 보이게 퍼플(#261B40) 테두리를 두른다. 장식이라 aria-hidden */
  /* 부위 그림(좌표는 1254px 원본 기준). docs/design/brand/sheep.svg와 같은 모양이다.
     부위 사이 짙은 퍼플 분리선은 같은 색 테두리를 칠 아래에 깔아(paint-order: stroke) 만든다 */
  SP.sheepParts = function (attr) {
    var ink = '#261B40', wht = '#F8F4FC', mint = '#76E7C4', lav = '#C3A6FF';
    var S = ' stroke="' + ink + '" stroke-width="24" stroke-linejoin="round" paint-order="stroke"';
    var g = function (name, inner) { return '<g ' + attr(name) + '>' + inner + '</g>'; };
    var foot = function (x, y, w) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="58" rx="16" fill="' + wht + '"' + S + '/>'; };
    var joint = function (cx, cy) { return '<circle cx="' + cx + '" cy="' + cy + '" r="66" fill="' + wht + '"' + S + '/><circle cx="' + cx + '" cy="' + cy + '" r="22" fill="' + ink + '"/>'; };
    var spiral = 'M655 438 C600 330 430 292 318 342 C198 396 168 545 232 645 C292 742 444 760 512 690 C580 620 562 502 470 472 C390 446 318 502 330 572 C335 600 348 610 360 614';
    return g('pings', '<circle class="ping p1" cx="415" cy="590" r="300" fill="none" stroke="' + mint + '" stroke-width="18"/><circle class="ping p2" cx="415" cy="590" r="300" fill="none" stroke="' + mint + '" stroke-width="18"/>') +
      g('bod',
        g('leg-3', '<path d="M380 995 L470 1015 L482 1045 L400 1045 Z" fill="' + wht + '"' + S + '/>' + foot(392, 1050, 98)) +
        g('leg-4', '<path d="M752 1005 L818 968 L858 1045 L775 1045 Z" fill="' + wht + '"' + S + '/>' + foot(770, 1050, 92)) +
        g('body', '<path d="M300 780 C390 810 500 800 575 752 C660 812 760 835 858 838 C858 900 830 950 760 980 C640 1010 500 1000 420 970 C360 950 300 950 275 920 C255 870 262 815 300 780 Z" fill="' + wht + '"' + S + '/>') +
        g('leg-1', '<path d="M300 958 L405 972 L350 1042 L262 1042 Z" fill="' + wht + '"' + S + '/>' + foot(250, 1050, 88) + joint(355, 930)) +
        g('leg-2', '<path d="M625 955 L740 965 L715 1042 L635 1042 Z" fill="' + wht + '"' + S + '/>' + foot(635, 1050, 90) + joint(680, 930)) +
        g('wool', '<g fill="' + lav + '"' + S + '><circle cx="565" cy="255" r="100"/><circle cx="765" cy="282" r="95"/><circle cx="922" cy="360" r="80"/><circle cx="690" cy="350" r="80"/><circle cx="850" cy="405" r="70"/></g><g fill="' + lav + '"><circle cx="565" cy="255" r="100"/><circle cx="765" cy="282" r="95"/><circle cx="922" cy="360" r="80"/><circle cx="690" cy="350" r="80"/><circle cx="850" cy="405" r="70"/></g>') +
        g('horn', '<path d="' + spiral + '" fill="none" stroke="' + ink + '" stroke-width="98" stroke-linecap="round"/><path d="' + spiral + '" fill="none" stroke="' + mint + '" stroke-width="72" stroke-linecap="round"/><circle cx="415" cy="600" r="40" fill="' + lav + '"/>') +
        g('head', '<path d="M535 435 C600 425 680 440 715 445 L800 425 C860 470 930 470 945 478 L970 530 C1010 545 1060 560 1065 600 C1068 640 1058 665 1050 690 C1020 760 900 805 820 805 C730 805 650 775 598 715 C630 650 645 600 640 590 C580 560 535 500 535 435 Z" fill="' + wht + '"' + S + '/>' +
          '<path d="M572 470 C612 482 650 512 668 548 C640 556 610 550 592 530 C578 512 572 492 572 470 Z" fill="none" stroke="' + ink + '" stroke-width="13" stroke-linejoin="round"/>' +
          '<path d="M968 670 C990 690 1030 690 1050 665" fill="none" stroke="' + ink + '" stroke-width="14" stroke-linecap="round"/>' +
          g('eye', '<ellipse cx="835" cy="577" rx="58" ry="62" fill="' + ink + '"/><ellipse cx="849" cy="549" rx="20" ry="16" fill="' + wht + '" transform="rotate(35 849 549)"/>')));
  };
  SP.sheep = function (cls) {
    return '<svg class="sp-sheep ' + (cls || '') + '" viewBox="150 130 940 1000" aria-hidden="true" focusable="false">' + SP.sheepParts(function (n) { return 'class="' + (n === 'bod' ? 'bod' : n) + '"'; }) + '</svg>';
  };
  /* 큰 문장 카드 + 양: o = { meta, headline, body, ring(해결: 폴짝 + 민트 고리), ping(첫 기록: 뿔 핑), pc, side, noAv }
     양은 상자 없이 카드 왼쪽 위 가장자리에 걸쳐 앉는다. 움직임은 상태가 바뀔 때 한 번만(components.css) */
  K.say = function (o) {
    /* noAv: 한 화면에 큰 문장 카드가 둘 이상일 때(S0 예시 화면) 두 번째부터는 양을 빼서 양이 한 번만 나오게 */
    var av = o.noAv ? '' : '<span class="sp-av' + (o.ring ? ' ring' : '') + (o.ping ? ' pinger' : '') + '">' + SP.sheep('perch') + '</span>';
    var main = '<div class="meta">' + (o.meta || '') + '</div>' + o.headline + (o.body || '');
    var card = o.pc ? '<div class="sp-hero pc"><div style="display:flex;flex-direction:column;gap:14px;min-width:0">' + main + '</div>' + (o.side || '') + '</div>' : '<div class="sp-hero">' + main + (o.side || '') + '</div>';
    return '<section class="sp-say' + (o.noAv ? ' noav' : '') + '" aria-label="쉽앤핑이 알려 드려요">' + av + card + '</section>';
  };
  K.cmp = function (a, b, cls) {
    return '<div class="sp-cmp" role="img" aria-label="' + a[0] + ' ' + a[1] + '초, ' + b[0] + ' ' + b[1] + '초"><span class="v old"><span class="lb">' + a[0] + '</span><span class="n">' + a[1] + '<small>초</small></span></span><span class="arr" aria-hidden="true">→</span><span class="v ' + (cls || 'bad') + '"><span class="lb">' + b[0] + '</span><span class="n">' + b[1] + '<small>초</small></span></span></div>';
  };
  /* 기능 행: 행 전체가 기능 상세(S6)로 가는 링크 — Tab으로 닿고 Enter로 연다. focus: 초점 모습 시연 */
  K.frow = function (f, focus) {
    var rt = f.st === 'wait' ? '<span class="rt"><small>아직 없어요</small></span>' : f.learning ? '<span class="rt"><small>평소 속도<br>익히는 중</small></span>' : '<span class="rt">' + f.now + '<small>평소 ' + f.usual + '</small></span>';
    var sub = f.st === 'wait' ? '아직 사용 기록이 없어요' : f.learning ? f.learning : f.deep ? '사용 ' + f.uses + '건: 성공 ' + f.deep.ok + ', 실패 ' + f.deep.fail + ', 중단 ' + f.deep.stop + ', 결과 미확인 ' + f.deep.unk : '사용 ' + f.uses.toLocaleString() + '건, 실패 ' + f.fail + '건';
    /* f.nolink: 상세 화면을 그리지 않은 앱(독서노트)의 행 — 다른 앱 화면으로 잘못 보내지 않게 링크 없이 */
    if (f.nolink) return '<li><div class="sp-frow ' + f.st + '"><span class="si ' + f.st + '">' + ic[f.st](20) + '<span class="sr">' + stTxt[f.st] + '</span></span><span class="nm">' + f.name + '<small>' + sub + '</small></span>' + rt + '</div></li>';
    return '<li><a class="sp-frow ' + f.st + (focus ? ' is-focus' : '') + '" href="#' + (f.deep ? 's8-result' : 's6') + '"><span class="si ' + f.st + '">' + ic[f.st](20) + '<span class="sr">' + stTxt[f.st] + '</span></span><span class="nm">' + f.name + (f.deep ? ' <span class="tag">깊게 보기</span>' : '') + '<small>' + sub + '</small></span>' + rt + '<span class="go">' + ic.chev(18) + '</span></a></li>';
  };
  K.featList = function (list, focusFirst) { return '<ul class="sp-list">' + list.map(function (f, i) { return K.frow(f, focusFirst && i === 0); }).join('') + '</ul>'; };
  /* 이름 없는 기능은 상태가 아니므로 상태 색을 쓰지 않는다(연필 아이콘 + 보조 글자색) */
  K.unnamed = function () { return '<h3 class="sp-h3">이름 없는 기능 1개</h3><ul class="sp-list"><li class="sp-frow"><span class="si none">' + ic.pen(18) + '</span><span class="nm">이름 없는 기능<small>사용 3건. 이름을 붙이면 알림에 그 이름이 나와요</small></span><button class="sp-edit">이름 붙이기</button></li></ul>'; };
  K.copy = function (label, kind, extra, state) { return '<button class="sp-btn sp-copy' + (extra || '') + '" data-copy="' + (kind || 'ai') + '" data-label="' + esc(label) + '"' + (state ? ' data-state="' + state + '"' : '') + '>' + ic.copy(18) + '<span class="lbl">' + (state === 'fail' ? '다시 복사' : label) + '</span></button>'; };
  /* 복사 묶음: 단추 + (자동 복사 막힘 때) 직접 선택 상자 + 미리 보기 전문
     o = { label, kind, line, preview: 'open' | 'closed' | false, blocked, note } */
  K.copyBlock = function (o) {
    var t = SP.texts[o.kind](), name = esc(o.label.replace(/( 다시)? 복사$/, '')) + ' 전문';
    return '<div class="sp-copyblock" data-kind="' + o.kind + '">' + K.copy(o.label, o.kind, o.line ? ' line block' : ' block', o.blocked ? 'fail' : null) +
      '<div class="sp-copy-manual"' + (o.blocked ? '' : ' hidden') + '><div class="sp-banner warn">' + ic.bad(18) + '<div><b>자동 복사가 막혔어요.</b> 아래 상자를 누르면 전부 선택돼요. 그대로 복사하세요(휴대폰은 길게 눌러 "복사").</div></div><pre class="sp-pre" tabindex="0" aria-label="' + name + ', 눌러서 모두 선택">' + esc(t) + '</pre></div>' +
      (o.preview && !o.blocked ? '<details' + (o.preview === 'open' ? ' open' : '') + '><summary>보낼 내용 미리 보기</summary><pre class="sp-pre scroll" tabindex="0" aria-label="' + name + '">' + esc(t) + '</pre></details>' : '') +
      (o.kind === 'deep' ? '<p class="sp-need err-line" role="status" hidden>' + ic.bad(16) + '빈 칸이 있어요. 세 칸을 모두 채우면 복사할 수 있어요.</p>' : '') +
      (o.note ? '<p class="sp-sub">' + o.note + '</p>' : '') + '</div>';
  };
  /* 깊게 보기 결과 4가지 — 상태가 아니라 결과 종류. 색 + 아이콘 + 글자 */
  K.results = function (r) {
    var it = function (cls, icn, k, n, d) { return '<li class="' + cls + '"><span class="k">' + ic[icn](16) + k + '</span><span class="c">' + n + '<small>건</small></span><span class="d">' + d + '</span></li>'; };
    return '<ul class="sp-results">' + it('ok', 'ok', '성공', r.ok, '명단 저장까지 끝났어요') + it('bad', 'bad', '실패', r.fail, '저장하다 실패했어요') + it('stop', 'exit', '중단', r.stop, '사용자가 취소했거나 화면을 떠났어요') + it('unk', 'question', '결과 미확인', r.unk, '시작하고 10분이 지나도 결과가 안 왔어요') + '</ul>';
  };
  /* 앱 화면 머리말 오른쪽: 평소엔 알림·설정 아이콘, 글자 200%에서는 [메뉴] 하나 */
  K.appActs = function (open) { return '<a class="sp-ibtn not-big" href="#s9" aria-label="알림 설정">' + ic.bell(20) + '</a><a class="sp-ibtn not-big" href="#s10" aria-label="앱 설정">' + ic.gear(20) + '</a><button class="sp-btn line only-big sp-menu-btn" aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="m' + (SP.mid = (SP.mid || 0) + 1) + '">' + ic.menu(18) + '메뉴</button>'; };
  /* [메뉴]가 여닫는 목록. 머리말 바로 다음에 둔다(닫혀 있으면 hidden). id는 바로 앞 appActs의 aria-controls와 같다 */
  K.appMenu = function (open) {
    var it = function (icn, t, href) { return '<li><a href="#' + href + '">' + ic[icn](20) + t + '<span class="go">' + ic.chev(18) + '</span></a></li>'; };
    return '<nav class="only-big-nav" id="m' + SP.mid + '" aria-label="모임모아 메뉴"' + (open ? '' : ' hidden') + '><ul class="sp-menu">' + it('bell', '알림 설정', 's9') + it('gear', '앱 설정', 's10') + it('plus', '깊게 볼 기능 추가', 's8') + it('back', '내 앱 목록', 's2') + it('user', '내 계정', 's11') + '</ul></nav>';
  };
  K.steps = function (items, doneUpTo, nowAt) {
    return '<ol class="sp-steps">' + items.map(function (t, i) {
      var c = i < doneUpTo ? 'done' : (i === nowAt ? 'now' : '');
      return '<li class="' + c + '"><span class="num">' + (c === 'done' ? ic.check(14) + '<span class="sr">끝남</span>' : (i + 1)) + '</span><span>' + t + '</span></li>';
    }).join('') + '</ol>';
  };
  K.field = function (o) {
    var id = 'f' + (SP.uid = (SP.uid || 0) + 1);
    return '<div class="sp-field"><label for="' + id + '">' + o.label + (o.opt ? ' <span class="opt">(선택)</span>' : '') + '</label>' + (o.example ? '<span class="help" id="' + id + 'h">' + o.example + '</span>' : '') +
      '<input class="sp-input" id="' + id + '" value="' + esc(o.value || '') + '"' + (o.attr || '') + (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') + (o.err ? ' aria-invalid="true" aria-describedby="' + id + 'e"' : (o.example || o.help ? ' aria-describedby="' + id + 'h"' : '')) + '>' +
      (o.help && !o.example ? '<span class="help" id="' + id + 'h">' + o.help + '</span>' : '') + (o.err ? '<span class="err" id="' + id + 'e" role="alert">' + ic.bad(16) + o.err + '</span>' : '') + '</div>';
  };
  /* 띠 알림. act가 있으면 href(다음 화면)로 가는 밑줄 글자 링크 */
  K.banner = function (kind, text, act, href) { return '<div class="sp-banner ' + kind + '" role="' + (kind === 'warn' ? 'alert' : 'status') + '">' + (kind === 'warn' ? ic.bad(18) : ic.info(18)) + '<div>' + text + (act ? '<br><a class="act" href="#' + (href || '') + '">' + act + '</a>' : '') + '</div></div>'; };
  K.error = function (title, body, acts) { return '<div class="sp-error" role="alert">' + ic.bad(20) + '<div class="body"><b>' + title + '</b><span class="sp-sub" style="color:var(--sp-ink)">' + body + '</span>' + (acts ? '<div class="acts">' + acts + '</div>' : '') + '</div></div>'; };
  K.empty = function (title, body, act) { return '<div class="sp-empty"><b>' + title + '</b><span class="sp-sub">' + body + '</span>' + (act || '') + '</div>'; };
  K.hdr = function (title, sub, back, right) {
    /* 양은 큰 문장 카드에서만 말한다. 머리말 왼쪽 브랜드 타일은 워드마크(양 없음) */
    return '<header class="sp-hdr">' + (back ? '<button class="sp-ibtn" aria-label="' + back + '">' + ic.back(22) + '</button>' : '<img class="sp-tile" src="' + SP.IMG.wordmark + '" alt="" width="30" height="30">') + '<span class="t">' + title + (sub ? '<small>' + sub + '</small>' : '') + '</span>' + (right === undefined ? '<button class="sp-ibtn" aria-label="앱 설정">' + ic.gear(20) + '</button>' : right) + '</header>';
  };
  K.top = function (crumb, right) { return '<header class="sp-top"><img class="sp-tile" src="' + SP.IMG.wordmark + '" alt="" width="30" height="30"><span class="crumb">내 앱 › <b>' + crumb + '</b></span><span style="flex:1"></span>' + (right || '<button class="sp-ibtn" aria-label="알림 설정">' + ic.bell(20) + '</button><button class="sp-ibtn" aria-label="앱 설정">' + ic.gear(20) + '</button>') + '</header>'; };

  /* ---------- 프레임 ---------- */
  var sbIcons = '<svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true"><rect x="0" y="8" width="3" height="4" rx="1" fill="currentColor"/><rect x="5" y="5.5" width="3" height="6.5" rx="1" fill="currentColor"/><rect x="10" y="3" width="3" height="9" rx="1" fill="currentColor"/><rect x="15" y="0" width="3" height="12" rx="1" fill="currentColor"/></svg><svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true"><path d="M8 11.5 5.6 9a3.4 3.4 0 0 1 4.8 0zM3.2 6.6a6.8 6.8 0 0 1 9.6 0l-1.4 1.4a4.8 4.8 0 0 0-6.8 0zM.8 4.2a10.2 10.2 0 0 1 14.4 0l-1.4 1.4a8.2 8.2 0 0 0-11.6 0z" fill="currentColor"/></svg><svg width="27" height="13" viewBox="0 0 27 13" aria-hidden="true"><rect x=".5" y=".5" width="23" height="12" rx="3.5" fill="none" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="17" height="9" rx="2" fill="currentColor"/></svg>';
  SP.phone = function (theme, inner, opts) {
    opts = opts || {};
    return '<figure class="t-' + theme + '" style="margin:0"><figcaption class="cap">휴대폰, ' + (theme === 'light' ? '밝은 모드' : '어두운 모드') + (opts.big ? ', 글자 200%' : '') + '</figcaption><div class="phone"><div class="sp' + (opts.big ? ' text-200' : '') + '" data-theme="' + theme + '"' + (opts.anim ? ' data-anim="' + opts.anim + '"' : '') + '><div class="sb" aria-hidden="true"><span>9:41</span><span class="island"></span><span class="ic">' + sbIcons + '</span></div><div class="scr">' + inner + '</div><div class="home" aria-hidden="true"><i></i></div></div></div></figure>';
  };
  /* PC 브라우저 창(주소창 포함). o = { width: 1440 | 1280 | 720, big: 글자 200%, cap: 덧붙일 설명 } — 높이는 900 기준(내용이 길면 늘어남) */
  SP.browser = function (theme, inner, path, anim, o) {
    o = o || {}; var w = o.width || 1440;
    return '<figure class="t-' + theme + '" style="margin:0"><figcaption class="cap">PC 브라우저 ' + w + '×900, ' + (theme === 'light' ? '밝은 모드' : '어두운 모드') + (o.cap ? ', ' + o.cap : '') + '</figcaption><div class="pc-fit"><div class="browser' + (theme === 'dark' ? ' dark' : '') + '" data-w="' + w + '" style="width:' + w + 'px"><div class="chrome" aria-hidden="true"><span class="dots"><i></i><i></i><i></i></span><span class="url">' + ic.lock(12) + 'ship-and-ping.pages.dev' + path + '</span><span style="width:52px"></span></div><div class="sp' + (o.big ? ' text-200' : '') + '" data-theme="' + theme + '"' + (anim ? ' data-anim="' + anim + '"' : '') + '>' + inner + '</div></div></div></figure>';
  };
  SP.fit = function () { document.querySelectorAll('.pc-fit').forEach(function (w) { var b = w.firstElementChild; if (b) b.style.zoom = Math.min(1, w.clientWidth / (+b.getAttribute('data-w') || 1440)); }); };
  window.addEventListener('resize', function () { SP.fit(); });

  /* ---------- 동작: 복사(성공·실패 구분, 중복 누름 방지), 스위치, 움직임 다시 보기 ---------- */
  var live;
  SP.say = function (msg) { if (!live) { live = document.createElement('div'); live.className = 'sr'; live.setAttribute('aria-live', 'polite'); live.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)'; document.body.appendChild(live); } live.textContent = ''; setTimeout(function () { live.textContent = msg; }, 30); };
  /* 클립보드 API → 안 되면 예전 방식 → 그래도 안 되면 실패로 알린다(성공 안내를 먼저 띄우지 않음) */
  function oldCopy(text) {
    try {
      var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta); ta.select(); var ok = document.execCommand && document.execCommand('copy'); document.body.removeChild(ta); return !!ok;
    } catch (err) { return false; }
  }
  SP.copyText = function (text, done) {
    var settled = false; var end = function (ok) { if (!settled) { settled = true; done(ok); } };
    try {
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { end(true); }, function () { end(oldCopy(text)); });
      else end(oldCopy(text));
    } catch (err) { end(false); }
  };
  function selectAll(el) { try { var r = document.createRange(); r.selectNodeContents(el); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); } catch (err) {} }
  document.addEventListener('click', function (e) {
    var c = e.target.closest('[data-copy]');
    if (c) {
      if (c.getAttribute('data-state') === 'done' || c.getAttribute('aria-busy') === 'true' || c.getAttribute('aria-disabled') === 'true') return;
      var kind = c.getAttribute('data-copy'), label = c.getAttribute('data-label') || '복사';
      var text = SP.texts[kind] ? SP.texts[kind](c.closest('.sp')) : '';
      var lbl = c.querySelector('.lbl'), box = c.closest('.sp-copyblock'), manual = box ? box.querySelector('.sp-copy-manual') : null;
      c.setAttribute('aria-busy', 'true');
      var force = c.hasAttribute('data-force-fail');
      var finish = function (ok) {
        c.removeAttribute('aria-busy');
        if (ok) {
          c.setAttribute('data-state', 'done'); if (lbl) lbl.textContent = '복사했어요';
          if (manual) manual.hidden = true;
          SP.say('복사했어요. 코딩 AI 대화창에 붙여넣으세요.');
          setTimeout(function () { c.removeAttribute('data-state'); if (lbl) lbl.textContent = label; }, 2600);
        } else {
          c.setAttribute('data-state', 'fail'); if (lbl) lbl.textContent = '다시 복사';
          if (manual) { manual.hidden = false; var pre = manual.querySelector('pre'); if (pre) { pre.textContent = text; pre.focus(); selectAll(pre); } }
          SP.say('자동 복사가 막혔어요. 아래 상자의 내용을 직접 선택해 복사하세요.');
        }
      };
      if (force) finish(false); else SP.copyText(text, finish);
      return;
    }
    var pre = e.target.closest('.sp-copy-manual pre');
    if (pre) { selectAll(pre); return; }
    /* 다음 화면으로 가는 단추(목업 이동). 비활성이면 아무것도 하지 않음 */
    var go = e.target.closest('[data-go]');
    if (go) { if (go.getAttribute('aria-disabled') === 'true') return; location.hash = go.getAttribute('data-go'); return; }
    /* 글자 200%의 [메뉴] 여닫기 */
    var mb = e.target.closest('.sp-menu-btn');
    if (mb) { setMenu(mb, mb.getAttribute('aria-expanded') !== 'true'); return; }
    /* 기간 고르기: 같은 화면 안의 data-period 묶음만 바꿔 보여 줌 */
    var pb = e.target.closest('.sp-seg button[data-period]');
    if (pb) {
      var root = pb.closest('.sp'), p = pb.getAttribute('data-period');
      root.querySelectorAll('.sp-seg button[data-period]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-period') === p)); });
      root.querySelectorAll('[data-period-panel]').forEach(function (el) { el.hidden = el.getAttribute('data-period-panel') !== p; });
      SP.say(p === '7d' ? '최근 7일로 바꿨어요' : '최근 24시간으로 바꿨어요');
      return;
    }
    var sw = e.target.closest('.sp-switch');
    if (sw) { sw.setAttribute('aria-checked', String(sw.getAttribute('aria-checked') !== 'true')); return; }
    var r = e.target.closest('[data-replay]');
    if (r) { document.querySelectorAll('[data-anim]').forEach(function (el) { el.classList.remove('play'); void el.offsetWidth; el.classList.add('play'); }); SP.say('움직임을 다시 보여 줘요'); }
  });
  function setMenu(btn, open) {
    var nav = document.getElementById(btn.getAttribute('aria-controls'));
    btn.setAttribute('aria-expanded', String(open)); if (nav) nav.hidden = !open;
    if (open && nav) { var a = nav.querySelector('a'); if (a) a.focus(); }
  }
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.sp-menu-btn[aria-expanded="true"]').forEach(function (b) { setMenu(b, false); b.focus(); });
  });
  document.addEventListener('input', function (e) {
    var t = e.target;
    /* S8: 세 칸을 고치면 미리 보기 전문도 바로 바뀜(복사 내용과 같음) */
    if (t.hasAttribute && t.hasAttribute('data-deep')) {
      var root = t.closest('.sp'), txt = SP.texts.deep(root), miss = SP.deepVals(root).missing;
      root.querySelectorAll('.sp-copyblock[data-kind="deep"] pre').forEach(function (p) { p.textContent = txt; });
      /* 빈 칸이 하나라도 있으면 복사 단추를 막고 이유를 보여 줌 */
      root.querySelectorAll('.sp-copyblock[data-kind="deep"]').forEach(function (b) {
        var btn = b.querySelector('[data-copy]'), why = b.querySelector('.sp-need');
        if (btn) btn.setAttribute('aria-disabled', String(miss));
        if (why) why.hidden = !miss;
      });
    }
    /* 확인 입력: 적은 값이 data-confirm과 정확히 같을 때만 단추가 눌림 */
    if (t.hasAttribute && t.hasAttribute('data-confirm')) {
      var btn = document.getElementById(t.getAttribute('data-confirm-btn'));
      if (btn) btn.setAttribute('aria-disabled', String(t.value !== t.getAttribute('data-confirm')));
    }
  });
  /* 키보드로 직접 선택 상자에 오면 전부 선택 */
  document.addEventListener('focusin', function (e) { var p = e.target.closest && e.target.closest('.sp-copy-manual pre'); if (p) selectAll(p); });
})(window.SP);
