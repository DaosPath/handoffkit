export class MemoryEntry {
  constructor({ role, content, metadata = {}, createdAt = null } = {}) {
    this.role = role;
    this.content = content;
    this.metadata = metadata;
    this.createdAt = createdAt || new Date().toISOString();
  }

  toDict() {
    return {
      role: this.role,
      content: this.content,
      metadata: this.metadata,
      created_at: this.createdAt,
    };
  }

  static fromDict(data) {
    return new MemoryEntry({
      role: data.role || "",
      content: data.content || "",
      metadata: data.metadata || {},
      createdAt: data.created_at || data.createdAt,
    });
  }
}

export class AgentMemory {
  constructor({ entries = [] } = {}) {
    this.entries = entries.map(item => item instanceof MemoryEntry ? item : MemoryEntry.fromDict(item));
  }

  add(role, content, metadata = {}) {
    const entry = new MemoryEntry({ role, content, metadata });
    this.entries.push(entry);
    return entry;
  }

  last(count = 5) {
    if (count <= 0) return [];
    return this.entries.slice(-count);
  }

  toText(count = 5) {
    return this.last(count).map(entry => `${entry.role}: ${entry.content}`).join("\n");
  }

  clear() {
    this.entries = [];
  }
}

export class MemoryItem {
  constructor({ id = null, content, kind = "note", tags = [], metadata = {}, createdAt = null, updatedAt = null } = {}) {
    this.id = id || Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    this.content = content;
    this.kind = kind;
    this.tags = Array.isArray(tags) ? tags : [];
    this.metadata = metadata;
    this.createdAt = createdAt || new Date().toISOString();
    this.updatedAt = updatedAt;
  }

  toDict() {
    return {
      id: this.id,
      content: this.content,
      kind: this.kind,
      tags: this.tags,
      metadata: this.metadata,
      created_at: this.createdAt,
      updated_at: this.updatedAt,
    };
  }

  toJS() {
    return this.toDict();
  }

  static fromDict(data) {
    return new MemoryItem({
      id: data.id,
      content: data.content || "",
      kind: data.kind || "note",
      tags: data.tags || [],
      metadata: data.metadata || {},
      createdAt: data.created_at || data.createdAt,
      updatedAt: data.updated_at || data.updatedAt,
    });
  }
}

export class MemoryStore {
  constructor({ items = [] } = {}) {
    this._items = new Map();
    for (const item of items) {
      const inst = item instanceof MemoryItem ? item : MemoryItem.fromDict(item);
      this._items.set(inst.id, inst);
    }
  }

  add(content, { kind = "note", tags = [], metadata = {} } = {}) {
    const item = new MemoryItem({ content, kind, tags, metadata });
    this._items.set(item.id, item);
    this._save();
    return item;
  }

  list() {
    return Array.from(this._items.values());
  }

  get(memoryId) {
    return this._items.get(memoryId) || null;
  }

  search(query, { limit = null } = {}) {
    if (!query) return [];
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = [];
    for (const item of this._items.values()) {
      const haystack = [
        item.content,
        item.kind,
        item.tags.join(" "),
        JSON.stringify(item.metadata),
      ].join(" ").toLowerCase();
      
      let score = 0;
      for (const term of terms) {
        let idx = -1;
        while ((idx = haystack.indexOf(term, idx + 1)) !== -1) {
          score++;
        }
      }
      
      if (score > 0) {
        scored.push({ score, item });
      }
    }
    
    // Sort: score descending, then createdAt ascending, then id ascending
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.item.createdAt !== b.item.createdAt) return a.item.createdAt.localeCompare(b.item.createdAt);
      return a.item.id.localeCompare(b.item.id);
    });
    
    const results = scored.map(entry => entry.item);
    return limit !== null ? results.slice(0, limit) : results;
  }

  delete(memoryId) {
    const existed = this._items.delete(memoryId);
    if (existed) {
      this._save();
    }
    return existed;
  }

  clear() {
    this._items.clear();
    this._save();
  }

  _save() {
    // In-memory no-op
  }
}

export class MemoryReport {
  constructor({ memoriesStored = [], searchesExecuted = [], contextDocumentsUsed = [], finalResult = "" } = {}) {
    this.memoriesStored = memoriesStored.map(item => item instanceof MemoryItem ? item : MemoryItem.fromDict(item));
    this.searchesExecuted = searchesExecuted;
    this.contextDocumentsUsed = contextDocumentsUsed;
    this.finalResult = finalResult;
  }

  toDict() {
    return {
      memories_stored: this.memoriesStored.map(item => item.toDict()),
      searches_executed: this.searchesExecuted,
      context_documents_used: this.contextDocumentsUsed,
      final_result: this.finalResult,
    };
  }

  toJS() {
    return this.toDict();
  }

  toMarkdown() {
    const memories = this.memoriesStored.map(item => `- ${item.kind}: ${item.content}`).join("\n");
    const searches = this.searchesExecuted.map(item => `- ${item}`).join("\n");
    const docs = this.contextDocumentsUsed.map(item => `- ${item}`).join("\n");
    return [
      "# Memory Report",
      "",
      "## Memories Stored",
      "",
      memories || "- none",
      "",
      "## Searches Executed",
      "",
      searches || "- none",
      "",
      "## Context Documents Used",
      "",
      docs || "- none",
      "",
      "## Final Result",
      "",
      this.finalResult,
    ].join("\n") + "\n";
  }
}

// ==========================================
// Extensions Registry
// ==========================================

