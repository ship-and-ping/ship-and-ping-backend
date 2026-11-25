/* ===== 시안 B — 양이 먼저 말해 줘요: 화면 3장 ===== */
(function (SP) {
  var D = SP.D, ic = SP.ic, P = D.problem, esc = SP.esc;
  var av = function (ring) { return '<span class="avw' + (ring ? ' ring' : '') + '"><img class="av" src="' + SP.IMG.sheep + '" alt="" width="36" height="36"></span>'; };
  var stTxt = { ok: '괜찮아요', bad: '문제 있어요', wait: '기록을 기다려요' };
  var badge = function (st, t) { return '<span class="badge ' + st + '">' + ic[st](15) + (t || stTxt[st]) + '</span>'; };
  function msg(inner, time, d, opts) {
    opts = opts || {};
    return '<div class="msg in" style="--d:' + (d || 0) + '">' + (opts.noAv ? '<span style="width:36px;flex:none"></span>' : av(opts.ring)) + '<div class="col">' + inner + (time ? '<span class="time">' + time + '</span>' : '') + '</div></div>';
  }
  function chipsB() {
    return '<div class="chips">' + D.features.map(function (f) { return '<button class="chip" aria-label="' + f.name + ' 이름 고치기">' + f.name + ic.pen(15) + '</button>'; }).join('') + '</div>' +
      '<details style="margin-top:8px"><summary>자세히: 주소와 이름</summary><div class="map">' + D.features.map(function (f) { return '<code>' + esc(f.route) + '</code><span>' + f.name + '</span>'; }).join('') + '</div></details>';
  }
  function s4Thread(pc) {
    return msg('<div class="bub"><div class="swap"><div class="from"><p class="h">첫 기록을 기다리고 있어요</p><p>배포한 앱을 한 번 써 보세요.</p></div><div class="to"><p class="h">기록이 도착했어요!</p><p>앱을 살펴보고 기능 8개를 찾았어요. 코딩 AI가 붙인 이름이 맞는지 봐 주세요.</p></div></div></div>', '오늘 13:42', 0) +
      msg('<div class="bub wide">' + badge('ok', '기능 8개') + '<p style="font-size:14px;color:var(--ink-2)">이름을 누르면 고칠 수 있어요. 알림에는 이 이름이 쓰여요.</p>' + chipsB() + '</div>', '', 700, { noAv: true }) +
      msg('<div class="bub"><p>이름이 없는 주소도 1개 있어요. 이름을 붙이면 그 이름으로 알려 드릴게요.</p><details><summary>자세히</summary><code>' + D.unnamed.route + ' (3건)</code></details></div>', '', 900) +
      '<div class="mine in" style="--d:1100"><button class="reply">' + ic.pen(16) + '이름 붙이기</button><button class="reply primary">' + ic.check(16) + '모두 맞아요</button></div>';
  }
  function probBubble() {
    return '<div class="bub wide">' + badge('bad') + '<p class="h">' + P.title + '</p><div class="bars" role="img" aria-label="평소 1.1초, 최근 30분 3.4초"><div class="bar"><span>평소</span><i><b style="width:30%"></b></i><span>' + P.usual + '</span></div><div class="bar slow"><span>최근 30분</span><i><b style="width:92%"></b></i><span>' + P.recent + '</span></div></div><p style="font-size:14px;color:var(--ink-2);margin-bottom:10px">최근 30분 동안 24건, 보통 걸린 시간이 평소의 3배예요. 슬랙으로도 알려 드렸어요.</p><button class="btn">같이 살펴보기</button></div>';
  }
  function tilesB() {
    return '<div class="tiles">' + D.features.map(function (f) {
      var sub = f.st === 'wait' ? '아직 사용 기록이 없어요' : f.learning ? f.learning : f.st === 'bad' ? '최근 ' + f.now + ' (평소 ' + f.usual + ')' : f.uses.toLocaleString() + '건, 보통 ' + f.now;
      return '<div class="ft"><span class="n ' + f.st + '">' + ic[f.st](16) + '<span>' + f.name + '</span><span class="sr">' + stTxt[f.st] + '</span></span><small>' + sub + (f.deep ? '<br>깊게 보는 중' : '') + '</small></div>';
    }).join('') + '<div class="ft"><span class="n wait">' + ic.pen(16) + '<span>이름 없는 기능</span></span><small>1개, 이름을 붙여 주세요</small></div></div>';
  }
  function s5Thread(withTiles) {
    return msg('<div class="bub"><p>모임모아를 지켜보고 있어요. <span class="jua">한 가지가 마음에 걸려요.</span></p></div>', '오늘 14:06', 0) +
      msg(probBubble(), '', 0, { noAv: true }) +
      (withTiles ? msg('<div class="bub"><p>나머지 기능은 괜찮아요. 최근 24시간 사용 많은 순이에요.</p></div>', '', 0) + '<div class="in">' + tilesB() + '</div>' : '');
  }
  function aiBubble() {
    return '<div class="bub wide"><p>아래 내용을 코딩 AI 대화창에 그대로 붙여넣어 주세요. 기능, 시각, 버전, 오류 기록이 들어 있고 개인정보와 키는 뺐어요.</p><div style="margin-top:10px"><button class="btn" data-copy="ai">' + ic.copy(18) + '<span class="lbl">AI에 보낼 내용 복사</span></button></div><details style="margin-top:6px"><summary>보낼 내용 미리 보기</summary><pre>' + esc(SP.aiText()) + '</pre></details></div>';
  }
  function resolvedBubble() {
    var d = ''; for (var i = 0; i < 15; i++) d += '<i style="--i:' + i + '"></i>';
    return '<div class="bub wide resolved">' + badge('ok', '해결됐어요') + '<p class="h">고쳐진 걸 확인했어요</p><p>' + P.resolved + '.</p><div class="dots" aria-hidden="true">' + d + '</div></div>';
  }
  function s7Thread(pc) {
    return msg('<div class="bub"><p><span class="jua">분석이 느려졌어요.</span> 평소 1.1초인데 최근 30분은 3.4초예요 (24건).</p></div>', '오늘 14:05', 0) +
      msg('<div class="bub"><p>슬랙 #모임모아-알림 채널로 알려 드렸어요.</p></div>', '14:06', 0, { noAv: true }) +
      msg(aiBubble(), '', 0, { noAv: true }) +
      msg('<div class="bub"><p>새 버전이 배포됐네요. 실제 사용으로 확인해 볼게요.</p></div>', '15:10', 600) +
      msg(resolvedBubble(), '15:32', 1100, { ring: true });
  }
  function s7Detail() {
    return '<details><summary>자세히: 주소, 버전, 오류 원문</summary><pre>POST /api/analyze\n버전 ' + P.oldVer + ' → ' + P.badVer + ' (문제) → ' + P.newVer + ' (해결)\n' + P.errors.join('\n') + '</pre></details>';
  }
  function hdr(title, sub, back) {
    return '<header class="hdr">' + (back ? '<button class="ibtn" aria-label="' + back + '">' + ic.back(22) + '</button>' : av()) + '<span class="t"><b>' + title + '</b><span>' + sub + '</span></span><button class="ibtn" aria-label="알림 설정">' + ic.bell(20) + '</button></header>';
  }
  function topB() {
    return '<header class="top">' + av() + '<span class="brand">쉽앤핑</span><button class="appsw">모임모아 ' + SP.ic.chev(14).replace('<svg', '<svg style="transform:rotate(90deg)"') + '</button><span style="flex:1"></span><button class="ibtn" aria-label="알림 설정">' + ic.bell(20) + '</button><button class="ibtn" aria-label="앱 설정">' + ic.gear(20) + '</button></header>';
  }

  SP.opts.b = {
    name: '시안 B', title: '양이 먼저 말해 줘요',
    screens: [
      {
        id: 's4', title: '① S4 연결 — 첫 기록 도착과 기능 이름표 확인', path: '/apps/moim/connect', replay: 's4',
        desc: '쉽앤핑 양이 메신저처럼 먼저 말을 건다. "첫 기록을 기다리고 있어요" 말풍선이 "기록이 도착했어요!"로 바뀌고, 찾은 기능이 이름 단추로 이어서 올라온다. 사용자는 아래 답 단추로 다음 행동을 고른다.',
        mobile: function () { return '<div data-anim="s4" style="display:flex;flex-direction:column;flex:1">' + hdr('모임모아 연결', '연결 4단계를 모두 마쳤어요', '내 앱 목록으로') + '<div class="thread">' + s4Thread() + '</div></div>'; },
        pc: function () {
          return '<div data-anim="s4" style="flex:1;display:flex;flex-direction:column">' + topB() + '<div class="pcbody"><div class="thread" style="padding:0">' + s4Thread(true) + '</div><aside class="panel"><h2>연결 단계</h2>' +
            ['요청문 복사', '코딩 AI가 연결', '배포', '앱 한 번 써 보기'].map(function (t, i) { return '<p style="margin:0;display:flex;gap:8px;align-items:center;color:var(--ok-ink)">' + ic.ok(18) + '<span style="color:var(--ink)">' + (i + 1) + '. ' + t + '</span></p>'; }).join('') + '<p style="margin:0;font-size:14px;color:var(--ink-2)">이름은 나중에 앱 설정에서도 고칠 수 있어요.</p></aside></div></div>';
        }
      },
      {
        id: 's5', title: '② S5 앱 홈 — 열린 문제 1개와 기능 목록', path: '/apps/moim',
        desc: '앱 홈도 양의 말로 시작한다. 문제 카드는 평소와 최근 시간을 막대 두 개로 견줘 보여 주고, 나머지 기능은 상태 아이콘이 붙은 타일로 모았다.',
        mobile: function () { return hdr('모임모아', '24시간 지켜보는 중, 마지막 기록 1분 전') + '<div class="thread">' + s5Thread(true) + '<button class="reply" style="align-self:center">' + ic.plus(16) + '깊게 볼 기능 추가</button></div>'; },
        pc: function () {
          return topB() + '<div class="pcbody"><div class="thread" style="padding:0">' + s5Thread(false) + '</div><aside class="panel"><h2>기능 8개</h2><p style="margin:0;font-size:14px;color:var(--ink-2)">최근 24시간 사용 많은 순, 마지막 기록 1분 전</p>' + tilesB() + '<button class="reply" style="align-self:flex-start">' + ic.plus(16) + '깊게 볼 기능 추가</button></aside></div>';
        }
      },
      {
        id: 's7', title: '③ S7 문제 상세 — AI에 보낼 내용 복사와 해결 확인', path: '/apps/moim/problems/42', replay: 's7',
        desc: '문제의 흐름(감지 → 알림 → AI에 맡기기 → 새 버전 → 해결)이 대화 순서 그대로 쌓인다. 해결 말풍선이 올라오면 점 15개가 채워지고 양 아이콘 둘레에 민트 고리가 한 번 퍼진다.',
        mobile: function () { return '<div data-anim="s7" style="display:flex;flex-direction:column;flex:1">' + hdr('분석이 느려졌어요', '해결됐어요, 오늘 15:32', '모임모아 홈으로') + '<div class="thread">' + s7Thread() + '<div style="padding-left:44px">' + s7Detail() + '</div></div></div>'; },
        pc: function () {
          return '<div data-anim="s7" style="flex:1;display:flex;flex-direction:column">' + topB() + '<div class="pcbody"><div class="thread" style="padding:0">' + s7Thread(true) + '</div><aside class="panel"><h2>이 문제</h2>' + badge('ok', '해결됐어요') + '<p style="margin:0">평소 1.1초 → 최근 30분 3.4초 (24건)<br><span style="color:var(--ink-2);font-size:14px">오늘 14:05 시작, 15:32 해결</span></p>' + s7Detail() + '</aside></div></div>';
        }
      }
    ],
    spec: {
      concept: '쉽앤핑 양이 메신저처럼 먼저 상황을 말해 주고, 사용자는 답 단추로 다음 행동을 고른다. 처음 쓰는 사람도 "누가 무엇을 해 주는지"가 분명하다.',
      motion: '새 말풍선이 8px 아래에서 떠오르며 나타남(0.26초, ease-out). 첫 기록 도착: 대기 말풍선 글자가 겹쳐 바뀜(0.2초) → 기능 단추 말풍선 0.7초 뒤. 해결: 점 15개가 0.026초 간격으로 채워지고 양 아이콘 둘레 민트 고리가 한 번 퍼짐(0.7초, 반복 없음). 동작 줄이기 설정이면 0.15초 투명도만, 고리 없음.',
      colors: '<span class="swatch" style="background:#EEE8FB"></span>바탕 라벤더 안개 #EEE8FB · <span class="swatch" style="background:#261B40"></span>글자·내 답 #261B40 · <span class="swatch" style="background:#C3A6FF"></span>어두운 모드 버튼 #C3A6FF · <span class="swatch" style="background:#76E7C4"></span>괜찮아요 민트 #76E7C4, 글자 #0B6B50 · <span class="swatch" style="background:#FFE0E8"></span>문제 있어요 장미색 바탕 #FFE0E8, 글자 #A3123F(어두운 모드 #FF9DB5) · <span class="swatch" style="background:#E9E3F5"></span>기록을 기다려요 #5C5274',
      fonts: '제목·양의 강조 말 Jua(Google Fonts, SIL OFL 1.1), 본문 Gowun Dodum(Google Fonts, SIL OFL 1.1). 두 글꼴 모두 굵기 한 가지라 강조는 굵게 대신 Jua로',
      type: '13 / 14 / 16(본문) / 19 / 21(말풍선 제목). 본문 줄 간격 1.6',
      space: '말풍선 사이 14px, 말풍선 안 12×14px, 화면 가장자리 14px(휴대폰), PC 32px. 답 단추 높이 48px',
      radius: '말풍선 20(꼬리 쪽 6) · 타일 16 · 단추 16·24(알약)',
      shadow: '밝은 모드 말풍선만 0 6px 18px -8px rgba(38,27,64,.25). 어두운 모드는 그림자 대신 바탕 명도',
      contrast: '본문 #261B40/#FFFFFF 16.0:1 · 보조 #5C5274/#FFFFFF 7.2:1 · 문제 #A3123F/#FFE0E8 6.3:1 · 괜찮아요 #0B6B50/#D9F7EC 5.7:1 · 문제 막대(그래픽) #E0456F/#E9E3F5 3.2:1 · 어두운 모드 본문 #F5F1FF/#2F2452 12.6:1, 문제 #FF9DB5/#2F2452 7.2:1 (WCAG 공식으로 색 값 계산, 브라우저 미확인)',
      risk: '난이도 중간~높음. 대화형 배치는 기능이 많아지면 스크롤이 길어지고 원하는 기능을 찾기 어렵다. 양이 말하는 문장을 상황마다 틀로 만들어야 하고(문구 작업량↑), 말투가 반복되면 금방 질린다. 마스코트를 더 크게·여러 표정으로 쓰려면 <b>투명 배경 버전 필요</b>(지금은 퍼플 배경 아이콘 타일로만 사용). 한글 글꼴 두 개라 첫 로딩이 가장 무겁다',
      rank: '<b>3순위</b> — 브랜드 개성과 첫 사용 안내는 가장 좋지만, 매일 확인하는 화면으로는 훑어보기가 느리다. 연결하기(S4)·빈 화면·해결 축하처럼 드문 순간에만 이 말투를 빌려 쓰는 것을 권한다'
    }
  };
})(window.SP);
