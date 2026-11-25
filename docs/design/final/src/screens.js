/* ===== 쉽앤핑 최종 화면 S1~S11 (+ 로딩·빈 화면·오류·진행 상태) =====
   숫자 규칙: 기능 8개(이름 있음) + 이름 없는 기능 1개. "기능 N개"라고 쓴 곳의 목록은 늘 N줄이다. */
(function (SP) {
  var K = SP.K, ic = SP.ic, D = SP.D, esc = SP.esc;
  var E = SP.entries = [];
  var add = function (o) { E.push(o); };
  var wrap = function (inner, pad) { return '<div style="display:flex;flex-direction:column;flex:1;padding-bottom:' + (pad == null ? 20 : pad) + 'px">' + inner + '</div>'; };
  var sec = function (inner, style) { return '<div class="sp-sec"' + (style ? ' style="' + style + '"' : '') + '>' + inner + '</div>'; };
  var flat = function (html) { return html.replace('class="sp-sec"', 'class="sp-sec" style="padding:0"'); };
  var problemMeta = function () { return K.status('bad') + '<span>오늘 14:05부터</span>'; };
  var hdrApp = function (sub, open) { return K.hdr('모임모아', sub, '내 앱 목록으로', K.appActs(open)); };
  /* 문제가 없는 때의 같은 기능 8개(분석도 괜찮음), 사용 많은 순 */
  var okFeatures = D.features.map(function (f) { return f.name === '분석' ? { name: f.name, route: f.route, uses: 132, fail: 0, now: '1.1초', usual: '1.1초', st: 'ok' } : f; })
    .sort(function (a, b) { return b.uses - a.uses; });

  /* ---------------- S1 첫 화면·로그인 ---------------- */
  var s1 = function (banner) {
    return wrap('<header class="sp-hdr"><img class="sp-tile" src="' + SP.IMG.wordmark + '" alt="Ship &amp; Ping 쉽앤핑" width="40" height="40" style="width:40px;height:40px;border-radius:10px"><span class="t">쉽앤핑</span></header>' + (banner || '') +
      K.say({ meta: '<span>무료 베타</span>', headline: '<p class="sp-headline">내 앱이 괜찮은지, 24시간 대신 지켜볼게요</p>', body: '<p class="hsub">문제가 생기면 "분석이 느려졌어요"처럼 쉬운 말로 알려 드리고, 코딩 AI에 보낼 내용까지 챙겨 드려요.</p>' }) +
      sec('<button class="sp-btn block">' + ic.google(18) + 'Google로 시작하기</button><button class="sp-btn line block">' + ic.mail(18) + '이메일 링크로 시작하기</button><p class="sp-sub">이메일 링크는 비밀번호 없이 메일에 온 링크를 눌러 들어오는 방식이에요.</p>') +
      sec('<h2>이렇게 써요</h2>' + K.steps(['연결 요청을 코딩 AI에 붙여넣어요', '문제가 생기면 슬랙이나 메일로 알려 드려요', '고친 버전을 배포하면 해결됐는지 확인해 드려요'], 0, -1)));
  };
  add({ id: 's1', group: 'S1 첫 화면·로그인', title: 'S1 첫 화면·로그인',
    desc: '서비스 소개 한 문장을 양이 말한다. 로그인은 Google과 이메일 링크 두 가지. 첫 로그인이면 S3(앱 등록)으로, 알림 링크로 왔으면 원래 화면으로 돌아간다. 머리말 왼쪽은 워드마크이고, 양은 큰 문장 카드에만 나온다.',
    mobile: function () { return s1(); } });

  /* ---------------- S2 내 앱 목록 ---------------- */
  add({ id: 's2', group: 'S2 내 앱 목록', title: 'S2 내 앱 목록 (앱 3개, 한도 도달)',
    desc: '앱 카드마다 상태·열린 문제 수·마지막 기록 시각. 문제 있는 앱이 맨 위. 무료 베타 한도(앱 3개)에 닿으면 등록 단추를 비활성으로 두고 이유를 바로 옆에 쓴다. 머리말 오른쪽 사람 아이콘이 S11 내 계정으로 가는 길이다(PC도 같은 자리).',
    mobile: function () {
      var card = function (name, st, line) { return '<a class="sp-appcard" href="#s5"><span class="r"><b>' + name + '</b>' + K.status(st) + '</span><span class="sp-sub">' + line + '</span></a>'; };
      return wrap(K.hdr('내 앱', '쉽앤핑', null, '<a class="sp-ibtn" href="#s11" aria-label="내 계정">' + ic.user(22) + '</a>') +
        sec('<h1>앱 3개</h1>' + card('모임모아', 'bad', '열린 문제 1개, 마지막 기록 1분 전') + card('독서노트', 'ok', '마지막 기록 12분 전') + card('우리동네 장터', 'wait', '연결을 마치면 첫 기록이 와요') +
          '<button class="sp-btn line block" aria-disabled="true" aria-describedby="lim">' + ic.plus(18) + '앱 등록하기</button><p class="sp-sub" id="lim">무료 베타는 앱 3개까지예요. 앱을 지우면 새로 등록할 수 있어요.</p>' +
          K.empty('앱이 하나도 없을 때', '"아직 등록한 앱이 없어요. 앱을 등록하면 연결 요청문을 드려요" 문장과 [앱 등록하기] 단추만 보여 줘요.')));
    } });

  /* ---------------- S3 앱 등록 ---------------- */
  add({ id: 's3', group: 'S3 앱 등록', title: 'S3 앱 등록 (주소 입력 오류)',
    desc: '입력은 두 칸. 이름표는 늘 칸 위에 보이고, 오류는 그 칸 바로 아래에 무엇을 고치면 되는지로. 등록하는 동안 단추는 "등록하는 중"으로 바뀌고 다시 눌리지 않는다.',
    mobile: function () {
      return wrap(K.hdr('앱 등록', null, '내 앱 목록으로', '') +
        sec('<h1>지켜볼 앱을 알려 주세요</h1><p class="sp-sub">등록하면 코딩 AI에 붙여넣을 연결 요청문을 드려요.</p>' +
          K.field({ label: '앱 이름', value: '모임모아', help: '1~40자. 알림에 이 이름이 쓰여요' }) +
          K.field({ label: '앱 주소', opt: true, value: 'moim-moa.pages.dev', err: 'https://로 시작하는 주소를 적어 주세요. 예: https://moim-moa.pages.dev' }) +
          '<p class="sp-sub">앱 주소는 나중에 적어도 돼요.</p><button class="sp-btn block">등록하고 연결 요청 받기</button>' +
          '<p class="sp-sub" style="margin-top:8px">누른 뒤 모습:</p><button class="sp-btn block" aria-busy="true" aria-disabled="true"><span class="sp-spin" aria-hidden="true"></span>등록하는 중</button>'));
    } });

  /* ---------------- S4 연결하기 ---------------- */
  var STEPS4 = ['<b>연결 요청 복사</b><br><span class="sp-sub">아래 단추로 복사해요</span>', '<b>코딩 AI가 연결</b><br><span class="sp-sub">코딩 AI 대화창에 붙여넣으면 AI가 기록 전송 코드를 넣어요</span>', '<b>배포</b><br><span class="sp-sub">고친 코드를 실제 주소에 올려요</span>', '<b>앱 한 번 써 보기</b><br><span class="sp-sub">배포한 앱에서 아무 기능이나 한 번 써요</span>'];
  var connectNote = '연결 요청에는 이 앱의 키가 들어 있어요. 코딩 AI 말고 다른 사람에게 보내지 마세요. (시안 미리 보기에서는 키 뒷부분과 수집 주소를 가렸어요)';
  var s4Copy = function (blocked) {
    return wrap(K.hdr('모임모아 연결하기', '1 / 4단계', '내 앱 목록으로') +
      K.say({ meta: K.status('wait', '연결 전') + '<span>방금 등록함</span>', headline: '<p class="sp-headline">연결 요청을 코딩 AI에 붙여넣어 주세요</p>', body: '<p class="hsub">요청문 하나로 코딩 AI가 기록 전송과 기능 이름표를 넣어요. 앱 기능은 바꾸지 않아요.</p>' }) +
      sec('<h2>연결 4단계</h2>' + K.steps(STEPS4, 0, 0)) +
      sec(K.copyBlock({ label: '연결 요청 복사', kind: 'connect', preview: 'open', blocked: blocked, note: connectNote })));
  };
  add({ id: 's4-copy', group: 'S4 연결하기', title: 'S4 ① 연결 요청 복사 (처음 들어온 화면)',
    desc: 'S3에서 등록하면 바로 오는 화면. 4단계 중 지금 할 일은 ① 하나. 요청문 전문(기능명세서 6.1)을 미리 보기로 펼쳐 두어 무엇을 보내는지 읽고 복사한다. 키가 들어 있으니 다른 사람에게 보내지 말라는 안내를 단추 아래에 둔다.',
    mobile: function () { return s4Copy(false); } });
  add({ id: 's4-copy-fail', group: 'S4 연결하기', title: 'S4 ① 복사 실패: 직접 선택해 복사',
    desc: '브라우저가 자동 복사를 막으면 "복사했어요"를 띄우지 않는다. 단추는 "다시 복사"로 바뀌고, 바로 아래에 이유와 요청문 전문 상자가 열린다. 상자를 누르거나 Tab으로 들어오면 전부 선택돼 그대로 복사할 수 있다. 화면 읽기에도 같은 내용을 알린다.',
    mobile: function () { return s4Copy(true); } });
  add({ id: 's4-wait', group: 'S4 연결하기', title: 'S4 ②~④ 첫 기록 대기',
    desc: '복사하면 ①에 체크가 붙고 대기 화면이 된다. ②~④는 쉽앤핑 밖에서 일어나 진행을 알 수 없으므로 할 일 목록으로만 보여 준다. 5초마다 확인하고, 기록이 오면 바로 "기록이 도착했어요"로 바뀐다. 30분이 지나면 "기록이 안 와요?" 확인 목록이 열린다.',
    mobile: function () {
      return wrap(K.hdr('모임모아 연결하기', '5초마다 확인하고 있어요', '내 앱 목록으로') +
        K.say({ meta: K.status('wait', '첫 기록을 기다려요') + '<span>연결 요청 복사 후 3분</span>', headline: '<p class="sp-headline">첫 기록을 기다리고 있어요</p>', body: '<p class="hsub">코딩 AI가 연결하고, 배포하고, 앱을 한 번 써 보면 기록이 와요. 이 화면을 닫아도 계속 확인해요.</p>' }) +
        sec('<h2>연결 4단계</h2>' + K.steps(STEPS4, 1, -1)) +
        sec(K.copyBlock({ label: '연결 요청 다시 복사', kind: 'connect', line: true, preview: 'closed', note: connectNote }) + '<p class="sp-sub">30분이 지나도 기록이 없으면 무엇을 확인할지 알려 드려요.</p>'));
    } });
  add({ id: 's4-empty', group: 'S4 연결하기', title: 'S4 빈 화면: 30분이 지나도 기록이 없음',
    desc: '연결 요청을 복사한 지 30분이 지나도 기록이 없으면 "기록이 안 와요?" 확인 목록을 펼친다(기능명세서 S4-5). 세 번째 항목의 확인 문장 전문을 미리 보기로 보여 주고 복사하게 한다. 화면은 계속 5초마다 확인한다.',
    mobile: function () {
      return wrap(K.hdr('모임모아 연결하기', '5초마다 확인하고 있어요', '내 앱 목록으로') +
        K.say({ meta: K.status('wait', '첫 기록을 기다려요') + '<span>연결 요청 복사 후 32분</span>', headline: '<p class="sp-headline">아직 기록이 안 왔어요</p>', body: '<p class="hsub">아래를 하나씩 확인해 보세요. 기록이 오면 이 화면이 바로 바뀌어요.</p>' }) +
        sec('<h2>기록이 안 와요?</h2>' + K.steps(['<b>배포했나요?</b><br><span class="sp-sub">코딩 AI가 고친 코드를 실제 주소에 올려야 기록이 와요</span>', '<b>배포한 앱을 한 번 써 봤나요?</b><br><span class="sp-sub">누군가 앱을 써야 첫 기록이 생겨요</span>', '<b>코딩 AI에게 연결을 확인해 달라고 하세요</b><br><span class="sp-sub">아래 확인 요청을 붙여넣으면 AI가 전송이 되는지 확인해요</span>'], 0, -1) +
          K.copyBlock({ label: '확인 요청 복사', kind: 'check', preview: 'open' }) +
          K.copyBlock({ label: '연결 요청 다시 복사', kind: 'connect', line: true, preview: false, note: connectNote })));
    } });
  var names = function () {
    return '<ul class="sp-list">' + D.features.map(function (f) {
      return '<li class="sp-frow"><span class="nm">' + f.name + '<details><summary>자세히</summary><code>' + esc(f.route) + '</code></details></span><button class="sp-edit" aria-label="' + f.name + ' 이름 고치기">' + ic.pen(15) + '고치기</button><button class="sp-edit" aria-label="' + f.name + ' 숨기기">' + ic.eyeoff(15) + '숨기기</button></li>';
    }).join('') + '</ul><h3 class="sp-h3">이름 없는 기능 1개</h3><ul class="sp-list"><li class="sp-frow"><span class="si none">' + ic.pen(18) + '</span><span class="nm">이름 없는 기능<small>이름을 붙이면 알림에 그 이름이 나와요</small><details><summary>자세히</summary><code>' + D.unnamed.route + ' (3건)</code></details></span><button class="sp-edit">이름 붙이기</button></li></ul>';
  };
  add({ id: 's4', group: 'S4 연결하기', title: 'S4 첫 기록 도착: 기능 이름 확인', anim: 's4',
    desc: '첫 기록이 도착한 순간. 상태 표시가 "첫 기록을 기다려요"에서 "기록이 도착했어요"로, 양이 하는 말이 "기능 8개를 찾았어요"로 바뀐다. 아래 목록도 정확히 8줄이고, 이름표에 없던 주소는 "이름 없는 기능 1개"로 따로 모은다.',
    mobile: function () {
      return wrap(K.hdr('모임모아 연결하기', '연결 4단계를 모두 마쳤어요', '내 앱 목록으로') +
        K.say({ meta: K.swapStatus('wait', '첫 기록을 기다려요', 'ok', '기록이 도착했어요') + '<span>오늘 13:42</span>',
          headline: '<div class="sp-swap"><div class="from"><p class="sp-headline">첫 기록을 기다리고 있어요</p></div><div class="to"><p class="sp-headline">기능 <span style="color:var(--sp-ok)">8</span>개를 찾았어요</p></div></div>',
          body: '<p class="hsub">코딩 AI가 붙인 이름이에요. 알림에 이 이름이 쓰이니 맞는지 봐 주세요. 이름이 없는 기능도 1개 있어요.</p>' }) +
        sec('<h2>찾은 기능 8개</h2>' + names() + '<button class="sp-btn block">이 이름으로 지켜보기</button><p class="sp-sub" style="text-align:center">이름은 나중에 앱 설정에서도 고칠 수 있어요</p>'));
    } });
  add({ id: 's4-loading', group: 'S4 연결하기', title: 'S4 로딩: 화면 불러오는 중',
    desc: '0.3초가 넘게 걸릴 때만 보인다. 큰 문장 카드와 목록이 들어갈 자리를 같은 높이로 먼저 잡아 두어, 내용이 들어와도 화면이 밀리지 않는다. 화면 읽기 프로그램에는 "불러오는 중"으로 알린다.',
    mobile: function () {
      return wrap(K.hdr('모임모아 연결하기', null, '내 앱 목록으로') + '<div aria-busy="true" aria-label="연결 상태를 불러오는 중">' +
        K.say({ meta: '<span class="sp-skel line" style="width:120px"></span>', headline: '<span class="sp-skel title" style="width:85%"></span>', body: '<span class="sp-skel line" style="width:95%"></span><span class="sp-skel line" style="width:60%"></span>' }) +
        sec('<span class="sp-skel line" style="width:40%;height:20px"></span>' + [1, 2, 3, 4, 5].map(function () { return '<span class="sp-skel" style="height:44px"></span>'; }).join('')) + '</div>');
    } });
  add({ id: 's4-error', group: 'S4 연결하기', title: 'S4 오류: 이름 저장 실패',
    desc: '[이 이름으로 지켜보기]가 실패하면 단추 바로 위에 무엇이 안 됐는지와 다시 할 방법을 쓴다. 고친 이름은 지우지 않고 그대로 둔다.',
    mobile: function () {
      return wrap(K.hdr('모임모아 연결하기', '연결 4단계를 모두 마쳤어요', '내 앱 목록으로') +
        K.say({ meta: K.status('ok', '기록이 도착했어요') + '<span>오늘 13:42</span>', headline: '<p class="sp-headline">기능 <span style="color:var(--sp-ok)">8</span>개를 찾았어요</p>' }) +
        sec('<h2>찾은 기능 8개</h2>' + names() + K.error('이름을 저장하지 못했어요', '인터넷 연결이 잠시 끊긴 것 같아요. 고친 이름은 그대로 있어요.', '<button class="sp-btn">' + ic.retry(16) + '다시 저장</button>') + '<button class="sp-btn block" aria-disabled="true">이 이름으로 지켜보기</button>'));
    } });

  /* ---------------- S5 앱 홈 ---------------- */
  var s5Hero = function (pc) {
    return K.say({ pc: pc, meta: problemMeta(), headline: '<p class="sp-headline">분석이 느려졌어요</p>',
      body: (pc ? '' : K.cmp(['평소', '1.1'], ['최근 30분', '3.4'])) + '<p class="hsub">최근 30분 동안 24건, 보통 걸린 시간이 평소의 3배예요. 슬랙으로 알림을 보냈어요.</p>' + (pc ? '<div><a class="sp-hbtn" href="#s7-open" style="display:inline-flex;text-decoration:none">문제 살펴보고 AI에 맡기기</a></div>' : '<a class="sp-hbtn" href="#s7-open" style="text-decoration:none">문제 살펴보고 AI에 맡기기</a>'),
      side: pc ? K.cmp(['평소', '1.1'], ['최근 30분', '3.4']) : '' });
  };
  var fixSteps = function () { return K.steps(['<b>AI에 보낼 내용 복사</b><br><span class="sp-sub">문제 화면에서 한 번에 복사해요</span>', '<b>코딩 AI에 붙여넣고 고치기</b><br><span class="sp-sub">AI가 원인을 찾아 고쳐요</span>', '<b>새 버전 배포</b><br><span class="sp-sub">배포만 하면 돼요</span>', '<b>쉽앤핑이 확인</b><br><span class="sp-sub">실제 사용으로 해결됐는지 알려 드려요</span>'], 0, 0); };
  var featSec = function (list, sub, focus) { return sec('<h2>기능 8개</h2><p class="sp-sub">' + sub + '</p>' + K.featList(list, focus) + K.unnamed() + '<a class="sp-btn line block" href="#s8" style="text-decoration:none">' + ic.plus(18) + '깊게 볼 기능 추가</a>'); };
  add({ id: 's5', group: 'S5 앱 홈', title: 'S5 앱 홈: 열린 문제 1개 (기본)', path: '/apps/moim',
    desc: '슬랙 알림과 같은 문장을 양이 맨 위 카드에서 말한다. 평소와 최근 시간을 큰 숫자로 나란히. 아래 기능 8개는 문제 있는 기능부터, 그다음 최근 24시간 사용 많은 순. 행 전체가 기능 상세(S6)로 가는 링크이고, 이름 없는 기능은 따로 모은다.',
    mobile: function () { return wrap(hdrApp('마지막 기록 1분 전') + s5Hero() + featSec(D.features, '최근 24시간, 문제 있는 기능 먼저')); },
    pc: function () { return K.top('모임모아') + '<div class="sp-pcw">' + s5Hero(true) + '<div class="sp-pc2"><div class="sp-sec" style="padding:0"><div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap"><h2>기능 8개</h2><p class="sp-sub" style="flex:1">최근 24시간, 문제 있는 기능 먼저, 마지막 기록 1분 전</p><a class="sp-btn line" href="#s8" style="text-decoration:none">' + ic.plus(18) + '깊게 볼 기능 추가</a></div>' + K.featList(D.features) + K.unnamed() + '</div><div class="sp-sec" style="padding:0"><h2>고치는 순서</h2>' + fixSteps() + '</div></div></div>'; } });
  add({ id: 's5-keyboard', group: 'S5 앱 홈', title: 'S5 키보드로 기능 상세 열기',
    desc: 'Tab을 누르면 머리말 단추 → 카드 안 단추 → 기능 행 순서로 초점이 옮겨 간다. 기능 행은 행 전체가 하나의 링크라 초점 테두리가 행을 감싸고, Enter를 누르면 S6 기능 상세가 열린다. 화면 읽기는 "문제 있어요, 분석, 사용 132건, 실패 4건, 3.4초, 평소 1.1초, 링크"로 읽는다. 그림은 분석 행에 초점이 있는 모습.',
    mobile: function () { return wrap(hdrApp('마지막 기록 1분 전') + s5Hero() + featSec(D.features, '최근 24시간, 문제 있는 기능 먼저', true)); } });
  add({ id: 's5-update', group: 'S5 앱 홈', title: 'S5 새 버전 감지 띠',
    desc: '문제가 열린 뒤 새 버전이 들어오면 큰 문장 카드 바로 아래에 "새 버전을 감지했어요" 띠가 붙는다(기능명세서 S5 "최근 업데이트 띠"). 띠의 [확인 상황 보기]는 S7의 업데이트 후 확인 영역으로 간다. 해결 판정이 나면 띠는 사라지고 카드 문장이 바뀐다.',
    mobile: function () { return wrap(hdrApp('마지막 기록 1분 전') + s5Hero() + sec(K.banner('info', '<b>새 버전 ' + D.newVer + '을 감지했어요 (15:10).</b> 분석이 고쳐졌는지 실제 사용으로 확인하고 있어요. 지금 3건 확인, 2건 남았어요.', '확인 상황 보기'), 'padding-top:12px') + featSec(D.features, '최근 24시간, 문제 있는 기능 먼저')); } });
  add({ id: 's5-ok', group: 'S5 앱 홈', title: 'S5 앱 홈: 모두 괜찮아요',
    desc: '열린 문제가 없을 때 같은 자리에서 양이 "모두 괜찮아요"를 말한다. 숫자 대신 무엇을 지켜보고 있는지를 쓴다. 목록은 같은 기능 8개를 사용 많은 순으로.',
    mobile: function () { return wrap(hdrApp('마지막 기록 1분 전') + K.say({ meta: K.status('ok') + '<span>지금</span>', headline: '<p class="sp-headline">모두 괜찮아요</p>', body: '<p class="hsub">기능 8개를 24시간 지켜보고 있어요. 문제가 생기면 슬랙으로 바로 알려 드릴게요.</p>' }) + featSec(okFeatures, '최근 24시간, 사용 많은 순')); } });
  add({ id: 's5-loading', group: 'S5 앱 홈', title: 'S5 로딩: 기록 불러오는 중',
    desc: '머리말은 바로 보이고, 카드와 기능 목록 자리만 옅은 막대로. 막대는 천천히 밝아졌다 어두워지며, 동작 줄이기 설정이면 멈춰 있다.',
    mobile: function () { return wrap(hdrApp('불러오는 중') + '<div aria-busy="true" aria-label="앱 상태를 불러오는 중">' + K.say({ meta: '<span class="sp-skel line" style="width:140px"></span>', headline: '<span class="sp-skel title" style="width:75%"></span>', body: '<span class="sp-skel num"></span><span class="sp-skel line" style="width:90%"></span><span class="sp-skel btn"></span>' }) + sec('<span class="sp-skel line" style="width:30%;height:20px"></span>' + [1, 2, 3, 4, 5, 6, 7, 8].map(function () { return '<span class="sp-skel" style="height:56px"></span>'; }).join('')) + '</div>'); } });
  add({ id: 's5-empty', group: 'S5 앱 홈', title: 'S5 빈 화면: 아직 기록이 없음',
    desc: '앱을 등록했지만 기록이 하나도 없을 때. 이유와 다음 행동(연결 단계 다시 보기)을 함께 보여 준다.',
    mobile: function () { return wrap(hdrApp('아직 기록이 없어요') + K.say({ meta: K.status('wait'), headline: '<p class="sp-headline">첫 기록을 기다리고 있어요</p>', body: '<p class="hsub">연결을 마치고 앱을 한 번 써 보면 여기에 기능 목록이 생겨요.</p><a class="sp-hbtn" href="#s4-wait" style="text-decoration:none">연결 단계 다시 보기</a>' }) + sec(K.empty('기능 목록이 비어 있어요', '첫 기록이 오면 코딩 AI가 붙인 기능 이름으로 채워져요.'))); } });
  add({ id: 's5-error', group: 'S5 앱 홈', title: 'S5 오류: 기록을 불러오지 못함 + 하루 동안 기록 없음',
    desc: '불러오기가 실패하면 마지막으로 본 내용을 지우지 않고 "14:20에 불러온 내용"이라고 밝혀 둔다. 흐리게 만들지 않는다(흐리게 하면 보조 글자 대비가 3.3:1로 떨어짐). 기록이 하루 동안 끊긴 경우는 문제가 아니라 띠 알림으로 알린다.',
    mobile: function () { return wrap(hdrApp('마지막으로 불러온 때 14:20') + sec(K.error('최신 기록을 불러오지 못했어요', '인터넷 연결을 확인하고 다시 불러와 주세요. 아래는 14:20에 불러온 내용이에요.', '<button class="sp-btn">' + ic.retry(16) + '다시 불러오기</button>') + K.banner('info', '<b>하루 동안 기록이 없어요.</b> 사용자가 없었거나 연결이 끊겼을 수 있어요.', '연결 확인하는 법 보기'), 'padding-top:4px') + sec('<h2>기능 8개</h2><p class="sp-sub">' + ic.wait(14) + ' 14:20에 불러온 내용</p>' + K.featList(okFeatures))); } });
  add({ id: 's5-big', group: 'S5 앱 홈', title: 'S5 큰 글자(200%)',
    desc: '기기·브라우저 글자 크기를 200%로 키웠을 때(앱 안에 따로 글자 크기 설정은 두지 않고 기기 설정을 따른다). 큰 숫자는 위아래로 쌓이고, 기능 행의 시간은 이름 아래로 내려간다. 머리말의 알림·설정 아이콘은 [메뉴] 단추 하나로 모인다. 문장은 자르지 않고 줄을 바꾼다.',
    big: true, mobile: function () { return wrap(hdrApp('마지막 기록 1분 전') + s5Hero() + featSec(D.features, '최근 24시간, 문제 있는 기능 먼저')); } });
  add({ id: 's5-big-menu', group: 'S5 앱 홈', title: 'S5 큰 글자: 메뉴 연 모습',
    desc: '글자 200%에서 [메뉴]를 누르면 머리말 바로 아래에 목록이 펼쳐진다. 평소 아이콘으로 가던 알림 설정·앱 설정과 깊게 볼 기능 추가, 내 앱 목록, 내 계정이 한 줄씩. 단추는 aria-expanded로 열림을 알리고, Esc나 [메뉴]를 다시 누르면 닫힌다.',
    big: true, mobile: function () {
      var it = function (icn, t, href) { return '<li><a href="#' + href + '">' + ic[icn](20) + t + '<span class="go">' + ic.chev(18) + '</span></a></li>'; };
      return wrap(hdrApp('마지막 기록 1분 전', true) + '<nav aria-label="모임모아 메뉴"><ul class="sp-menu">' + it('bell', '알림 설정', 's9') + it('gear', '앱 설정', 's10') + it('plus', '깊게 볼 기능 추가', 's8') + it('back', '내 앱 목록', 's2') + it('user', '내 계정', 's11') + '</ul></nav>' + s5Hero());
    } });

  /* ---------------- S6 기능 상세 ---------------- */
  /* 막대: 위가 사용(--sp-chart), 아래가 실패(--sp-bad-ink), 둘 사이 2px 틈 */
  var bars = function (use, fail, max) {
    return use.map(function (u, i) { var f = fail[i] || 0; return '<span class="col"><span class="u" style="height:' + Math.round((u - f) / max * 100) + '%"></span>' + (f ? '<span class="f" style="height:' + Math.max(4, Math.round(f / max * 100)) + '%"></span>' : '') + '</span>'; }).join('');
  };
  var lineSvg = function (vals, usual, max) {
    var w = 120, h = 96, x = function (i) { return (i * w / (vals.length - 1)).toFixed(1); }, y = function (v) { return (h - 6 - v / max * (h - 12)).toFixed(1); };
    return '<svg class="sp-linechart" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true"><line class="usual" x1="0" x2="' + w + '" y1="' + y(usual) + '" y2="' + y(usual) + '" stroke-width="2" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/><polyline class="ln" fill="none" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke" points="' + vals.map(function (v, i) { return x(i) + ',' + y(v); }).join(' ') + '"/></svg>';
  };
  var s6 = function (week) {
    var use = week ? [180, 190, 175, 210, 160, 96, 160] : [10, 14, 12, 8, 6, 4, 5, 13, 20, 16, 12, 12];
    var fail = week ? [0, 0, 0, 1, 0, 0, 4] : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2];
    var med = week ? [1.0, 1.1, 1.0, 1.0, 1.1, 1.1, 2.3] : [1.1, 1.0, 1.1, 1.2, 1.1, 1.0, 1.1, 1.1, 1.2, 1.1, 3.1, 3.4];
    var axis = week ? '<span>11월 19일</span><span>오늘</span>' : '<span>어제 16시</span><span>지금</span>';
    var period = week ? '최근 7일' : '최근 24시간';
    var seg = '<div class="sp-seg" role="group" aria-label="보는 기간"><button aria-pressed="' + !week + '">24시간</button><button aria-pressed="' + week + '">7일</button></div>';
    var errs = '<ul style="margin:4px 0 0;padding-left:18px">' + D.errors.map(function (e) { return '<li><code>' + esc(e) + '</code></li>'; }).join('') + '</ul>';
    return wrap(K.hdr('분석', '모임모아', '모임모아 홈으로') +
      K.say({ meta: problemMeta(), headline: '<p class="sp-headline">분석이 평소보다 느려요</p>', body: K.cmp(['평소', '1.1'], ['최근 30분', '3.4']) + '<a class="sp-hbtn" href="#s7-open" style="text-decoration:none">열린 문제 보기</a>' }) +
      sec(seg + '<h2>' + period + ' 사용과 실패</h2><p class="sp-sub">' + (week ? '하루마다' : '2시간마다') + ' 사용 건수, 그중 실패는 ' + (week ? '5건' : '4건') + '이에요(모두 오늘 오후)</p>' +
        '<div class="sp-bars" role="img" aria-label="' + period + ' 사용 건수 막대. ' + (week ? '하루 96~210건, 실패는 11월 22일 1건, 오늘 4건' : '오후에 가장 많고, 실패는 최근 4시간에 4건') + '">' + bars(use, fail, week ? 210 : 20) + '</div><div class="sp-axis">' + axis + '</div>' +
        '<ul class="sp-legend"><li><i class="u"></i>사용</li><li><i class="f"></i>실패</li></ul>') +
      sec('<h2>' + period + ' 보통 걸린 시간</h2><p class="sp-sub">점선이 평소 속도 1.1초예요. 지금은 ' + (week ? '오늘 하루 보통 2.3초' : '최근 2시간 보통 3.4초') + '예요.</p><div role="img" aria-label="보통 걸린 시간 선. 평소 1.1초 근처였다가 ' + (week ? '오늘 2.3초로 올라감' : '최근 4시간에 3.4초로 올라감') + '">' + lineSvg(med, 1.1, 4) + '</div><div class="sp-axis">' + axis + '</div><ul class="sp-legend"><li><i class="ln"></i>보통 걸린 시간</li><li><i class="dash"></i>평소 속도</li></ul>') +
      sec('<h2>버전별 비교</h2><table class="sp-table"><caption class="sr">최근 버전 3개 비교</caption><thead><tr><th scope="col">버전</th><th scope="col" class="n">사용</th><th scope="col" class="n">실패율</th><th scope="col" class="n">보통 시간</th></tr></thead><tbody><tr><td>오늘 13:50</td><td class="n">24건</td><td class="n">17% (4건)</td><td class="n"><b style="color:var(--sp-bad-ink)">3.4초</b></td></tr><tr><td>어제 18:20</td><td class="n">96건</td><td class="n">0%</td><td class="n">1.1초</td></tr><tr><td>11월 22일</td><td class="n">210건</td><td class="n">0.5% (1건)</td><td class="n">1.0초</td></tr></tbody></table>' +
        '<details><summary>자세히</summary><code>주소 형태: POST /api/analyze<br>버전: ' + D.badVer + ' / ' + D.oldVer + '<br>오류 종류: TimeoutError 4건, SlowQuery 1건</code><p class="sp-sub" style="margin-top:6px">최근 오류 예시 5개 (개인정보 가림)</p>' + errs + '</details>') +
      sec(K.field({ label: '느림 기준', value: '5초', help: '평소 속도가 아직 없을 때만 써요. 지금은 평소 속도(1.1초)로 판단하고 있어요.' })));
  };
  add({ id: 's6', group: 'S6 기능 상세', title: 'S6 기능 상세: 분석 (24시간)',
    desc: 'S5의 분석 행을 누르거나 Enter로 온다. 양이 지금 상태를 한 문장으로 말하고, 아래에 기간 고르기(24시간 / 7일), 사용·실패 막대, 보통 걸린 시간 선과 평소 속도 점선, 버전별 실패율 비교, [자세히](주소 형태·오류 종류별 건수·최근 오류 예시 5개)를 둔다. 막대 색은 바탕과 4.7:1, 실패는 6.2:1이고 범례 글자와 막대 설명이 함께 있다.',
    mobile: function () { return s6(false); } });
  add({ id: 's6-7d', group: 'S6 기능 상세', title: 'S6 기능 상세: 7일 보기',
    desc: '[7일]을 누르면 같은 자리의 막대와 선이 하루 단위로 바뀐다(움직임 없이 바로 바뀜). 11월 22일 실패 1건, 오늘 실패 4건이 막대 아래쪽 색으로 보인다.',
    mobile: function () { return s6(true); } });

  /* ---------------- S7 문제 상세 ---------------- */
  var aiSec = function (again, blocked) {
    return sec('<h2>' + (again ? 'AI에게 다시 맡기기' : '코딩 AI에게 맡기기') + '</h2><p class="sp-sub">' + (again ? '이전에 고친 버전과 결과를 함께 담았어요.' : '기능 이름, 시작 시각, 버전, 오류 기록 5개를 담은 조사 요청이에요.') + ' 개인정보와 키는 뺐어요.</p>' +
      K.copyBlock({ label: again ? 'AI에 다시 보낼 내용 복사' : 'AI에 보낼 내용 복사', kind: again ? 'again' : 'ai', preview: 'closed', blocked: blocked }));
  };
  var tlRows = { start: ['14:05', '처음 감지', '분석이 평소보다 2배 넘게 느려졌어요'], sent: ['14:06', '알림 보냄', '슬랙 #모임모아-알림'], ver: ['15:10', '새 버전 감지', '고친 버전이 배포됐어요'] };
  var tl = function (rows) { return sec('<h2>지금까지</h2><ol class="sp-tl">' + rows.map(function (t) { return '<li><time>' + t[0] + '</time><span>' + t[1] + '<br><span class="sp-sub">' + t[2] + '</span></span></li>'; }).join('') + '</ol><details><summary>자세히</summary><code>POST /api/analyze<br>버전 ' + D.oldVer + ' → ' + D.badVer + '(문제) → ' + D.newVer + '</code></details>'); };
  var tlDone = [tlRows.start, tlRows.sent, tlRows.ver, ['15:32', '해결됐어요', '업데이트 후 15건 모두 평소 속도']];
  var hdr7 = function () { return K.hdr('문제 상세', '모임모아', '모임모아 홈으로'); };
  var check = function (inner) { return sec('<h2>업데이트 후 확인</h2>' + inner); };
  var s7Hero = function (pc) {
    var meter = '<div style="display:flex;flex-direction:column;gap:8px;min-width:' + (pc ? '300px' : '0') + '"><div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap"><span class="sp-cmp"><span class="v ok"><span class="n">15</span></span></span><span class="hsub sp-after">/ 15건 평소 속도</span></div><div class="sp-track" aria-hidden="true"><i></i></div></div>';
    return K.say({ pc: pc, ring: true, meta: K.swapStatus('bad', null, 'ok', '해결됐어요') + '<span>오늘 15:32 확인</span>', headline: '<p class="sp-headline">업데이트 후 분석 15건 모두 평소 속도로 끝났어요</p>', body: (pc ? '' : meter) + '<p class="hsub">15:10에 새 버전을 감지하고, 그 뒤 실제 사용 15건을 확인했어요.</p>', side: pc ? meter : '' });
  };
  var recap = function () { return sec('<h2>분석이 느려졌어요</h2><p class="sp-sub">평소 1.1초 → 최근 30분 3.4초 (24건), 오늘 14:05 시작</p>'); };
  var dismiss = function () { return sec('<button class="sp-btn text">문제 아님으로 닫기</button><p class="sp-sub">닫으면 분석이 느려지는 문제는 24시간 동안 다시 알리지 않아요.</p>'); };
  add({ id: 's7-open', group: 'S7 문제 상세', title: 'S7 진행 중: 알림 링크로 처음 연 화면',
    desc: '슬랙 알림 링크를 휴대폰으로 열면 처음 보는 화면. 할 일은 [AI에 보낼 내용 복사] 하나(요청문 전문은 미리 보기 안에, 기능명세서 6.3 틀). 업데이트 후 확인 영역은 아직 비어 있고 다음에 무엇이 일어나는지 말해 준다.',
    mobile: function () { return wrap(hdr7() + K.say({ meta: problemMeta(), headline: '<p class="sp-headline">분석이 느려졌어요</p>', body: K.cmp(['평소', '1.1'], ['최근 30분', '3.4']) + '<p class="hsub">최근 30분 동안 24건, 보통 걸린 시간이 평소의 3배예요.</p>' }) + aiSec() + check(K.empty('고친 버전을 배포하면 여기서 확인해 드려요', '새 버전이 감지되면 실제 사용 5건을 지켜보고, 모두 평소 속도면 해결로 알려 드려요.')) + tl([tlRows.start, tlRows.sent]) + dismiss()); } });
  add({ id: 's7-first-use', group: 'S7 문제 상세', title: 'S7 업데이트 후 첫 사용 대기',
    desc: '새 버전은 감지했지만 그 버전으로 분석을 쓴 기록이 아직 없다. 문제는 열린 채라 상태는 "문제 있어요" 그대로이고, 숫자 대신 무엇을 기다리는지와 사용자가 할 수 있는 일(직접 한 번 써 보기)을 말한다.',
    mobile: function () { return wrap(hdr7() + K.say({ meta: K.status('bad') + '<span>15:10 새 버전 감지</span>', headline: '<p class="sp-headline">업데이트 후 첫 사용을 기다리고 있어요</p>', body: '<p class="hsub">누군가 새 버전에서 분석을 쓰면 바로 확인을 시작해요. 직접 한 번 써 봐도 돼요.</p>' }) + recap() + check('<p class="sp-sub">새 버전 ' + D.newVer + '에서 분석 사용 0건. 5건을 확인하면 결과를 알려 드려요.</p>') + aiSec() + tl([tlRows.start, tlRows.sent, tlRows.ver])); } });
  add({ id: 's7-loading', group: 'S7 문제 상세', title: 'S7 업데이트 후 확인 중',
    desc: '새 버전에서 5건 중 3건을 확인한 상태. 확인한 건수를 그대로 보여 준다(꾸민 진행 막대 대신 실제 숫자). 아직 결론이 아니므로 숫자는 상태 색 없이 흰색, 상태는 "문제 있어요" 그대로. 화면 첫 불러오기는 S5와 같은 스켈레톤을 쓴다.',
    mobile: function () { return wrap(hdr7() + K.say({ meta: K.status('bad') + '<span>15:10 새 버전 감지</span>', headline: '<p class="sp-headline">업데이트 후 3건 성공, 2건 더 확인할게요</p>', body: '<div class="sp-cmp"><span class="v now"><span class="n">3</span></span><span class="hsub" style="padding-bottom:6px">/ 5건 평소 속도</span></div><p class="hsub">새 버전으로 분석을 쓴 기록을 기다리고 있어요. 다 확인하면 알려 드릴게요.</p>' }) + recap() + aiSec() + tl([tlRows.start, tlRows.sent, tlRows.ver])); } });
  add({ id: 's7', group: 'S7 문제 상세', title: 'S7 해결됐어요', anim: 's7', path: '/apps/moim/problems/42',
    desc: '해결이 확인되면 양이 하는 말 자체가 "업데이트 후 분석 15건 모두 평소 속도로 끝났어요"로 바뀌고, 막대가 왼쪽부터 채워진 뒤 양 둘레에 민트 고리가 한 번 퍼진다(동작 줄이기면 고리 없이 0.15초 투명도만). 원래 문제와 AI에 보낼 내용은 아래에 남는다.',
    mobile: function () { return wrap(hdr7() + s7Hero() + recap() + aiSec() + tl(tlDone)); },
    pc: function () { return K.top('모임모아 › 문제 상세') + '<div class="sp-pcw">' + s7Hero(true) + '<div class="sp-pc2"><div style="display:flex;flex-direction:column;gap:8px">' + flat(recap()) + flat(aiSec()) + '</div><div>' + flat(tl(tlDone)) + '</div></div></div>'; } });
  add({ id: 's7-error', group: 'S7 문제 상세', title: 'S7 업데이트 후에도 느림 + 자동 복사 막힘',
    desc: '새 버전에서도 기준을 넘으면 양이 그대로 말하고, 이전 시도 버전을 담은 [AI에 다시 보낼 내용 복사]를 준다. 브라우저가 자동 복사를 막은 경우의 대안(상자를 눌러 전부 선택해 복사)이 이 화면에 함께 보인다.',
    mobile: function () { return wrap(hdr7() + K.say({ meta: K.status('bad') + '<span>15:40 확인</span>', headline: '<p class="sp-headline">업데이트 후에도 5건 중 2건이 느렸어요</p>', body: K.cmp(['평소', '1.1'], ['새 버전', '2.8']) + '<p class="hsub">고친 버전(15:10 배포)에서도 아직 느려요. 이전 시도를 담아 AI에게 다시 맡겨 보세요.</p>' }) + aiSec(true, true) + tl([tlRows.start, tlRows.ver, ['15:40', '아직 느려요', '5건 중 2건이 평소의 2배 넘게 걸렸어요']])); } });
  add({ id: 's7-worse', group: 'S7 문제 상세', title: 'S7 더 나빠짐: 다시 알림',
    desc: '열린 문제가 처음 알림 때보다 2배 넘게 나빠지고 마지막 알림 뒤 6시간이 지나 다시 알린 상태(기능명세서 7장 "다시 알림"). 큰 숫자는 처음 알림 때와 지금을 나란히, 흐름에 "더 나빠짐"과 "다시 알림"이 붙는다.',
    mobile: function () { return wrap(hdr7() + K.say({ meta: K.status('bad') + '<span>20:10 다시 알림</span>', headline: '<p class="sp-headline">분석이 더 느려졌어요</p>', body: K.cmp(['처음 알림 때', '3.4'], ['최근 30분', '7.1']) + '<p class="hsub">처음 알렸을 때보다 2배 넘게 느려져서 슬랙으로 다시 알렸어요. 평소에는 1.1초예요.</p>' }) + aiSec() + check(K.empty('고친 버전을 배포하면 여기서 확인해 드려요', '새 버전이 감지되면 실제 사용 5건을 지켜봐요.')) + tl([tlRows.start, tlRows.sent, ['20:10', '더 나빠짐', '보통 7.1초, 처음 알림의 2배가 넘어요'], ['20:10', '다시 알림', '슬랙 #모임모아-알림']]) + dismiss()); } });
  add({ id: 's7-quiet', group: 'S7 문제 상세', title: 'S7 잠잠해졌어요',
    desc: '새 버전 없이 2시간 동안 기준 아래로 돌아온 경우. 해결과 구분해 "잠잠해졌어요"라고 쓰고, 알림은 보내지 않았다고 밝힌다. 민트 고리는 해결 때만 쓰므로 여기서는 움직이지 않는다.',
    mobile: function () { return wrap(hdr7() + K.say({ meta: K.status('ok', '잠잠해졌어요') + '<span>16:05</span>', headline: '<p class="sp-headline">새 버전 없이 2시간 동안 괜찮았어요</p>', body: '<p class="hsub">고친 버전 없이 나아져서 알림은 보내지 않았어요. 다시 느려지면 새 문제로 알려 드릴게요.</p>' }) + recap() + aiSec() + tl([tlRows.start, tlRows.sent, ['16:05', '잠잠해졌어요', '2시간 동안 평소 속도 안에서 끝났어요']])); } });
  add({ id: 's7-dismissed', group: 'S7 문제 상세', title: 'S7 문제 아님으로 닫음',
    desc: '[문제 아님으로 닫기]를 누른 뒤. 열린 문제가 없어졌으므로 상태는 "괜찮아요" 계열 표시에 "문제 아님으로 닫음"이라고 쓰고, 언제까지 다시 알리지 않는지 시각으로 말한다.',
    mobile: function () { return wrap(hdr7() + K.say({ meta: K.status('ok', '문제 아님으로 닫음') + '<span>14:30</span>', headline: '<p class="sp-headline">문제 아님으로 닫았어요</p>', body: '<p class="hsub">분석이 느려지는 문제는 내일 14:30까지 다시 알리지 않아요. 그 뒤에도 느리면 새 문제로 알려 드릴게요.</p>' }) + recap() + tl([tlRows.start, tlRows.sent, ['14:30', '문제 아님으로 닫음', '직접 닫았어요']])); } });

  /* ---------------- S8 깊게 볼 기능 추가 ---------------- */
  var hdr8 = function (t, sub) { return K.hdr(t, sub, '모임모아 홈으로', ''); };
  add({ id: 's8', group: 'S8 깊게 볼 기능 추가', title: 'S8 깊게 볼 기능 추가',
    desc: '"시작"과 "실제 성공"의 차이를 예시 문장으로 칸 위에 보여 준다(칸 안 흐린 글씨는 쓰지 않음). 앱마다 5개까지이고 지금 몇 개인지 머리에 적는다. 세 칸을 채우면 그 문장이 들어간 추가 연결 요청 전문(기능명세서 6.2)이 미리 보기에 보인다.',
    mobile: function () {
      return wrap(hdr8('깊게 볼 기능 추가', '모임모아, 지금 1개 / 5개') +
        sec('<h1>저장까지 됐는지 확인할 기능</h1><p class="sp-sub">화면에 "성공"이 떠도 실제로 저장이 안 될 때가 있어요. 중요한 기능 하나를 골라 끝까지 확인해요.</p>' +
          K.field({ label: '기능 이름', value: '모임 신청', example: '예: 모임 신청, 결제, 글쓰기' }) +
          K.field({ label: '시작', value: '신청 버튼을 누를 때', example: '사용자가 무엇을 하면 시작인가요? 예: 신청 버튼을 누를 때' }) +
          K.field({ label: '실제 성공', value: '참가자 명단에 저장됐을 때', example: '무엇이 끝나야 진짜 성공인가요? 예: 참가자 명단에 저장됐을 때' }) +
          K.copyBlock({ label: '추가 연결 요청 복사', kind: 'deep', preview: 'open', note: '코딩 AI에 붙여넣고 배포하면, 첫 결과가 왔을 때 "첫 신청 기록이 도착했어요"로 알려 드려요. 요청문에 수집 키가 들어 있어요.' })));
    } });
  add({ id: 's8-wait', group: 'S8 깊게 볼 기능 추가', title: 'S8 첫 결과 대기',
    desc: '복사 뒤 첫 결과를 기다리는 화면. S4 대기와 같은 구조(할 일 목록 + 5초마다 확인). 30분이 지나도 결과가 없으면 S4와 같은 "기록이 안 와요?" 확인 목록을 연다.',
    mobile: function () {
      return wrap(hdr8('모임 신청', '깊게 보는 기능, 5초마다 확인하고 있어요') +
        K.say({ meta: K.status('wait', '첫 결과를 기다려요') + '<span>요청 복사 후 4분</span>', headline: '<p class="sp-headline">첫 신청 기록을 기다리고 있어요</p>', body: '<p class="hsub">코딩 AI가 코드를 넣고 배포한 뒤, 누군가 모임 신청을 한 번 하면 결과가 와요.</p>' }) +
        sec('<h2>남은 할 일</h2>' + K.steps(['<b>추가 연결 요청 복사</b>', '<b>코딩 AI가 코드 추가</b>', '<b>배포</b>', '<b>모임 신청 한 번 해 보기</b>'], 1, -1)) +
        sec(K.copyBlock({ label: '추가 연결 요청 다시 복사', kind: 'deep', line: true, preview: 'closed' })));
    } });
  add({ id: 's8-arrived', group: 'S8 깊게 볼 기능 추가', title: 'S8 첫 결과 도착',
    desc: '첫 결과가 오면 양이 기능명세서 문장 그대로 "첫 신청 기록이 도착했어요"를 말하고, 아래에 결과 4가지 칸이 생긴다. 4가지는 상태가 아니라 결과 종류라 늘 같은 순서(성공·실패·중단·결과 미확인)로, 아이콘 모양 + 글자 + 건수를 함께 쓴다.',
    mobile: function () {
      return wrap(hdr8('모임 신청', '깊게 보는 기능') +
        K.say({ meta: K.status('ok', '첫 결과 도착') + '<span>오늘 16:42</span>', headline: '<p class="sp-headline">첫 신청 기록이 도착했어요</p>', body: '<p class="hsub">참가자 명단에 저장되기까지 1.2초 걸렸어요. 이제 신청마다 끝까지 됐는지 확인해요.</p>' }) +
        sec('<h2>지금까지 결과</h2>' + K.results({ ok: 1, fail: 0, stop: 0, unk: 0 })));
    } });
  add({ id: 's8-result', group: 'S8 깊게 볼 기능 추가', title: 'S8 깊게 보는 기능: 결과 4가지',
    desc: 'S5 목록의 "모임 신청(깊게 보기)" 행에서 오는 화면. 최근 24시간 88건을 성공 84 · 실패 1 · 중단 3 · 결과 미확인 0으로 나눠 보여 준다. 중단은 사용자가 그만둔 것이라 문제로 치지 않고 보조 글자색, 결과 미확인이 1시간에 절반을 넘으면 문제로 연다(기능명세서 7장).',
    mobile: function () {
      var r = D.features[4].deep;
      return wrap(hdr8('모임 신청', '깊게 보는 기능, 모임모아') +
        K.say({ meta: K.status('ok') + '<span>최근 24시간</span>', headline: '<p class="sp-headline">모임 신청 88건 중 84건이 명단 저장까지 끝났어요</p>', body: '<p class="hsub">실패 1건은 경보 기준(30분에 20%)보다 적어요. 보통 1.2초 걸려요.</p>' }) +
        sec('<h2>최근 24시간 결과</h2>' + K.results(r) + '<details><summary>자세히</summary><code>실패 1건: 단계 save_member, DbError: unique constraint (14:52)<br>시작 기준: 신청 버튼을 누를 때<br>성공 기준: 참가자 명단에 저장됐을 때</code></details>'));
    } });

  /* ---------------- S9 알림 설정 ---------------- */
  var emailSw = function (on, sub) { return '<div class="sp-card"><button class="sp-switch" role="switch" aria-checked="' + (on ? 'true' : 'false') + '"><span><b>이메일로도 받기</b><br><span class="sp-sub">' + (sub || '로그인한 이메일로 보내요') + '</span></span><span class="knob" aria-hidden="true"></span></button></div>'; };
  var slackHelp = '<details><summary>슬랙 연결이 안 될 때</summary><p class="sp-sub" style="margin-top:6px">무료 슬랙은 앱을 10개까지만 추가할 수 있어요. 앱 하나를 지우거나 이메일 알림을 켜세요. 회사 슬랙이면 관리자가 앱 추가를 막아 두었을 수 있어요. 관리자에게 요청해 주세요.</p></details>';
  add({ id: 's9', group: 'S9 알림 설정', title: 'S9 알림 설정 (슬랙 연결됨)',
    desc: '슬랙이 연결된 상태와 시험 알림, 이메일 켜기. 슬랙 연결이 실패하는 흔한 이유(무료 워크스페이스 앱 10개 한도, 관리자 제한)는 자세히 안에 쉬운 말로. 켜진 스위치 손잡이는 어두운 모드에서 진한 색(민트 바탕과 11.9:1).',
    mobile: function () {
      return wrap(K.hdr('알림 설정', '모임모아', '모임모아 홈으로', '') +
        sec('<div class="sp-card"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' + ic.slack(22) + '<b style="flex:1">슬랙</b>' + K.status('ok', '연결됐어요') + '</div><p>#모임모아-알림 채널로 보내요</p><p class="sp-sub">문제가 생길 때 한 번, 해결될 때 한 번 보내요.</p><button class="sp-btn block">시험 알림 보내기</button><button class="sp-btn text">슬랙 연결 끊기</button></div>' +
          emailSw(true) + slackHelp + K.banner('info', '시험 알림을 누르면 "시험 알림을 보냈어요. 슬랙에서 확인해 보세요"로 바뀌어요.')));
    } });
  add({ id: 's9-none', group: 'S9 알림 설정', title: 'S9 슬랙 미연결: 알림 받을 곳 없음',
    desc: '슬랙도 이메일도 꺼져 있으면 화면 맨 위에 "알림을 받을 곳이 없어요" 띠(같은 띠가 S5에도 뜬다). 슬랙 화면이 영어일 수 있어 누르기 전에 그 화면에서 할 일(채널 고르기)을 먼저 알려 준다.',
    mobile: function () {
      return wrap(K.hdr('알림 설정', '모임모아', '모임모아 홈으로', '') + '<div class="sp-banner warn top" role="alert">' + ic.bad(18) + '<div><b>알림을 받을 곳이 없어요.</b> 문제가 생겨도 이 화면을 열기 전에는 알 수 없어요. 슬랙을 연결하거나 이메일 알림을 켜세요.</div></div>' +
        sec('<div class="sp-card"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' + ic.slack(22) + '<b style="flex:1">슬랙</b><span class="sp-sub">연결 안 됨</span></div><p class="sp-sub">누르면 슬랙 화면이 열려요. 거기서 알림 받을 채널을 고르고 허용을 누르면 여기로 돌아와요.</p><button class="sp-btn block">' + ic.slack(18) + 'Slack에 추가</button></div>' +
          emailSw(false) + slackHelp));
    } });
  add({ id: 's9-broken', group: 'S9 알림 설정', title: 'S9 슬랙 연결 끊김: 다시 연결',
    desc: '슬랙에서 앱이 지워졌거나 연결이 거부되면 "연결이 끊겼어요"(문제 있어요 표시)와 [슬랙 다시 연결]. 그동안 알림은 로그인 이메일로 대신 보낸다고 밝힌다(기능명세서 9장).',
    mobile: function () {
      return wrap(K.hdr('알림 설정', '모임모아', '모임모아 홈으로', '') +
        sec('<div class="sp-card"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' + ic.slack(22) + '<b style="flex:1">슬랙</b>' + K.status('bad', '연결이 끊겼어요') + '</div><p>#모임모아-알림으로 보내지 못했어요 (오늘 14:06)</p><p class="sp-sub">슬랙에서 쉽앤핑 앱이 지워졌거나 권한이 바뀌었어요. 다시 연결할 때까지 알림은 로그인 이메일로 보내요.</p><button class="sp-btn block">' + ic.retry(18) + '슬랙 다시 연결</button></div>' +
          emailSw(true, '슬랙이 끊긴 동안은 꺼 두어도 이메일로 보내요') + slackHelp));
    } });

  /* ---------------- S10 앱 설정 ---------------- */
  add({ id: 's10', group: 'S10 앱 설정', title: 'S10 앱 설정',
    desc: '이름·주소, 기능 이름표, 키. 키는 앞 글자만 보이고 재발급은 "이전 키는 24시간 뒤 멈춰요", 폐기는 "지금 바로 멈춰요"를 단추 옆에 미리 쓴다. 앱 삭제는 맨 아래, 앱 이름을 다시 적어야 눌린다.',
    mobile: function () {
      var key = function (name, pfx, note) { return '<div class="sp-card"><div style="display:flex;align-items:center;gap:8px">' + ic.key(18) + '<b>' + name + '</b></div><code style="font-size:14px">' + pfx + '········</code><p class="sp-sub">' + note + '</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="sp-btn line">새 키 만들기</button><button class="sp-btn danger">폐기</button></div><p class="sp-sub">새 키를 만들면 이전 키는 24시간 뒤에 멈춰요. 폐기하면 지금 바로 멈춰요.</p></div>'; };
      return wrap(K.hdr('앱 설정', '모임모아', '모임모아 홈으로', '') +
        sec('<h2>앱 정보</h2>' + K.field({ label: '앱 이름', value: '모임모아' }) + K.field({ label: '앱 주소', opt: true, value: 'https://moim-moa.pages.dev' }) + '<button class="sp-btn">저장</button>') +
        sec('<h2>기능 이름표</h2><a class="sp-appcard" href="#s10-names"><span class="r"><b style="font-size:var(--sp-text-md)">기능 8개, 이름 없는 기능 1개</b>' + ic.chev(18) + '</span><span class="sp-sub">숨긴 기능 1개. 주소 형태가 200개를 넘어 일부를 "기타"로 묶었어요</span></a>') +
        sec('<h2>키</h2>' + key('수집 키', 'sp_pub_3f9a', '앱에 넣는 키예요. 기록을 보내기만 할 수 있어요.') + key('서버 키', 'sp_srv_8c21', '서버 코드에만 넣는 비공개 키예요.')) +
        sec('<h2>앱 삭제</h2><p class="sp-sub">모든 기록이 바로 지워지고 되돌릴 수 없어요.</p>' + K.field({ label: '확인을 위해 앱 이름을 적어 주세요', value: '' }) + '<button class="sp-btn danger block" aria-disabled="true">모임모아 삭제</button>'));
    } });
  add({ id: 's10-names', group: 'S10 앱 설정', title: 'S10 기능 이름표: 숨긴 기능 되살리기 + 주소 200개 초과',
    desc: '이름 고치기·숨기기는 S4와 같은 행. 아래 "숨긴 기능"에서 [다시 지켜보기]로 되살린다. 앱의 주소 형태가 200개를 넘으면(기능명세서 4.3) 그 뒤에 처음 본 주소를 "기타" 한 줄로 묶었다고 띠로 알리고, 흔한 원인(주소 안 실제 값)과 할 일을 쓴다.',
    mobile: function () {
      return wrap(K.hdr('기능 이름표', '모임모아', '앱 설정으로', '') +
        sec(K.banner('info', '<b>주소 형태가 200개를 넘었어요.</b> 그 뒤에 처음 본 주소는 "기타" 한 줄로 묶어 보여 드려요. 주소 안에 숫자나 글자 값이 그대로 들어가 있으면 코딩 AI에게 그 부분을 :id로 바꿔 달라고 하세요.'), 'padding-top:4px') +
        sec('<h2>지켜보는 기능 8개</h2>' + names() + '<h3 class="sp-h3">기타 1줄</h3><ul class="sp-list"><li class="sp-frow"><span class="si none">' + ic.info(18) + '</span><span class="nm">기타<small>200개를 넘은 뒤 처음 본 주소 37개, 사용 41건</small></span></li></ul>') +
        sec('<h2>숨긴 기능 1개</h2><p class="sp-sub">숨긴 기능은 목록과 알림에서 빠지지만 기록은 계속 받아요.</p><ul class="sp-list"><li class="sp-frow"><span class="si none">' + ic.eyeoff(18) + '</span><span class="nm">관리자 통계<small>11월 24일에 숨김</small></span><button class="sp-edit">다시 지켜보기</button></li></ul>'));
    } });

  /* ---------------- S11 내 계정 ---------------- */
  var EMAIL = 'moim.maker@example.com';
  var appAlert = function (name, line) { return '<li><a class="sp-frow" href="#s9"><span class="si none">' + ic.bell(18) + '</span><span class="nm">' + name + '<small>' + line + '</small></span><span class="go">' + ic.chev(18) + '</span></a></li>'; };
  var s11Parts = {
    account: function () { return sec('<h2>계정</h2><dl class="sp-kv"><div><dt>로그인한 이메일</dt><dd>' + EMAIL + '</dd></div><div><dt>로그인 방식</dt><dd>Google</dd></div></dl>'); },
    alerts: function () { return sec('<h2>알림 받을 곳</h2><p class="sp-sub">알림은 앱마다 정해요. 누르면 그 앱의 알림 설정으로 가요.</p><ul class="sp-list">' + appAlert('모임모아', '슬랙 #모임모아-알림, 이메일 켜짐') + appAlert('독서노트', '이메일만 켜짐') + appAlert('우리동네 장터', '받을 곳 없음, 설정해 주세요') + '</ul>'); },
    apps: function () { return sec('<h2>내 앱</h2><dl class="sp-kv"><div><dt>등록한 앱</dt><dd>3개 / 3개</dd></div></dl><p class="sp-sub">무료 베타는 앱 3개까지예요.</p><a class="sp-btn line block" href="#s2" style="text-decoration:none">내 앱 목록 보기</a>'); },
    out: function () { return sec('<h2>로그아웃</h2><p class="sp-sub">이 기기에서만 로그아웃돼요. 알림은 계속 와요.</p><button class="sp-btn line block">로그아웃</button>'); },
    leave: function () { return sec('<h2>회원 탈퇴</h2><p class="sp-sub">모든 앱과 기록이 지워지고 되돌릴 수 없어요. 무엇이 지워지는지 다음 화면에서 한 번 더 보여 드려요.</p><a class="sp-btn danger block" href="#s11-delete" style="text-decoration:none">회원 탈퇴</a>'); }
  };
  add({ id: 's11', group: 'S11 내 계정', title: 'S11 내 계정', path: '/account',
    desc: 'S2 내 앱 목록 머리말 오른쪽 사람 아이콘(PC도 같은 자리)으로 온다. 계정 정보, 앱마다의 알림 받을 곳 요약(누르면 S9), 등록한 앱 수, 로그아웃, 회원 탈퇴. 설정 화면이라 큰 문장 카드와 양은 쓰지 않는다.',
    mobile: function () { return wrap(K.hdr('내 계정', null, '내 앱 목록으로', '') + s11Parts.account() + s11Parts.alerts() + s11Parts.apps() + s11Parts.out() + s11Parts.leave()); },
    pc: function () { return '<header class="sp-top"><img class="sp-tile" src="' + SP.IMG.wordmark + '" alt="" width="30" height="30"><span class="crumb">내 앱 › <b>내 계정</b></span><span style="flex:1"></span><a class="sp-ibtn" href="#s11" aria-label="내 계정" aria-current="page">' + ic.user(22) + '</a></header><div class="sp-pcw"><h1 style="font-size:var(--sp-text-xl)">내 계정</h1><div class="sp-pc2"><div style="display:flex;flex-direction:column;gap:8px">' + flat(s11Parts.account()) + flat(s11Parts.alerts()) + '</div><div style="display:flex;flex-direction:column;gap:8px">' + flat(s11Parts.apps()) + flat(s11Parts.out()) + flat(s11Parts.leave()) + '</div></div></div>'; } });
  var leaveScreen = function (state) {
    var gone = '<ul class="sp-steps">' + [
      ['bad', '<b>앱 3개가 모두 지워져요</b><br><span class="sp-sub">모임모아, 독서노트, 우리동네 장터와 그 안의 기록·문제·알림 설정 전부</span>'],
      ['key', '<b>앱에 넣은 키가 바로 멈춰요</b><br><span class="sp-sub">그 키로 보내는 기록은 받지 않아요. 앱 코드에서 전송 부분을 빼도 돼요</span>'],
      ['bell', '<b>슬랙·이메일 알림이 더 오지 않아요</b><br><span class="sp-sub">슬랙 채널에 남은 지난 메시지는 슬랙에서 지워야 해요</span>'],
      ['retry', '<b>되돌릴 수 없어요</b><br><span class="sp-sub">같은 이메일로 다시 가입하면 처음부터 시작해요</span>']
    ].map(function (r) { return '<li><span class="num" style="background:var(--sp-bad-soft);color:var(--sp-bad-ink)">' + ic[r[0]](14) + '</span><span>' + r[1] + '</span></li>'; }).join('') + '</ul>';
    var busy = state === 'busy';
    var field = K.field({ label: '확인을 위해 로그인 이메일을 적어 주세요', value: EMAIL, help: '적은 이메일이 ' + EMAIL + '와 같아야 탈퇴 단추가 눌려요' });
    if (busy) field = field.replace('<input ', '<input disabled ');
    var btn = busy ? '<button class="sp-btn danger block" aria-busy="true" aria-disabled="true"><span class="sp-spin" aria-hidden="true"></span>탈퇴하는 중</button><p class="sp-sub" role="status">앱 3개와 기록을 지우고 있어요. 보통 10초 안에 끝나요. 이 화면을 닫아도 계속 진행돼요.</p>'
      : '<button class="sp-btn danger block">모든 앱과 기록을 지우고 탈퇴</button>';
    var err = state === 'error' ? K.error('탈퇴를 마치지 못했어요', '중간에 연결이 끊겼어요. 계정은 아직 남아 있고 로그인도 돼요. [다시 시도]를 누르면 남은 삭제를 이어서 해요.', '<button class="sp-btn">' + ic.retry(16) + '다시 시도</button>') : '';
    return wrap(K.hdr('회원 탈퇴', null, '내 계정으로', '') + sec('<h1>탈퇴하면 이렇게 돼요</h1>' + gone) + sec(err + field + btn + (busy ? '' : '<a class="sp-btn text" href="#s11">탈퇴하지 않고 돌아가기</a>')));
  };
  add({ id: 's11-delete', group: 'S11 내 계정', title: 'S11 탈퇴 확인',
    desc: '무엇이 지워지는지를 네 줄로 먼저 보여 주고, 로그인 이메일을 다시 적어야 단추가 눌린다(S10 앱 삭제와 같은 방식). 단추 이름이 결과를 말한다: "모든 앱과 기록을 지우고 탈퇴". 그림은 이메일을 맞게 적은 상태.',
    mobile: function () { return leaveScreen(); } });
  add({ id: 's11-deleting', group: 'S11 내 계정', title: 'S11 탈퇴 진행 중',
    desc: '누르면 단추가 "탈퇴하는 중"으로 바뀌고 다시 눌리지 않는다. 입력 칸도 잠근다. 서버에서 키 폐기 → 앱·기록 삭제 → 계정 삭제 순서로 진행하며, 화면을 닫아도 계속된다.',
    mobile: function () { return leaveScreen('busy'); } });
  add({ id: 's11-delete-error', group: 'S11 내 계정', title: 'S11 탈퇴 실패',
    desc: '중간에 실패하면 단추 위에 무엇이 안 됐는지와 지금 계정이 어떤 상태인지(아직 남아 있음, 로그인 됨)를 쓰고 [다시 시도]로 남은 삭제를 이어서 한다. 적은 이메일은 지우지 않는다.',
    mobile: function () { return leaveScreen('error'); } });
  add({ id: 's11-done', group: 'S11 내 계정', title: 'S11 탈퇴 완료 → 첫 화면',
    desc: '탈퇴가 끝나면 로그아웃된 첫 화면(S1)으로 보내고, 맨 위 띠로 결과를 한 번 알린다. 띠는 다음 방문부터 보이지 않는다.',
    mobile: function () { return s1('<div class="sp-banner info top" role="status">' + ic.ok(18) + '<div><b>탈퇴를 마쳤어요.</b> 앱 3개와 모든 기록을 지웠고, 키는 더 이상 쓰이지 않아요.</div></div>'); } });
})(window.SP);
