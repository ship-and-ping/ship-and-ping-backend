import { useEffect, useRef, useState } from "react";

export function LogoutButton({ logout, failed = false }: {
  logout: (deviceOnly?: boolean) => Promise<void>;
  failed?: boolean;
}) {
  const [error, setError] = useState(failed);
  const [busy, setBusy] = useState(false);
  const retry = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (error && !busy) retry.current?.focus();
  }, [error,busy]);
  async function attempt(deviceOnly = false) {
    setBusy(true);
    try {
      await logout(deviceOnly);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return <>
    {error && <p role="alert">로그아웃을 끝내지 못했어요. 인터넷 연결 후 다시 시도해 주세요.</p>}
    <button ref={retry} className="secondary" disabled={busy} onClick={() => attempt()}>
      {busy ? "로그아웃하는 중" : error ? "다시 시도" : "로그아웃"}
    </button>
    {error && <>
      <p>다시 연결되기 전까지 이 기기로 알림이 올 수 있어요.</p>
      <button className="secondary" disabled={busy} onClick={() => attempt(true)}>
        그래도 이 기기에서 로그아웃
      </button>
    </>}
  </>;
}
