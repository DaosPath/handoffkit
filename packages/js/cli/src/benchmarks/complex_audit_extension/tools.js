import { defineTool } from "@handoffkit/core";

export const queryDatabase = defineTool({
  name: "query_database",
  description: "Query user profile information from the database.",
  parameters: {
    type: "object",
    properties: {
      userId: { type: "string" }
    },
    required: ["userId"]
  },
  execute: ({ userId }) => {
    if (userId === "admin") {
      return "user_id: admin, role: SuperUser, status: Active, last_login: 2 minutes ago";
    }
    return `user_id: ${userId}, role: StandardUser, status: Active, last_login: 5 days ago`;
  }
});

export const verifySecurityPolicy = defineTool({
  name: "verify_security_policy",
  description: "Verify if the user data violates any security policies.",
  parameters: {
    type: "object",
    properties: {
      userData: { type: "string" }
    },
    required: ["userData"]
  },
  execute: ({ userData }) => {
    if (userData.includes("SuperUser")) {
      return "Security status: WARNING - SuperUser account accessed. Requires immediate logging.";
    }
    return "Security status: PASS - StandardUser access compliant.";
  }
});

export const postAuditAlert = defineTool({
  name: "post_audit_alert",
  description: "Post an audit alert message to the monitoring logs or alerts system.",
  parameters: {
    type: "object",
    properties: {
      alertMessage: { type: "string" }
    },
    required: ["alertMessage"]
  },
  execute: ({ alertMessage }) => {
    return `ALERT DISPATCHED: ${alertMessage}`;
  }
});
