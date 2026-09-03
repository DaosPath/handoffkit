import { Extension } from "@handoffkit/core";
import { queryDatabase, verifySecurityPolicy, postAuditAlert } from "./tools.js";
import { auditRecipe } from "./recipes.js";

export const extension = new Extension({
  name: "complex_audit_extension",
  description: "A complex multi-step security and database audit plugin.",
  version: "1.0.0",
  tools: [queryDatabase, verifySecurityPolicy, postAuditAlert],
  recipes: [auditRecipe],
});
