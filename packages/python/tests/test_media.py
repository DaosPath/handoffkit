from __future__ import annotations

import json

import pytest

from handoffkit.recipes.media import (
    MEDIA_OPERATIONS,
    MediaAsset,
    MediaContext,
    MediaEditionOp,
    MediaWorkflowReport,
    SpeakerProfile,
    TranscriptSegment,
    apply_transcript_editions,
    build_creation_context,
    build_dubbing_plan,
    build_generation_context,
    extract_audio,
    ffmpeg_available,
    format_srt_timestamp,
    get_media_operation,
    handoff_media_context,
    list_media_pipelines,
    media_context_to_workflow_report,
    media_operation_catalog,
    mux_audio,
    plan_media_pipeline,
    read_transcript_json,
    write_srt,
    write_transcript_json,
)


def test_media_contracts_roundtrip() -> None:
    source = MediaAsset("video.mp4", "video", language="zh", duration_seconds=2.5)
    segment = TranscriptSegment(1, 0.0, 2.5, "你好", speaker="S1", language="zh")
    speaker = SpeakerProfile("S1", "Narrator", "es-calm", "es")
    dubbing = build_dubbing_plan([segment], {1: "Hola."}, [speaker])
    report = MediaWorkflowReport(
        success=True,
        source=source,
        target_language="es",
        transcript_segments=[segment],
        speakers=[speaker],
        dubbing_segments=dubbing,
        output_files=["subtitles_es.srt"],
    )

    loaded = MediaWorkflowReport.from_json(report.to_json())

    assert loaded.success is True
    assert loaded.source.language == "zh"
    assert loaded.dubbing_segments[0].target_text == "Hola."
    assert "Media Workflow Report" in loaded.to_markdown()


def test_transcript_json_and_srt(tmp_path) -> None:  # type: ignore[no-untyped-def]
    segments = [
        TranscriptSegment(1, 0.0, 1.25, "你好", speaker="S1"),
        TranscriptSegment(2, 1.5, 3.0, "再见", speaker="S2"),
    ]

    transcript_path = write_transcript_json(segments, tmp_path / "transcript.json")
    loaded = read_transcript_json(transcript_path)
    srt_path = write_srt(loaded, tmp_path / "subtitles.srt")
    payload = json.loads(transcript_path.read_text(encoding="utf-8"))

    assert payload["segments"][0]["text"] == "你好"
    assert loaded[1].speaker == "S2"
    assert "00:00:01,250" in srt_path.read_text(encoding="utf-8")


def test_srt_timestamp_format() -> None:
    assert format_srt_timestamp(3723.456) == "01:02:03,456"
    assert format_srt_timestamp(-1) == "00:00:00,000"


def test_ffmpeg_wrappers_fail_clearly_when_missing(tmp_path) -> None:  # type: ignore[no-untyped-def]
    assert ffmpeg_available("__missing_ffmpeg_binary__") is False
    with pytest.raises(RuntimeError, match="required"):
        extract_audio("input.mp4", tmp_path / "audio.wav", ffmpeg="__missing_ffmpeg_binary__")
    with pytest.raises(RuntimeError, match="required"):
        mux_audio(
            "input.mp4",
            "audio.wav",
            tmp_path / "output.mp4",
            ffmpeg="__missing_ffmpeg_binary__",
        )


def test_media_operation_catalog_is_ion_focused() -> None:
    catalog = media_operation_catalog()
    names = {item.name for item in catalog}
    assert names == set(MEDIA_OPERATIONS)
    for name in MEDIA_OPERATIONS:
        assert name.endswith("ion")
        assert get_media_operation(name).name == name
    assert "from_scratch" in list_media_pipelines()
    assert "video_dubbing" in list_media_pipelines()


def test_media_context_handoff_creation_generation_edition() -> None:
    created = build_creation_context("Make a 20s clip", target_language="es")
    assert created.operation == "creation"
    assert "generation" in created.next_operations

    generated = handoff_media_context(
        created, "generation", from_agent="creator", to_agent="generator"
    )
    assert generated.operation == "generation"
    assert generated.history == ["creation"]
    assert generated.metadata["last_handoff"]["from_agent"] == "creator"

    gen2 = build_generation_context("Narrate calmly", prompts=["line 1"], media_type="audio")
    assert gen2.operation == "generation"
    assert gen2.generation_prompts == ["line 1"]

    edited = handoff_media_context(generated, "edition")
    assert edited.operation == "edition"
    assert edited.history == ["creation", "generation"]

    segs = [
        TranscriptSegment(1, 0.0, 1.0, "Hello", speaker="A"),
        TranscriptSegment(2, 1.0, 2.0, "World", speaker="A"),
    ]
    edited.transcript_segments = apply_transcript_editions(segs, {2: "World!"})
    edited.edition_ops = [MediaEditionOp("rewrite", "2", {"text": "World!"})]
    assert edited.transcript_segments[1].text == "World!"

    handoff = edited.to_handoff_state(from_agent="editor", to_agent="validator")
    assert handoff.metadata["kind"] == "media_context"
    restored = MediaContext.from_handoff_state(handoff)
    assert restored.operation == "edition"
    assert restored.history == ["creation", "generation"]

    report = media_context_to_workflow_report(restored)
    assert report.metadata["operation"] == "edition"
    assert MediaContext.from_json(restored.to_json()).brief == restored.brief


def test_plan_media_pipeline_stages() -> None:
    planned = plan_media_pipeline(
        "video_dubbing",
        brief="Dub demo",
        target_language="es",
        source=MediaAsset("clip.mp4", "video"),
    )
    assert [c.operation for c in planned] == list(list_media_pipelines()["video_dubbing"])
    assert planned[0].next_operations[0] == "transcription"
    assert planned[-1].next_operations == []
    assert planned[2].history == ["inspection", "transcription"]


def test_build_media_context_unknown_pipeline_raises() -> None:
    with pytest.raises(KeyError, match="unknown media pipeline"):
        plan_media_pipeline("not-a-real-pipeline")
    with pytest.raises(KeyError, match="unknown media operation"):
        get_media_operation("not-an-op")
