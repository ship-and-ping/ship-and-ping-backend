/* ===== 시안 A — 조용한 상태 보드: 화면 3장 ===== */
(function (SP) {
  var D = SP.D, ic = SP.ic, P = D.problem, esc = SP.esc;
  var tile = function (s) { return '<img class="tile" src="' + SP.IMG.sheep + '" alt="" width="' + (s || 32) + '" height="' + (s || 32) + '" style="width:' + (s || 32) + 'px;height:' + (s || 32) + 'px">'; };
  var pill = function (st, txt) { return '<span class="pill ' + st + '">' + ic[st](16) + txt + '</span>'; };
  var stTxt = { ok: '괜찮아요', bad: '문제 있어요', wait: '기록을 기다려요' };

  function stepsA() {
    return '<ol class="steps" aria-label="연결 단계, 4단계 모두 끝남">' + ['요청문 복사', '코딩 AI가 연결', '배포', '앱 써 보기'].map(function (t) { return '<li><i></i><span>' + ic.check(12) + ' ' + t + '</span></li>'; }).join('') + '</ol>';
  }
  function namesA() {
    return '<ul class="names">' + D.features.map(function (f, i) {
      var id = 'an' + (SP.uid = (SP.uid || 0) + 1); /* 같은 화면을 여러 번 그리므로 id가 겹치지 않게 */
      return '<li class="rise" style="--i:' + i + '"><div class="r1"><label class="sr" for="' + id + '">' + esc(f.name) + ' 기능 이름 고치기</label><input id="' + id + '" value="' + esc(f.name) + '"><button class="ibtn" aria-label="' + esc(f.name) + ' 숨기기">' + ic.eyeoff(18) + '</button></div>' +
        '<details><summary>자세히</summary><code>' + esc(f.route) + '</code></details></li>';
    }).join('') + '</ul>';
  }
  function unnamedA() {
    return '<div class="card sec rise" style="--i:9"><p><b>이름 없는 기능 1개</b></p><p class="small">코딩 AI가 이름을 붙이지 않은 주소예요. 이름을 붙이면 알림에 그 이름이 나와요.</p>' +
      '<details><summary>자세히</summary><code>' + D.unnamed.route + ' (지금까지 ' + D.unnamed.uses + '건)</code></details><button class="btn ghost">' + ic.pen(16) + '이름 붙이기</button></div>';
  }
  function arrivedHead(big) {
    return '<div class="stline"><span class="swap">' + '<span class="from">' + pill('wait', '첫 기록을 기다려요') + '</span><span class="to">' + pill('ok', '기록이 도착했어요') + '</span></span><span class="small">오늘 13:42</span></div>' +
      '<h1 class="' + (big ? 'pc-h1' : '') + '">기능 8개를 찾았어요</h1><p class="sub">코딩 AI가 붙인 이름이에요. 맞지 않는 이름은 고치고, 지켜보지 않을 기능은 숨기세요. 알림에는 이 이름이 쓰여요.</p>';
  }

  function featListA() {
    return '<ul class="flist">' + D.features.map(function (f) {
      var tm = f.st === 'wait' ? '<span class="tm"><small>아직 없어요</small></span>' : f.learning ? '<span class="tm"><small>평소 속도<br>익히는 중</small></span>' : '<span class="tm">' + f.now + '<small>평소 ' + f.usual + '</small></span>';
      var meta = f.st === 'wait' ? '아직 사용 기록이 없어요' : f.learning ? f.learning : '사용 ' + f.uses.toLocaleString() + '건, 실패 ' + f.fail + '건';
      return '<li><span class="si ' + f.st + '" title="' + stTxt[f.st] + '">' + ic[f.st](20) + '<span class="sr">' + stTxt[f.st] + '</span></span><span class="nm">' + f.name + (f.deep ? '<span class="tag">깊게 보는 중</span>' : '') + '</span><span class="meta">' + meta + '</span>' + tm + '</li>';
    }).join('') + '<li><span class="si wait">' + ic.pen(18) + '</span><span class="nm">이름 없는 기능 1개</span><span class="meta"><button class="link">이름 붙이기</button></span><span class="tm"><small>3건</small></span></li></ul>';
  }
  function probA() {
    return '<div class="prob"><span>' + pill('bad', '문제 있어요') + '</span><p class="big">' + P.title + '</p><p class="nums">평소 <b>' + P.usual + '</b> → 최근 30분 <b>' + P.recent + '</b> (' + P.count + '건)</p><p class="small" style="color:inherit;opacity:.85">' + P.since + ' 지켜보고 있어요. 슬랙으로 알림을 보냈어요.</p><button class="btn full">문제 살펴보고 AI에 맡기기</button></div>';
  }

  function verifyA() {
    var m = ''; for (var i = 0; i < 15; i++) m += '<i style="--i:' + i + '"></i>';
    return '<div class="card sec"><h2>업데이트 후 확인</h2><div class="marks" aria-hidden="true">' + m + '</div><p style="font-weight:600;font-size:17px">' + P.resolved + '</p><p class="small">15:10에 새 버전을 감지했고, 그 뒤 실제 사용 15건을 확인했어요.</p></div>';
  }
  function aiA() {
    return '<div class="card sec"><h2>코딩 AI에게 맡기기</h2><p class="small">기능 이름, 시작 시각, 버전, 오류 기록을 담은 조사 요청이에요. 개인정보와 키는 빼고 담았어요.</p>' +
      '<button class="btn full" data-copy="ai">' + ic.copy(18) + '<span class="lbl">AI에 보낼 내용 복사</span></button>' +
      '<details><summary>보낼 내용 미리 보기</summary><pre>' + esc(SP.aiText()) + '</pre></details></div>';
  }
  function tlA() {
    return '<div class="card sec"><h2>지금까지</h2><ol class="tl">' + P.timeline.map(function (t) { return '<li><time>' + t[0] + '</time><span><b>' + t[1] + '</b><br><span class="small">' + t[2] + '</span></span></li>'; }).join('') + '</ol>' +
      '<details><summary>자세히</summary><code>POST /api/analyze<br>버전 ' + P.oldVer + ' → ' + P.badVer + '(문제) → ' + P.newVer + '(해결)<br>' + P.errors.join('<br>') + '</code></details></div>';
  }
  function s7Head(big) {
    return '<div class="stline"><span class="swap"><span class="from">' + pill('bad', '문제 있어요') + '</span><span class="to">' + pill('ok', '해결됐어요') + '</span></span><span class="small">오늘 15:32 확인</span></div>' +
      '<h1 class="' + (big ? 'pc-h1' : '') + '">' + P.title + '</h1><p class="nums sub">평소 <b>' + P.usual + '</b> → 최근 30분 <b>' + P.recent + '</b> (' + P.count + '건), 오늘 14:05 시작</p>';
  }
  function sideA(cur) {
    var items = [['apps', '내 앱'], ['ok', '모임모아'], ['bell', '알림 설정'], ['gear', '앱 설정']];
    return '<nav class="side" aria-label="주 메뉴"><div class="brand">' + tile(30) + '쉽앤핑</div><div class="nav">' + items.map(function (x, i) { return '<a href="#"' + (i === cur ? ' aria-current="page"' : '') + '>' + ic[x[0]](18) + x[1] + '</a>'; }).join('') + '</div></nav>';
  }

  SP.opts.a = {
    name: '시안 A', title: '조용한 상태 보드',
    screens: [
      {
        id: 's4', title: '① S4 연결 — 첫 기록 도착과 기능 이름표 확인', path: '/apps/moim/connect', replay: 's4',
        desc: '연결 4단계가 모두 끝나고 첫 기록이 도착한 순간. 상태 표시가 "첫 기록을 기다려요"에서 "기록이 도착했어요"로 바뀌고, 찾은 기능 이름이 한 줄씩 나타난다.',
        mobile: function () {
          return '<div data-anim="s4" style="display:flex;flex-direction:column;flex:1"><header class="hdr"><button class="ibtn" aria-label="내 앱 목록으로">' + ic.back(22) + '</button><span class="t">모임모아 연결하기</span></header>' +
            '<div class="wrap">' + stepsA() + arrivedHead() + '<div class="card">' + namesA() + '</div>' + unnamedA() +
            '<div><button class="btn full">이 이름으로 지켜보기</button><p class="small" style="text-align:center;margin-top:8px">이름은 나중에 앱 설정에서도 고칠 수 있어요</p></div></div></div>';
        },
        pc: function () {
          return '<div data-anim="s4" style="display:flex;flex:1">' + sideA(1) + '<main class="main"><div class="cols"><div style="display:flex;flex-direction:column;gap:16px">' + arrivedHead(true) + '<div class="card">' + namesA() + '</div><div style="display:flex;gap:12px;align-items:center"><button class="btn">이 이름으로 지켜보기</button><span class="small">이름은 나중에 앱 설정에서도 고칠 수 있어요</span></div></div>' +
            '<aside style="display:flex;flex-direction:column;gap:16px"><div class="card sec"><h2>연결 단계</h2>' + stepsA() + '<p class="small">4단계를 모두 마쳤어요.</p></div>' + unnamedA() + '</aside></div></main></div>';
        }
      },
      {
        id: 's5', title: '② S5 앱 홈 — 열린 문제 1개와 기능 목록', path: '/apps/moim',
        desc: '맨 위에 열린 문제 한 개, 그 아래 최근 24시간 사용이 많은 순서의 기능 목록. 상태는 색·모양 아이콘·글자를 함께 써서 색을 구분하기 어려워도 읽힌다.',
        mobile: function () {
          return '<header class="hdr">' + tile() + '<span class="t">모임모아</span><button class="ibtn" aria-label="알림 설정">' + ic.bell(20) + '</button><button class="ibtn" aria-label="앱 설정">' + ic.gear(20) + '</button></header>' +
            '<div class="wrap"><div class="stline"><span class="small">마지막 기록 1분 전</span></div>' + probA() +
            '<div style="display:flex;justify-content:space-between;align-items:baseline"><h2>기능 8개</h2><span class="small">최근 24시간, 사용 많은 순</span></div><div class="card">' + featListA() + '</div>' +
            '<button class="btn ghost full">' + ic.plus(18) + '깊게 볼 기능 추가</button></div>';
        },
        pc: function () {
          var rows = D.features.map(function (f) {
            var tm = f.st === 'wait' ? '<span class="small">아직 없어요</span>' : f.learning ? '<span class="small">' + f.learning + '</span>' : '<b>' + f.now + '</b>';
            return '<tr><td><span class="pill ' + f.st + '" style="height:26px">' + ic[f.st](15) + stTxt[f.st] + '</span></td><td><b>' + f.name + '</b>' + (f.deep ? '<span class="tag">깊게 보는 중</span>' : '') + '</td><td class="n">' + f.uses.toLocaleString() + '건</td><td class="n">' + f.fail + '건</td><td class="n">' + tm + '</td><td class="n small">' + (f.usual ? f.usual : (f.learning ? '익히는 중' : '—')) + '</td></tr>';
          }).join('');
          return sideA(1) + '<main class="main"><div class="stline"><h1 class="pc-h1" style="flex:1">모임모아</h1><span class="small">마지막 기록 1분 전</span><button class="btn ghost">' + ic.plus(18) + '깊게 볼 기능 추가</button></div>' +
            '<div class="cols"><div style="display:flex;flex-direction:column;gap:20px">' + probA().replace('btn full', 'btn').replace('<div class="prob">', '<div class="prob" style="align-items:flex-start">') +
            '<div class="card"><table class="ftable"><caption class="sr">기능 8개, 최근 24시간 사용 많은 순</caption><thead><tr><th>상태</th><th>기능</th><th class="n">사용</th><th class="n">실패</th><th class="n">최근 보통 시간</th><th class="n">평소</th></tr></thead><tbody>' + rows +
            '<tr><td><span class="pill wait" style="height:26px">' + ic.pen(15) + '이름 없음</span></td><td>이름 없는 기능 1개 <button class="link" style="min-height:24px;margin-left:6px">이름 붙이기</button></td><td class="n">3건</td><td class="n">0건</td><td></td><td></td></tr></tbody></table></div></div>' +
            '<aside style="display:flex;flex-direction:column;gap:16px"><div class="card sec"><h2>알림 받는 곳</h2><p>슬랙 <b>#모임모아-알림</b></p><p class="small">문제가 생기면 한 번, 해결되면 한 번 보내요.</p></div><div class="card sec"><h2>최근 업데이트</h2><p>어제 18:20 새 버전</p><details><summary>자세히</summary><code>' + P.badVer + '</code></details></div></aside></div></main>';
        }
      },
      {
        id: 's7', title: '③ S7 문제 상세 — AI에 보낼 내용 복사와 해결 확인', path: '/apps/moim/problems/42', replay: 's7',
        desc: '고친 버전이 배포된 뒤 실제 사용 15건이 모두 평소 속도로 끝나 "해결됐어요"로 바뀐 상태. 15칸이 차례로 채워지고 상태 표시가 바뀐다. 복사 버튼은 누르면 "복사했어요"로 바뀌고 화면 읽기 프로그램에도 알린다.',
        mobile: function () {
          return '<div data-anim="s7" style="display:flex;flex-direction:column;flex:1"><header class="hdr"><button class="ibtn" aria-label="모임모아 홈으로">' + ic.back(22) + '</button><span class="t">문제 상세</span></header><div class="wrap">' + s7Head() + verifyA() + aiA() + tlA() + '</div></div>';
        },
        pc: function () {
          return '<div data-anim="s7" style="display:flex;flex:1">' + sideA(1) + '<main class="main"><p class="small"><a href="#" style="color:inherit">모임모아</a> › 문제 상세</p>' + s7Head(true) + '<div class="cols"><div style="display:flex;flex-direction:column;gap:16px">' + verifyA() + aiA().replace('btn full', 'btn') + '</div>' + tlA() + '</div></main></div>';
        }
      }
    ],
    spec: {
      concept: '현황판처럼 조용하게 정돈된 화면. 상태 한 줄과 기능 목록이 중심이고, 문제가 있을 때만 노란 카드가 올라온다.',
      motion: '드문 순간 두 곳만 움직인다. ① 첫 기록 도착: 상태 표시 글자가 0.2초 겹쳐 바뀌고(투명도), 기능 이름 줄이 4px 위로 떠오르며 0.04초 간격으로 나타남(0.24초, ease-out). ② 해결: 15칸이 0.024초 간격으로 채워진 뒤 상태 표시가 "해결됐어요"로 바뀜. 버튼은 누를 때 0.97로 살짝 눌림. 동작 줄이기 설정이면 위치 이동·간격 없이 0.15초 투명도만.',
      colors: '<span class="swatch" style="background:#261B40"></span>글자/버튼 #261B40 · <span class="swatch" style="background:#F6F4FA"></span>바탕 #F6F4FA · <span class="swatch" style="background:#C3A6FF"></span>라벤더 #C3A6FF(어두운 모드 버튼) · <span class="swatch" style="background:#76E7C4"></span>괜찮아요 민트 #76E7C4(채움), 글자 #0B6B50 · <span class="swatch" style="background:#FFEBCF"></span>문제 있어요 호박색 바탕 #FFEBCF, 글자 #9A4A00(어두운 모드 #FFB861) · <span class="swatch" style="background:#ECE8F3"></span>기록을 기다려요 회보라 #5A5170',
      fonts: 'IBM Plex Sans KR 400·500·600·700 (Google Fonts, SIL Open Font License 1.1). 숫자는 고정폭 숫자(tnum)로 세로 줄이 맞게. 코드·주소는 기기 기본 고정폭 글꼴',
      type: '휴대폰 13 / 15(본문) / 17 / 19 / 24, PC 13 / 15 / 17 / 19 / 30. 줄 간격 본문 1.55, 제목 1.3',
      space: '4의 배수: 4·8·12·16·20·24·36. 화면 가장자리 16px(휴대폰), 36px(PC). 누르는 곳 최소 44×44px',
      radius: '카드 12 · 입력/버튼 10·8 · 상태 표시 999(알약)',
      shadow: '그림자 없음. 테두리 1px(#E2DCEC)와 바탕 명도 차이로 층을 나눔',
      contrast: '본문 #261B40/#FFFFFF 16.0:1 · 보조 글자 #5A5170/#FFFFFF 7.4:1 · 문제 글자 #9A4A00/#FFEBCF 5.4:1 · 괜찮아요 #0B6B50/#DDF8EF 5.8:1 · 어두운 모드 본문 #F3EFFC/#221838 14.8:1, 민트 #76E7C4/#221838 11.1:1, 호박 #FFB861/#221838 9.8:1 (WCAG 공식으로 색 값 계산, 브라우저 미확인)',
      risk: '난이도 낮음. 표·목록·알약 표시 같은 흔한 부품이라 React로 옮기기 쉽고 기능이 20개로 늘어도 버틴다. 위험: 브랜드 개성이 약해 "흔한 관리 화면"처럼 보일 수 있다. 마스코트는 아이콘 타일로만 쓰므로 투명 버전이 필요 없다',
      rank: '<b>2순위</b> — 가장 안전하고 기능이 많아져도 읽기 쉽다. 다만 알림을 받고 휴대폰으로 열었을 때 "무엇이 문제인지"가 C만큼 즉시 크게 보이지 않는다'
    }
  };
})(window.SP);
