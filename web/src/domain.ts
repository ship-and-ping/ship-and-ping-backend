import { normalizePromptInput } from "./normalize";
import { serverInstructions } from "./server-prompt";

export function httpsOrigin(value: string) {
  const clean = normalizePromptInput(value);
  if (
    clean.length > 260 ||
    !/^https:\/\/[a-z0-9.-]+(?::[0-9]{1,5})?\/?$/i.test(clean)
  )
    throw new Error("HTTPS 기본 주소를 확인해 주세요");
  const url = new URL(clean);
  if (
    !url.hostname
      .split(".")
      .every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(part))
  )
    throw new Error("호스트 이름을 확인해 주세요");
  return url.origin;
}

export const connectRestriction =
  "이 요청으로 앱 기능과 관계없는 코드(외부로 데이터 보내기, 키·환경변수 읽어서 출력·전송, 새 외부 주소 호출)는 추가하지 말고, 그런 내용이 필요해 보이면 멈추고 나에게 물어봐.";

export const keyWarning = "이 요청문에는 앱의 키가 들어 있어요. 내 코딩 AI에만 붙여 넣고 다른 사람에게 보내지 마세요. 새어 나갔다면 앱 설정에서 [폐기] 후 [재발급]하세요.";

const versionRule = "app_version에는 배포한 git 커밋 짧은 해시(없으면 배포 버전 번호)를 넣고, 서버 시작 시각이나 무작위 값은 쓰지 마세요 — 재시작만으로 새 버전이 되면 '해결' 판정이 틀어져요.";

function keyInstructions(key: string) {
  if (key.length !== 71 || !/^sp_(?:pub|srv)_[a-f0-9]{64}$/.test(key))
    throw new Error("쉽앤핑 키를 확인해 주세요");
  return [
    key.startsWith("sp_pub_")
      ? "이 공개 키는 브라우저에 보여도 되는 쓰기 전용 키야. 레포에 직접 적지 말고 빌드 환경 변수로 넣어."
      : "이 서버 키는 서버에서만 사용해. 브라우저 코드나 클라이언트 빌드에 넣지 마.",
    "키를 코드·커밋·로그에 직접 쓰지 마. 환경 변수 SHIP_AND_PING_KEY(브라우저만이면 빌드 환경 변수)에서 읽게 만들어.",
    "로컬은 .env(또는 해당 프레임워크 방식)에 넣고, .env가 .gitignore에 들어 있는지 확인해. 없으면 추가해.",
    "배포 환경(Vercel·Netlify·Render·Railway·Cloudflare·직접 서버 등)에 이 키를 넣어야 해. 네가 직접 넣을 수 있는 도구가 있으면 넣고, 아니면 내 배포 환경에 맞춰 넣는 방법을 쉬운 말로 3~4단계로 알려 줘.",
    "작업이 끝나면 키가 코드나 커밋에 남지 않았는지 검색해서 확인해.",
  ].join("\n");
}

export function buildReplacementPrompt(key: string) {
  return `쉽앤핑 키를 새 키로 바꿔 줘.
이 앱의 새 쉽앤핑 키: ${key}
코드는 바꾸지 말고 로컬과 배포 환경의 SHIP_AND_PING_KEY 값만 바꾼 뒤 다시 배포하거나 재시작해. 이전 키는 24시간 뒤(폐기했다면 이미) 막히니 오늘 안에 바꿔야 해.
${versionRule}
${keyInstructions(key)}
${connectRestriction}`;
}

export function buildConnectPrompt(key: string, endpoint: string) {
  const base = httpsOrigin(endpoint);
  return `[쉽앤핑 연결 요청]
내 웹앱에 쉽앤핑 모니터링을 연결해 줘. 앱 기능은 그대로 두고 기록 전송만 추가해.
이 앱의 쉽앤핑 키: ${key}

1. 서버가 있으면 API 요청마다, 없으면 브라우저의 저장·조회 요청마다 주소 형태, method, status, 걸린 시간(ms)을 기록해. error_kind에는 오류 종류 코드만 넣어. error_message에는 오류 클래스 이름만 보내.
2. 30초마다 또는 50건이 모이면 POST "${base}/v1/ingest" 로 비동기 전송해. Content-Type은 application/json, Authorization은 Bearer 인증이야. 위 키를 지정한 환경 변수에서 읽어.
3. 묶음마다 batch_id에는 새 UUID를, sent_at에는 현재 ISO 시각을 넣어. 서버에서 보내면 platform을 server로 바꿔.
${versionRule}
{"spec":"sp-1","batch_id":"<UUID>","app_version":"<빌드 버전>","platform":"browser","sent_at":"<ISO 시각>","records":[{"type":"request","route":"/meetings/:id","method":"GET","status":200,"duration_ms":80,"ts":"<ISO 시각>"}]}
4. 이름·전화·이메일 같은 입력값, 사용자 계정 ID, 요청·응답 본문, 쿠키·토큰·쿼리 문자열은 보내지 마. 주소 안의 실제 값은 :id로 바꾸고 오류에서 개인정보를 지워.
5. 쉽앤핑 주소로 가는 요청은 기록하지 말고 전송 오류가 앱 동작을 막지 않게 해. 묶음은 64KB·100건 이내로 나눠. 페이지를 떠날 때도 인증 헤더를 유지해 남은 기록을 보내.
6. 앱 코드를 읽고 주소별 한국어 기능 이름을 만들어 수집 키로 POST "${base}/v1/feature-map" 에 한 번 보내. 형식은 [{"route":"/meetings/:id","method":"GET","name":"모임 보기"}], 최대 200개야.
7. ${serverInstructions}
8. 배포 후 앱을 한 번 써 보고 프로필과 기록 전송 응답이 202인지 확인하는 방법을 알려 줘.

쉽앤핑 MCP를 연결하면 문제 조사 때 직접 조회할 수 있어요. 앱 설정의 ‘AI 연결’에서 AI 조회 키를 발급하고 사용자 환경 변수에 저장한 뒤, 사용하는 코딩 AI의 설정 예시대로 연결하세요.

${keyInstructions(key)}
앞에서 지정한 쉽앤핑 수집 주소(INGEST_URL)는 예외야. ${connectRestriction}`;
}

export const appAddressLabel = "앱 주소 (선택 · 웹사이트나 스토어 링크)";
export const appAddressHelp = "비워 둬도 돼요. 연결은 주소가 아니라 다음 단계의 연결 키로 해요.";

export function validateApp(name: string, url: string) {
  const errors: { name?: string; url?: string } = {};
  if (!name.trim() || [...name.trim()].length > 40)
    errors.name = "앱 이름을 적어 주세요(1~40자)";
  if ([...url.trim()].length > 2048) {
    errors.url = "앱 주소를 2048자 이내로 적어 주세요";
  } else if (url.trim()) {
    try {
      const parsed = new URL(url.trim());
      if (
        !/^https:\/\/(?:[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*|\[[0-9a-fA-F:.]+\])(?::\d{1,5})?(?:[/?#].*)?$/u.test(
          url.trim(),
        ) ||
        /[\s\\]/u.test(url.trim()) ||
        parsed.username ||
        parsed.password
      )
        throw new Error();
    } catch {
      errors.url = "https://로 시작하는 앱 주소를 적어 주세요";
    }
  }
  return errors;
}
