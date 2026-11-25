/* ===== 시안 C — 한 문장 알림 카드: 화면 3장 ===== */
(function (SP) {
  var D = SP.D, ic = SP.ic, P = D.problem, esc = SP.esc;
  var tile = function () { return '<img class="tile" src="' + SP.IMG.sheep + '" alt="" width="30" height="30">'; };
  var stTxt = { ok: '괜찮아요', bad: '문제 있어요', wait: '기록을 기다려요' };
  var chip = function (st, t) { return '<span class="chip ' + st + '">' + ic[st](15) + (t || stTxt[st]) + '</span>'; };
  function hdr(title, sub, back) {
    return '<header class="hdr">' + (back ? '<button class="ibtn" aria-label="' + back + '">' + ic.back(22) + '</button>' : tile()) + '<span class="t">' + title + (sub ? '<small>' + sub + '</small>' : '') + '</span><button class="ibtn" aria-label="앱 설정">' + ic.gear(20) + '</button></header>';
  }
  function top(crumb) { return '<header class="top">' + tile() + '<span class="crumb">내 앱 › <b>' + crumb + '</b></span><span style="flex:1"></span><button class="ibtn" aria-label="알림 설정">' + ic.bell(20) + '</button><button class="ibtn" aria-label="앱 설정">' + ic.gear(20) + '</button></header>'; }

  /* S4 */
  function heroS4(pc) {
    var txt = '<div class="crow"><span class="swap"><span class="from">' + chip('wait', '첫 기록을 기다려요') + '</span><span class="to">' + chip('ok', '기록이 도착했어요') + '</span></span><span>오늘 13:42</span></div>' +
      '<div class="swap"><div class="from"><p class="headline">첫 기록을 기다리고 있어요</p><p class="hsub" style="margin-top:6px">배포한 앱을 한 번 써 보세요.</p></div><div class="to"><p class="headline">기능을 찾았어요</p><p class="hsub" style="margin-top:6px">코딩 AI가 붙인 이름이에요. 알림에 이 이름이 쓰이니 맞는지 봐 주세요.</p></div></div>';
    return '<div class="hero' + (pc ? ' pc' : '') + '">' + (pc ? '<div style="display:flex;flex-direction:column;gap:12px">' + txt + '</div><div class="swap"><span class="from"></span><span class="to big8" style="font-size:140px" aria-label="8개">8<small style="font-size:40px;font-weight:700">개</small></span></div>' : '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><div style="display:flex;flex-direction:column;gap:12px">' + txt + '</div><span class="swap"><span class="from"></span><span class="to big8" aria-label="8개">8</span></span></div>') + '</div>';
  }
  function namesC() {
    return '<ul class="list">' + D.features.map(function (f, i) {
      return '<li><span class="nm">' + f.name + '<details><summary>자세히</summary><code>' + esc(f.route) + '</code></details></span><button class="edit" aria-label="' + f.name + ' 이름 고치기">' + ic.pen(15) + '고치기</button><button class="edit" aria-label="' + f.name + ' 숨기기">' + ic.eyeoff(15) + '숨기기</button></li>';
    }).join('') + '<li><span class="si wait">' + ic.pen(18) + '</span><span class="nm">이름 없는 기능 1개<small>이름을 붙이면 알림에 그 이름이 나와요</small><details><summary>자세히</summary><code>' + D.unnamed.route + ' (3건)</code></details></span><button class="edit">이름 붙이기</button></li></ul>';
  }
  /* S5 */
  function heroS5(pc) {
    var cmp = '<div class="cmp" role="img" aria-label="평소 1.1초, 최근 30분 3.4초"><span class="lb">평소</span><span></span><span class="lb">최근 30분</span><span class="v old">1.1<small>초</small></span><span class="arr" aria-hidden="true">→</span><span class="v bad">3.4<small>초</small></span></div>';
    var head = '<div class="crow">' + chip('bad') + '<span>' + P.since + '</span></div><p class="headline">' + P.title + '</p>';
    if (pc) return '<div class="hero pc"><div style="display:flex;flex-direction:column;gap:14px">' + head + '<p class="hsub">최근 30분 동안 24건, 보통 걸린 시간이 평소의 3배예요. 슬랙으로 알림을 보냈어요.</p><div><button class="hbtn" style="padding:0 24px;display:inline-flex">문제 살펴보고 AI에 맡기기</button></div></div>' + cmp + '</div>';
    return '<div class="hero">' + head + cmp + '<p class="hsub">최근 30분 동안 24건, 보통 걸린 시간이 평소의 3배예요. 슬랙으로 알림을 보냈어요.</p><button class="hbtn">문제 살펴보고 AI에 맡기기</button></div>';
  }
  function listS5() {
    var fs = D.features.slice().sort(function (a, b) { return (b.st === 'bad') - (a.st === 'bad'); });
    return '<ul class="list bad-first">' + fs.map(function (f) {
      var rt = f.st === 'wait' ? '<span class="rt"><small>아직 없어요</small></span>' : f.learning ? '<span class="rt"><small>평소 속도<br>익히는 중</small></span>' : '<span class="rt">' + f.now + '<small>평소 ' + f.usual + '</small></span>';
      var sub = f.st === 'wait' ? '아직 사용 기록이 없어요' : f.learning ? f.learning : '사용 ' + f.uses.toLocaleString() + '건, 실패 ' + f.fail + '건' + (f.deep ? ', 깊게 보는 중' : '');
      return '<li><span class="si ' + f.st + '">' + ic[f.st](20) + '<span class="sr">' + stTxt[f.st] + '</span></span><span class="nm">' + f.name + '<small>' + sub + '</small></span>' + rt + '</li>';
    }).join('') + '<li><span class="si wait">' + ic.pen(18) + '</span><span class="nm">이름 없는 기능 1개<small>사용 3건</small></span><button class="edit">이름 붙이기</button></li></ul>';
  }
  /* 순서가 의미 있는 단계라 번호를 쓴다. 끝난 단계는 번호 대신 체크 아이콘 */
  function stepList(items, done) {
    return '<ol class="steps">' + items.map(function (t, i) { return '<li' + (done ? ' class="done"' : '') + '><span class="num">' + (done ? ic.check(14) + '<span class="sr">끝남</span>' : (i + 1)) + '</span><span>' + t + '</span></li>'; }).join('') + '</ol>';
  }
  function nextSteps(done) {
    return stepList(['<b>AI에 보낼 내용 복사</b><br><span class="sub">문제 화면에서 한 번에 복사해요</span>', '<b>코딩 AI에 붙여넣고 고치기</b><br><span class="sub">AI가 원인을 찾아 고쳐요</span>', '<b>새 버전 배포</b><br><span class="sub">배포만 하면 돼요</span>', '<b>쉽앤핑이 확인</b><br><span class="sub">실제 사용으로 해결됐는지 알려 드려요</span>'], done);
  }
  /* S7 */
  function heroS7(pc) {
    var head = '<div class="crow"><span class="swap"><span class="from">' + chip('bad') + '</span><span class="to">' + chip('ok', '해결됐어요') + '</span></span><span>오늘 15:32 확인</span></div>' +
      '<p class="headline">업데이트 후 분석 15건 모두 평소 속도로 끝났어요</p>';
    var meter = '<div style="display:flex;flex-direction:column;gap:8px;min-width:' + (pc ? '300px' : '0') + '"><div style="display:flex;align-items:baseline;gap:8px"><span class="big8" style="font-size:' + (pc ? '96px' : '64px') + '">15</span><span class="hsub after">/ 15건 평소 속도</span></div><div class="track" aria-hidden="true"><i></i></div></div>';
    if (pc) return '<div class="hero pc"><div style="display:flex;flex-direction:column;gap:14px">' + head + '<p class="hsub">15:10에 새 버전을 감지하고, 그 뒤 실제 사용 15건을 확인했어요.</p></div>' + meter + '</div>';
    return '<div class="hero">' + head + meter + '<p class="hsub">15:10에 새 버전을 감지하고, 그 뒤 실제 사용 15건을 확인했어요.</p></div>';
  }
  function probRecap() {
    return '<div class="sec"><h2>' + P.title + '</h2><p class="sub">평소 1.1초 → 최근 30분 3.4초 (24건), 오늘 14:05 시작</p></div>';
  }
  function aiC(pc) {
    return '<div class="sec"><h2>코딩 AI에게 맡기기</h2><p class="sub">기능 이름, 시작 시각, 버전, 오류 기록을 담은 조사 요청이에요. 개인정보와 키는 뺐어요.</p><button class="btn" data-copy="ai"' + (pc ? '' : ' style="width:100%"') + '>' + ic.copy(18) + '<span class="lbl">AI에 보낼 내용 복사</span></button><details><summary>보낼 내용 미리 보기</summary><pre>' + esc(SP.aiText()) + '</pre></details></div>';
  }
  function tlC() {
    return '<div class="sec"><h2>지금까지</h2><ol class="tl">' + P.timeline.map(function (t) { return '<li><time>' + t[0] + '</time><span>' + t[1] + '<br><span class="sub">' + t[2] + '</span></span></li>'; }).join('') + '</ol><details><summary>자세히</summary><code>POST /api/analyze<br>버전 ' + P.oldVer + ' → ' + P.badVer + '(문제) → ' + P.newVer + '(해결)<br>' + P.errors.join('<br>') + '</code></details></div>';
  }

  SP.opts.c = {
    name: '시안 C', title: '한 문장 알림 카드',
    screens: [
      {
        id: 's4', title: '① S4 연결 — 첫 기록 도착과 기능 이름표 확인', path: '/apps/moim/connect', replay: 's4',
        desc: '화면 맨 위 퍼플 카드가 지금 가장 중요한 한 문장을 크게 말한다. "첫 기록을 기다리고 있어요"가 "기능을 찾았어요"와 큰 숫자 8로 바뀌고, 아래에서 이름을 고치거나 숨긴다.',
        mobile: function () { return '<div data-anim="s4" style="display:flex;flex-direction:column;flex:1">' + hdr('모임모아 연결하기', '연결 4단계를 모두 마쳤어요', '내 앱 목록으로') + heroS4() + '<div class="sec"><h2>찾은 기능 8개</h2>' + namesC() + '<button class="btn" style="width:100%;margin-top:6px">이 이름으로 지켜보기</button><p class="sub" style="text-align:center;padding-bottom:16px">이름은 나중에 앱 설정에서도 고칠 수 있어요</p></div></div>'; },
        pc: function () { return '<div data-anim="s4" style="display:flex;flex-direction:column;flex:1">' + top('모임모아 연결하기') + '<div class="pcw">' + heroS4(true) + '<div class="pc2"><div class="sec" style="padding:0"><h2>찾은 기능 8개</h2>' + namesC() + '<div><button class="btn">이 이름으로 지켜보기</button></div></div><div class="sec" style="padding:0"><h2>연결 단계</h2>' + stepList(['요청문 복사', '코딩 AI가 연결', '배포', '앱 한 번 써 보기'], true) + '<p class="sub">이름은 나중에 앱 설정에서도 고칠 수 있어요.</p></div></div></div></div>'; }
      },
      {
        id: 's5', title: '② S5 앱 홈 — 열린 문제 1개와 기능 목록', path: '/apps/moim',
        desc: '슬랙 알림과 똑같은 문장이 화면 맨 위 카드에 크게 이어진다. 평소와 최근 시간을 큰 숫자로 나란히 두어 "얼마나 나빠졌는지"를 한눈에 본다. 문제가 없으면 같은 자리에 "모두 괜찮아요"가 온다.',
        mobile: function () { return hdr('모임모아', '마지막 기록 1분 전') + heroS5() + '<div class="sec"><h2>기능 8개</h2><p class="sub">최근 24시간, 문제 있는 기능 먼저</p>' + listS5() + '<button class="btn line" style="width:100%;margin:6px 0 16px">' + ic.plus(18) + '깊게 볼 기능 추가</button></div>'; },
        pc: function () { return top('모임모아') + '<div class="pcw">' + heroS5(true) + '<div class="pc2"><div class="sec" style="padding:0"><div style="display:flex;align-items:baseline;gap:12px"><h2>기능 8개</h2><p class="sub" style="flex:1">최근 24시간, 문제 있는 기능 먼저, 마지막 기록 1분 전</p><button class="btn line">' + ic.plus(18) + '깊게 볼 기능 추가</button></div>' + listS5() + '</div><div class="sec" style="padding:0"><h2>고치는 순서</h2>' + nextSteps(false) + '</div></div></div>'; }
      },
      {
        id: 's7', title: '③ S7 문제 상세 — AI에 보낼 내용 복사와 해결 확인', path: '/apps/moim/problems/42', replay: 's7',
        desc: '해결이 확인되면 맨 위 카드의 문장 자체가 "업데이트 후 분석 15건 모두 평소 속도로 끝났어요"로 바뀌고 막대가 왼쪽부터 채워진다. 원래 문제와 AI에 보낼 내용은 그 아래에 남아 다시 볼 수 있다.',
        mobile: function () { return '<div data-anim="s7" style="display:flex;flex-direction:column;flex:1">' + hdr('문제 상세', '모임모아', '모임모아 홈으로') + heroS7() + probRecap() + aiC() + tlC() + '<div style="height:16px"></div></div>'; },
        pc: function () { return '<div data-anim="s7" style="display:flex;flex-direction:column;flex:1">' + top('모임모아 › 문제 상세') + '<div class="pcw">' + heroS7(true) + '<div class="pc2"><div style="display:flex;flex-direction:column;gap:8px">' + probRecap().replace('class="sec"', 'class="sec" style="padding:0"') + aiC(true) + '</div><div>' + tlC().replace('class="sec"', 'class="sec" style="padding:0"') + '</div></div></div></div>'; }
      }
    ],
    spec: {
      concept: '화면마다 지금 가장 중요한 한 문장을 퍼플 카드에 크게 쓰고, 숫자는 그보다 더 크게. 슬랙 알림에서 읽은 문장이 화면을 열면 그대로 이어진다.',
      motion: '큰 문장이 바뀌는 순간만 움직인다. 첫 기록 도착: 상태 칩이 겹쳐 바뀌고(0.18초) 새 문장과 숫자 8이 6px 떠오르며 나타남(0.28초, ease-out). 해결: 막대가 왼쪽부터 채워짐(0.7초, transform만 사용) → "/ 15건 평소 속도" 글자가 0.2초 나타남. 숫자를 세어 올리는 효과는 쓰지 않음(데이터는 바로 읽혀야 함). 동작 줄이기 설정이면 0.15초 투명도만.',
      colors: '<span class="swatch" style="background:#261B40"></span>알림 카드 미드나이트 퍼플 #261B40(두 모드 공통) · <span class="swatch" style="background:#FAF9FC"></span>바탕 #FAF9FC / 어두운 #0F0A1C · <span class="swatch" style="background:#C3A6FF"></span>카드 안 버튼 라벤더 #C3A6FF · <span class="swatch" style="background:#76E7C4"></span>괜찮아요 민트 #76E7C4, 밝은 바탕 글자 #0B6B50 · <span class="swatch" style="background:#FF8A65"></span>문제 있어요 산호색 #FF8A65(카드 안), 밝은 바탕 글자 #B3261E · <span class="swatch" style="background:#CFC5E8"></span>기록을 기다려요 #CFC5E8(카드 안) / #5D5673',
      fonts: 'Noto Sans KR 400·500·700·800·900 (Google Fonts, SIL OFL 1.1). 한 글꼴의 굵기 차이(500 → 900)만으로 위계를 만든다. 숫자는 고정폭 숫자(tnum)',
      type: '휴대폰 12.5 / 14 / 15(본문) / 18 / 30(큰 문장) / 52~88(숫자), PC 15 / 18 / 44 / 84~140. 큰 문장 줄 간격 1.25, 글자 사이 -0.03em',
      space: '카드 안 20px(휴대폰)·32×36px(PC), 구역 사이 20px, 화면 가장자리 12~16px / PC 40px. 목록 줄 높이 최소 52px',
      radius: '알림 카드 24 · 버튼 12~14 · 칩 999',
      shadow: '밝은 모드 알림 카드만 0 24px 40px -24px rgba(38,27,64,.55). 나머지는 그림자 없이 선 1px',
      contrast: '카드 안 흰 글자/#261B40 16.0:1 · 산호 #FF8A65/#261B40 6.9:1 · 민트 #76E7C4/#261B40 10.7:1 · 보조 #CFC5E8/#261B40 9.8:1 · 라벤더 버튼 글자 #261B40/#C3A6FF 7.8:1 · 밝은 바탕 문제 글자 #B3261E/#FAF9FC 6.2:1 · 어두운 모드 본문 #F1EDF9/#0F0A1C 16.9:1 (WCAG 공식으로 색 값 계산, 브라우저 미확인)',
      risk: '난이도 낮음~중간. 부품 수가 가장 적다. 위험: 문제가 여러 개 동시에 열리면 큰 카드를 어떻게 쌓을지 규칙이 필요(제안: 가장 나쁜 문제 1개만 크게, 나머지는 카드 아래 "문제 2개 더" 줄). 큰 숫자는 "평소 속도가 아직 없는" 기능에서 보여 줄 값이 없으므로 그때는 "지금까지 7건, 0.9~2.1초" 문장으로 대신한다',
      rank: '<b>1순위</b> — 대상 사용자가 원하는 세 가지 답("괜찮은지 / 어디가 문제인지 / 고쳐졌는지")을 화면 맨 위 한 문장으로 바로 준다. 휴대폰에서 알림 링크로 열었을 때 가장 빨리 읽히고, 브랜드 퍼플을 넓게 써서 개성도 있다. 기능 목록은 A처럼 단정한 줄 목록이라 기능이 늘어도 버틴다'
    }
  };
})(window.SP);
