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

그래프는 한 손가락 이동과 두 손가락 확대·축소를 지원한다. Local 보기는 처음 열 때만 짧게 약한 노드 반발력·노드 및 라벨 충돌·링크 힘으로 자리를 잡고, 확대·이동 중에는 안정된 배치를 유지한 채 카메라만 움직인다. 확대 시 17px 라벨을 표시하며 노드와 선의 화면상 크기는 과도하게 커지지 않는다. Global은 성능과 형태 안정성을 위해 폴더별 정적 군집으로 표시한다.
