# financewiki-viewer
Static iPhone viewer shell for a private FinanceWiki repository.

## Graph View

문서를 연 뒤 `그래프`를 누르면 GitHub 정본의
`.financewiki/generated/graph/v1/graph-index.json`을 필요할 때만 읽는다.
Markdown 전체를 다시 스캔하지 않으며, 인덱스는 연결 저장소별로 로컬에 보조 캐시된다.

- Local 1: 직접 Wiki Link와 backlink
- Local 2: 링크 거리 2 이하
- Global: 전체 문서 Link 그래프
- Links / Entities / Semantic: 관계 계층별 선택 표시. Semantic은 `model_reviewed`이고 `review_required: false`인 관계만 표시

그래프는 한 손가락 이동과 두 손가락 확대·축소를 지원한다. 확대 시 노드 라벨을 표시하고 Local 보기에서는 라벨이 겹치지 않도록 노드를 추가로 밀어낸다. Global은 성능과 형태 안정성을 위해 폴더별 정적 군집으로 표시한다.
