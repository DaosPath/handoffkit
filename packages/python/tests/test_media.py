from __future__ import annotations

import json

import pytest

from handoffkit.recipes.media import (
    MediaAsset,
    MediaWorkflowReport,
    SpeakerProfile,
    TranscriptSegment,
    build_dubbing_plan,
    extract_audio,
    ffmpeg_available,
    format_srt_timestamp,
    mux_audio,
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
