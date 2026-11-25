import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { createClient } from "@supabase/supabase-js";
import { App } from "./App";
import { gateway } from "./data";
import { httpsOrigin } from "./domain";
import "./styles/tokens.css";
import "./styles/app.css";

function start() {
  const {
    VITE_SUPABASE_URL: url,
    VITE_SUPABASE_PUBLISHABLE_KEY: key,
    VITE_INGEST_URL: ingest,
  } = import.meta.env;
  if (url && key?.startsWith("sb_publishable_") && ingest) {
    try {
      const endpoint = httpsOrigin(ingest);
      return (
        <BrowserRouter>
          <App
            api={gateway(createClient(httpsOrigin(url), key))}
            ingest={endpoint}
          />
        </BrowserRouter>
      );
    } catch {
      /* 설정 오류는 개발용 안내로 표시한다. */
    }
  }
  return (
    <main className="public">
      <h1>웹 실행 설정이 필요해요</h1>
      <p>
        web/.env.example을 web/.env.local로 복사하고 아래 값을 채운 뒤 개발
        서버를 다시 시작하세요.
      </p>
      <ul>
        {[
          "VITE_SUPABASE_URL",
          "VITE_SUPABASE_PUBLISHABLE_KEY",
          "VITE_INGEST_URL",
        ].map((k) => (
          <li key={k}>
            <code>{k}</code>
          </li>
        ))}
      </ul>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(start());
