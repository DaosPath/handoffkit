"""Media-related CLI helpers."""

from __future__ import annotations

from pathlib import Path

from handoffkit.handoff import HandoffState
from handoffkit.recipes.media import (
    MediaAsset,
    MediaEditionOp,
    MediaWorkflowReport,
    SpeakerProfile,
    TranscriptSegment,
    apply_transcript_editions,
    build_creation_context,
    build_dubbing_plan,
    ffmpeg_available,
    handoff_media_context,
    list_media_pipelines,
    media_context_to_workflow_report,
    media_operation_catalog,
    plan_media_pipeline,
    read_transcript_json,
    write_srt,
    write_transcript_json,
)
from handoffkit.reports import write_report_files


def build_media_demo_report(output_dir: Path | None = None) -> MediaWorkflowReport:
    """Build and write a deterministic offline media dubbing report."""
    target_dir = output_dir or Path("examples") / "output" / "media_dubbing_demo"
    target_dir.mkdir(parents=True, exist_ok=True)
    source = MediaAsset(
        path="examples/input/market_scene_zh.mp4",
        media_type="video",
        language="zh",
        duration_seconds=13.2,
        metadata={"mode": "offline-demo", "real_video_required": False},
    )
    transcript = [
        TranscriptSegment(
            index=1,
            start=0.0,
            end=3.4,
            speaker="SPEAKER_01",
            language="zh",
            text="我们今天要检查新的库存系统。",
        ),
        TranscriptSegment(
            index=2,
            start=3.5,
            end=7.2,
            speaker="SPEAKER_02",
            language="zh",
            text="订单同步失败，但付款记录还在。",
        ),
        TranscriptSegment(
            index=3,
            start=7.4,
            end=13.2,
            speaker="SPEAKER_01",
            language="zh",
            text="先保留日志，然后通知技术团队。",
        ),
    ]
    speakers = [
        SpeakerProfile("SPEAKER_01", "Operations lead", "es-LATAM-calm-lead", "es"),
        SpeakerProfile("SPEAKER_02", "Support analyst", "es-LATAM-analyst", "es"),
    ]
    dubbing_segments = build_dubbing_plan(
        transcript,
        {
            1: "Hoy vamos a revisar el nuevo sistema de inventario.",
            2: "La sincronización de pedidos falló, pero los registros de pago siguen ahí.",
            3: "Primero conserva los logs y luego avisa al equipo técnico.",
        },
        speakers,
    )
    transcript_path = write_transcript_json(transcript, target_dir / "transcript_zh.json")
    zh_srt = write_srt(transcript, target_dir / "subtitles_zh.srt")
    es_srt = write_srt(dubbing_segments, target_dir / "subtitles_es.srt", translated=True)
    handoff = HandoffState(
        task="Translate and dub a Chinese operations video into Spanish.",
        from_agent="Transcriber",
        to_agent="DubbingAdapter",
        summary="Timestamped Mandarin transcript converted into a Spanish dubbing plan.",
        decisions=[
            "Keep timestamps stable for the first pass.",
            "Assign one Spanish voice profile per detected speaker.",
            "Write subtitles before generating or muxing audio.",
        ],
        important_files=[str(transcript_path), str(zh_srt), str(es_srt)],
        next_steps=[
            "Run real transcription with Whisper or another provider.",
            "Generate one TTS clip per DubbingSegment.",
            "Mux final Spanish audio into the source video with ffmpeg.",
        ],
        metadata={"source_language": "zh", "target_language": "es"},
    )
    return MediaWorkflowReport(
        success=True,
        source=source,
        target_language="es",
        transcript_segments=transcript,
        speakers=speakers,
        dubbing_segments=dubbing_segments,
        output_files=[
            str(transcript_path),
            str(zh_srt),
            str(es_srt),
            str(target_dir / "dubbed_audio_es.wav"),
            str(target_dir / "final_video_es.mp4"),
        ],
        warnings=[
            "Offline demo only; no real transcription, TTS, diarization, or muxing was run.",
            "Review translated dubbing for timing, rights, and voice consent before publishing.",
        ],
        metadata={"handoff": handoff.to_dict(), "ffmpeg_available": ffmpeg_available()},
    )


def run_media_demo() -> str:
    """Run the local media dubbing demo."""
    report = build_media_demo_report()
    json_path, markdown_path = write_report_files(report, "media_dubbing_demo", "reports")
    return (
        "HandoffKit media dubbing demo\n"
        "Pipeline: Extract -> Transcribe -> Speaker Map -> Translate -> TTS -> Mux\n"
        f"Segments: {len(report.transcript_segments)}\n"
        f"Speakers: {len(report.speakers)}\n"
        f"ffmpeg available: {ffmpeg_available()}\n"
        f"Markdown report: {markdown_path}\n"
        f"JSON report: {json_path}\n\n"
        f"{report.to_markdown()}"
    )


def inspect_media_transcript(path: str) -> str:
    """Inspect a transcript JSON file."""
    segments = read_transcript_json(path)
    speakers = sorted({segment.speaker for segment in segments if segment.speaker})
    duration = max((segment.end for segment in segments), default=0.0)
    return (
        "HandoffKit media transcript inspection\n"
        f"Path: {path}\n"
        f"Segments: {len(segments)}\n"
        f"Speakers: {', '.join(speakers) if speakers else 'none'}\n"
        f"Duration seconds: {duration:.2f}"
    )


