# 연결 확인용 웹앱

두 앱 모두 독서 모임에 한 자리를 신청하고 신청 수를 조회한다. `with-server`는 Node 서버 메모리에, `browser-only`는 브라우저의 localStorage에 신청 수를 보관한다. 각 폴더의 `before/`와 `after/`에서 연결 전후를 비교할 수 있다.

레포 루트에서 다음 명령을 실행한다.

```sh
bash scripts/verify-local.sh
```

Docker, Node 24 이상, Python 3, Worker README의 Rust 도구와 worker-build, Chrome이 필요하다. Linux에서는 설치된 Chromium을 자동으로 찾으며 다른 경로는 `CHROME_BIN`으로 지정한다. 기존 로컬 DB와 별도의 Supabase 프로젝트를 만들고 실행이 끝나면 해당 프로젝트와 테스트 프로세스를 정리한다. 비밀값 검사는 설치한 gitleaks 또는 `GITLEAKS_BIN` 경로를 사용한다.

연결 요청문은 S4의 `buildConnectPrompt`로 생성한다. `node scripts/t10-prompts.mjs`로 두 공개 사본을 갱신할 수 있다. 실제 실행에서는 회원별 공개 키를 넣은 전문을 임시 폴더에 저장하고, 키 한 곳을 `<PUBLIC_KEY>`로 바꾼 결과가 각 앱의 `connect.txt`와 같은지 확인한다. S4가 HTTPS만 허용하므로 시험 중에는 같은 루프백 호스트와 포트에서 HTTP를 쓴다.

서버 예제는 `node examples/with-server/after/server.mjs`로 실행한다. 수집 설정은 서버 환경의 `INGEST_URL`, `SHIPPING_PUBLIC_KEY`, `SHIPPING_SERVER_KEY`, `BUILD_VERSION`에서 읽는다. 정적 예제는 `examples/`를 정적 파일로 제공하고 `/browser-only/after/`를 연다. 빌드 때 `shipping-config.js`에 수집 주소, 공개 키, 빌드 버전을 채운다. 신청 수만 정수로 표시하고 전송할 주소와 기능 이름은 코드에 고정했다.

연결 후 신청과 조회를 한 번씩 하고 브라우저 네트워크 탭에서 30초 안에 `/v1/ingest`의 202 응답을 확인한다. 서버 앱은 전송이 서버에서 일어나므로 S4에서 첫 도착 시각과 두 기능 이름을 확인한다. 자동 검사는 두 앱 모두 회원용 조회 코드로 이 결과까지 대조한다.
