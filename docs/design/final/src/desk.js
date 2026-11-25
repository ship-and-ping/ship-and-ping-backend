/* ===== 쉽앤핑 PC 화면 틀 (D4: PC 브라우저가 기준 화면) =====
   왼쪽 메뉴(내 앱 / 알림 설정 / 내 계정, 맨 아래 로그아웃) + 오른쪽 본문(최대 폭 1080px).
   앱을 고르면 "내 앱" 아래에 앱 안 메뉴(홈·기능·문제·설정)가 펼쳐진다.
   화면마다 e.pc()가 있으면 그 본문을 쓰고, 없으면 휴대폰 내용(e.mobile())을 본문 폭에 맞춰 넣는다(휴대폰 머리말은 숨김). */
(function (SP) {
  var ic = SP.ic, esc = SP.esc;
  var APP_HREF = { '모임모아': 's9', '독서노트': 's9-dokseo', '우리동네 장터': 's9-none' };

  /* 화면 id → 어느 메뉴에 있는 화면인지, 제목, 경로 */
  SP.navOf = function (id) {
    var n = { kind: 'app', top: 'apps', app: '모임모아', tab: null, crumb: ['내 앱', '모임모아'], title: '', narrow: false, path: '/apps/moim' };
    var m = function (o) { for (var k in o) n[k] = o[k]; return n; };
    if (id === 's0') return m({ kind: 'landing', path: '/' });
    if (id === 's1' || /^s11-(done|logout)/.test(id)) return m({ kind: 'public', path: id === 's1' ? '/login' : '/' });
    if (id === 's2') return m({ app: null, crumb: [], title: '내 앱', path: '/apps' });
    if (id === 's3') return m({ app: null, crumb: ['내 앱'], title: '앱 등록', narrow: true, path: '/apps/new' });
    if (/^s4/.test(id)) return m({ tab: 'home', title: '연결하기', path: '/apps/moim/connect' });
    if (/^s5/.test(id)) return m({ tab: 'home', title: '홈' });
    if (/^s6/.test(id)) return m({ tab: 'features', crumb: ['내 앱', '모임모아', '기능'], title: '분석', path: '/apps/moim/features/analyze' });
    if (/^s7/.test(id)) return m({ tab: 'problems', crumb: ['내 앱', '모임모아', '문제'], title: '분석이 느려졌어요', path: '/apps/moim/problems/42' });
    if (id === 's8') return m({ tab: 'features', crumb: ['내 앱', '모임모아', '기능'], title: '깊게 볼 기능 추가', narrow: true, path: '/apps/moim/features/deep/new' });
    if (/^s8/.test(id)) return m({ tab: 'features', crumb: ['내 앱', '모임모아', '기능'], title: '모임 신청 (깊게 보기)', path: '/apps/moim/features/deep-1' });
    if (/^s9/.test(id)) { var a = id === 's9-dokseo' ? '독서노트' : id === 's9-none' ? '우리동네 장터' : '모임모아'; return m({ top: 'alerts', app: a, crumb: [], title: '알림 설정', narrow: true, picker: true, path: '/alerts' }); }
    if (id === 's10') return m({ tab: 'settings', title: '앱 설정', narrow: true, path: '/apps/moim/settings' });
    if (/^s10/.test(id)) return m({ tab: 'settings', crumb: ['내 앱', '모임모아', '설정'], title: '기능 이름표', path: '/apps/moim/settings/names' });
    if (/^s11-delete/.test(id)) return m({ top: 'account', app: null, crumb: ['내 계정'], title: '회원 탈퇴', narrow: true, path: '/account/delete' });
    if (/^s11/.test(id)) return m({ top: 'account', app: null, crumb: [], title: '내 계정', path: '/account' });
    return n;
  };

  var nv = function (href, icn, t, cur) { return '<a class="nv" href="#' + href + '"' + (cur ? ' aria-current="page"' : '') + '>' + ic[icn](20) + '<span>' + t + '</span></a>'; };
  /* 왼쪽 메뉴. 키보드 순서: 로고 → 내 앱 → (앱 안 메뉴) → 알림 설정 → 내 계정 → 로그아웃 → 본문 */
  SP.side = function (n) {
    var inApp = n.top === 'apps' && n.app;
    var sub = inApp ? '<div class="sub" role="group" aria-label="' + n.app + ' 메뉴"><span class="appname">' + n.app + '</span>' +
      nv('s5', 'home', '홈', n.tab === 'home') + nv('s6', 'list', '기능', n.tab === 'features') + nv('s7-open', 'bad', '문제 <span class="cnt" aria-label="열린 문제 1개">1</span>', n.tab === 'problems') + nv('s10', 'gear', '설정', n.tab === 'settings') + '</div>' : '';
    return '<nav class="sp-side" aria-label="쉽앤핑 메뉴"><a class="brand" href="#s2"><img class="sp-tile" src="' + SP.IMG.wordmark + '" alt="" width="30" height="30">쉽앤핑</a>' +
      nv('s2', 'apps', '내 앱', n.top === 'apps' && !inApp) + sub +
      nv('s9', 'bell', '알림 설정', n.top === 'alerts') + nv('s11', 'user', '내 계정', n.top === 'account') +
      '<span class="grow"></span><button class="nv" data-go="s11-logout">' + ic.exit(20) + '<span>로그아웃</span></button></nav>';
  };
  /* 본문 맨 위: 경로(작게) + 제목. 알림 설정은 앱 고르기 */
  SP.ptitle = function (n) {
    var crumb = n.crumb.length ? '<p class="crumb">' + n.crumb.map(esc).join(' › ') + '</p>' : '';
    var picker = n.picker ? '<div class="sp-seg" role="group" aria-label="알림을 정할 앱">' + ['모임모아', '독서노트', '우리동네 장터'].map(function (a) { return '<a href="#' + APP_HREF[a] + '"' + (a === n.app ? ' aria-current="page"' : '') + '>' + a + '</a>'; }).join('') + '</div>' : '';
    return '<header class="sp-ptitle">' + crumb + '<h1>' + n.title + '</h1>' + picker + '</header>';
  };
  /* 로그인 전 화면 맨 위 줄 */
  SP.pubbar = function () { return '<header class="sp-pubbar"><a class="brand" href="#s0"><img class="sp-tile" src="' + SP.IMG.wordmark + '" alt="" width="34" height="34">쉽앤핑</a><span class="grow"></span><a class="sp-btn text" href="#s1">로그인</a><a class="sp-btn" href="#s1" style="text-decoration:none">시작하기</a></header>'; };

  /* 화면 하나의 PC 내용 */
  SP.deskHtml = function (e) {
    var n = SP.navOf(e.id);
    if (n.kind === 'landing') return e.pc();
    var main = e.pc ? e.pc() : '<div class="sp-body' + (n.narrow ? ' narrow' : '') + '">' + e.mobile() + '</div>';
    if (n.kind === 'public') return '<div class="sp-public">' + SP.pubbar() + '<main class="sp-wrap pub">' + main + '</main></div>';
    return '<div class="sp-desk">' + SP.side(n) + '<main class="sp-main"><div class="sp-wrap">' + SP.ptitle(n) + main + '</div></main></div>';
  };
  SP.deskPath = function (e) { return e.path || SP.navOf(e.id).path; };
})(window.SP);
