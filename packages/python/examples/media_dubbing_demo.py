"""Offline media dubbing workflow demo.

This demo does not call transcription, TTS, or video APIs. It shows the handoff
contracts and files a real Chinese-to-Spanish dubbing pipeline would produce.
"""

from __future__ import annotations

from pathlib import Path

from handoffkit import HandoffState, write_report_files
from handoffkit.recipes.media import (
    MediaAsset,
    MediaWorkflowReport,
    SpeakerProfile,
    TranscriptSegment,
    build_dubbing_plan,
    write_srt,
    write_transcript_json,
)

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "examples" / "output" / "media_dubbing_demo"
REPORTS_DIR = ROOT / "reports"


def build_demo_report() -> MediaWorkflowReport:
    """Build a deterministic Chinese-to-Spanish dubbing report."""
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
        SpeakerProfile(
            speaker_id="SPEAKER_01",
            label="Operations lead",
            voice="es-LATAM-calm-lead",
            language="es",
            notes=["authoritative", "steady pace"],
        ),
        SpeakerProfile(
            speaker_id="SPEAKER_02",
            label="Support analyst",
            voice="es-LATAM-analyst",
            language="es",
            notes=["concise", "slightly urgent"],
        ),
    ]
    translations = {
        1: "Hoy vamos a revisar el nuevo sistema de inventario.",
        2: "La sincronización de pedidos falló, pero los registros de pago siguen ahí.",
        3: "Primero conserva los logs y luego avisa al equipo técnico.",
    }
    dubbing_segments = build_dubbing_plan(transcript, translations, speakers)
    transcript_path = write_transcript_json(transcript, OUTPUT_DIR / "transcript_zh.json")
    source_srt = write_srt(transcript, OUTPUT_DIR / "subtitles_zh.srt")
    target_srt = write_srt(dubbing_segments, OUTPUT_DIR / "subtitles_es.srt", translated=True)
    handoff = HandoffState(
        task="Translate and dub a Chinese operations video into Spanish.",
        from_agent="Transcriber",
        to_agent="DubbingAdapter",
        summary="Three timestamped Mandarin segments were translated and assigned voices.",
        decisions=[
            "Preserve original timestamps for first pass.",
            "Assign one Spanish voice per detected speaker.",
            "Export SRT files before generating audio.",
        ],
        important_files=[str(transcript_path), str(source_srt), str(target_srt)],
        next_steps=[
            "Run Whisper or another transcriber in real mode.",
            "Generate one TTS clip per DubbingSegment.",
            "Mux final Spanish audio into the video with ffmpeg.",
        ],
        metadata={"source_language": "zh", "target_language": "es", "speakers": 2},
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
            str(source_srt),
            str(target_srt),
            "examples/output/media_dubbing_demo/dubbed_audio_es.wav",
            "examples/output/media_dubbing_demo/final_video_es.mp4",
        ],
        warnings=[
            "Offline demo only; no real transcription, TTS, diarization, or muxing was run.",
            "Generated dubbing should be reviewed for timing, rights, and voice consent.",
        ],
        metadata={"handoff": handoff.to_dict(), "workflow": "video-dubbing"},
    )


def main() -> None:
    """Run the offline media dubbing demo and write reports."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    report = build_demo_report()
    json_path, markdown_path = write_report_files(report, "media_dubbing_demo", REPORTS_DIR)
    print("HandoffKit media dubbing demo")
    print(f"Segments: {len(report.transcript_segments)}")
    print(f"Speakers: {len(report.speakers)}")
    print(f"Output directory: {OUTPUT_DIR}")
    print(f"Markdown report: {markdown_path}")
    print(f"JSON report: {json_path}")


if __name__ == "__main__":
    main()
