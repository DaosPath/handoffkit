from handoffkit.extensions import Extension

from .recipes import audit_recipe
from .tools import post_audit_alert, query_database, verify_security_policy

extension = Extension(
    name="complex_audit_extension",
    description="A complex multi-step security and database audit plugin.",
    version="1.0.0",
    tools=[query_database, verify_security_policy, post_audit_alert],
    recipes=[audit_recipe],
)
