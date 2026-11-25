/* ===== 시안 페이지 / 비교 페이지 초기화 ===== */
(function (SP) {
  /* 명도 대비(WCAG 2.x 상대 휘도) — 페이지를 열 때 브라우저가 직접 계산한다 */
  function lum(hex) { var h = hex.replace('#', ''); return [0, 2, 4].map(function (i) { var c = parseInt(h.substr(i, 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }).reduce(function (a, c, i) { return a + c * [0.2126, 0.7152, 0.0722][i]; }, 0); }
  SP.ratio = function (a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  SP.pairs = {
    a: [['본문', '#261B40', '#FFFFFF', 4.5], ['보조 글자', '#5A5170', '#FFFFFF', 4.5], ['보조 글자(바탕)', '#5A5170', '#F6F4FA', 4.5], ['문제 글자', '#9A4A00', '#FFEBCF', 4.5], ['괜찮아요 글자', '#0B6B50', '#DDF8EF', 4.5], ['기다려요 글자', '#5A5170', '#ECE8F3', 4.5], ['버튼 글자', '#FFFFFF', '#261B40', 4.5], ['어두운: 본문', '#F3EFFC', '#221838', 4.5], ['어두운: 보조', '#BDB3D6', '#221838', 4.5], ['어두운: 민트', '#76E7C4', '#221838', 4.5], ['어두운: 문제', '#FFB861', '#221838', 4.5], ['어두운: 버튼 글자', '#1B1230', '#C3A6FF', 4.5], ['상태 아이콘 민트 채움 위 진한 글자', '#13372B', '#76E7C4', 4.5]],
    b: [['본문(말풍선)', '#261B40', '#FFFFFF', 4.5], ['보조 글자', '#5C5274', '#FFFFFF', 4.5], ['보조 글자(바탕)', '#5C5274', '#EEE8FB', 4.5], ['문제 글자', '#A3123F', '#FFE0E8', 4.5], ['괜찮아요 글자', '#0B6B50', '#D9F7EC', 4.5], ['문제 막대(그래픽)', '#E0456F', '#E9E3F5', 3], ['괜찮아요 막대(그래픽)', '#76E7C4', '#E9E3F5', 1], ['내 답 단추 글자', '#FFFFFF', '#261B40', 4.5], ['어두운: 본문', '#F5F1FF', '#2F2452', 4.5], ['어두운: 보조', '#C4B9DE', '#2F2452', 4.5], ['어두운: 문제', '#FF9DB5', '#2F2452', 4.5], ['어두운: 민트', '#76E7C4', '#2F2452', 4.5], ['어두운: 버튼 글자', '#1C1433', '#C3A6FF', 4.5]],
    c: [['카드 큰 문장', '#FFFFFF', '#261B40', 4.5], ['카드 보조', '#CFC5E8', '#261B40', 4.5], ['카드 산호(문제)', '#FF8A65', '#261B40', 4.5], ['카드 민트(괜찮아요)', '#76E7C4', '#261B40', 4.5], ['카드 버튼 글자', '#261B40', '#C3A6FF', 4.5], ['본문', '#1E1535', '#FAF9FC', 4.5], ['보조 글자', '#5D5673', '#FAF9FC', 4.5], ['문제 글자', '#B3261E', '#FAF9FC', 4.5], ['괜찮아요 글자', '#0B6B50', '#FAF9FC', 4.5], ['어두운: 본문', '#F1EDF9', '#0F0A1C', 4.5], ['어두운: 보조', '#B8AED0', '#0F0A1C', 4.5], ['어두운: 문제', '#FF8A65', '#0F0A1C', 4.5], ['어두운: 버튼 글자', '#1B1230', '#C3A6FF', 4.5]]
  };
  SP.contrastTable = function (keys) {
    var r = '<table class="spec-table"><caption class="sr">명도 대비 계산 결과</caption><thead><tr><th scope="col" style="width:auto">시안</th><th scope="col" style="width:auto">쓰는 곳</th><th scope="col" style="width:auto">글자 / 바탕</th><th scope="col" style="width:auto">대비</th><th scope="col" style="width:auto">기준</th></tr></thead><tbody>';
    var fails = 0;
    keys.forEach(function (k) {
      SP.pairs[k].forEach(function (p) {
        var v = SP.ratio(p[1], p[2]); var ok = v >= p[3]; if (!ok) fails++;
        r += '<tr><td>' + k.toUpperCase() + '</td><td>' + p[0] + '</td><td><span class="swatch" style="background:' + p[1] + '"></span>' + p[1] + ' / <span class="swatch" style="background:' + p[2] + '"></span>' + p[2] + '</td><td><b>' + v.toFixed(1) + ':1</b></td><td>' + (p[3] === 1 ? '장식(글자 없음, 옆에 글자로 값 표시)' : (p[3] === 3 ? '그래픽 3:1' : '글자 AA 4.5:1')) + ' ' + (ok ? '통과' : '<b>미달</b>') + '</td></tr>';
      });
    });
    return r + '</tbody></table><p class="note">미달 ' + fails + '건. 이 표는 페이지를 열 때 브라우저가 WCAG 2.x 공식으로 직접 계산한다.</p>';
  };

  var FONTS = 'A: IBM Plex Sans KR · B: Jua + Gowun Dodum · C: Noto Sans KR — 모두 Google Fonts, SIL Open Font License 1.1(무료, 상업 사용 가능)';

  SP.initOption = function () {
    var key = Object.keys(SP.opts)[0], o = SP.opts[key];
    document.title = '쉽앤핑 ' + o.name + ' ' + o.title;
    document.getElementById('top').innerHTML = '<h1>쉽앤핑 ' + o.name + ': ' + o.title + '</h1><p class="lead">' + o.spec.concept + '</p><p class="note">흐름 순서대로 화면 3장(S4 연결 → S5 앱 홈 → S7 문제 상세)을 휴대폰·PC, 밝은·어두운 모드로 그렸다. 예시 앱 이름은 "모임모아", 숫자는 PRD 4장 시나리오 문구다. 세 시안 비교는 같은 폴더의 compare.html.</p>' +
      '<h2>시안 설명</h2>' + SP.specTable(key) + '<h3>명도 대비</h3>' + SP.contrastTable([key]);
    SP.renderOption(key, document.getElementById('mount'));
    SP.themeSeg(function (v) {
      document.body.classList.toggle('hide-dark', v === 'light');
      document.body.classList.toggle('hide-light', v === 'dark');
      document.documentElement.setAttribute('data-page-theme', v === 'dark' ? 'dark' : 'light');
      SP.fit();
    });
  };

  SP.initCompare = function () {
    var keys = ['a', 'b', 'c'], theme = 'light', view = 'phone';
    function draw() {
      var out = '';
      [0, 1, 2].forEach(function (si) {
        var s0 = SP.opts.a.screens[si];
        out += '<section><h2>' + s0.title.replace(/^.\s/, (si + 1) + '. ') + '</h2>' + (s0.replay ? '<p><button class="pg-btn" data-replay="' + s0.replay + '">' + SP.ic.replay(14) + ' 세 시안 움직임 다시 보기</button></p>' : '') + '<div class="cgrid">';
        keys.forEach(function (k) {
          var o = SP.opts[k], s = o.screens[si];
          out += '<div class="ccol"><p class="ctitle"><b>' + o.name + '</b> ' + o.title + '</p>' + (view === 'phone' ? '<div class="ph-fit">' + SP.phone(k, theme, s.mobile(), o.name + ' ' + s.title) + '</div>' : SP.browser(k, theme, s.pc(), s.path, o.name + ' ' + s.title)) + '</div>';
        });
        out += '</div></section>';
      });
      document.getElementById('mount').innerHTML = out;
      document.querySelectorAll('[data-anim]').forEach(function (el) { el.classList.add('play'); });
      SP.fit(); SP.fitPhones();
    }
    var rows = [['콘셉트', 'concept'], ['추천 순위', 'rank'], ['움직임', 'motion'], ['색 토큰', 'colors'], ['글꼴', 'fonts'], ['글자 크기 단계', 'type'], ['간격', 'space'], ['모서리', 'radius'], ['그림자', 'shadow'], ['대비', 'contrast'], ['난이도·위험', 'risk']];
    var t = '<div style="overflow-x:auto"><table class="spec-table cmp-table"><thead><tr><th scope="col"></th>' + keys.map(function (k) { return '<th scope="col" style="width:auto">' + SP.opts[k].name + '<br><span style="font-weight:400">' + SP.opts[k].title + '</span></th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><th scope="row">' + r[0] + '</th>' + keys.map(function (k) { return '<td>' + SP.opts[k].spec[r[1]] + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
    document.getElementById('specs').innerHTML = t;
    document.getElementById('fonts').textContent = FONTS;
    document.getElementById('contrast').innerHTML = SP.contrastTable(keys);
    document.querySelectorAll('[data-pt]').forEach(function (b) { b.addEventListener('click', function () { document.querySelectorAll('[data-pt]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); theme = b.getAttribute('data-pt'); document.documentElement.setAttribute('data-page-theme', theme); draw(); }); });
    document.querySelectorAll('[data-view]').forEach(function (b) { b.addEventListener('click', function () { document.querySelectorAll('[data-view]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); view = b.getAttribute('data-view'); document.body.classList.toggle('view-pc', view === 'pc'); draw(); }); });
    var mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    if (mq && mq.matches) { var db = document.querySelector('[data-pt="dark"]'); if (db) { db.click(); return; } }
    draw();
  };
  SP.fitPhones = function () {
    document.querySelectorAll('.ph-fit').forEach(function (w) { var f = w.querySelector('.phone'); if (!f) return; f.style.zoom = Math.min(1, w.clientWidth / 414); });
  };
  window.addEventListener('resize', function () { SP.fitPhones && SP.fitPhones(); });
})(window.SP);
