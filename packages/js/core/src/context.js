import { toJSONString } from "./utils.js";

export class ContextDocument {
  constructor({ path, content, summary = "", metadata = {} } = {}) {
    this.path = path;
    this.content = content;
    this.summary = summary;
    this.metadata = { ...metadata };
  }

  toDict() {
    return {
      path: this.path,
      content: this.content,
      summary: this.summary,
      metadata: this.metadata,
    };
  }

  toJSON() {
    return this.toDict();
  }

  toJSONString(space = 2) {
    return JSON.stringify(this.toJSON(), null, space);
  }

  static fromJSON(value) {
    const data = typeof value === "string" ? JSON.parse(value) : value;
    return new ContextDocument(data);
  }
}

export class ContextRetriever {
  constructor(documents = []) {
    this.documents = [...documents];
  }

  search(query, { limit = 5 } = {}) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];

    const scored = [];
    for (const doc of this.documents) {
      const haystack = `${doc.path}\n${doc.summary}\n${doc.content}`.toLowerCase();
      let score = 0;
      for (const term of terms) {
        let pos = 0;
        while (true) {
          pos = haystack.indexOf(term, pos);
          if (pos >= 0) {
            score++;
            pos += term.length;
          } else {
            break;
          }
        }
      }

      if (score > 0) {
        scored.push({ score, doc });
      }
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.doc.path.localeCompare(b.doc.path);
    });

    return scored.slice(0, limit).map(item => item.doc);
  }
}

export class ContextPack {
  constructor({ query, documents = [], memories = [], summary = "", metadata = {} } = {}) {
    this.query = query;
    this.documents = (Array.isArray(documents) ? documents : []).map((doc) =>
      doc instanceof ContextDocument ? doc : ContextDocument.fromJSON(doc),
    );
    this.memories = Array.isArray(memories) ? [...memories] : [];
    this.summary = summary;
    this.metadata = { ...metadata };
  }

  toDict() {
    return {
      query: this.query,
      documents: this.documents.map(doc => doc.toDict()),
      memories: this.memories.map(m => (typeof m.toDict === "function" ? m.toDict() : m)),
      summary: this.summary,
      metadata: this.metadata,
    };
  }

  toJSON() {
    return this.toDict();
  }

  toJSONString(space = 2) {
    return JSON.stringify(this.toJSON(), null, space);
  }

  toMarkdown() {
    const docsStr = this.documents.map(doc => `- \`${doc.path}\`: ${doc.summary}`).join("\n");
    const memoriesStr = this.memories.map(m => `- \`${m.kind}\` ${m.content}`).join("\n");
    return [
      "# Context Pack",
      "",
      "## Query",
      this.query,
      "",
      "## Summary",
      this.summary || "No summary.",
      "",
      "## Documents",
      docsStr || "- none",
      "",
      "## Memories",
      memoriesStr || "- none",
    ].join("\n");
  }

  static fromJSON(value) {
    const data = typeof value === "string" ? JSON.parse(value) : value;
    return new ContextPack(data);
  }
}

export class ContextRunResult {
  constructor({ finalOutput, contextUsed = null, memoriesUsed = [], success = true } = {}) {
    this.finalOutput = finalOutput;
    this.contextUsed = contextUsed instanceof ContextPack ? contextUsed : (contextUsed ? ContextPack.fromJSON(contextUsed) : null);
    this.memoriesUsed = Array.isArray(memoriesUsed) ? [...memoriesUsed] : [];
    this.success = Boolean(success);
  }

  toDict() {
    return {
      final_output: this.finalOutput,
      context_used: this.contextUsed ? this.contextUsed.toDict() : null,
      memories_used: this.memoriesUsed.map(m => (typeof m.toDict === "function" ? m.toDict() : m)),
      success: this.success,
    };
  }

  toJSON() {
    return this.toDict();
  }

  toJSONString(space = 2) {
    return JSON.stringify(this.toJSON(), null, space);
  }

  static fromJSON(value) {
    const data = typeof value === "string" ? JSON.parse(value) : value;
    return new ContextRunResult({
      finalOutput: data.finalOutput ?? data.final_output,
      contextUsed: data.contextUsed ?? data.context_used,
      memoriesUsed: data.memoriesUsed ?? data.memories_used,
      success: data.success,
    });
  }
}
