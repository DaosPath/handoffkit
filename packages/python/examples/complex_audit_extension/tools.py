from handoffkit.tool import tool

@tool
def query_database(user_id: str) -> str:
    """Query user profile information from the database."""
    if user_id == "admin":
        return "user_id: admin, role: SuperUser, status: Active, last_login: 2 minutes ago"
    return f"user_id: {user_id}, role: StandardUser, status: Active, last_login: 5 days ago"

@tool
def verify_security_policy(user_data: str) -> str:
    """Verify if the user data violates any security policies."""
    if "SuperUser" in user_data:
        return "Security status: WARNING - SuperUser account accessed. Requires immediate logging."
    return "Security status: PASS - StandardUser access compliant."

@tool
def post_audit_alert(alert_message: str) -> str:
    """Post an audit alert message to the monitoring logs or alerts system."""
    return f"ALERT DISPATCHED: {alert_message}"
