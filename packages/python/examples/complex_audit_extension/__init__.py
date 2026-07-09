from handoffkit.extensions import Extension
from .tools import query_database, verify_security_policy, post_audit_alert
from .recipes import audit_recipe

extension = Extension(
    name="complex_audit_extension",
    description="A complex multi-step security and database audit plugin.",
    version="1.0.0",
    tools=[query_database, verify_security_policy, post_audit_alert],
    recipes=[audit_recipe],
)
