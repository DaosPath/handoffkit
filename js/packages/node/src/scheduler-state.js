import { VersionedStateFile } from "./durable-security.js";
import { SecurityError } from "@handoffkit/csp";

export class FileSchedulerStateStore {
  constructor(filePath, { maxFileBytes = 16 * 1024 * 1024 } = {}) {
    this.stateFile = new VersionedStateFile(filePath, { maxFileBytes });
  }

  get path() { return this.stateFile.path; }

  load() {
    const value = this.stateFile.load();
    if (value === null) return null;
    const { checksum: _checksum, ...payload } = value;
    return payload;
  }

  commit(payload) {
    try {
      this.stateFile.commit(payload);
    } catch (error) {
      if (error?.code === "replay_state_durability_uncertain") {
        throw new SecurityError(
          "Scheduler state committed but directory sync was uncertain.",
          {
            code: "scheduler_state_durability_uncertain",
            details: { ...error.details, committed: true },
          },
        );
      }
      throw error;
    }
  }

  backup(destination) { this.stateFile.backup(destination); }

  restore(source) { this.stateFile.restore(source); }

  quarantine(reason) { return this.stateFile.quarantine(reason); }
}
