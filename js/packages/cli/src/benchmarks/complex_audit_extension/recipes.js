import { Recipe } from "@handoffkit/core";

export const auditRecipe = new Recipe({
  name: "complex_audit_pipeline",
  description: "Query user db entry, run security checks, and log status.",
  steps: [
    {
      name: "query_step",
      agent: "Database Clerk",
      task: "Fetch user details from database."
    },
    {
      name: "verify_step",
      agent: "Security Auditor",
      task: "Verify user permissions and flag warning alerts if role is elevated."
    },
    {
      name: "dispatch_step",
      agent: "System Dispatcher",
      task: "Post security alert and report audit compliance."
    }
  ]
});
