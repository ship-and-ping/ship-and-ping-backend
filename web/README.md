# 쉽앤핑 회원 웹

Node.js 24와 npm을 사용한다. 저장소 루트에서 다음 순서로 실행한다.

```sh
npm ci --prefix web
cp web/.env.example web/.env.local
npm run dev --prefix web
```

| web/.env.local 항목 | 값 |
|---|---|
| VITE_SUPABASE_URL | 프로젝트의 HTTPS 기본 주소 |
| VITE_SUPABASE_PUBLISHABLE_KEY | 브라우저에 공개할 수 있는 sb_publishable_ 키 |
| VITE_INGEST_URL | 기록 수집 Worker의 HTTPS 기본 주소. /v1/ingest 경로는 요청문이 붙인다. |

환경값이 없으면 개발 설정 안내가 열린다. 로그인 리디렉션은 웹의 `/login` 경로이다. Google 및 이메일 링크는 Supabase Auth의 제공자 설정과 리디렉션 허용 목록이 필요하다.

```sh
npm run lint --prefix web
npm run typecheck --prefix web
npm test --prefix web
npm run build --prefix web
```

테스트는 메모리 라우터와 가짜 데이터 클라이언트로 실행한다. Cloudflare Pages의 루트는 `web`, 빌드 명령은 `npm run build`, 출력 폴더는 `dist`이다. 빌드 시점에 위 환경값을 제공한다.

수집 키와 서버 키 원문은 연결 화면에서만 유지한다. 새로고침 후 새 키가 필요하면 이전 키가 24시간 뒤 만료된다는 안내를 확인하고 발급한다. 서버 키는 배포 환경의 SHIPPING_SERVER_KEY에 직접 넣는다. 이름표 제안만 있고 해당 기능 기록이 없으면 첫 사용 후 저장할 수 있다.
