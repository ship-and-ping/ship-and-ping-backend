/* ===== 쉽앤핑 PC 화면 틀 (D4: PC 브라우저가 기준 화면) =====
   너비에 따라 배치가 바뀐다(design-system.md 10.1):
     PC ≥1024     왼쪽 메뉴 + 오른쪽 본문(최대 폭 1080px)
     태블릿 640~1023  왼쪽 메뉴를 접고 위쪽 줄 [메뉴]로 펼침, 본문 한 열
     휴대폰 <640   휴대폰 화면 그대로
   앱을 고르면 "내 앱" 아래에 그 앱의 메뉴(홈·기능·문제·설정)가 펼쳐진다. 앱 이름·열린 문제 수는 고른 앱을 따른다.
   화면마다 e.pc()가 있으면 그 본문을 쓰고, 없으면 휴대폰 내용(e.mobile())을 본문 폭에 맞춰 넣는다(휴대폰 머리말은 숨김). */
(function (SP) {
  var ic = SP.ic, esc = SP.esc;
  /* 앱마다 화면 id와 열린 문제 수. 독서노트·우리동네 장터는 홈 화면만 그렸고, 기능·문제·설정은 모임모아와 같은 틀이라 홈으로 둔다 */
  var APPS = {
    '모임모아': { slug: 'moim', home: 's5', feat: 's6', prob: 's7-open', set: 's10', alert: 's9', probs: 1 },
    '독서노트': { slug: 'dokseo', home: 's5-dokseo', feat: 's5-dokseo', prob: 's5-dokseo', set: 's5-dokseo', alert: 's9-dokseo', probs: 0 },
    '우리동네 장터': { slug: 'jangteo', home: 's5-jangteo', feat: 's5-jangteo', prob: 's5-jangteo', set: 's5-jangteo', alert: 's9-none', probs: 0 }
  };
  SP.APPS = APPS;

  /* 화면 → 어느 메뉴에 있는 화면인지, 앱, 제목, 경로. e.app·e.probs가 있으면 그것을 따른다 */
  SP.navOf = function (id, e) {
    e = e || {};
    var app = e.app || '모임모아';
    var n = { kind: 'app', top: 'apps', app: app, tab: null, crumb: ['내 앱', app], title: '', narrow: false, path: '/apps/' + APPS[app].slug };
    var m = function (o) { for (var k in o) n[k] = o[k]; return n; };
    if (id === 's0') return m({ kind: 'landing', path: '/' });
    if (id === 's1' || /^s11-(done|logout)/.test(id)) return m({ kind: 'public', path: id === 's1' ? '/login' : '/' });
    if (/^s2/.test(id)) return m({ app: null, crumb: [], title: '내 앱', path: '/apps' });
    if (id === 's3') return m({ app: null, crumb: ['내 앱'], title: '앱 등록', narrow: true, path: '/apps/new' });
    if (/^s4/.test(id)) return m({ tab: 'home', title: '연결하기', path: n.path + '/connect' });
    if (/^s5/.test(id)) return m({ tab: 'home', title: '홈' });
    if (/^s6/.test(id)) return m({ tab: 'features', crumb: ['내 앱', app, '기능'], title: '분석', path: n.path + '/features/analyze' });
    if (/^s7/.test(id)) return m({ tab: 'problems', crumb: ['내 앱', app, '문제'], title: '분석이 느려졌어요', path: n.path + '/problems/42' });
    if (id === 's8') return m({ tab: 'features', crumb: ['내 앱', app, '기능'], title: '깊게 볼 기능 추가', narrow: true, path: n.path + '/features/deep/new' });
    if (/^s8/.test(id)) return m({ tab: 'features', crumb: ['내 앱', app, '기능'], title: '모임 신청 (깊게 보기)', path: n.path + '/features/deep-1' });
    if (/^s9/.test(id)) { var a = id === 's9-dokseo' ? '독서노트' : id === 's9-none' ? '우리동네 장터' : '모임모아'; return m({ top: 'alerts', app: a, crumb: [], title: '알림 설정', narrow: true, picker: true, path: '/alerts/' + APPS[a].slug }); }
    if (id === 's10') return m({ tab: 'settings', title: '앱 설정', narrow: true, path: n.path + '/settings' });
    if (/^s10/.test(id)) return m({ tab: 'settings', crumb: ['내 앱', app, '설정'], title: '기능 이름표', path: n.path + '/settings/names' });
    if (/^s11-delete/.test(id)) return m({ top: 'account', app: null, crumb: ['내 계정'], title: '회원 탈퇴', narrow: true, path: '/account/delete' });
    if (/^s11/.test(id)) return m({ top: 'account', app: null, crumb: [], title: '내 계정', path: '/account' });
    return n;
  };

  var nv = function (href, icn, t, cur) { return '<a class="nv" href="#' + href + '"' + (cur ? ' aria-current="page"' : '') + '>' + ic[icn](20) + '<span>' + t + '</span></a>'; };
  /* 왼쪽 메뉴. 키보드 순서: 로고 → 내 앱 → (앱 안 메뉴) → 알림 설정 → 내 계정 → 로그아웃 → 본문
     probs: 지금 화면 기준 열린 문제 수(0이면 숫자를 쓰지 않음). tabId: 태블릿에서 접을 때 쓰는 id */
  SP.side = function (n, probs, sideId) {
    var inApp = n.top === 'apps' && n.app, A = inApp ? APPS[n.app] : null;
    var cnt = probs > 0 ? ' <span class="cnt" aria-label="열린 문제 ' + probs + '개">' + probs + '</span>' : '';
    var sub = inApp ? '<div class="sub" role="group" aria-label="' + n.app + ' 메뉴"><span class="appname">' + n.app + '</span>' +
      nv(A.home, 'home', '홈', n.tab === 'home') + nv(A.feat, 'list', '기능', n.tab === 'features') + nv(A.prob, 'bad', '문제' + cnt, n.tab === 'problems') + nv(A.set, 'gear', '설정', n.tab === 'settings') + '</div>' : '';
    return '<nav class="sp-side" aria-label="쉽앤핑 메뉴"' + (sideId ? ' id="' + sideId + '" hidden' : '') + '><a class="brand" href="#s2"><img class="sp-tile" src="' + SP.IMG.wordmark + '" alt="" width="30" height="30">쉽앤핑</a>' +
      nv('s2', 'apps', '내 앱', n.top === 'apps' && !inApp) + sub +
      nv(n.app && n.top !== 'account' ? APPS[n.app].alert : 's9', 'bell', '알림 설정', n.top === 'alerts') + nv('s11', 'user', '내 계정', n.top === 'account') +
      '<span class="grow"></span><button class="nv" data-go="s11-logout">' + ic.exit(20) + '<span>로그아웃</span></button></nav>';
  };
  /* 본문 맨 위: 경로(작게) + 제목. 알림 설정은 앱 고르기 */
  SP.ptitle = function (n) {
    var crumb = n.crumb.length ? '<p class="crumb">' + n.crumb.map(esc).join(' › ') + '</p>' : '';
    var picker = n.picker ? '<div class="sp-seg" role="group" aria-label="알림을 정할 앱">' + Object.keys(APPS).map(function (a) { return '<a href="#' + APPS[a].alert + '"' + (a === n.app ? ' aria-current="page"' : '') + '>' + a + '</a>'; }).join('') + '</div>' : '';
    return '<header class="sp-ptitle">' + crumb + '<h1>' + n.title + '</h1>' + picker + '</header>';
  };
  /* 로그인 전 화면 맨 위 줄 */
  SP.pubbar = function () { return '<header class="sp-pubbar"><a class="brand" href="#s0"><img class="sp-tile" src="' + SP.IMG.wordmark + '" alt="" width="34" height="34">쉽앤핑</a><span class="grow"></span><a class="sp-btn text" href="#s1">로그인</a><a class="sp-btn" href="#s1" style="text-decoration:none">시작하기</a></header>'; };

  /* 화면 하나를 창 너비 w에 맞춰 그린다 */
  SP.deskHtml = function (e, w) {
    w = w || 1440;
    var n = SP.navOf(e.id, e);
    if (w < 640) return '<div class="sp-phonewrap">' + e.mobile() + '</div>';            /* 휴대폰 배치 */
    var tab = w < 1024;                                                                   /* 태블릿 배치 */
    if (n.kind === 'landing') return tab ? e.mobile() : e.pc();
    var main = e.pc ? e.pc.call(e) : '<div class="sp-body' + (n.narrow ? ' narrow' : '') + '">' + e.mobile() + '</div>';
    if (n.kind === 'public') return '<div class="sp-public' + (tab ? ' tab' : '') + '">' + SP.pubbar() + '<main class="sp-wrap pub">' + main + '</main></div>';
    var probs = e.probs != null ? e.probs : (n.app ? APPS[n.app].probs : 0);
    if (!tab) return '<div class="sp-desk">' + SP.side(n, probs) + '<main class="sp-main"><div class="sp-wrap">' + SP.ptitle(n) + main + '</div></main></div>';
    var sid = 'side' + (SP.uid = (SP.uid || 0) + 1);
    return '<div class="sp-desk tab"><header class="sp-tbar"><button class="sp-btn line sp-menu-btn" aria-expanded="false" aria-controls="' + sid + '">' + ic.menu(18) + '메뉴</button><a class="brand" href="#s2"><img class="sp-tile" src="' + SP.IMG.wordmark + '" alt="" width="28" height="28">쉽앤핑</a><span class="where">' + esc(n.app && n.top === 'apps' ? n.app : n.title) + '</span></header>' +
      SP.side(n, probs, sid) + '<main class="sp-main"><div class="sp-wrap">' + SP.ptitle(n) + main + '</div></main></div>';
  };
  SP.deskPath = function (e) { return e.path || SP.navOf(e.id, e).path; };
})(window.SP);