def plan_media_dubbing(video_path: str, *, source_language: str, target_language: str) -> str:
    """Return an offline media dubbing plan."""
    from handoffkit.recipes.media import media_pipeline_stages

    stages = " -> ".join(media_pipeline_stages("video_dubbing"))
    return (
        "HandoffKit media dubbing plan\n"
        f"Video: {video_path}\n"
        f"Language: {source_language} -> {target_language}\n"
        f"ffmpeg available: {ffmpeg_available()}\n"
        f"Pipeline (-ion): {stages}\n\n"
        "1. inspection — probe source media\n"
        "2. transcription — speech to timestamped text\n"
        "3. translation — target language copy\n"
        "4. localization — voices and locale notes\n"
        "5. generation — TTS / voice clips\n"
        "6. composition — mux audio into video\n"
        "7. validation — QA gates\n"
        "8. publication — deliverables + report\n"
    )


def list_media_ops_text() -> str:
    """List media -ion operations and pipelines."""
    lines = ["HandoffKit media operations (-ion)", ""]
    for spec in media_operation_catalog():
        lines.append(f"- {spec.name}: {spec.description}")
        lines.append(f"    role={spec.agent_role or '-'}  in={','.join(spec.inputs) or '-'}")
    lines.append("")
    lines.append("Pipelines:")
    for name, stages in list_media_pipelines().items():
        lines.append(f"- {name}: {' -> '.join(stages)}")
    return "\n".join(lines) + "\n"


def run_media_pipeline_plan(
    pipeline: str,
    *,
    brief: str = "",
    target_language: str = "",
    video_path: str = "",
) -> str:
    """Print a planned multi-stage media context pipeline."""
    source = MediaAsset(video_path, "video") if video_path else None
    planned = plan_media_pipeline(
        pipeline,
        brief=brief or f"pipeline={pipeline}",
        target_language=target_language,
        source=source,
    )
    lines = [
        f"HandoffKit media pipeline: {pipeline}",
        f"Stages: {len(planned)}",
        f"Brief: {brief or '(none)'}",
        f"Target language: {target_language or '(none)'}",
        "",
    ]
    for ctx in planned:
        nxt = ", ".join(ctx.next_operations) if ctx.next_operations else "(end)"
        lines.append(f"[{ctx.metadata.get('stage_index', '?')}] {ctx.operation} → next: {nxt}")
    return "\n".join(lines) + "\n"


def run_media_context_demo() -> str:
    """Offline demo: creation → generation → edition context handoffs."""
    created = build_creation_context(
        "Short product explainer with bilingual captions",
        target_language="es",
        pipeline="from_scratch",
    )
    generated = handoff_media_context(
        created,
        "generation",
        from_agent="media-creator",
        to_agent="media-generator",
    )
    generated.generation_prompts = [
        "Narrate a 30s product explainer in a calm tone",
        "Keep claims factual; no music under speech",
    ]
    generated.assets.append(
        MediaAsset("examples/output/media_context_demo/script.txt", "text", language="en")
    )
    edited = handoff_media_context(
        generated,
        "edition",
        from_agent="media-generator",
        to_agent="media-editor",
    )
    edited.transcript_segments = [
        TranscriptSegment(
            1, 0.0, 2.0, "Welcome to HandoffKit media.", speaker="NARR", language="en"
        ),
        TranscriptSegment(
            2,
            2.0,
            5.0,
            "Pass structured context between stages.",
            speaker="NARR",
            language="en",
        ),
    ]
    edited.edition_ops = [
        MediaEditionOp("rewrite", "1", {"text": "Welcome to HandoffKit media workflows."}),
    ]
    edited.transcript_segments = apply_transcript_editions(
        edited.transcript_segments, {1: "Welcome to HandoffKit media workflows."}
    )
    handoff = edited.to_handoff_state(
        from_agent="media-editor",
        to_agent="media-validator",
        task="Validate edited explainer before publication",
    )
    report = media_context_to_workflow_report(edited, success=True)
    out_dir = Path("examples") / "output" / "media_context_demo"
    out_dir.mkdir(parents=True, exist_ok=True)
    ctx_path = out_dir / "media_context_edition.json"
    ctx_path.write_text(edited.to_json(), encoding="utf-8")
    handoff_path = out_dir / "handoff_to_validator.json"
    handoff_path.write_text(handoff.to_json(), encoding="utf-8")
    report.output_files = [str(ctx_path), str(handoff_path)]
    report.metadata["history"] = edited.history
    json_path, markdown_path = write_report_files(report, "media_context_demo", "reports")
    return (
        "HandoffKit media context demo (creation → generation → edition)\n"
        f"History: {' -> '.join(edited.history + [edited.operation])}\n"
        f"Segments: {len(edited.transcript_segments)}\n"
        f"Context: {ctx_path}\n"
        f"Handoff: {handoff_path}\n"
        f"Report JSON: {json_path}\n"
        f"Report Markdown: {markdown_path}\n"
    )


