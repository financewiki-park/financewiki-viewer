const DATABASE_NAME = "financewiki-viewer";
const DATABASE_VERSION = 1;
const STORE_NAME = "documents";
export const MAX_CACHE_ENTRIES = 20;

export function evictionKeys(entries, maxEntries = MAX_CACHE_ENTRIES) {
  if (entries.length <= maxEntries) return [];
  return [...entries]
    .sort((a, b) => a.lastAccessed - b.lastAccessed)
    .slice(0, entries.length - maxEntries)
    .map((entry) => entry.key);
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB 요청 실패"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB 트랜잭션 실패"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB 트랜잭션 중단"));
  });
}

export class DocumentCache {
  constructor(indexedDBImpl = globalThis.indexedDB, maxEntries = MAX_CACHE_ENTRIES) {
    this.indexedDB = indexedDBImpl;
    this.maxEntries = maxEntries;
    this.databasePromise = null;
  }

  async open() {
    if (!this.indexedDB) throw new Error("IndexedDB를 사용할 수 없습니다.");
    if (!this.databasePromise) {
      this.databasePromise = new Promise((resolve, reject) => {
        const request = this.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(STORE_NAME)) {
            const store = database.createObjectStore(STORE_NAME, { keyPath: "key" });
            store.createIndex("lastAccessed", "lastAccessed");
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("문서 캐시를 열 수 없습니다."));
      });
    }
    return this.databasePromise;
  }

  async get(repositoryKey, document) {
    try {
      const database = await this.open();
      const key = `${repositoryKey}:${document.path}`;
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const entry = await requestResult(store.get(key));
      if (!entry || entry.hash !== document.hash) {
        if (entry) store.delete(key);
        await transactionDone(transaction);
        return null;
      }
      entry.lastAccessed = Date.now();
      store.put(entry);
      await transactionDone(transaction);
      return entry.text;
    } catch {
      return null;
    }
  }

  async put(repositoryKey, document, text) {
    try {
      const database = await this.open();
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put({
        key: `${repositoryKey}:${document.path}`,
        repositoryKey,
        path: document.path,
        hash: document.hash,
        text,
        lastAccessed: Date.now(),
      });
      await transactionDone(transaction);
      await this.evict();
    } catch {
      // 캐시는 삭제 가능한 보조 수단이므로 실패해도 문서 열람을 막지 않는다.
    }
  }

  async evict() {
    const database = await this.open();
    const readTransaction = database.transaction(STORE_NAME, "readonly");
    const entries = await requestResult(readTransaction.objectStore(STORE_NAME).getAll());
    await transactionDone(readTransaction);
    const keys = evictionKeys(entries, this.maxEntries);
    if (!keys.length) return;
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    for (const key of keys) store.delete(key);
    await transactionDone(transaction);
  }

  async clear() {
    try {
      const database = await this.open();
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).clear();
      await transactionDone(transaction);
    } catch {
      // 이미 손상되거나 사용할 수 없는 캐시는 지울 필요가 없다.
    }
  }
}
