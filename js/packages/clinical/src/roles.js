import { PROVIDER_STATUS, ROLES } from "./constants.js";
import { ClinicalError } from "./wire.js";

export const ROLE_STATUS = Object.freeze({
  hypothesis: { declared: true, adapter: "scaffold", integrated: false, live_tested: false, available: false },
  test_selector: { declared: true, adapter: "scaffold", integrated: false, live_tested: false, available: false },
  challenger: { declared: true, adapter: "scaffold", integrated: false, live_tested: false, available: false },
  finalizer: { declared: true, adapter: "scaffold", integrated: false, live_tested: false, available: false },
  judge: { declared: true, adapter: "scaffold", integrated: false, live_tested: false, available: false },
});

export function executeRole(role, prompt, provider = "ollama") {
  const key = String(role || "").trim().toLowerCase();
  if (key === "judge" || ROLES.includes(key)) {
    const status = ROLE_STATUS[key === "judge" ? "judge" : key] || ROLE_STATUS.hypothesis;
    if (!status.available) {
      throw new ClinicalError("live role provider is unavailable", {
        code: "provider_unavailable",
        details: { role: key, provider, provider_status: PROVIDER_STATUS[provider] || {}, ...status },
      });
    }
  }
  throw new ClinicalError("unknown role", { code: "invalid_request", details: { role } });
}
