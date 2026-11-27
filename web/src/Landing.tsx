import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { Sheep } from "./Sheep";
import { Hero } from "./Layout";
import { StatusBadge, Timeline, IssueListItem } from "./IncidentSummary";
import mark from "./assets/wordmark.png";
import "./styles/landing.css";

const questions = [
  ["키는 어디에 넣나요?", "서버 키는 서버 환경 변수에만 넣어요. 브라우저만 쓰는 앱에는 기록을 보낼 수만 있는 공개 키를 써요. 문제 해결 요청문에서는 키를 가려요."],
  ["무료로 몇 개의 앱을 쓸 수 있나요?", "무료 베타 기간에는 회원 한 명당 웹앱을 세 개까지 등록할 수 있어요."],
  ["어떤 앱을 연결할 수 있나요?", "서버가 있는 웹앱도, 브라우저에서만 동작하는 웹앱도 연결할 수 있어요. 쓰던 코딩 AI에 연결 요청문을 붙여넣으면 돼요."],
  ["알림은 어디에서 받나요?", "앱의 알림 설정에서 슬랙을 연결하거나 이메일 알림을 켜세요. 앱 홈에서도 문제와 해결 상태를 확인할 수 있어요."],
  ["내 앱에서 어떤 데이터를 보내나요?", "기능별 성공 여부와 걸린 시간을 요약해요. 이름, 이메일, 요청·응답 본문, 쿠키와 토큰은 수집하지 않아요. 5분 요약은 7일, 시간별 요약은 30일, 하루 요약은 1년 보관해요."],
];
const signals = ["로그인에서 실패가 늘었어요", "결제가 느려졌어요", "업데이트 후 해결됐어요"];
const channels = ["슬랙", "이메일"] as const;
const paymentAlert = {
  title: "결제가 느려졌어요",
  metric: "평소 1.1초 → 최근 30분 3.4초",
  sample: "결제 24건",
};

function SignupLink({ className = "" }: { className?: string }) {
  return <Link to="/signup" className={"lp-start " + className}>회원가입 <span aria-hidden="true">↗</span></Link>;
}

function SignalStrip() {
  const [paused, setPaused] = useState(false);
  return <div className="lp-strip">
    <div className="lp-ticker">
      <div className="lp-track" data-paused={paused}>
        {[0, 1].map(copy => <div key={copy} className="lp-run" aria-hidden={copy === 1 || undefined}>
          {signals.map((signal, i) => <span key={signal}><i aria-hidden="true">{["!", "◷", "✓"][i]}</i>{signal}</span>)}
        </div>)}
      </div>
    </div>
    <button className="lp-pause" aria-label={paused ? "알림 예시 띠 재생" : "알림 예시 띠 일시정지"}
      onClick={() => setPaused(!paused)}>{paused ? "▶" : "Ⅱ"}</button>
  </div>;
}

function Alerts() {
  const [selected, setSelected] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  function navigate(event: KeyboardEvent, index: number) {
    const keys: Record<string, number> = {ArrowRight: 1-index, ArrowLeft: 1-index, Home: 0, End: 1};
    if (!(event.key in keys)) return;
    event.preventDefault();
    const next = keys[event.key];
    setSelected(next);
    tabs.current[next]?.focus();
  }
  return <section className="lp-section lp-split lp-alerts alert-examples">
    <div className="lp-copy"><p className="lp-kicker">알림 예시</p>
      <h2>문제가 생기면<br/>쓰던 곳으로 핑.</h2>
      <p>어떤 기능이 얼마나 달라졌는지, 슬랙이나 메일에서 바로 읽어보세요.</p>
    </div>
    <div className="lp-window">
      <div role="tablist" aria-label="알림 예시 채널" className="lp-tabs">
        {channels.map((channel, i) => <button key={channel} type="button" role="tab"
          id={"alert-tab-" + i} aria-controls={"alert-panel-" + i} aria-selected={selected === i}
          tabIndex={selected === i ? 0 : -1} ref={el => { tabs.current[i] = el; }}
          onClick={() => setSelected(i)} onKeyDown={event => navigate(event, i)}>{channel}</button>)}
      </div>
      {channels.map((channel, i) => <div key={channel} role="tabpanel" id={"alert-panel-" + i}
        aria-labelledby={"alert-tab-" + i} hidden={selected !== i} tabIndex={0} className="lp-message">
        <div className="lp-envelope">{i === 0 ? "# 모임모아-알림" : "받은 메일함"}</div>
        <div className="lp-sender"><Sheep/><span><strong>쉽앤핑</strong><small>모임모아 · 오후 6:00</small></span></div>
        <div className="lp-excerpt"><h3>{i === 1 && "[쉽앤핑] 모임모아 · "}{paymentAlert.title}</h3>
          <p>{paymentAlert.metric}</p><small>{paymentAlert.sample}을 살펴봤어요.</small></div>
        <details className="lp-alert-detail">
          <summary>쉽앤핑에서 보기</summary>
          <Hero title="모임모아 · 결제 문제 상세" mood="worried" showSheep={false}
            badge={<StatusBadge state="open"/>} detail={paymentAlert.sample + " · " + paymentAlert.metric}/>
        </details>
      </div>)}
    </div>
  </section>;
}

