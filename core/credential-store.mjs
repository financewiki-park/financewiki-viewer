const STORAGE_KEY = "financewiki.viewer.credentials.v1";
const INDEX_KEY = "financewiki.viewer.index.v1";

function safeParse(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export const credentialStore = {
  load() {
    const persistent = safeParse(localStorage.getItem(STORAGE_KEY));
    if (persistent) return persistent;
    const legacySession = safeParse(sessionStorage.getItem(STORAGE_KEY));
    if (legacySession) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(legacySession));
      sessionStorage.removeItem(STORAGE_KEY);
    }
    return legacySession;
  },
  save(config) {
    const serialized = JSON.stringify(config);
    sessionStorage.removeItem(STORAGE_KEY);
    localStorage.setItem(STORAGE_KEY, serialized);
  },
  clear() {
    sessionStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(INDEX_KEY);
  },
  saveIndex(repositoryKey, payload) {
    // 오프라인용 보조 사본이므로 저장 공간 부족 등으로 실패해도 연결을 막지 않는다.
    try {
      localStorage.setItem(INDEX_KEY, JSON.stringify({ repositoryKey, payload }));
      return true;
    } catch {
      localStorage.removeItem(INDEX_KEY);
      return false;
    }
  },
  loadIndex(repositoryKey) {
    const cached = safeParse(localStorage.getItem(INDEX_KEY));
    return cached?.repositoryKey === repositoryKey ? cached.payload : null;
  },
};
