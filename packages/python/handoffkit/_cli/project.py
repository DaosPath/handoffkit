"""Project scaffolding, keys, and extension CLI helpers."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

from handoffkit.context import ProjectIndexer
from handoffkit.extensions import ExtensionRegistry
from handoffkit.recipes.showcases import showcase_names
from handoffkit.reports import write_report_files
from handoffkit.templates import TemplateScaffolder


def init_project(
    project_name: str,
    *,
    template: str | None = None,
    output: str = ".",
    force: bool = False,
) -> str:
    """Scaffold a HandoffKit starter project."""
    scaffolder = TemplateScaffolder()
    selected_template = template or "basic-agent"
    if template is None and project_name in scaffolder.list_templates():
        selected_template = project_name
    result = scaffolder.scaffold(
        project_name,
        template=selected_template,
        output=output,
        force=force,
    )
    rendered = result.to_markdown()
    if selected_template in showcase_names():
        script = selected_template.replace("-", "_") + ".py"
        rendered += (
            "\n## Next Commands\n\n"
            "```bash\n"
            f"cd {project_name}\n"
            f"python {script}\n"
            "handoffkit report runs/latest\n"
            "```\n"
        )
    return rendered


def init_project_interactive(
    default_project_name: str | None = None,
    *,
    template: str | None = None,
    output: str = ".",
    force: bool = False,
) -> str:
    """Scaffold a project interactively prompting for name, provider, and API key."""
    name = (default_project_name or "").strip()
    if not name:
        name = input("Project name (my-agent): ").strip() or "my-agent"
    else:
        inp_name = input(f"Project name ({name}): ").strip()
        if inp_name:
            name = inp_name

    selected_template = template or "basic-agent"
    inp_tmpl = input(f"Template ({selected_template}): ").strip()
    if inp_tmpl:
        selected_template = inp_tmpl

    provider = input("LLM Provider (openai/nvidia/groq/ollama/echo) [openai]: ").strip() or "openai"
    api_key = ""
    if provider not in ("echo", "ollama"):
        api_key = input(f"API Key for {provider.upper()}: ").strip()

    scaffolder = TemplateScaffolder()
    target_dir = Path(output) / name
    result = scaffolder.scaffold(
        name,
        template=selected_template,
        output=output,
        force=force,
    )
    rendered = result.to_markdown()

    env_lines = []
    if api_key:
        env_name = f"{provider.upper()}_API_KEY"
        env_lines.append(f"{env_name}={api_key}")
    
    if env_lines:
        env_path = target_dir / ".env"
        env_path.write_text("\n".join(env_lines) + "\n", encoding="utf-8")
        
        gitignore_path = target_dir / ".gitignore"
        if gitignore_path.exists():
            try:
                git_content = gitignore_path.read_text(encoding="utf-8")
                if ".env" not in git_content:
                    git_content += "\n.env\n"
                    gitignore_path.write_text(git_content, encoding="utf-8")
            except Exception:
                pass


    if provider == "openai":
        model = "gpt-4o-mini"
    elif provider == "nvidia":
        model = "meta/llama-3.1-8b-instruct"
    else:
        model = "default"
    config = {"provider": provider, "model": model}
    config_path = target_dir / "handoff.config.json"
    config_path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")

    rendered += (
        f"\n## Next Commands\n\n"
        f"cd {name}\n"
        f"Configured provider: {provider}\n"
        + ("Saved API Key to .env\n" if api_key else "No API Key saved\n")
    )
    return rendered


def set_key(name: str, value: str) -> str:
    """Set key in local .env."""
    env_path = Path(".env")
    content = ""
    if env_path.exists():
        content = env_path.read_text(encoding="utf-8")
    
    lines = [line.strip() for line in content.splitlines() if line.strip()]
    updated = False
    new_lines = []
    for line in lines:
        parts = line.split("=", 1)
        if parts[0].strip() == name:
            updated = True
            new_lines.append(f"{name}={value}")
        else:
            new_lines.append(line)
            
    if not updated:
        new_lines.append(f"{name}={value}")
        
    env_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
    return f"Set key {name} successfully in .env"


def delete_key(name: str) -> str:
    """Delete key from local .env."""
    env_path = Path(".env")
    if not env_path.exists():
        return "No .env file found."
        
    content = env_path.read_text(encoding="utf-8")
    lines = [line.strip() for line in content.splitlines() if line.strip()]
    new_lines = []
    for line in lines:
        parts = line.split("=", 1)
        if parts[0].strip() != name:
            new_lines.append(line)
            
    env_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
    return f"Deleted key {name} successfully from .env"


def list_keys() -> str:
    """List keys from local .env with redacted values."""
    env_path = Path(".env")
    if not env_path.exists():
        return "No keys configured (.env not found)."
        
    content = env_path.read_text(encoding="utf-8")
    lines = [line.strip() for line in content.splitlines() if line.strip()]
    if not lines:
        return "No keys configured (.env is empty)."
        
    rows = []
    for line in lines:
        parts = line.split("=", 1)
        key = parts[0].strip()
        val = parts[1].strip() if len(parts) > 1 else ""
        redacted = f"{val[:4]}...{val[-4:]} (redacted)" if len(val) > 8 else "[redacted]"
        rows.append(f"- {key}={redacted}")
        
    return "Configured Keys:\n" + "\n".join(rows)


def write_project_report(
    project_path: str = ".",
    *,
    output_dir: str = "reports",
    query: str = "handoffkit",
) -> str:
    """Index a project directory and write a JSON + Markdown report.

    Args:
        project_path: Root directory to index (default: current directory).
        output_dir:   Directory that receives the generated report files.
        query:        Search term used to filter the indexed documents.

    Returns:
        A short status string with the paths of the written files.
    """
    root = Path(project_path).resolve()
    docs = ProjectIndexer(root=str(root)).index()

    class _Report:
        def to_json(self) -> dict:  # type: ignore[override]
            return {
                "kind": "handoffkit-project-report",
                "root": str(root),
                "query": query,
                "document_count": len(docs),
                "documents": [
                    doc.to_json() if hasattr(doc, "to_json") else vars(doc)
                    for doc in docs[:20]
                ],
            }

        def to_markdown(self) -> str:
            rows = "\n".join(
                f"- `{doc.path}`: {doc.summary}" for doc in docs[:20]
            ) or "- none"
            return "\n".join([
                "# HandoffKit Project Report",
                "",
                f"Root: {root}",
                f"Documents: {len(docs)}",
                "",
                "## Documents",
                "",
                rows,
            ])

    report = _Report()
    json_path, markdown_path = write_report_files(report, "project-report", output_dir)
    return (
        f"HandoffKit project report\n"
        f"JSON: {json_path}\n"
        f"Markdown: {markdown_path}"
    )


def create_extension(name: str, output: str = ".", force: bool = False) -> str:
    """Scaffold a custom HandoffKit extension directory."""
    ext_dir = Path(output) / name
    if ext_dir.exists() and not force:
        raise FileExistsError(
            f"Extension directory {ext_dir} already exists. Use --force to overwrite."
        )

    ext_dir.mkdir(parents=True, exist_ok=True)
    
    init_content = f'''from handoffkit.extensions import Extension
from .tools import mi_herramienta
from .recipes import mi_receta

extension = Extension(
    name="{name}",
    description="Plugin personalizado {name}",
    version="1.0.0",
    tools=[mi_herramienta],
    recipes=[mi_receta]
)
'''

    tools_content = '''from handoffkit.tool import tool

@tool
def mi_herramienta(param: str) -> str:
    """Una herramienta de ejemplo."""
    return f"Procesado parametro: {param}"
'''

    recipes_content = '''from handoffkit.recipes import Recipe

mi_receta = Recipe(
    name="mi_receta_ejemplo",
    description="Una receta de ejemplo",
    steps=[]
)
'''

    (ext_dir / "__init__.py").write_text(init_content, encoding="utf-8")
    (ext_dir / "tools.py").write_text(tools_content, encoding="utf-8")
    (ext_dir / "recipes.py").write_text(recipes_content, encoding="utf-8")
    
    return f"Scaffolded extension {name} successfully in {ext_dir}."


def load_dynamic_extensions(registry: ExtensionRegistry) -> None:
    """Load dynamically configured extensions into the registry."""
    config_path = Path("handoff.config.json")
    if not config_path.exists():
        return
        
    try:
        import json
        config = json.loads(config_path.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"Warning: Failed to parse handoff.config.json: {exc}")
        return
        
    extensions = config.get("extensions", [])
    if not isinstance(extensions, list):
        return
        
    
    for ext_path_str in extensions:
        p = Path(ext_path_str)
        try:
            if p.is_dir() or ext_path_str.endswith(".py"):
                ext_dir = p.resolve()
                module_name = ext_dir.name
                
                parent_dir = str(ext_dir.parent)
                if parent_dir not in sys.path:
                    sys.path.insert(0, parent_dir)
                    
                if (ext_dir / "__init__.py").exists():
                    init_path = str(ext_dir / "__init__.py")
                    spec = importlib.util.spec_from_file_location(module_name, init_path)
                else:
                    spec = importlib.util.spec_from_file_location(module_name, str(ext_dir))

                if spec and spec.loader:
                    mod = importlib.util.module_from_spec(spec)
                    sys.modules[module_name] = mod
                    spec.loader.exec_module(mod)
                    if hasattr(mod, "extension"):
                        registry.register(mod.extension)
            else:
                mod = importlib.import_module(ext_path_str)
                if hasattr(mod, "extension"):
                    registry.register(mod.extension)
        except Exception as exc:
            print(f"Warning: Failed to load extension '{ext_path_str}': {exc}")


