# 쉽앤핑 홍보 릴스 1편

[최종 MP4](final/ship-and-ping-reel-01.mp4) · 30.5초 · 1080 × 1920 · 30fps · H.264 · 무음

최종 파일은 2,628,864바이트다. Chrome에서 915프레임을 처음부터 끝까지 재생했고 누락 프레임은 0이었다. 검은 프레임과 오디오 트랙은 0개였으며, 대표 프레임 여덟 장에서 자막·버튼·해결 문장의 배치를 확인했다.

## 대본과 대표 프레임

| 구간 | 큰 글자 | 화면 종류와 내용 |
|---|---|---|
| [0–3초](frames/01.png) | AI로 만든 내 앱, 고장 난 걸 사용자한테 먼저 들었나요? | 브랜드 애니메이션. 양이 졸다가 “신청이 안 돼요” 말풍선을 받는다. |
| [3–7.8초](frames/02.png) | 어디가 문제인지 모르고 / AI에겐 "안 돼요"만 말하고 / 고쳐졌는지도 모르고 | 브랜드 애니메이션. 세 문장을 1.6초씩 차례로 보여 주고 양 곁에 말풍선이 쌓인다. |
| [7.8–10.4초](frames/03.png) | 이제 쉽앤핑이 대신 지켜볼게요 | 브랜드 애니메이션. 양이 말풍선으로 답하고 민트 레이더 뿔과 워드마크가 등장한다. |
| [10.4–14.9초](frames/04.png) | 요청문 붙여넣기 한 번이면 연결 끝 | 실제 연결 화면에서 요청문 복사 → 중립적인 코딩 AI 입력창에 붙여넣기 → 실제 연결 화면의 “기록이 도착했어요”. |
| [14.9–19초](frames/05.png) | 문제가 생기면 쉬운 말로 먼저 알려 줘요 | 실제 홈의 “분석이 느려졌어요” 카드와 평소·최근 속도. 카드 위 양의 뿔이 한 번 울린다. |
| [19–23.3초](frames/06.png) | AI에 보낼 말까지 정리해 줘요 | 실제 문제 상세에서 “AI에 보낼 내용 복사”를 누르고 “보낼 내용 미리 보기”를 펼친다. |
| [23.3–27.3초](frames/07.png) | 고친 뒤엔 실제 사용으로 확인해요 | 실제 문제 상세의 타임라인이 “새 버전 감지”에서 “해결됐어요”로 바뀐다. 양 둘레에 민트 고리가 한 번 나타난다. |
| [27.3–30.5초](frames/08.png) | 내 앱, 이제 쉽앤핑에 맡겨 보세요 | 양과 공식 워드마크, 서비스 주소. |

마지막 장면에는 `ship-and-ping.pages.dev`를 넣었다. 배포 워크플로가 참조하는 GitHub `production` 환경의 `CLOUDFLARE_PAGES_PROJECT` 값은 `ship-and-ping`이며 해당 주소의 공개 첫 화면 제목도 “쉽앤핑 · 내 앱 모니터링”으로 확인했다. [배포 워크플로](../../.github/workflows/deploy.yml) · [서비스](https://ship-and-ping.pages.dev/)

## 데모 데이터와 녹화

앱 소스 기준은 `13ed80e`다. Vite가 레포의 `web/index.html`과 `web/src`를 직접 제공한다. [데모 데이터](demo.mjs)가 기존 [화면 검수용 데이터](../../web/qa/fixtures.mjs)를 바탕으로 브라우저의 요청에 응답한다. “예제 웹앱”의 “분석” 기능이 연결 대기, 첫 기록 도착, 느림 알림, 새 버전 감지, 해결 순으로 바뀐다. 회원 정보와 키는 로컬 검수용 값이고, 유일하게 연출한 [코딩 AI 입력창](neutral.html)은 붙여넣은 키를 “[데모 키]”로 가린다.

[녹화 코드](record.spec.mjs)가 1440 × 900 CSS 픽셀, 기기 배율 2의 Chrome에서 실제 버튼과 링크를 조작한다. 2880 × 1800 원본 영상은 `raw/`, 편집용 확대 영상은 `capture/`에 생성된다. 양은 [공식 SVG](../../docs/design/brand/sheep.svg)의 기존 눈·머리·뿔 그룹을 움직이며, [워드마크](../../docs/design/brand/ship-and-ping-wordmark.png)는 원본 타일을 사용한다.

## 다시 만들기

Chrome과 Noto Sans KR이 설치되어 있고 `ffmpeg`, `ffprobe`를 PATH에서 실행할 수 있는 환경에서 시작한다. 합성 단계에서 시스템의 Noto Sans KR 가변 글꼴을 읽는다. 별도 위치에 설치했다면 같은 글꼴 파일을 `marketing/reel-01/assets/NotoSansKR-VF.ttf`에 둔다. 아래는 레포 루트에서 실행하는 Windows 명령이다. 기존 확대 영상이 있고 편집만 바꿀 때는 세 번째 명령부터 실행한다.

```powershell
npm.cmd --prefix marketing/reel-01 ci --cache marketing/reel-01/.cache/npm --no-audit --no-fund --ignore-scripts
npm.cmd --prefix marketing/reel-01 run capture
npm.cmd --prefix marketing/reel-01 run render
npm.cmd --prefix marketing/reel-01 run verify
```

렌더 명령은 로컬 HyperFrames에 `HYPERFRAMES_NO_TELEMETRY=1`, `DO_NOT_TRACK=1`, `HYPERFRAMES_NO_UPDATE_CHECK=1`을 전달한다. 검수 명령은 전체 영상 디코딩, 검은 프레임 탐지, 큰 글자의 안전 영역, 오디오 트랙 수, 해상도·프레임 수를 확인하고 Chrome에서 영상을 끝까지 재생한다. 대표 PNG는 `frames/01.png`부터 `08.png`, 재생 기록과 축소 검수 이미지는 `qa/`에 기록한다.

## 제작 환경

| 용도 | 사용한 버전 |
|---|---|
| 영상 합성 | HyperFrames 0.9.85, 패키지에 포함된 GSAP 3.15.0 |
| 실제 앱 구동·녹화 | Vite 7.3.8, React 19.3.1, Playwright 1.65.0, Chrome 157.0.8103.52 |
| 소스 인코딩·검수 | 시스템에 설치된 FFmpeg·ffprobe 9.0.2 |
| 실행 환경 | Node.js 24.20.0, npm 11.19.0, Windows |
