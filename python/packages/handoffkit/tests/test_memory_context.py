from __future__ import annotations

import json
import subprocess
import sys
import uuid
from pathlib import Path

import pytest

from handoffkit import (
    Agent,
    ContextDocument,
    ContextPack,
    ContextRetriever,
    HandoffProtocol,
    JsonMemoryStore,
    MemoryItem,
    MemoryReport,
    MemoryStore,
    ProjectIndexer,
)

ROOT = Path(__file__).resolve().parents[1]
TMP_ROOT = ROOT / "tests" / "_tmp_memory_context"


def make_workspace() -> Path:
    path = TMP_ROOT / uuid.uuid4().hex
    path.mkdir(parents=True, exist_ok=True)
    return path


def test_memory_item_json_roundtrip() -> None:
    item = MemoryItem(
        content="Use argparse for calculator CLI.",
        kind="decision",
        tags=["cli", "calculator"],
        metadata={"source": "Architect"},
    )

    loaded = MemoryItem.from_json(item.to_json())

    assert loaded.content == item.content
    assert loaded.kind == "decision"
    assert loaded.tags == ["cli", "calculator"]
    assert loaded.metadata["source"] == "Architect"


def test_memory_store_add_get_search_delete() -> None:
    store = MemoryStore()
    item = store.add("Use pytest for calculator behavior.", tags=["tests"])

    assert store.get(item.id) is item
    assert store.search("calculator pytest") == [item]
    assert store.delete(item.id) is True
    assert store.get(item.id) is None


def test_json_memory_store_persists_items() -> None:
    path = make_workspace() / "memory.json"
    store = JsonMemoryStore(str(path))
    item = store.add("Persist release decision.", kind="decision")

    loaded = JsonMemoryStore(str(path))

    assert loaded.get(item.id) is not None
    assert loaded.search("release decision")[0].content == "Persist release decision."


def test_json_memory_store_reports_corrupt_json() -> None:
    path = make_workspace() / "memory.json"
    path.write_text("{not json", encoding="utf-8")

    with pytest.raises(ValueError, match="Invalid JSON memory store"):
        JsonMemoryStore(str(path))


def test_project_indexer_indexes_text_and_ignores_build_dirs() -> None:
    project = make_workspace()
    (project / "src").mkdir()
    (project / "src" / "calculator.py").write_text(
        "def add(a, b):\n    return a + b\n",
        encoding="utf-8",
    )
    (project / "dist").mkdir()
    (project / "dist" / "generated.py").write_text("secret = True\n", encoding="utf-8")
    (project / "binary.bin").write_bytes(b"\x00\x01")

    docs = ProjectIndexer(str(project)).index()
    indexed_paths = [doc.path.replace("\\", "/") for doc in docs]

    assert indexed_paths == ["src/calculator.py"]
    assert docs[0].metadata["extension"] == ".py"
    assert "calculator.py" in docs[0].summary


def test_context_retriever_and_pack_serialization() -> None:
    docs = [
        ContextDocument(
            path="calculator.py",
            content="argparse divide pytest",
            summary="Calculator CLI implementation.",
        ),
        ContextDocument(path="README.md", content="unrelated", summary="Docs."),
    ]
    memory = MemoryItem(content="Use argparse.", kind="decision")
    matches = ContextRetriever(docs).search("argparse pytest")
    pack = ContextPack(query="calculator tests", documents=matches, memories=[memory])

    payload = json.loads(pack.to_json())

    assert [doc.path for doc in matches] == ["calculator.py"]
    assert payload["query"] == "calculator tests"
    assert "calculator.py" in pack.to_markdown()
    assert "`decision` Use argparse." in pack.to_markdown()


def test_agent_run_with_context_uses_memory_search() -> None:
    store = MemoryStore()
    store.add("Calculator CLI uses argparse.", kind="decision", tags=["calculator"])
    context = ContextPack(
        query="calculator",
        documents=[
            ContextDocument(
                path="README.md",
                content="Calculator CLI",
                summary="Calculator project docs.",
            )
        ],
    )
    agent = Agent("Architect", "Plan with context.")

    result = agent.run_with_context("Plan calculator argparse implementation.", context, store)

    assert result.success is True
    assert result.context_used is context
    assert len(result.memories_used) == 1
    assert "Agent: Architect" in result.final_output


def test_memory_report_serialization() -> None:
    item = MemoryItem(content="Decision", kind="decision")
    report = MemoryReport(
        memories_stored=[item],
        searches_executed=["Decision"],
        context_documents_used=["README.md"],
        final_result="Done",
    )

    assert report.to_dict()["final_result"] == "Done"
    assert "README.md" in report.to_markdown()


def test_context_refs_move_through_handoff_protocol() -> None:
    state = HandoffProtocol(mode="hybrid_state").transfer(
        from_agent=Agent("Architect", "Plan"),
        to_agent=Agent("Coder", "Build"),
        task="Build",
        summary="Ready",
        context_refs=["README.md"],
    )

    assert state.validate().context_refs == ["README.md"]


@pytest.mark.parametrize(
    "script_name",
    ["memory_demo.py", "project_context_demo.py", "context_handoff_demo.py"],
)
def test_memory_context_examples_run(script_name: str) -> None:
    completed = subprocess.run(
        [sys.executable, str(ROOT / "examples" / "demos" / script_name)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 0, completed.stdout + completed.stderr
