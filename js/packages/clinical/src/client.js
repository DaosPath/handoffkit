import { OFFICIAL_CASE_COUNT } from "./constants.js";
import { ClinicalError } from "./wire.js";
import { ClinicalRun } from "./models.js";

export class ClinicalClient {
  constructor(options = {}) {
    this.baseUrl = String(options.baseUrl || "/api/clinical/v1beta").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
  }

  async _request(method, path, body) {
    if (!this.fetchImpl) {
      throw new ClinicalError("fetch is unavailable", { code: "provider_unavailable" });
    }
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new ClinicalError(payload.message || "clinical request failed", {
        code: payload.code || "invalid_request",
        details: payload.details || {},
      });
    }
    return payload;
  }

  async manifests() {
    return this._request("GET", "/manifests");
  }

  async createRun(body) {
    return new ClinicalRun(await this._request("POST", "/runs", body));
  }

  async getRun(runId) {
    return new ClinicalRun(await this._request("GET", `/runs/${runId}`));
  }

  async act(runId, body) {
    return new ClinicalRun(await this._request("POST", `/runs/${runId}/actions`, body));
  }

  async createBenchmark(body) {
    return this._request("POST", "/benchmarks", body);
  }

  async getBenchmark(id) {
    return this._request("GET", `/benchmarks/${id}`);
  }

  async report(id) {
    return this._request("GET", `/benchmarks/${id}/report`);
  }
}

export const OFFICIAL_GATE = OFFICIAL_CASE_COUNT;
