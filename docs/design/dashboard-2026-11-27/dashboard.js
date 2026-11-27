(function dashboard(){
  const {records, snapshotEnd, featureNames, series, aggregate, day} = globalThis.dashboardFixture;
  const option = document.body.dataset.option;
  const params = new URLSearchParams(location.search);
  const theme = params.get("theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.dataset.theme = theme;
  const page = params.get("screen") || "home";
  const key = Object.hasOwn(featureNames,params.get("feature")) ? params.get("feature") : "other";
  const name = page==="home"?"전체 기능":featureNames[key];
  const days = params.get("days") === "7" ? 7 : 1;
  const atHome=page==="home";
  const scenario=atHome&&["empty","loading","healthy"].includes(params.get("state"))?params.get("state"):"problem";
  const preview=atHome&&scenario!=="problem";
  const points = series(key,days).map(p=>atHome?{...p,...aggregate(records.filter(r=>r.at>=p.from&&r.at<p.until))}:p);
  const current = (id,period=1) => aggregate(records.filter(r=>r.feature===id && r.at>=snapshotEnd-period*day));
  const snap = "11월 27일 18:00 기준";
  const paths = {
    alerts:"M5 16h14l-2-3V9a5 5 0 0 0-10 0v4z M10 20h4", home:"M3 11 12 4l9 7v10h-6v-7H9v7H3z", features:"M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    issue:"M12 3 2 21h20z M12 9v5 M12 17v1", ok:"m4 12 5 5L20 6", next:"m9 5 7 7-7 7",
    theme:"M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11z", clock:"M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5l4 2", compare:"M3 4h18v16H3z M12 4v16"
  };
  const icon = (id) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[id]}"/></svg>`;
  const navUrl=(screen,feature=key,period=days,mode=theme)=>`?screen=${screen}&feature=${feature}&days=${period}&theme=${mode}`;
  const link=(screen,label,id=key,cl="")=>`<a class="${cl}" href="${navUrl(screen,id)}">${label}</a>`;
  const section=(title,body)=>`<section class="panel"><h2>${title}</h2>${body}</section>`;
  const badge=(bad)=>`<span class="badge">${icon(bad?"issue":"ok")} ${bad?"문제 있어요":"괜찮아요"}</span>`;
  const date=(ms)=>new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Seoul",day:"2-digit",month:"2-digit"}).format(ms).split("/").reverse().join("/");
  const clock=(ms)=>new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Seoul",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(ms);
  const range=(p)=>`${date(p.from)} ${clock(p.from)}–${date(p.from)===date(p.until)?"":date(p.until)+" "}${clock(p.until)}`;
  const sec=(n)=>n===null?"측정 없음":`${n}초`;
  const action=()=>link("issue","실패 문제 보기"+icon("next"),"other","btn");
  function nav(){
    return `<header><div class="top"><a class="brand" href="${navUrl("home")}"><img src="../../brand/ship-and-ping-wordmark.png" width="30" height="30" alt="">쉽앤핑</a><span class="app-name">트루바</span><div class="tools"><a href="../index.html" aria-label="시안 비교">${icon("compare")}<span>시안 비교</span></a><a href="${navUrl(page,key,days,theme==="light"?"dark":"light")}&state=${scenario}" aria-label="화면 테마 변경">${icon("theme")}</a></div></div></header>
    <nav aria-label="트루바 메뉴">${(preview?[["home","문제 예시로 돌아가기"]]:[["home","앱 홈"],["features","기능 목록"],["issue","문제 1개"],["alerts","알림 설정"]]).map(([s,t])=>`<a href="${navUrl(s)}" ${page===s||(page==="feature"&&s==="features")?'aria-current="page"':""}>${icon(s)}${t}</a>`).join("")}</nav>`;
  }
  function hero(title,reason,button,bad=true){
    return `<section class="hero"><div>${badge(bad)}<h2>${title}</h2><p>${reason}</p>${button||""}</div>${!bad&&option==="c"?'<div class="mascot"><img src="../../brand/sheep.svg" alt=""></div>':""}</section>`;
  }
  function facts(items){
    return `<dl class="facts">${items.map(([label,val])=>`<div><dt>${label}</dt><dd>${val}</dd></div>`).join("")}</dl>`;
  }
  function spark(id){
    const data=series(id);
    return `<span class="spark" role="img" aria-label="최근 24시간 사용 건수, 공통 축 0~50건">${data.map(r=>`<i style="height:${r.total*2}%"><b style="height:${r.total?r.fail/r.total*100:0}%"></b></i>`).join("")}</span>`;
  }
  function list(){
    const ids=Object.keys(featureNames).sort((a,b)=>option==="c"?current(b).total-current(a).total:Number(b==="other")-Number(a==="other")||current(b).total-current(a).total);
    return `<section class="panel list"><div class="section-title"><h2>기능별 상태</h2><small>최근 24시간 · ${option==="c"?"사용 많은 순":"문제 있는 기능 먼저"}</small></div>
    ${option==="c"?`<div class="list-head"><span>기능</span><span>현재 상태</span><span>사용 흐름 · 0~50건</span><span>사용</span><span>실패</span></div>`:""}
    ${ids.map(id=>{
      const s=current(id);
      return `<a class="feature-row" href="${navUrl("feature",id)}"><strong>${featureNames[id]}</strong>${badge(id==="other")}${option==="c"?spark(id):""}<span class="count">${s.total}건<span class="mobile-label"> 사용</span></span><span class="count">${s.fail}건<span class="mobile-label"> 실패</span></span>${icon("next")}</a>`;
    }).join("")}</section>`;
  }
  function eventRow(time,title,note){
    return `<div class="event"><time>${time}</time><div><strong>${title}</strong><p>${note}</p></div></div>`;
  }
  const eventList=()=>section("오늘의 기록",eventRow("14:15","기타에서 실패가 몰렸어요","14:20까지 5분 동안 30건 실패")+eventRow("10:00","기타가 한때 느렸어요","10:00–11:00 보통 5초, 다음 구간 1초"));
  const mascotImage='<img class="sheep-art" src="../../brand/sheep.svg" alt="">';
  function sheepDesk(title,detail){
    return `<aside class="sheep-desk"><div class="desk-card">${icon("ok")}<strong>${title}</strong><small>${detail}</small></div><div class="sheep-stage">${mascotImage}</div></aside>`;
  }
  function statePage(){
    const content={
      empty:["첫 기록을 기다려요","트루바에서 기능을 한 번 사용하면 이곳에 첫 기록이 나타나요.","기록 도착 전"],
      loading:["기록을 불러오고 있어요","트루바의 최근 기록과 열린 문제를 확인하고 있어요.","조회 중"],
      healthy:["모두 괜찮아요","세 기능에 열린 문제가 없어요. 마지막으로 확인한 기능은 검색이에요.","정상"]
    }[scenario];
    const illustration=option==="c"?`<div class="state-art ${scenario}">${mascotImage}</div>`:"";
    const next=scenario==="loading"?"확인 중":scenario==="empty"?"첫 기록을 확인하는 방법":"최근 정상 기록";
    const more=scenario==="empty"?"연결한 트루바에서 검색을 한 번 실행한 뒤 기록 도착을 확인하세요.":scenario==="healthy"?"17:10 검색 성공 · 보통 0.5초":"기록이 도착하면 상태와 기능별 건수를 보여줘요.";
    return `<section class="panel state-view ${scenario}" aria-busy="${scenario==="loading"}"><div><span class="badge">${icon(scenario==="healthy"?"ok":"clock")} ${content[2]}</span><h2>${content[0]}</h2><p>${content[1]}</p></div>${illustration}</section>`+
      section(next,scenario==="loading"?'<div class="skeleton" aria-hidden="true"><i></i><i></i><i></i></div>':'<p>'+more+'</p>');
  }
  function home(){
    if(preview)return statePage();
    const totals=aggregate(records.filter(r=>r.at>=snapshotEnd-days*day));
    if(option==="a"){
      const stats=facts([["열린 문제","1개"],["전체 사용",totals.total+"건"],["실패",totals.fail+"건"],["보통 시간",sec(totals.median)]]);
      return `<div class="phone-summary">${badge(true)} 기타에서 실패 30건</div><section class="panel overview"><div class="section-title"><h2>앱 사용 흐름</h2><small>전체 기능 3개</small></div>${stats}<details class="fold" ${matchMedia("(min-width:761px)").matches||params.get("chart")==="open"?"open":""}><summary>그래프와 표 보기</summary>${filters()}${figure(false)}${table()}</details></section>
        <div class="overview-foot">${list()}${section("확인할 문제",'<p>기타에서 5분 동안 30건이 실패했어요.</p>'+action())}</div>`;
    }
    if(option==="b"){
      return `<section class="panel toss-card"><div class="big-status"><span class="badge">${icon("issue")} 확인할 문제</span><h2><b>1</b><span>개</span></h2><p>기타에서 실패가 몰렸어요.</p></div>
        <div class="incident-ticket"><div class="ticket-heading"><span class="ticket-icon">${icon("issue")}</span><div><small>기타 · 실패</small><h3>5분 동안 30건 실패</h3></div></div><p>오늘 오후 2시 15분부터 2시 20분까지</p>${action()}</div></section>
        <div class="toss-lower">${list()}${section("다른 시간대 기록",eventRow("17:10","검색이 정상 작동했어요","사용 4건 모두 성공 · 보통 0.5초")+eventRow("10:00","기타가 한때 느렸어요","보통 5초, 다음 구간에서 1초"))}</div>`;
    }
    return `<section class="workbench"><div class="watch-report"><span class="badge">${icon("issue")} 문제 있어요</span><h2>기타를 한 번 <br>살펴봐 주세요.</h2><p>오후 2시 15분부터 5분 동안 <br>30건이 실패했어요.</p>${action()}</div>${sheepDesk("검색은 괜찮아요","17:10 마지막 성공 기록")}</section><div class="watch-lower">${eventList()}${list()}</div>`;
  }
  const filters=()=>`<div class="range"><div class="seg" aria-label="조회 기간">${[1,7].map(d=>`<a href="${navUrl(atHome?"home":"feature",key,d)}&chart=open" ${days===d?'aria-current="true"':""}>${d===1?"24시간":"7일"}</a>`).join("")}</div><small>${range({from:points[0].from,until:snapshotEnd})} · 한국 시간</small></div>`;
  const maxPoint=points.reduce((best,p)=>(p.median??0)>(best.median??0)?p:best);
  const step=days===1?"1시간":"24시간";
  function figure(isTime){
    const title=isTime?"보통 걸린 시간":"사용과 실패";
    const summary=isTime?`가장 오래 걸린 구간은 ${range(maxPoint)}로, 보통 ${sec(maxPoint.median)}였어요.`:
      atHome||key==="other"?"11/27 14:15–14:20에 기타에서 30건이 실패했어요.":`선택한 기간에 실패한 기록은 없어요.`;
    return `<figure><figcaption>${title}</figcaption><p>${summary}</p><div class="plot-head"><small>${isTime?"점":"막대"} 하나는 ${step}</small>${isTime?"":'<span class="legend"><i></i>성공 <i class="hatch"></i>실패</span>'}</div><div class="chart" data-chart="${isTime?"time":"count"}"></div></figure>`;
  }
  const table=()=>`<details class="table"><summary>표로 보기</summary><table><caption>기능 ${name} · ${step} 단위</caption><thead><tr><th>시간 구간</th><th>사용</th><th>실패</th><th>보통 시간</th></tr></thead><tbody>${points.map(p=>`<tr><th scope="row">${range(p)}</th><td>${p.total}</td><td>${p.fail}</td><td>${sec(p.median)}</td></tr>`).join("")}</tbody></table></details>`;
  function detail(){
    const s=current(key,days), bad=key==="other";
    const title=bad?"기타에서 실패가 몰렸어요":`${name} 기능은 괜찮아요`;
    const reason=`최근 ${days===1?"24시간":"7일"} 사용 ${s.total}건 중 ${s.fail}건이 실패했어요.`;
    const summary=option==="c"?`<div class="ledger-alert">${badge(bad)}<strong>${title}</strong>${bad?action():""}</div>`:hero(title,reason,bad?action():link("features","기능 목록 보기",key,"btn"),bad);
    const stats=facts([["사용",s.total+"건"],["실패",s.fail+"건"],["보통 시간",sec(s.median)]]);
    const figs=figure(false)+figure(true);
    return summary+`<section class="panel charts"><div class="section-title"><h2>사용 흐름</h2>${option==="c"?`<small>${reason}</small>`:""}</div>${option==="c"?stats:""}<details class="fold" ${matchMedia("(min-width:761px)").matches||params.get("chart")==="open"?"open":""}><summary>그래프와 표 보기</summary>${filters()}<div class="figures">${figs}</div>${table()}</details></section>`;
  }
  function copyButton(){return '<button class="btn copy" type="button">AI 조사 요청문 복사</button>';}
  function issue(){
    const request="트루바의 기타 기능에서 11월 27일 14:15~14:20에 30건이 실패했어요. 이 구간에 영향을 준 변경과 실패 원인을 조사해 주세요.";
    return hero("기타에서 실패가 늘었어요","11월 27일 14:15–14:20에 실패 30건을 확인했어요.",copyButton())+section("실패가 몰린 구간",eventRow("14:15","5분 동안 30건 실패","같은 시간대 전체(14:00–15:00) 사용 50건 중 30건이 실패했어요.")+link("feature","기타 사용 흐름 보기","other"))+
      `<section class="panel" id="request"><h2>코딩 AI에 맡기기</h2><p>아래 문장을 복사해 앱을 만든 코딩 AI에 붙여넣으세요.</p><blockquote>${request}</blockquote><span id="copy-result" role="status"></span></section>`;
  }
  function alerts(){
    return `<div class="channel-list"><section class="panel channel push"><div class="channel-head"><h2>앱 푸시</h2><span>기본 알림</span></div><p>휴대폰 홈 화면에서 쉽앤핑을 열면 알림을 받을 수 있어요. 알림을 누르면 해당 문제로 이동해요.</p>
      <details id="setup"><summary>홈 화면에 추가하는 방법</summary><ol><li>휴대폰 브라우저의 공유 또는 메뉴에서 ‘홈 화면에 추가’를 선택하세요.</li><li>홈 화면에서 쉽앤핑을 다시 열고 알림을 허용하세요.</li></ol><p>추가 메뉴가 보이지 않으면 메일로 받을 수 있어요.</p></details>
      ${link("issue","예시 알림 열기"+icon("next"),"other","btn")}</section>
      <section class="panel channel"><div class="channel-head"><h2>메일</h2><span>대비용 · 켜짐</span></div><p>앱 푸시를 놓쳤을 때 로그인 메일에서도 문제를 열 수 있어요.</p></section>
      <section class="panel channel"><div class="channel-head"><h2>슬랙</h2><span>팀용 선택 · 미연결</span></div><p>팀원이 함께 확인할 때 채널로 알림을 받을 수 있어요.</p></section></div>`;
  }
  function dock(){
    if(preview)return '<div class="dock">'+link("home","문제 예시로 돌아가기","other","btn")+"</div>";
    const button=page==="issue"?copyButton():page==="alerts"?'<a class="btn" href="#setup">홈 화면에 추가하는 방법</a>':
      page==="feature"&&key!=="other"?link("features","기능 목록 보기",key,"btn"):action();
    return `<div class="dock" aria-label="주요 행동">${button}</div>`;
  }
  const stateLinks=()=>atHome?`<div class="state-links" aria-label="홈 상태 미리보기"><span>상태 미리보기</span>${[["problem","문제"],["empty","빈 화면"],["loading","로딩"],["healthy","정상"]].map(([s,t])=>`<a href="${navUrl("home")}&state=${s}" ${s===scenario?'aria-current="true"':""}>${t}</a>`).join("")}</div>`:"";
  const pageTitle={home:"트루바",features:"기능 목록",feature:name,issue:"실패 문제",alerts:"알림 설정"};
  document.getElementById("dashboard").outerHTML=nav()+`<main><div class="page-title"><div><small>${page==="home"?"앱 홈":link("home","트루바")+" / "+(page==="feature"?link("features","기능 목록"):"앱 홈")}</small><h1>${pageTitle[page]||"트루바"}</h1></div><small>${icon("clock")}${snap}</small></div>${page==="feature"?detail():page==="features"?'<div class="phone-summary">'+badge(true)+' 기타에서 실패 30건</div>'+list():page==="issue"?issue():page==="alerts"?alerts():home()}</main><footer>${stateLinks()}트루바 예시 데이터 · 2026년 11월 27일</footer>${dock()}`;
  document.body.dataset.screen=page;
  const setup=document.getElementById("setup");
  if(setup)document.querySelector('.dock a').onclick=()=>{setup.open=true;};
  const fold=document.querySelector(".fold");
  if(fold)matchMedia("(min-width:761px)").addEventListener("change",event=>{fold.open=event.matches;});
  for(const copy of document.querySelectorAll(".copy"))copy.onclick=async()=>{try{await navigator.clipboard.writeText(document.querySelector("blockquote").textContent);document.querySelector("#copy-result").textContent="복사했어요.";document.querySelectorAll(".copy").forEach(b=>{b.textContent="복사했어요";});}catch{document.querySelector("#copy-result").textContent=" 위 문장을 선택해 직접 복사하세요.";}};
  for(const chart of document.querySelectorAll(".chart")) setupChart(chart);
  function setupChart(el){
    const timed=el.dataset.chart==="time", unit=timed?"초":"건", label=timed?"보통 걸린 시간":"사용과 실패";
    const peak=Math.max(...points.map(p=>(timed?p.median:p.total)??0));
    const steps=timed?[0.2,0.25,0.5,1,2,5,10]:[1,2,5,10,20,50,100];
    const tick=steps.find(v=>v*5>=peak)||100;
    const intervals=Math.max(3,Math.ceil(peak/tick));
    const top=tick*intervals;
    let selected=points.findIndex(p=>(timed?p.median:p.total)>0);
    const tip=document.createElement("div");tip.className="tip";tip.hidden=true;tip.setAttribute("role","tooltip");
    el.innerHTML=`<svg aria-hidden="true"></svg><div class="hit" role="slider" tabindex="0" aria-label="${label} 시간 구간" aria-valuemin="1" aria-valuemax="${points.length}"><i hidden></i></div>`;
    el.append(tip);
    const svg=el.querySelector("svg"),hit=el.querySelector(".hit"),mark=hit.firstChild;
    const left=40,right=12,yTop=12;
    function draw(){
      const width=el.clientWidth;
      if(width<=left+right)return;
      const bottom=el.clientHeight-38;
      const w=width-left-right, slot=w/points.length;
      const x=i=>left+(i+0.5)*slot, y=v=>bottom-v/top*(bottom-yTop);
      const glyph=(px,py,content,anchor)=>`<text x="${px}" y="${py}" text-anchor="${anchor}">${content}</text>`;
      let content=`<defs><pattern id="stripe-${timed?"time":"count"}" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" class="failed"/><path d="M-1 1L1 -1 M0 6L6 0 M5 7L7 5" class="stripe"/></pattern></defs>`;
      for(let i=0;i<=intervals;i++){
        content+=`<line class="${i?"grid":"axis"}" x1="${left}" x2="${width-right}" y1="${y(i*tick)}" y2="${y(i*tick)}"/>`+glyph(left-7,y(i*tick)+4,+(i*tick).toFixed(2)+unit,"end");
      }
      const xTicks=days===1?[0,6,12,18,24]:[0,2,4,7];
      for(const n of xTicks){
        const at=n===points.length?snapshotEnd:points[n].from;
        content+=glyph(left+n*slot,bottom+26,days===1?clock(at):date(at),n===0?"start":n===points.length?"end":"middle");
      }
      if(timed){
        let path="";
        points.forEach((p,i)=>{if(p.median!==null)path+=(i>0&&points[i-1].median!==null?"L":"M")+x(i)+" "+y(p.median)+" ";});
        content+=`<path d="${path}" class="duration"/>`;
        points.forEach((p,i)=>{if(p.median!==null)content+=`<circle cx="${x(i)}" cy="${y(p.median)}" r="5"/>`;});
      }else{
        // Fixed 2px gutter. Cap both the band and bar widths on large screens.
        const bar=Math.min(18,slot-2);
        function piece(i,low,high,fill,rounded){
          const l=x(i)-bar/2,r=l+bar,t=y(high),b=y(low),radius=rounded?Math.min(4,(b-t),bar/2):0;
          return `<path fill="${fill}" d="M${l} ${b}V${t+radius}Q${l} ${t} ${l+radius} ${t}H${r-radius}Q${r} ${t} ${r} ${t+radius}V${b}Z"/>`;
        }
        points.forEach((p,i)=>{
          if(p.success)content+=piece(i,0,p.success,"var(--bar)",!p.fail);
          if(p.fail)content+=piece(i,p.success,p.total,"url(#stripe-count)",true);
          if(p.success&&p.fail)content+=`<line x1="${x(i)-bar/2}" x2="${x(i)+bar/2}" y1="${y(p.success)}" y2="${y(p.success)}" class="separator"/>`;
        });
      }
      svg.innerHTML=content;
    }
    function select(index,show=true){
      selected=Math.max(0,Math.min(points.length-1,index));
      const p=points[selected], text=range(p)+" · "+(timed?"보통 시간 "+sec(p.median):`성공 ${p.success}건 · 실패 ${p.fail}건`);
      hit.setAttribute("aria-valuenow",selected+1);hit.setAttribute("aria-valuetext",text);
      tip.textContent=text;tip.hidden=mark.hidden=!show;
      const pos=(selected+0.5)/points.length*100;
      mark.style.left=pos+"%";mark.style.width=timed?"2px":100/points.length+"%";
    }
    function hide(){tip.hidden=mark.hidden=true;}
    function point(e){const rect=hit.getBoundingClientRect();return Math.floor((e.clientX-rect.left)/rect.width*points.length);}
    hit.onpointerdown=e=>{hit.focus({preventScroll:true});select(point(e));};
    hit.onpointermove=e=>{if(e.pointerType!=="touch"||e.buttons)select(point(e));};
    hit.onpointerleave=()=>{if(document.activeElement!==hit)hide();};
    hit.onfocus=()=>select(selected);hit.onblur=hide;
    hit.onkeydown=e=>{const next={ArrowLeft:selected-1,ArrowRight:selected+1,Home:0,End:points.length-1}[e.key];if(next!==undefined){e.preventDefault();select(next);}};
    document.addEventListener("keydown",e=>{if(e.key==="Escape")hide();});
    select(selected,false);draw();new ResizeObserver(draw).observe(el);
  }
})();
