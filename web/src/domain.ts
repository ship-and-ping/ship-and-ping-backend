import { normalizePromptInput } from "./normalize";

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

export function buildConnectPrompt(publicKey: string, endpoint: string) {
  if (publicKey.length !== 71 || !/^sp_pub_[a-f0-9]{64}$/.test(publicKey))
    throw new Error("수집 키를 확인해 주세요");
  const base = httpsOrigin(endpoint);
  return `[쉽앤핑 연결 요청]
내 웹앱에 쉽앤핑 모니터링을 연결해 줘. 앱 기능은 그대로 두고 기록 전송만 추가해.

1. 서버가 있으면 API 요청마다, 없으면 브라우저의 저장·조회 요청마다 주소 형태, method, status, 걸린 시간(ms), 정제한 오류 종류와 메시지를 기록해.
2. 30초마다 또는 50건이 모이면 POST "${base}/v1/ingest" 로 비동기 전송해. Content-Type은 application/json, Authorization은 Bearer 인증이야. 브라우저용 수집 키는 "${publicKey}"야. 서버 키는 서버에서만 환경변수 SHIPPING_SERVER_KEY에서 읽어라.
3. 묶음 예시의 자리표시자를 실제 UUID·현재 ISO 시각·배포마다 바뀌는 커밋 해시 또는 빌드 시각으로 채워. 서버에서 보내면 platform을 server로 바꿔.
{"spec":"sp-1","batch_id":"<UUID>","app_version":"<빌드 버전>","platform":"browser","sent_at":"<ISO 시각>","records":[{"type":"request","route":"/meetings/:id","method":"GET","status":200,"duration_ms":80,"ts":"<ISO 시각>"}]}
4. 이름·전화·이메일 같은 입력값, 사용자 계정 ID, 요청·응답 본문, 쿠키·토큰·쿼리 문자열은 보내지 마. 주소 안의 실제 값은 :id로 바꾸고 오류에서 개인정보를 지워.
5. 쉽앤핑 주소로 가는 요청은 기록하지 말고 전송 오류가 앱 동작을 막지 않게 해. 묶음은 64KB·100건 이내로 나눠. 페이지를 떠날 때도 인증 헤더를 유지해 남은 기록을 보내.
6. 앱 코드를 읽고 주소별 한국어 기능 이름을 만들어 수집 키로 POST "${base}/v1/feature-map" 에 한 번 보내. 형식은 [{"route":"/meetings/:id","method":"GET","name":"모임 보기"}], 최대 200개야.
7. 배포 후 앱을 한 번 써 보고 기록 전송 응답이 202인지 확인하는 방법을 알려 줘.

키는 코드에 직접 쓰지 말고 .env·배포 설정으로, 깃에 올리지 마.
앞에서 지정한 쉽앤핑 수집 주소(INGEST_URL)는 예외야. ${connectRestriction}`;
}

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
