/* ===== 쉽앤핑 최종 화면 S1~S10 (+ S4·S5·S7 로딩·빈 화면·오류) ===== */
(function (SP) {
  var K = SP.K, ic = SP.ic, D = SP.D, esc = SP.esc;
  var E = SP.entries = [];
  var add = function (o) { E.push(o); };
  var wrap = function (inner, pad) { return '<div style="display:flex;flex-direction:column;flex:1;padding-bottom:' + (pad == null ? 20 : pad) + 'px">' + inner + '</div>'; };
  var sec = function (inner, style) { return '<div class="sp-sec"' + (style ? ' style="' + style + '"' : '') + '>' + inner + '</div>'; };
  var problemMeta = function () { return K.status('bad') + '<span>오늘 14:05부터</span>'; };

  /* ---------------- S1 첫 화면·로그인 ---------------- */
  add({ id: 's1', group: 'S1 첫 화면·로그인', title: 'S1 첫 화면·로그인',
    desc: '서비스 소개 한 문장을 양이 말한다. 로그인은 Google과 이메일 링크 두 가지. 첫 로그인이면 S3(앱 등록)으로, 알림 링크로 왔으면 원래 화면으로 돌아간다.',
    mobile: function () {
      return wrap('<header class="sp-hdr"><img class="sp-tile" src="' + SP.IMG.wordmark + '" alt="Ship &amp; Ping 쉽앤핑" width="40" height="40" style="width:40px;height:40px;border-radius:10px"><span class="t">쉽앤핑</span></header>' +
        K.say({ meta: '<span>무료 베타</span>', headline: '<p class="sp-headline">내 앱이 괜찮은지, 24시간 대신 지켜볼게요</p>', body: '<p class="hsub">문제가 생기면 "분석이 느려졌어요"처럼 쉬운 말로 알려 드리고, 코딩 AI에 보낼 내용까지 챙겨 드려요.</p>' }) +
        sec('<button class="sp-btn block">' + ic.google(18) + 'Google로 시작하기</button><button class="sp-btn line block">' + ic.mail(18) + '이메일 링크로 시작하기</button><p class="sp-sub">이메일 링크는 비밀번호 없이 메일에 온 링크를 눌러 들어오는 방식이에요.</p>') +
        sec('<h2>이렇게 써요</h2>' + K.steps(['연결 요청을 코딩 AI에 붙여넣어요', '문제가 생기면 슬랙이나 메일로 알려 드려요', '고친 버전을 배포하면 해결됐는지 확인해 드려요'], 0, -1)));
    } });

  /* ---------------- S2 내 앱 목록 ---------------- */
  add({ id: 's2', group: 'S2 내 앱 목록', title: 'S2 내 앱 목록 (앱 3개, 한도 도달)',
    desc: '앱 카드마다 상태·열린 문제 수·마지막 기록 시각. 문제 있는 앱이 맨 위. 무료 베타 한도(앱 3개)에 닿으면 등록 단추를 비활성으로 두고 이유를 바로 옆에 쓴다. 앱이 하나도 없으면 빈 화면(S2 아래 설명)으로.',
    mobile: function () {
      var card = function (name, st, line) { return '<a class="sp-appcard" href="#"><span class="r"><b>' + name + '</b>' + K.status(st) + '</span><span class="sp-sub">' + line + '</span></a>'; };
      return wrap(K.hdr('내 앱', '쉽앤핑', null, '<button class="sp-ibtn" aria-label="내 계정">' + ic.gear(20) + '</button>') +
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
  var names = function (errAt) {
    return '<ul class="sp-list">' + D.features.map(function (f) {
      return '<li class="sp-frow"><span class="nm">' + f.name + '<details><summary>자세히</summary><code>' + esc(f.route) + '</code></details></span><button class="sp-edit" aria-label="' + f.name + ' 이름 고치기">' + ic.pen(15) + '고치기</button><button class="sp-edit" aria-label="' + f.name + ' 숨기기">' + ic.eyeoff(15) + '숨기기</button></li>';
    }).join('') + '<li class="sp-frow"><span class="si wait">' + ic.pen(18) + '</span><span class="nm">이름 없는 기능 1개<small>이름을 붙이면 알림에 그 이름이 나와요</small><details><summary>자세히</summary><code>' + D.unnamed.route + ' (3건)</code></details></span><button class="sp-edit">이름 붙이기</button></li></ul>';
  };
  add({ id: 's4', group: 'S4 연결하기', title: 'S4 연결하기: 기록 도착 (완료)', anim: 's4',
    desc: '연결 4단계를 마치고 첫 기록이 도착한 순간. 상태 표시가 "첫 기록을 기다려요"에서 "기록이 도착했어요"로, 양이 하는 말이 "기능을 찾았어요"와 큰 숫자 8로 바뀐다. 아래에서 이름을 고치거나 숨긴다.',
    mobile: function () {
      return wrap(K.hdr('모임모아 연결하기', '연결 4단계를 모두 마쳤어요', '내 앱 목록으로') +
        K.say({ meta: K.swapStatus('wait', '첫 기록을 기다려요', 'ok', '기록이 도착했어요') + '<span>오늘 13:42</span>',
          headline: '<div class="sp-swap"><div class="from"><p class="sp-headline">첫 기록을 기다리고 있어요</p></div><div class="to"><p class="sp-headline">기능 <span style="color:var(--sp-ok)">8</span>개를 찾았어요</p></div></div>',
          body: '<p class="hsub">코딩 AI가 붙인 이름이에요. 알림에 이 이름이 쓰이니 맞는지 봐 주세요.</p>' }) +
        sec('<h2>찾은 기능 8개</h2>' + names() + '<button class="sp-btn block">이 이름으로 지켜보기</button><p class="sp-sub" style="text-align:center">이름은 나중에 앱 설정에서도 고칠 수 있어요</p>'));
    } });
  add({ id: 's4-loading', group: 'S4 연결하기', title: 'S4 로딩: 화면 불러오는 중',
    desc: '0.3초가 넘게 걸릴 때만 보인다. 큰 문장 카드와 목록이 들어갈 자리를 같은 높이로 먼저 잡아 두어, 내용이 들어와도 화면이 밀리지 않는다. 화면 읽기 프로그램에는 "불러오는 중"으로 알린다.',
    mobile: function () {
      return wrap(K.hdr('모임모아 연결하기', null, '내 앱 목록으로') + '<div aria-busy="true" aria-label="연결 상태를 불러오는 중">' +
        K.say({ meta: '<span class="sp-skel line" style="width:120px"></span>', headline: '<span class="sp-skel title" style="width:85%"></span>', body: '<span class="sp-skel line" style="width:95%"></span><span class="sp-skel line" style="width:60%"></span>' }) +
        sec('<span class="sp-skel line" style="width:40%;height:20px"></span>' + [1, 2, 3, 4, 5].map(function () { return '<span class="sp-skel" style="height:44px"></span>'; }).join('')) + '</div>');
    } });
  add({ id: 's4-empty', group: 'S4 연결하기', title: 'S4 빈 화면: 30분이 지나도 기록이 없음',
    desc: '연결 요청을 복사한 지 30분이 지나도 기록이 없으면 "기록이 안 와요?" 확인 목록을 펼친다. 화면은 계속 5초마다 확인하고, 기록이 오면 바로 위 완료 화면으로 바뀐다.',
    mobile: function () {
      return wrap(K.hdr('모임모아 연결하기', '5초마다 확인하고 있어요', '내 앱 목록으로') +
        K.say({ meta: K.status('wait', '첫 기록을 기다려요') + '<span>연결 요청 복사 후 32분</span>', headline: '<p class="sp-headline">아직 기록이 안 왔어요</p>', body: '<p class="hsub">아래를 하나씩 확인해 보세요. 기록이 오면 이 화면이 바로 바뀌어요.</p>' }) +
        sec('<h2>기록이 안 와요?</h2>' + K.steps(['<b>배포했나요?</b><br><span class="sp-sub">코딩 AI가 고친 코드를 실제 주소에 올려야 기록이 와요</span>', '<b>배포한 앱을 한 번 써 봤나요?</b><br><span class="sp-sub">누군가 앱을 써야 첫 기록이 생겨요</span>', '<b>코딩 AI에게 연결을 확인해 달라고 하세요</b><br><span class="sp-sub">아래 문장을 붙여넣으면 AI가 전송이 되는지 확인해요</span>'], 0, -1) +
          K.copy('확인 문장 복사', 'check', ' block') + '<button class="sp-btn line block">' + ic.copy(18) + '연결 요청 다시 복사</button><p class="sp-sub">연결 요청에는 이 앱의 키가 들어 있어요. 다른 사람에게 보내지 마세요.</p>'));
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
      body: (pc ? '' : K.cmp(['평소', '1.1'], ['최근 30분', '3.4'])) + '<p class="hsub">최근 30분 동안 24건, 보통 걸린 시간이 평소의 3배예요. 슬랙으로 알림을 보냈어요.</p>' + (pc ? '<div><button class="sp-hbtn" style="display:inline-flex">문제 살펴보고 AI에 맡기기</button></div>' : '<button class="sp-hbtn">문제 살펴보고 AI에 맡기기</button>'),
      side: pc ? K.cmp(['평소', '1.1'], ['최근 30분', '3.4']) : '' });
  };
  var featList = function () { return '<ul class="sp-list">' + D.features.map(K.frow).join('') + K.unnamedRow() + '</ul>'; };
  var fixSteps = function () { return K.steps(['<b>AI에 보낼 내용 복사</b><br><span class="sp-sub">문제 화면에서 한 번에 복사해요</span>', '<b>코딩 AI에 붙여넣고 고치기</b><br><span class="sp-sub">AI가 원인을 찾아 고쳐요</span>', '<b>새 버전 배포</b><br><span class="sp-sub">배포만 하면 돼요</span>', '<b>쉽앤핑이 확인</b><br><span class="sp-sub">실제 사용으로 해결됐는지 알려 드려요</span>'], 0, 0); };
  add({ id: 's5', group: 'S5 앱 홈', title: 'S5 앱 홈: 열린 문제 1개 (기본)',
    desc: '슬랙 알림과 같은 문장을 양이 맨 위 카드에서 말한다. 평소와 최근 시간을 큰 숫자로 나란히. 아래는 문제 있는 기능부터, 그다음 최근 24시간 사용 많은 순.',
    mobile: function () { return wrap(K.hdr('모임모아', '마지막 기록 1분 전', null, '<button class="sp-ibtn" aria-label="알림 설정">' + ic.bell(20) + '</button><button class="sp-ibtn" aria-label="앱 설정">' + ic.gear(20) + '</button>') + s5Hero() + sec('<h2>기능 8개</h2><p class="sp-sub">최근 24시간, 문제 있는 기능 먼저</p>' + featList() + '<button class="sp-btn line block">' + ic.plus(18) + '깊게 볼 기능 추가</button>')); },
    pc: function () { return K.top('모임모아') + '<div class="sp-pcw">' + s5Hero(true) + '<div class="sp-pc2"><div class="sp-sec" style="padding:0"><div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap"><h2>기능 8개</h2><p class="sp-sub" style="flex:1">최근 24시간, 문제 있는 기능 먼저, 마지막 기록 1분 전</p><button class="sp-btn line">' + ic.plus(18) + '깊게 볼 기능 추가</button></div>' + featList() + '</div><div class="sp-sec" style="padding:0"><h2>고치는 순서</h2>' + fixSteps() + '</div></div></div>'; } });
  add({ id: 's5-ok', group: 'S5 앱 홈', title: 'S5 앱 홈: 모두 괜찮아요',
    desc: '열린 문제가 없을 때 같은 자리에서 양이 "모두 괜찮아요"를 말한다. 숫자 대신 무엇을 지켜보고 있는지를 쓴다.',
    mobile: function () { return wrap(K.hdr('모임모아', '마지막 기록 1분 전') + K.say({ meta: K.status('ok') + '<span>지금</span>', headline: '<p class="sp-headline">모두 괜찮아요</p>', body: '<p class="hsub">기능 8개를 24시간 지켜보고 있어요. 문제가 생기면 슬랙으로 바로 알려 드릴게요.</p>' }) + sec('<h2>기능 8개</h2><p class="sp-sub">최근 24시간, 사용 많은 순</p><ul class="sp-list">' + D.features.slice(1).map(K.frow).join('') + '</ul>')); } });
  add({ id: 's5-loading', group: 'S5 앱 홈', title: 'S5 로딩: 기록 불러오는 중',
    desc: '머리말은 바로 보이고, 카드와 기능 목록 자리만 옅은 막대로. 막대는 천천히 밝아졌다 어두워지며, 동작 줄이기 설정이면 멈춰 있다.',
    mobile: function () { return wrap(K.hdr('모임모아', '불러오는 중') + '<div aria-busy="true" aria-label="앱 상태를 불러오는 중">' + K.say({ meta: '<span class="sp-skel line" style="width:140px"></span>', headline: '<span class="sp-skel title" style="width:75%"></span>', body: '<span class="sp-skel num"></span><span class="sp-skel line" style="width:90%"></span><span class="sp-skel btn"></span>' }) + sec('<span class="sp-skel line" style="width:30%;height:20px"></span>' + [1, 2, 3, 4, 5, 6].map(function () { return '<span class="sp-skel" style="height:48px"></span>'; }).join('')) + '</div>'); } });
  add({ id: 's5-empty', group: 'S5 앱 홈', title: 'S5 빈 화면: 아직 기록이 없음',
    desc: '앱을 등록했지만 기록이 하나도 없을 때. 이유와 다음 행동(연결 다시 보기)을 함께 보여 준다.',
    mobile: function () { return wrap(K.hdr('모임모아', '아직 기록이 없어요') + K.say({ meta: K.status('wait'), headline: '<p class="sp-headline">첫 기록을 기다리고 있어요</p>', body: '<p class="hsub">연결을 마치고 앱을 한 번 써 보면 여기에 기능 목록이 생겨요.</p><button class="sp-hbtn">연결 단계 다시 보기</button>' }) + sec(K.empty('기능 목록이 비어 있어요', '첫 기록이 오면 코딩 AI가 붙인 기능 이름으로 채워져요.'))); } });
  add({ id: 's5-error', group: 'S5 앱 홈', title: 'S5 오류: 기록을 불러오지 못함 + 하루 동안 기록 없음',
    desc: '불러오기가 실패하면 마지막으로 본 내용을 지우지 않고 위에 오류 안내를 둔다. 기록이 하루 동안 끊긴 경우는 문제가 아니라 띠 알림으로 알린다.',
    mobile: function () { return wrap(K.hdr('모임모아', '마지막으로 불러온 때 14:20') + sec(K.error('최신 기록을 불러오지 못했어요', '인터넷 연결을 확인하고 다시 불러와 주세요. 아래는 14:20에 불러온 내용이에요.', '<button class="sp-btn">' + ic.retry(16) + '다시 불러오기</button>') + K.banner('info', '<b>하루 동안 기록이 없어요.</b> 사용자가 없었거나 연결이 끊겼을 수 있어요.', '연결 확인하는 법 보기'), 'padding-top:4px') + sec('<h2>기능 8개</h2><ul class="sp-list" style="opacity:.7">' + D.features.slice(1, 6).map(K.frow).join('') + '</ul>')); } });
  add({ id: 's5-big', group: 'S5 앱 홈', title: 'S5 큰 글자(200%)',
    desc: '기기 글자 크기를 200%로 키웠을 때. 큰 숫자는 위아래로 쌓이고(화살표도 아래 방향), 기능 행의 시간은 이름 아래로 내려간다. 머리말의 보조 단추는 숨기고 설정 메뉴에서 찾게 한다. 문장은 자르지 않고 줄을 바꾼다.',
    big: true, mobile: function () { return wrap(K.hdr('모임모아', '마지막 기록 1분 전') + s5Hero() + sec('<h2>기능 8개</h2><ul class="sp-list">' + D.features.slice(0, 3).map(K.frow).join('') + '</ul>')); } });

  /* ---------------- S6 기능 상세 ---------------- */
  add({ id: 's6', group: 'S6 기능 상세', title: 'S6 기능 상세: 분석',
    desc: '양이 이 기능의 지금 상태를 한 문장으로 말하고, 아래에 최근 24시간 사용·실패 막대, 버전별 비교, 자세히(주소·오류 종류)를 둔다. 느림 기준은 평소 속도가 없을 때만 쓰인다는 걸 칸 옆에 적는다.',
    mobile: function () {
      var h = [30, 42, 38, 25, 18, 12, 15, 40, 62, 70, 58, 66]; var f = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      var bars = h.map(function (v, i) { return '<i style="height:' + v + '%"><b style="height:' + f[i] + '%"></b></i>'; }).join('');
      return wrap(K.hdr('분석', '모임모아', '모임모아 홈으로') +
        K.say({ meta: problemMeta(), headline: '<p class="sp-headline">분석이 평소보다 느려요</p>', body: K.cmp(['평소', '1.1'], ['최근 30분', '3.4']) + '<button class="sp-hbtn">열린 문제 보기</button>' }) +
        sec('<h2>최근 24시간</h2><p class="sp-sub">2시간마다 사용 건수, 실패는 0건이에요</p><div class="sp-bars" role="img" aria-label="최근 24시간 사용 건수 막대, 오후에 가장 많음, 실패 없음">' + bars + '</div><div style="display:flex;justify-content:space-between" class="sp-sub"><span>어제 16시</span><span>지금</span></div>') +
        sec('<h2>버전별 비교</h2><table class="sp-table"><caption class="sr">최근 버전 3개 비교</caption><thead><tr><th scope="col">버전</th><th scope="col" class="n">사용</th><th scope="col" class="n">실패</th><th scope="col" class="n">보통 시간</th></tr></thead><tbody><tr><td>오늘 13:50</td><td class="n">24건</td><td class="n">0건</td><td class="n"><b style="color:var(--sp-bad-ink)">3.4초</b></td></tr><tr><td>어제 18:20</td><td class="n">96건</td><td class="n">0건</td><td class="n">1.1초</td></tr><tr><td>11월 22일</td><td class="n">210건</td><td class="n">1건</td><td class="n">1.0초</td></tr></tbody></table><details><summary>자세히</summary><code>POST /api/analyze<br>버전 ' + D.badVer + ' / ' + D.oldVer + '<br>오류 종류: TimeoutError 2건, SlowQuery 1건</code></details>') +
        sec(K.field({ label: '느림 기준', value: '5초', help: '평소 속도가 아직 없을 때만 써요. 지금은 평소 속도(1.1초)로 판단하고 있어요.' })));
    } });

  /* ---------------- S7 문제 상세 ---------------- */
  var aiSec = function (again, blocked) {
    return sec('<h2>' + (again ? 'AI에게 다시 맡기기' : '코딩 AI에게 맡기기') + '</h2><p class="sp-sub">' + (again ? '이전에 고친 버전과 결과를 함께 담았어요.' : '기능 이름, 시작 시각, 버전, 오류 기록을 담은 조사 요청이에요.') + ' 개인정보와 키는 뺐어요.</p>' +
      K.copy(again ? 'AI에 다시 보낼 내용 복사' : 'AI에 보낼 내용 복사', again ? 'again' : 'ai', ' block') +
      (blocked ? '<div class="sp-copy-blocked">' + K.banner('warn', '<b>자동 복사가 막혔어요.</b> 아래 내용을 길게 눌러 모두 선택한 뒤 복사하세요.') + '<pre class="sp-pre" tabindex="0" aria-label="AI에 보낼 내용">' + esc(SP.aiText(again)) + '</pre></div>' : '<details><summary>보낼 내용 미리 보기</summary><pre class="sp-pre">' + esc(SP.aiText(again)) + '</pre></details>'));
  };
  var tl = function (rows) { return sec('<h2>지금까지</h2><ol class="sp-tl">' + rows.map(function (t) { return '<li><time>' + t[0] + '</time><span>' + t[1] + '<br><span class="sp-sub">' + t[2] + '</span></span></li>'; }).join('') + '</ol><details><summary>자세히</summary><code>POST /api/analyze<br>버전 ' + D.oldVer + ' → ' + D.badVer + '(문제) → ' + D.newVer + '<br>' + D.errors.join('<br>') + '</code></details>'); };
  var tlDone = [['14:05', '처음 감지', '분석이 평소보다 2배 넘게 느려졌어요'], ['14:06', '알림 보냄', '슬랙 #모임모아-알림'], ['15:10', '새 버전 감지', '고친 버전이 배포됐어요'], ['15:32', '해결됐어요', '업데이트 후 15건 모두 평소 속도']];
  var s7Hero = function (pc) {
    var meter = '<div style="display:flex;flex-direction:column;gap:8px;min-width:' + (pc ? '300px' : '0') + '"><div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap"><span class="sp-cmp"><span class="v ok"><span class="n">15</span></span></span><span class="hsub sp-after">/ 15건 평소 속도</span></div><div class="sp-track" aria-hidden="true"><i></i></div></div>';
    return K.say({ pc: pc, ring: true, meta: K.swapStatus('bad', null, 'ok', '해결됐어요') + '<span>오늘 15:32 확인</span>', headline: '<p class="sp-headline">업데이트 후 분석 15건 모두 평소 속도로 끝났어요</p>', body: (pc ? '' : meter) + '<p class="hsub">15:10에 새 버전을 감지하고, 그 뒤 실제 사용 15건을 확인했어요.</p>', side: pc ? meter : '' });
  };
  var recap = function () { return sec('<h2>분석이 느려졌어요</h2><p class="sp-sub">평소 1.1초 → 최근 30분 3.4초 (24건), 오늘 14:05 시작</p>'); };
  add({ id: 's7', group: 'S7 문제 상세', title: 'S7 문제 상세: 해결됐어요 (기본)', anim: 's7',
    desc: '해결이 확인되면 양이 하는 말 자체가 "업데이트 후 분석 15건 모두 평소 속도로 끝났어요"로 바뀌고, 막대가 왼쪽부터 채워진 뒤 양 둘레에 민트 고리가 한 번 퍼진다(동작 줄이기면 고리 없음). 원래 문제와 AI에 보낼 내용은 아래에 남는다.',
    mobile: function () { return wrap(K.hdr('문제 상세', '모임모아', '모임모아 홈으로') + s7Hero() + recap() + aiSec() + tl(tlDone)); },
    pc: function () { return K.top('모임모아 › 문제 상세') + '<div class="sp-pcw">' + s7Hero(true) + '<div class="sp-pc2"><div style="display:flex;flex-direction:column;gap:8px">' + recap().replace('class="sp-sec"', 'class="sp-sec" style="padding:0"') + aiSec().replace('class="sp-sec"', 'class="sp-sec" style="padding:0"') + '</div><div>' + tl(tlDone).replace('class="sp-sec"', 'class="sp-sec" style="padding:0"') + '</div></div></div>'; } });
  add({ id: 's7-open', group: 'S7 문제 상세', title: 'S7 진행 중: 알림 링크로 처음 연 화면',
    desc: '슬랙 알림 링크를 휴대폰으로 열면 처음 보는 화면. 할 일은 [AI에 보낼 내용 복사] 하나. 업데이트 후 확인 영역은 아직 비어 있고 다음에 무엇이 일어나는지 말해 준다.',
    mobile: function () { return wrap(K.hdr('문제 상세', '모임모아', '모임모아 홈으로') + K.say({ meta: problemMeta(), headline: '<p class="sp-headline">분석이 느려졌어요</p>', body: K.cmp(['평소', '1.1'], ['최근 30분', '3.4']) + '<p class="hsub">최근 30분 동안 24건, 보통 걸린 시간이 평소의 3배예요.</p>' }) + aiSec() + sec('<h2>업데이트 후 확인</h2>' + K.empty('고친 버전을 배포하면 여기서 확인해 드려요', '새 버전이 감지되면 실제 사용 5건을 지켜보고, 모두 평소 속도면 해결로 알려 드려요.')) + tl([['14:05', '처음 감지', '분석이 평소보다 2배 넘게 느려졌어요'], ['14:06', '알림 보냄', '슬랙 #모임모아-알림']]) + sec('<button class="sp-btn text">문제 아님으로 닫기</button><p class="sp-sub">닫으면 같은 문제를 24시간 동안 다시 알리지 않아요.</p>')); } });
  add({ id: 's7-loading', group: 'S7 문제 상세', title: 'S7 로딩: 업데이트 후 확인 중',
    desc: '새 버전은 감지했지만 아직 5건을 다 보지 못한 상태. 확인한 건수를 그대로 보여 준다(꾸민 진행 막대 대신 실제 숫자). 화면 첫 불러오기는 S5와 같은 스켈레톤을 쓴다.',
    mobile: function () { return wrap(K.hdr('문제 상세', '모임모아', '모임모아 홈으로') + K.say({ meta: K.status('bad') + '<span>15:10 새 버전 감지</span>', headline: '<p class="sp-headline">업데이트 후 3건 성공, 2건 더 확인할게요</p>', body: '<div class="sp-cmp"><span class="v ok"><span class="n">3</span></span><span class="hsub" style="padding-bottom:6px">/ 5건 평소 속도</span></div><p class="hsub">새 버전으로 분석을 쓴 기록을 기다리고 있어요. 다 확인하면 알려 드릴게요.</p>' }) + recap() + aiSec() ); } });
  add({ id: 's7-error', group: 'S7 문제 상세', title: 'S7 오류: 업데이트 후에도 느림 + 자동 복사 막힘',
    desc: '새 버전에서도 기준을 넘으면 양이 그대로 말하고, 이전 시도 버전을 담은 [AI에 다시 보낼 내용 복사]를 준다. 브라우저가 자동 복사를 막은 경우의 대안(직접 선택해 복사)도 이 화면에 함께 보인다.',
    mobile: function () { return wrap(K.hdr('문제 상세', '모임모아', '모임모아 홈으로') + K.say({ meta: K.status('bad') + '<span>15:40 확인</span>', headline: '<p class="sp-headline">업데이트 후에도 5건 중 2건이 느렸어요</p>', body: K.cmp(['평소', '1.1'], ['새 버전', '2.8']) + '<p class="hsub">고친 버전(15:10 배포)에서도 아직 느려요. 이전 시도를 담아 AI에게 다시 맡겨 보세요.</p>' }) + aiSec(true, true) + tl([['14:05', '처음 감지', '분석이 평소보다 2배 넘게 느려졌어요'], ['15:10', '새 버전 감지', '고친 버전이 배포됐어요'], ['15:40', '아직 느려요', '5건 중 2건이 평소의 2배 넘게 걸렸어요']])); } });

  /* ---------------- S8 깊게 볼 기능 추가 ---------------- */
  add({ id: 's8', group: 'S8 깊게 볼 기능 추가', title: 'S8 깊게 볼 기능 추가',
    desc: '"시작"과 "실제 성공"의 차이를 예시 문장으로 칸 위에 보여 준다(칸 안 흐린 글씨는 쓰지 않음). 앱마다 5개까지이고 지금 몇 개인지 머리에 적는다.',
    mobile: function () {
      return wrap(K.hdr('깊게 볼 기능 추가', '모임모아, 지금 1개 / 5개', '모임모아 홈으로', '') +
        sec('<h1>저장까지 됐는지 확인할 기능</h1><p class="sp-sub">화면에 "성공"이 떠도 실제로 저장이 안 될 때가 있어요. 중요한 기능 하나를 골라 끝까지 확인해요.</p>' +
          K.field({ label: '기능 이름', value: '모임 신청', example: '예: 모임 신청, 결제, 글쓰기' }) +
          K.field({ label: '시작', value: '신청 버튼을 누를 때', example: '사용자가 무엇을 하면 시작인가요? 예: 신청 버튼을 누를 때' }) +
          K.field({ label: '실제 성공', value: '참가자 명단에 저장됐을 때', example: '무엇이 끝나야 진짜 성공인가요? 예: 참가자 명단에 저장됐을 때' }) +
          K.copy('추가 연결 요청 복사', 'connect', ' block') + '<p class="sp-sub">코딩 AI에 붙여넣고 배포하면, 첫 결과가 왔을 때 "첫 신청 기록이 도착했어요"로 알려 드려요.</p>'));
    } });

  /* ---------------- S9 알림 설정 ---------------- */
  add({ id: 's9', group: 'S9 알림 설정', title: 'S9 알림 설정 (슬랙 연결됨)',
    desc: '슬랙이 연결된 상태와 시험 알림, 이메일 켜기. 슬랙 연결이 실패하는 흔한 이유(무료 워크스페이스 앱 10개 한도, 관리자 제한)는 자세히 안에 쉬운 말로.',
    mobile: function () {
      return wrap(K.hdr('알림 설정', '모임모아', '모임모아 홈으로', '') +
        sec('<div class="sp-card"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' + ic.slack(22) + '<b style="flex:1">슬랙</b>' + K.status('ok', '연결됐어요') + '</div><p>#모임모아-알림 채널로 보내요</p><p class="sp-sub">문제가 생길 때 한 번, 해결될 때 한 번 보내요.</p><button class="sp-btn block">시험 알림 보내기</button><button class="sp-btn text">슬랙 연결 끊기</button></div>' +
          '<div class="sp-card"><button class="sp-switch" role="switch" aria-checked="false"><span><b>이메일로도 받기</b><br><span class="sp-sub">로그인한 이메일로 보내요</span></span><span class="knob" aria-hidden="true"></span></button></div>' +
          '<details><summary>슬랙 연결이 안 될 때</summary><p class="sp-sub" style="margin-top:6px">무료 슬랙은 앱을 10개까지만 추가할 수 있어요. 앱 하나를 지우거나 이메일 알림을 켜세요. 회사 슬랙이면 관리자가 앱 추가를 막아 두었을 수 있어요. 관리자에게 요청해 주세요.</p></details>' +
          K.banner('info', '시험 알림을 누르면 "시험 알림을 보냈어요. 슬랙에서 확인해 보세요"로 바뀌어요.')));
    } });

  /* ---------------- S10 앱 설정 ---------------- */
  add({ id: 's10', group: 'S10 앱 설정', title: 'S10 앱 설정',
    desc: '이름·주소, 기능 이름표, 키. 키는 앞 글자만 보이고 재발급은 "이전 키는 24시간 뒤 멈춰요", 폐기는 "지금 바로 멈춰요"를 단추 옆에 미리 쓴다. 앱 삭제는 맨 아래, 앱 이름을 다시 적어야 눌린다.',
    mobile: function () {
      var key = function (name, pfx, note) { return '<div class="sp-card"><div style="display:flex;align-items:center;gap:8px">' + ic.key(18) + '<b>' + name + '</b></div><code style="font-size:14px">' + pfx + '········</code><p class="sp-sub">' + note + '</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="sp-btn line">새 키 만들기</button><button class="sp-btn danger">폐기</button></div><p class="sp-sub">새 키를 만들면 이전 키는 24시간 뒤에 멈춰요. 폐기하면 지금 바로 멈춰요.</p></div>'; };
      return wrap(K.hdr('앱 설정', '모임모아', '모임모아 홈으로', '') +
        sec('<h2>앱 정보</h2>' + K.field({ label: '앱 이름', value: '모임모아' }) + K.field({ label: '앱 주소', opt: true, value: 'https://moim-moa.pages.dev' }) + '<button class="sp-btn">저장</button>') +
        sec('<h2>기능 이름표</h2><a class="sp-appcard" href="#"><span class="r"><b style="font-size:var(--sp-text-md)">기능 8개, 이름 없는 기능 1개</b>' + ic.chev(18) + '</span><span class="sp-sub">숨긴 기능이 없어요</span></a>') +
        sec('<h2>키</h2>' + key('수집 키', 'sp_pub_3f9a', '앱에 넣는 키예요. 기록을 보내기만 할 수 있어요.') + key('서버 키', 'sp_srv_8c21', '서버 코드에만 넣는 비공개 키예요.')) +
        sec('<h2>앱 삭제</h2><p class="sp-sub">모든 기록이 바로 지워지고 되돌릴 수 없어요.</p>' + K.field({ label: '확인을 위해 앱 이름을 적어 주세요', value: '' }) + '<button class="sp-btn danger block" aria-disabled="true">모임모아 삭제</button>'));
    } });
})(window.SP);
