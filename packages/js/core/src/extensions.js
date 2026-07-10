import { Tool } from "./tools.js";

export class Extension {
  constructor({ name, description, version, recipes = [], tools = [], metadata = {} } = {}) {
    this.name = name;
    this.description = description;
    this.version = version;
    this.recipes = recipes; // array of Recipes
    this.tools = tools; // array of functions or Tool instances
    this.metadata = metadata;
  }

  validate() {
    if (!this.name || !this.name.trim()) {
      throw new Error("extension name must be a non-empty string");
    }
    for (const recipe of this.recipes) {
      if (recipe.validate) recipe.validate();
    }
    const toolNames = this.tools.map(item => {
      // In JS, check if it's a function or an object with a name property
      if (typeof item === "function") return item.name || "anonymous";
      if (item && typeof item === "object") return item.name || "unknown";
      return "invalid";
    });
    const duplicates = toolNames.filter((name, index) => name !== "invalid" && toolNames.indexOf(name) !== index);
    if (duplicates.length > 0) {
      throw new Error(`duplicate tool names: ${[...new Set(duplicates)].join(", ")}`);
    }
    return this;
  }

  toDict() {
    return {
      name: this.name,
      description: this.description,
      version: this.version,
      recipes: this.recipes.map(recipe => recipe.toDict ? recipe.toDict() : recipe),
      tools: this.tools.map(tool => {
        if (tool.toDict) return tool.toDict();
        if (typeof tool === "function") return { name: tool.name || "anonymous", type: "function" };
        return tool;
      }),
      metadata: this.metadata,
    };
  }

  toJS() {
    return this.toDict();
  }
}

export class ExtensionRegistry {
  constructor() {
    this._extensions = new Map();
  }

  register(extension) {
    if (!(extension instanceof Extension)) {
      extension = new Extension(extension);
    }
    extension.validate();
    if (this._extensions.has(extension.name)) {
      throw new Error(`Extension already registered: ${extension.name}`);
    }
    this._extensions.set(extension.name, extension);
    return extension;
  }

  get(name) {
    if (!this._extensions.has(name)) {
      throw new Error(`Extension not found: ${name}`);
    }
    return this._extensions.get(name);
  }

  list() {
    const keys = Array.from(this._extensions.keys()).sort();
    return keys.map(key => this._extensions.get(key));
  }

  recipes() {
    const list = [];
    for (const ext of this.list()) {
      list.push(...ext.recipes);
    }
    return list;
  }

  tools() {
    const list = [];
    for (const ext of this.list()) {
      list.push(...ext.tools);
    }
    return list;
  }
}

