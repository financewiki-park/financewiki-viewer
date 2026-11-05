// Read-only Topic Graph v2 adapter for the existing private GitHub mobile viewer.
// The canonical viewer-index remains authoritative for document existence and paths.
export const TOPIC_INDEX_PATH = ".financewiki/generated/topics/v2/topic-index.json";

function validText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export class TopicIndex {
  constructor(payload, viewerIndex) {
    if (payload?.schema_version !== "2.0"
        || !Array.isArray(payload.topics)
        || !Array.isArray(payload.documents)
        || !Array.isArray(viewerIndex?.documents)) {
      throw new Error("지원하지 않는 주제 인덱스 형식입니다.");
    }

    const realDocuments = new Map(viewerIndex.documents.map((doc) => [doc.path, doc]));
    const approved = new Map();
    for (const item of payload.topics) {
      if (!validText(item?.name) || !validText(item?.category)) continue;
      if (approved.has(item.name)) throw new Error("주제 인덱스에 중복 태그가 있습니다.");
      approved.set(item.name, { name: item.name, category: item.category });
    }

    const tagByPath = new Map();
    const pathsByTopic = new Map([...approved.keys()].map((tag) => [tag, new Set()]));
    for (const row of payload.documents) {
      if (!validText(row?.path) || !realDocuments.has(row.path)) continue;
      const tags = [...new Set(Array.isArray(row.tags) ? row.tags.filter((tag) => approved.has(tag)) : [])];
      tagByPath.set(row.path, tags);
      for (const tag of tags) pathsByTopic.get(tag).add(row.path);
    }

    this.tagsByPath = tagByPath;
    this.documentsByTopic = new Map(
      [...pathsByTopic].map(([tag, paths]) => [
        tag,
        viewerIndex.documents.filter((doc) => paths.has(doc.path)),
      ]),
    );
    this.topics = [...approved.values()]
      .map((item) => ({ ...item, count: this.documentsByTopic.get(item.name).length }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko"));
    this.topicByName = new Map(this.topics.map((item) => [item.name, item]));
  }

  tagsFor(path) {
    return this.tagsByPath.get(path) || [];
  }

  documentsFor(tag) {
    return this.documentsByTopic.get(tag) || [];
  }

  find(tag) {
    return this.topicByName.get(tag) || null;
  }

  groups() {
    const groups = new Map();
    for (const topic of this.topics) {
      if (!groups.has(topic.category)) groups.set(topic.category, []);
      groups.get(topic.category).push(topic);
    }
    return [...groups].map(([category, topics]) => ({ category, topics }));
  }
}
