import { useEffect, useRef, useState } from "react";
import { Copy } from "./Connect";
import type { AiKey, aiKeys } from "./ai-keys";

const variable = "SHIP_AND_PING_AI_KEY";
const when = (date: string) => new Date(date).toLocaleString("ko-KR");

export function AiConnection({ app, api }: { app: string; api: ReturnType<typeof aiKeys> }) {
  const [keys, setKeys] = useState<AiKey[]>();
  const [issued, setIssued] = useState<{ id: string; key: string }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, refresh] = useState(0);
  const locked = useRef(false);
  useEffect(() => {
    let active = true;
    api.list(app).then(rows => { if (active) setKeys(rows); })
      .catch(() => { if (active) setError("키 목록을 불러오지 못했어요. 다시 조회해 주세요."); });
    return () => { active = false; };
  }, [app, api, revision]);

  async function change(id?: string) {
    if (locked.current) return;
    if (id && !window.confirm("이 키로 연결한 AI의 조회가 즉시 중단돼요. 폐기할까요?")) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      if (id) {
        await api.revoke(app, id);
        setIssued(value => value?.id === id ? undefined : value);
      } else {
        setIssued(await api.issue(app));
      }
    } catch {
      setError("변경 결과를 확인할 수 없어요. 키 목록을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setKeys(undefined);
      refresh(n => n + 1);
      setBusy(false);
      locked.current = false;
    }
  }
  const cursor = { mcpServers: { "ship-and-ping": { url: api.endpoint, headers: { Authorization: "Bearer ${env:SHIP_AND_PING_AI_KEY}" } } } };
  return <section className="panel">
    <h2>AI 연결</h2>
    <p>코딩 AI가 이 앱의 문제와 해결 여부를 조회할 수 있어요. 키는 90일 동안 유효하고 한 앱에 3개까지 발급할 수 있어요.</p>
    {error && <p role="alert">{error}</p>}
    {keys && (keys.length ? <ul>{keys.map(key => <li key={key.id}>
      <strong>조회 키 {key.id.slice(0, 8)}</strong> · 발급 {when(key.created_at)} · 만료 {when(key.expires_at)}
      <br />마지막 사용 {key.last_used_at ? when(key.last_used_at) : "아직 사용 전"}{" "}
      <button type="button" className="secondary danger" disabled={busy} onClick={() => void change(key.id)}>조회 키 폐기</button>
    </li>)}</ul> : <p>사용 중인 조회 키가 없어요.</p>)}
    <div className="actions">
      <button type="button" disabled={busy || !keys || keys.length >= 3 || !!issued} onClick={() => void change()}>AI 조회 키 발급</button>
      <button type="button" className="secondary" disabled={busy} onClick={() => { setError(""); refresh(n => n + 1); }}>키 목록 새로고침</button>
    </div>
    {issued && <div className="key-instructions">
      <p>새 키 {issued.id.slice(0, 8)}는 지금만 복사할 수 있어요. 사용자 환경 변수 <code>{variable}</code>에 저장하세요.</p>
      <Copy key={issued.id} compact text={issued.key} previewKey={issued.key} title="AI 조회 키 복사"
        successMessage="복사했어요. 사용자 환경 변수에 저장하세요." />
      <button type="button" className="secondary" onClick={() => setIssued(undefined)}>저장했어요 · 키 닫기</button>
    </div>}
    <details><summary>코딩 AI에 연결하기</summary>
      <p>키를 사용자 환경 변수에 저장하고 코딩 AI를 다시 시작하세요. 프로젝트 파일·채팅·커밋에 키를 넣지 마세요. 로컬 환경 파일을 쓴다면 .env와 .env.local을 .gitignore에 등록하세요.</p>
      <h3>Claude Code</h3>
      <p>사용자 설정에 등록한 뒤 <code>/mcp</code>에서 연결을 확인하세요.</p>
      <pre>{`claude mcp add --scope user --transport http ship-and-ping ${api.endpoint} --header 'Authorization: Bearer \${SHIP_AND_PING_AI_KEY}'`}</pre>
      <h3>Cursor</h3>
      <p>사용자 홈의 <code>~/.cursor/mcp.json</code>에 추가하세요.</p><pre>{JSON.stringify(cursor, null, 2)}</pre>
      <h3>Codex</h3>
      <pre>{`codex mcp add ship-and-ping --url ${api.endpoint} --bearer-token-env-var ${variable}`}</pre>
      <p>연결한 코딩 AI에 “쉽앤핑에서 열린 문제를 조회해 줘”라고 요청하세요.</p>
    </details>
  </section>;
}