function ProductExample() {
  const [preview, setPreview] = useState<"앱 홈" | "문제 상세">("앱 홈");
  const detailButton = useRef<HTMLButtonElement>(null);
  return (<div className="product-example" role="region" aria-label="예시 화면">
            <div className="example-bar"><strong>모임모아</strong>
              <div className="example-tabs" role="group" aria-label="예시 화면 선택">{(["앱 홈", "문제 상세"] as const).map(name =>
                <button key={name} ref={name === "문제 상세" ? detailButton : undefined} aria-pressed={preview === name} onClick={() => setPreview(name)}>{name}</button>)}</div>
            </div>
            <Hero title={preview === "앱 홈" ? "모임 신청에서 실패가 늘었어요" : "모임 신청 20건 중 6건 실패"}
              mood="worried" showSheep={false} badge={<StatusBadge state="open" />}
              detail={preview === "앱 홈" ? "최근 30분 동안 실패가 6건 있었어요." : "감지 구간 · 최근 30분"} />
            {preview === "앱 홈" ? <div className="example-row"><h3>문제</h3>
              <IssueListItem summary="모임 신청에서 실패가 늘었어요" state="open"
                metric="최근 30분 20건 중 실패 6건" onOpen={() => {
                  setPreview("문제 상세");
                  detailButton.current?.focus();
                }} /></div> :
              <div className="example-row"><h3>지금까지 흐름</h3>
                <Timeline events={[{at:"2026-11-25T18:00:00+09:00", date:"오후 6:00", text:"버전 1.0에서 처음 감지했어요"}]} /></div>}
          </div>);
}

export function Landing() {
  const main = useRef<HTMLElement>(null);
  const navSignup = useRef<HTMLAnchorElement>(null);
  const [showMobileSignup, setShowMobileSignup] = useState(false);
  useEffect(() => {
    if (!navSignup.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setShowMobileSignup(!entry.isIntersecting));
    observer.observe(navSignup.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!main.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("lp-enter");
        observer.unobserve(entry.target);
      }
    });
    main.current.querySelectorAll(".lp-section").forEach(section => observer.observe(section));
    return () => observer.disconnect();
  }, []);
  return <div className="lp" data-mobile-signup={showMobileSignup}>
    <a className="skip" href="#main">본문으로 가기</a>
    <header className="lp-header"><nav aria-label="시작 메뉴">
      <Link className="lp-brand" to="/"><img src={mark} alt="" width="34" height="34"/>쉽앤핑</Link>
      <Link to="/login">로그인</Link>
      <Link className="lp-nav-start" to="/signup" ref={navSignup}>회원가입</Link>
    </nav></header>
    <main id="main" tabIndex={-1} ref={main}>
      <section className="intro lp-hero">
        <div className="lp-hero-copy">
          <p className="lp-kicker"><i aria-hidden="true"/>웹앱 모니터링</p>
          <h1 className="lp-title" tabIndex={-1}>내 앱의 이상 신호,<br/><em>양이 알려드려요.</em></h1>
          <p className="lp-lede">로그인이 막히거나 결제가 느려질 때,<br/>쉽앤핑이 슬랙이나 메일로 알려드려요.</p>
          <SignupLink className="lp-hero-start"/>
        </div>
        <div className="lp-scene" aria-hidden="true">
          <div className="lp-radar"><i/><i/><i/><b/></div>
          <div className="lp-star lp-star-one">✦</div><div className="lp-star lp-star-two">✦</div>
          <div className="lp-mascot"><Sheep/></div>
          <div className="lp-reading"><i/>정상 신호 수신 <span>· 예시</span></div>
        </div>
      </section>
      <SignalStrip/>
      <section className="lp-section lp-split review-story" id="app-preview" data-slot="onboarding">
        <div className="lp-copy"><p className="lp-kicker">앱 홈 미리보기</p>
          <h2>어디서 막혔는지<br/>한눈에 보여요.</h2>
          <p>사용자 리뷰를 기다리는 동안에도 쉽앤핑은 기록을 살펴요. 예시에서 문제를 열어 어떤 일이 있었는지 확인해 보세요.</p>
        </div>
        <ProductExample/>
      </section>
      <Alerts/>
      <section className="lp-section lp-setup">
        <div className="lp-copy"><p className="lp-kicker">연결 방법</p><h2>쓰던 코딩 AI와 연결해요.</h2></div>
        <ol>{[
          ["요청문 복사", "앱을 등록하고 내 앱에 맞는 연결 요청문을 복사해요."],
          ["코딩 AI에 붙여넣기", "대화창에 요청문을 붙여넣고 AI가 바꾼 코드를 확인해요."],
          ["배포하고 확인", "배포한 뒤 앱을 한 번 써 보세요. 첫 기록이 앱 홈에 도착해요."],
        ].map(([title, detail], i) => <li key={title}><span aria-hidden="true">0{i+1}</span>
          <h3>{title}</h3><p>{detail}</p></li>)}</ol>
      </section>
      <section className="lp-section lp-split answers">
        <div className="lp-copy section-heading" data-mood="relieved"><p className="lp-kicker">자주 묻는 질문</p><h2>연결하기 전에.</h2></div>
        <div className="lp-faq">{questions.map(([question, answer]) =>
          <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div>
      </section>
    </main>
    <footer className="lp-footer"><strong>쉽앤핑</strong><small>무료 베타 · 회원당 앱 3개까지</small><SignupLink/></footer>
    <SignupLink className="lp-mobile-start"/>
  </div>;
}
