# FinanceWiki Mobile Viewer

비공개 `financewiki-private` 문서를 GitHub 인증으로 읽는 공개 정적 iPhone/PWA shell입니다. 이 저장소에는 Markdown 원문, 주제 인덱스 데이터, PAT가 들어가지 않습니다.

## 탐색

- **폴더**: 기존 `viewer-index.json`을 이용한 문서 트리와 제목·경로 검색
- **주제**: `.financewiki/generated/topics/v2/topic-index.json`에서 승인된 표준 태그만 읽어 범주별 탐색·태그 내 문서 검색
- **문서**: 해시태그와 같은 주제의 관련 문서 최대 8개 표시. 원문은 클릭할 때만 인증 요청
- 주제 인덱스를 읽을 수 없으면 폴더 탐색을 그대로 제공하고, 토큰과 데이터는 공개 호스팅 영역에 저장하지 않음

## 그래프

`.financewiki/generated/topics/v2/graph-index.json`을 요청해 직접 Wiki Link와 Topic 노드를 시각화합니다. 그래프 태그를 누르면 해당 주제의 문서 목록을 엽니다. v2가 없을 때만 기존 v1 그래프로 대체하며, 그 경우 직접 링크 탐색을 유지합니다. 그래프는 한 손가락 이동과 두 손가락 확대·축소를 지원합니다.

## 개발·검증

```bash
node --check app.mjs
node --test tests/*.test.mjs
```

GitHub Pages는 `.github/workflows/deploy-iphone-viewer.yml`이 `main` 변경 시 자동 배포합니다. 오직 공개 shell을 호스팅하며 데이터는 비공개 GitHub Contents API로 필요할 때 읽습니다.
