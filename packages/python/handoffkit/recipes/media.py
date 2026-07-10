"""Media workflow contracts and lightweight helpers.

The helpers in this module are intentionally dependency-free. Real audio/video
work is delegated to an installed ``ffmpeg`` binary when requested.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class MediaAsset:
    """A file used or produced by a media workflow."""

    path: str
    media_type: str
    language: str = ""
    duration_seconds: float | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Return JSON-serializable asset data."""
        return {
            "path": self.path,
            "media_type": self.media_type,
            "language": self.language,
            "duration_seconds": self.duration_seconds,
            "metadata": self.metadata,
        }

    @staticmethod
    def from_dict(data: dict[str, Any]) -> MediaAsset:
        """Build an asset from dictionary data."""
        return MediaAsset(
            path=str(data.get("path", "")),
            media_type=str(data.get("media_type", "")),
            language=str(data.get("language", "")),
            duration_seconds=_optional_float(data.get("duration_seconds")),
            metadata=dict(data.get("metadata") or {}),
        )


@dataclass
class TranscriptSegment:
    """One timestamped transcript segment."""

    index: int
    start: float
    end: float
    text: str
    speaker: str = ""
    language: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Return JSON-serializable segment data."""
        return {
            "index": self.index,
            "start": self.start,
            "end": self.end,
            "text": self.text,
            "speaker": self.speaker,
            "language": self.language,
            "metadata": self.metadata,
        }

    @staticmethod
    def from_dict(data: dict[str, Any]) -> TranscriptSegment:
        """Build a transcript segment from dictionary data."""
        return TranscriptSegment(
            index=int(data.get("index", 0)),
            start=float(data.get("start", 0.0)),
            end=float(data.get("end", 0.0)),
            text=str(data.get("text", "")),
            speaker=str(data.get("speaker", "")),
            language=str(data.get("language", "")),
            metadata=dict(data.get("metadata") or {}),
        )


@dataclass
class SpeakerProfile:
    """A speaker/persona detected or assigned in a media workflow."""

    speaker_id: str
    label: str = ""
    voice: str = ""
    language: str = ""
    notes: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Return JSON-serializable speaker data."""
        return {
            "speaker_id": self.speaker_id,
            "label": self.label,
            "voice": self.voice,
            "language": self.language,
            "notes": self.notes,
            "metadata": self.metadata,
        }

    @staticmethod
    def from_dict(data: dict[str, Any]) -> SpeakerProfile:
        """Build a speaker profile from dictionary data."""
        return SpeakerProfile(
            speaker_id=str(data.get("speaker_id", "")),
            label=str(data.get("label", "")),
            voice=str(data.get("voice", "")),
            language=str(data.get("language", "")),
            notes=[str(item) for item in data.get("notes", [])],
            metadata=dict(data.get("metadata") or {}),
        )


@dataclass
class DubbingSegment:
    """One translated segment ready for voice generation or muxing."""

    index: int
    start: float
    end: float
    speaker: str
    source_text: str
    target_text: str
    voice: str = ""
    audio_path: str = ""
    notes: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Return JSON-serializable dubbing segment data."""
        return {
            "index": self.index,
            "start": self.start,
            "end": self.end,
            "speaker": self.speaker,
            "source_text": self.source_text,
            "target_text": self.target_text,
            "voice": self.voice,
            "audio_path": self.audio_path,
            "notes": self.notes,
            "metadata": self.metadata,
        }

    @staticmethod
    def from_dict(data: dict[str, Any]) -> DubbingSegment:
        """Build a dubbing segment from dictionary data."""
        return DubbingSegment(
            index=int(data.get("index", 0)),
            start=float(data.get("start", 0.0)),
            end=float(data.get("end", 0.0)),
            speaker=str(data.get("speaker", "")),
            source_text=str(data.get("source_text", "")),
            target_text=str(data.get("target_text", "")),
            voice=str(data.get("voice", "")),
            audio_path=str(data.get("audio_path", "")),
            notes=[str(item) for item in data.get("notes", [])],
            metadata=dict(data.get("metadata") or {}),
        )


@dataclass
class MediaWorkflowReport:
    """Reusable report for transcript, dubbing, and audiobook workflows."""

    success: bool
    source: MediaAsset
    target_language: str
    transcript_segments: list[TranscriptSegment] = field(default_factory=list)
    speakers: list[SpeakerProfile] = field(default_factory=list)
    dubbing_segments: list[DubbingSegment] = field(default_factory=list)
    output_files: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Return JSON-serializable report data."""
        return {
            "success": self.success,
            "source": self.source.to_dict(),
            "target_language": self.target_language,
            "transcript_segments": [item.to_dict() for item in self.transcript_segments],
            "speakers": [item.to_dict() for item in self.speakers],
            "dubbing_segments": [item.to_dict() for item in self.dubbing_segments],
            "output_files": self.output_files,
            "warnings": self.warnings,
            "metadata": self.metadata,
        }

    @staticmethod
    def from_dict(data: dict[str, Any]) -> MediaWorkflowReport:
        """Build a media report from dictionary data."""
        return MediaWorkflowReport(
            success=bool(data.get("success", False)),
            source=MediaAsset.from_dict(dict(data.get("source") or {})),
            target_language=str(data.get("target_language", "")),
            transcript_segments=[
                TranscriptSegment.from_dict(dict(item))
                for item in data.get("transcript_segments", [])
            ],
            speakers=[SpeakerProfile.from_dict(dict(item)) for item in data.get("speakers", [])],
            dubbing_segments=[
                DubbingSegment.from_dict(dict(item)) for item in data.get("dubbing_segments", [])
            ],
            output_files=[str(item) for item in data.get("output_files", [])],
            warnings=[str(item) for item in data.get("warnings", [])],
            metadata=dict(data.get("metadata") or {}),
        )

    def to_json(self, *, indent: int | None = 2) -> str:
        """Return report JSON."""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent)

    @staticmethod
    def from_json(value: str) -> MediaWorkflowReport:
        """Build a media report from JSON text."""
        data = json.loads(value)
        if not isinstance(data, dict):
            raise ValueError("media workflow report JSON must be an object")
        return MediaWorkflowReport.from_dict(data)

    def to_markdown(self) -> str:
        """Return a compact Markdown report."""
        lines = [
            "# Media Workflow Report",
            "",
            f"- Success: `{self.success}`",
            f"- Source: `{self.source.path}`",
            f"- Target language: `{self.target_language}`",
            f"- Transcript segments: `{len(self.transcript_segments)}`",
            f"- Speakers: `{len(self.speakers)}`",
            f"- Dubbing segments: `{len(self.dubbing_segments)}`",
        ]
        if self.output_files:
            lines.extend(["", "## Output Files", ""])
            lines.extend(f"- `{item}`" for item in self.output_files)
        if self.speakers:
            lines.extend(["", "## Speakers", ""])
            for speaker in self.speakers:
                label = speaker.label or speaker.speaker_id
                lines.append(f"- `{speaker.speaker_id}`: {label} -> `{speaker.voice}`")
        if self.dubbing_segments:
            lines.extend(["", "## Dubbing Plan", ""])
            lines.append("| # | Time | Speaker | Target text |")
            lines.append("| ---: | --- | --- | --- |")
            for segment in self.dubbing_segments:
                lines.append(
                    f"| {segment.index} | {_format_time_range(segment.start, segment.end)} | "
                    f"{segment.speaker} | {segment.target_text} |"
                )
        if self.warnings:
            lines.extend(["", "## Warnings", ""])
            lines.extend(f"- {item}" for item in self.warnings)
        return "\n".join(lines) + "\n"


def build_dubbing_plan(
    segments: list[TranscriptSegment],
    translations: dict[int, str],
    speakers: list[SpeakerProfile] | None = None,
) -> list[DubbingSegment]:
    """Build translated dubbing segments while preserving timestamps and speakers."""
    voice_by_speaker = {item.speaker_id: item.voice for item in speakers or []}
    dubbing_segments = []
    for segment in segments:
        target_text = translations.get(segment.index, segment.text)
        dubbing_segments.append(
            DubbingSegment(
                index=segment.index,
                start=segment.start,
                end=segment.end,
                speaker=segment.speaker,
                source_text=segment.text,
                target_text=target_text,
                voice=voice_by_speaker.get(segment.speaker, ""),
                notes=["preserve timing", "review lip-sync manually"],
            )
        )
    return dubbing_segments


def write_transcript_json(segments: list[TranscriptSegment], path: str | Path) -> Path:
    """Write transcript segments to JSON."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = {"segments": [segment.to_dict() for segment in segments]}
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return target


def read_transcript_json(path: str | Path) -> list[TranscriptSegment]:
    """Read transcript segments from JSON."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(data, list):
        items = data
    elif isinstance(data, dict):
        items = data.get("segments", [])
    else:
        raise ValueError("transcript JSON must be a list or object with segments")
    if not isinstance(items, list):
        raise ValueError("transcript segments must be a list")
    return [TranscriptSegment.from_dict(dict(item)) for item in items]


def write_srt(
    segments: list[TranscriptSegment] | list[DubbingSegment],
    path: str | Path,
    *,
    translated: bool = False,
) -> Path:
    """Write transcript or dubbing segments as SRT subtitles."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    blocks = []
    for display_index, segment in enumerate(segments, start=1):
        text = _segment_text(segment, translated=translated)
        blocks.append(
            "\n".join(
                [
                    str(display_index),
                    (
                        f"{format_srt_timestamp(segment.start)} --> "
                        f"{format_srt_timestamp(segment.end)}"
                    ),
                    text,
                ]
            )
        )
    target.write_text("\n\n".join(blocks) + "\n", encoding="utf-8")
    return target


def format_srt_timestamp(seconds: float) -> str:
    """Return an SRT timestamp for a seconds value."""
    milliseconds = max(0, round(seconds * 1000))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def ffmpeg_available(ffmpeg: str = "ffmpeg") -> bool:
    """Return whether an ffmpeg binary is available."""
    return shutil.which(ffmpeg) is not None


def extract_audio(
    video_path: str | Path,
    audio_path: str | Path,
    *,
    ffmpeg: str = "ffmpeg",
    overwrite: bool = False,
) -> MediaAsset:
    """Extract audio from a video with ffmpeg."""
    output = Path(audio_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    _run_ffmpeg(
        [
            ffmpeg,
            "-y" if overwrite else "-n",
            "-i",
            str(video_path),
            "-vn",
            "-acodec",
            "pcm_s16le",
            str(output),
        ]
    )
    return MediaAsset(path=str(output), media_type="audio", metadata={"source": str(video_path)})


def mux_audio(
    video_path: str | Path,
    audio_path: str | Path,
    output_path: str | Path,
    *,
    ffmpeg: str = "ffmpeg",
    overwrite: bool = False,
) -> MediaAsset:
    """Mux a video stream with a replacement audio track using ffmpeg."""
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    _run_ffmpeg(
        [
            ffmpeg,
            "-y" if overwrite else "-n",
            "-i",
            str(video_path),
            "-i",
            str(audio_path),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            str(output),
        ]
    )
    return MediaAsset(path=str(output), media_type="video", metadata={"audio": str(audio_path)})


def _run_ffmpeg(command: list[str]) -> None:
    if shutil.which(command[0]) is None:
        raise RuntimeError(f"{command[0]} is required for this media operation")
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        raise RuntimeError(f"ffmpeg failed with exit code {result.returncode}: {detail}")


def _segment_text(segment: TranscriptSegment | DubbingSegment, *, translated: bool) -> str:
    if isinstance(segment, DubbingSegment):
        return segment.target_text if translated else segment.source_text
    return segment.text


def _format_time_range(start: float, end: float) -> str:
    return f"{format_srt_timestamp(start)} -> {format_srt_timestamp(end)}"


def _optional_float(value: Any) -> float | None:
    if value is None:
        return None
    return float(value)


# ---------------------------------------------------------------------------
# 1.13 — Media operations (-ion) + context handoffs
# ---------------------------------------------------------------------------

# Canonical media operations (English nouns ending in -ion).
MEDIA_OPERATIONS: tuple[str, ...] = (
    "creation",
    "generation",
    "edition",
    "transcription",
    "translation",
    "localization",
    "adaptation",
    "composition",
    "inspection",
    "validation",
    "publication",
    "production",
)


@dataclass
class MediaOperationSpec:
    """One named media operation stage (creation, generation, edition, …)."""

    name: str
    description: str
    inputs: list[str] = field(default_factory=list)
    outputs: list[str] = field(default_factory=list)
    agent_role: str = ""
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "inputs": list(self.inputs),
            "outputs": list(self.outputs),
            "agent_role": self.agent_role,
            "notes": list(self.notes),
        }

    @staticmethod
    def from_dict(data: dict[str, Any]) -> MediaOperationSpec:
        return MediaOperationSpec(
            name=str(data.get("name", "")),
            description=str(data.get("description", "")),
            inputs=[str(x) for x in data.get("inputs", [])],
            outputs=[str(x) for x in data.get("outputs", [])],
            agent_role=str(data.get("agent_role", "")),
            notes=[str(x) for x in data.get("notes", [])],
        )


def media_operation_catalog() -> list[MediaOperationSpec]:
    """Return the built-in catalog of media -ion operations."""
    return [
        MediaOperationSpec(
            "creation",
            "Define media brief, format, audience, and source constraints.",
            inputs=["brief", "constraints"],
            outputs=["brief", "source_plan"],
            agent_role="media-creator",
        ),
        MediaOperationSpec(
            "generation",
            "Generate audio, video, image, or script assets from a brief.",
            inputs=["brief", "prompts", "voice"],
            outputs=["assets", "generation_prompts"],
            agent_role="media-generator",
        ),
        MediaOperationSpec(
            "edition",
            "Edit timing, copy, cuts, and structure of media or transcripts.",
            inputs=["assets", "transcript", "edition_ops"],
            outputs=["assets", "transcript", "edition_ops"],
            agent_role="media-editor",
        ),
        MediaOperationSpec(
            "transcription",
            "Speech-to-text into timestamped transcript segments.",
            inputs=["audio", "video"],
            outputs=["transcript_segments"],
            agent_role="transcriber",
        ),
        MediaOperationSpec(
            "translation",
            "Translate transcript or script text into a target language.",
            inputs=["transcript_segments", "target_language"],
            outputs=["dubbing_segments", "translations"],
            agent_role="translator",
        ),
        MediaOperationSpec(
            "localization",
            "Adapt voices, culture notes, and delivery for a locale.",
            inputs=["dubbing_segments", "speakers", "locale"],
            outputs=["dubbing_segments", "speakers"],
            agent_role="localizer",
        ),
        MediaOperationSpec(
            "adaptation",
            "Adapt length, tone, or format (clip, reel, audiobook chapter).",
            inputs=["assets", "transcript", "format"],
            outputs=["assets", "transcript"],
            agent_role="adapter",
        ),
        MediaOperationSpec(
            "composition",
            "Compose tracks: mux audio, layout multi-clip, mix stems.",
            inputs=["video", "audio", "assets"],
            outputs=["composed_asset"],
            agent_role="composer",
        ),
        MediaOperationSpec(
            "inspection",
            "Inspect source media and existing transcripts without mutation.",
            inputs=["source"],
            outputs=["inspection_notes", "assets"],
            agent_role="inspector",
        ),
        MediaOperationSpec(
            "validation",
            "Validate timing, language coverage, rights, and quality gates.",
            inputs=["assets", "transcript", "dubbing"],
            outputs=["warnings", "validation_report"],
            agent_role="validator",
        ),
        MediaOperationSpec(
            "publication",
            "Package deliverables, reports, and publish metadata.",
            inputs=["assets", "report"],
            outputs=["output_files", "publish_manifest"],
            agent_role="publisher",
        ),
        MediaOperationSpec(
            "production",
            "End-to-end production orchestration across prior -ion stages.",
            inputs=["pipeline", "brief"],
            outputs=["report", "output_files"],
            agent_role="producer",
        ),
    ]


def get_media_operation(name: str) -> MediaOperationSpec:
    """Lookup a media operation by name (case-insensitive)."""
    key = name.strip().lower()
    for item in media_operation_catalog():
        if item.name == key:
            return item
    known = ", ".join(MEDIA_OPERATIONS)
    raise KeyError(f"unknown media operation '{name}'. Known: {known}")


# Named pipelines: ordered -ion stages
MEDIA_PIPELINES: dict[str, tuple[str, ...]] = {
    "from_scratch": (
        "creation",
        "generation",
        "edition",
        "validation",
        "publication",
    ),
    "video_dubbing": (
        "inspection",
        "transcription",
        "translation",
        "localization",
        "generation",
        "composition",
        "validation",
        "publication",
    ),
    "audiobook": (
        "creation",
        "generation",
        "edition",
        "composition",
        "validation",
        "publication",
    ),
    "subtitle_localization": (
        "transcription",
        "translation",
        "edition",
        "validation",
        "publication",
    ),
    "edit_existing": (
        "inspection",
        "edition",
        "adaptation",
        "validation",
        "publication",
    ),
}


@dataclass
class MediaEditionOp:
    """One discrete edition (edit) action on media or text."""

    op_type: str  # rewrite, retiming, cut, insert, rename_speaker, ...
    target: str = ""  # segment index, asset path, field name
    payload: dict[str, Any] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "op_type": self.op_type,
            "target": self.target,
            "payload": dict(self.payload),
            "notes": list(self.notes),
        }

    @staticmethod
    def from_dict(data: dict[str, Any]) -> MediaEditionOp:
        return MediaEditionOp(
            op_type=str(data.get("op_type", "")),
            target=str(data.get("target", "")),
            payload=dict(data.get("payload") or {}),
            notes=[str(x) for x in data.get("notes", [])],
        )


@dataclass
class MediaContext:
    """Portable context for media creation / generation / edition handoffs.

    Agents pass this object (or its HandoffState projection) instead of a vague
    summary so the next -ion stage keeps assets, transcripts, and constraints.
    """

    operation: str
    brief: str = ""
    target_language: str = ""
    source: MediaAsset | None = None
    assets: list[MediaAsset] = field(default_factory=list)
    transcript_segments: list[TranscriptSegment] = field(default_factory=list)
    speakers: list[SpeakerProfile] = field(default_factory=list)
    dubbing_segments: list[DubbingSegment] = field(default_factory=list)
    generation_prompts: list[str] = field(default_factory=list)
    edition_ops: list[MediaEditionOp] = field(default_factory=list)
    constraints: list[str] = field(default_factory=list)
    history: list[str] = field(default_factory=list)
    next_operations: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    output_files: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.operation = self.operation.strip().lower()
        if self.operation and self.operation not in MEDIA_OPERATIONS:
            # allow forward-compat custom ops but mark a warning
            if "custom_operation" not in self.metadata:
                self.warnings = list(self.warnings) + [
                    f"operation '{self.operation}' is not in the built-in -ion catalog"
                ]

    def to_dict(self) -> dict[str, Any]:
        return {
            "operation": self.operation,
            "brief": self.brief,
            "target_language": self.target_language,
            "source": self.source.to_dict() if self.source else None,
            "assets": [a.to_dict() for a in self.assets],
            "transcript_segments": [s.to_dict() for s in self.transcript_segments],
            "speakers": [s.to_dict() for s in self.speakers],
            "dubbing_segments": [s.to_dict() for s in self.dubbing_segments],
            "generation_prompts": list(self.generation_prompts),
            "edition_ops": [e.to_dict() for e in self.edition_ops],
            "constraints": list(self.constraints),
            "history": list(self.history),
            "next_operations": list(self.next_operations),
            "warnings": list(self.warnings),
            "output_files": list(self.output_files),
            "metadata": dict(self.metadata),
        }

    @staticmethod
    def from_dict(data: dict[str, Any]) -> MediaContext:
        source_raw = data.get("source")
        source = MediaAsset.from_dict(dict(source_raw)) if source_raw else None
        return MediaContext(
            operation=str(data.get("operation", "")),
            brief=str(data.get("brief", "")),
            target_language=str(data.get("target_language", "")),
            source=source,
            assets=[MediaAsset.from_dict(dict(x)) for x in data.get("assets", [])],
            transcript_segments=[
                TranscriptSegment.from_dict(dict(x)) for x in data.get("transcript_segments", [])
            ],
            speakers=[SpeakerProfile.from_dict(dict(x)) for x in data.get("speakers", [])],
            dubbing_segments=[
                DubbingSegment.from_dict(dict(x)) for x in data.get("dubbing_segments", [])
            ],
            generation_prompts=[str(x) for x in data.get("generation_prompts", [])],
            edition_ops=[MediaEditionOp.from_dict(dict(x)) for x in data.get("edition_ops", [])],
            constraints=[str(x) for x in data.get("constraints", [])],
            history=[str(x) for x in data.get("history", [])],
            next_operations=[str(x) for x in data.get("next_operations", [])],
            warnings=[str(x) for x in data.get("warnings", [])],
            output_files=[str(x) for x in data.get("output_files", [])],
            metadata=dict(data.get("metadata") or {}),
        )

    def to_json(self, *, indent: int | None = 2) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent)

    @staticmethod
    def from_json(value: str) -> MediaContext:
        data = json.loads(value)
        if not isinstance(data, dict):
            raise ValueError("media context JSON must be an object")
        return MediaContext.from_dict(data)

    def operation_spec(self) -> MediaOperationSpec | None:
        try:
            return get_media_operation(self.operation)
        except KeyError:
            return None

    def to_handoff_state(
        self,
        *,
        from_agent: str,
        to_agent: str,
        task: str | None = None,
    ) -> Any:
        """Project this media context into a validated HandoffState."""
        from handoffkit.handoff import HandoffState

        spec = self.operation_spec()
        role = (spec.agent_role if spec else self.operation) or "media-agent"
        default_task = task or f"media {self.operation}: {self.brief or self.operation}"
        files = list(self.output_files)
        if self.source and self.source.path:
            files.append(self.source.path)
        files.extend(a.path for a in self.assets if a.path)
        next_steps = list(self.next_operations) or (
            list(spec.outputs) if spec else []
        )
        return HandoffState(
            task=default_task,
            from_agent=from_agent or role,
            to_agent=to_agent,
            summary=(
                f"Media {self.operation} context"
                + (f" → {self.target_language}" if self.target_language else "")
                + (f": {self.brief[:160]}" if self.brief else "")
            ),
            decisions=[f"operation={self.operation}"]
            + ([f"target_language={self.target_language}"] if self.target_language else []),
            important_files=files,
            errors=[],
            next_steps=next_steps,
            context_refs=[f"media_operation:{self.operation}", *self.history],
            metadata={
                "media_context": self.to_dict(),
                "kind": "media_context",
            },
        ).validate()

    @staticmethod
    def from_handoff_state(state: Any) -> MediaContext:
        """Restore MediaContext from a HandoffState (or dict-like)."""
        data = state.to_dict() if hasattr(state, "to_dict") else dict(state)
        meta = dict(data.get("metadata") or {})
        raw = meta.get("media_context")
        if isinstance(raw, dict):
            return MediaContext.from_dict(raw)
        # best-effort skeleton
        return MediaContext(
            operation=str(meta.get("operation") or "inspection"),
            brief=str(data.get("summary") or data.get("task") or ""),
            constraints=[str(x) for x in data.get("decisions", [])],
            output_files=[str(x) for x in data.get("important_files", [])],
            next_operations=[str(x) for x in data.get("next_steps", [])],
            metadata=meta,
        )

    def with_operation(self, operation: str) -> MediaContext:
        """Return a copy switched to ``operation``, appending current to history."""
        data = self.to_dict()
        history = list(self.history)
        if self.operation:
            history.append(self.operation)
        data["operation"] = operation.strip().lower()
        data["history"] = history
        return MediaContext.from_dict(data)


def build_media_context(
    operation: str,
    *,
    brief: str = "",
    target_language: str = "",
    source: MediaAsset | None = None,
    pipeline: str | None = None,
    constraints: list[str] | None = None,
    generation_prompts: list[str] | None = None,
    metadata: dict[str, Any] | None = None,
) -> MediaContext:
    """Create a media context for a -ion operation, optionally bound to a pipeline."""
    op = operation.strip().lower()
    next_ops: list[str] = []
    if pipeline:
        stages = list(media_pipeline_stages(pipeline))
        if op in stages:
            idx = stages.index(op)
            next_ops = stages[idx + 1 :]
        else:
            next_ops = stages
    return MediaContext(
        operation=op,
        brief=brief,
        target_language=target_language,
        source=source,
        constraints=list(constraints or []),
        generation_prompts=list(generation_prompts or []),
        next_operations=next_ops,
        metadata={
            **(metadata or {}),
            **({"pipeline": pipeline} if pipeline else {}),
        },
    )


def handoff_media_context(
    context: MediaContext,
    next_operation: str,
    *,
    from_agent: str = "",
    to_agent: str = "",
) -> MediaContext:
    """Advance context to the next -ion stage (creation → generation → edition …)."""
    nxt = next_operation.strip().lower()
    advanced = context.with_operation(nxt)
    # refresh next_operations relative to declared pipeline if present
    pipeline = str((advanced.metadata or {}).get("pipeline") or "")
    if pipeline:
        stages = list(media_pipeline_stages(pipeline))
        if nxt in stages:
            i = stages.index(nxt)
            advanced.next_operations = stages[i + 1 :]
    else:
        # drop the first next if it matches, else keep remaining
        remaining = [x for x in context.next_operations if x != nxt]
        advanced.next_operations = remaining
    if from_agent or to_agent:
        advanced.metadata = {
            **advanced.metadata,
            "last_handoff": {
                "from_agent": from_agent,
                "to_agent": to_agent,
                "from_operation": context.operation,
                "to_operation": nxt,
            },
        }
    return advanced


def media_pipeline_stages(name: str) -> tuple[str, ...]:
    """Return ordered -ion stages for a named media pipeline."""
    key = name.strip().lower()
    if key not in MEDIA_PIPELINES:
        known = ", ".join(sorted(MEDIA_PIPELINES))
        raise KeyError(f"unknown media pipeline '{name}'. Known: {known}")
    return MEDIA_PIPELINES[key]


def list_media_pipelines() -> dict[str, list[str]]:
    """Return pipeline name → stage list."""
    return {name: list(stages) for name, stages in MEDIA_PIPELINES.items()}


def plan_media_pipeline(
    pipeline: str,
    *,
    brief: str = "",
    target_language: str = "",
    source: MediaAsset | None = None,
    constraints: list[str] | None = None,
) -> list[MediaContext]:
    """Materialize one MediaContext skeleton per -ion stage in a pipeline."""
    stages = media_pipeline_stages(pipeline)
    planned: list[MediaContext] = []
    history: list[str] = []
    for i, stage in enumerate(stages):
        planned.append(
            MediaContext(
                operation=stage,
                brief=brief,
                target_language=target_language,
                source=source,
                constraints=list(constraints or []),
                history=list(history),
                next_operations=list(stages[i + 1 :]),
                metadata={"pipeline": pipeline, "stage_index": i},
            )
        )
        history.append(stage)
    return planned


def apply_transcript_editions(
    segments: list[TranscriptSegment],
    rewrites: dict[int, str],
) -> list[TranscriptSegment]:
    """Apply edition rewrites to transcript segments by index (offline)."""
    out: list[TranscriptSegment] = []
    for seg in segments:
        text = rewrites.get(seg.index, seg.text)
        meta = dict(seg.metadata)
        if seg.index in rewrites:
            meta["edition"] = "rewrite"
        out.append(
            TranscriptSegment(
                index=seg.index,
                start=seg.start,
                end=seg.end,
                text=text,
                speaker=seg.speaker,
                language=seg.language,
                metadata=meta,
            )
        )
    return out


def build_generation_context(
    brief: str,
    *,
    prompts: list[str] | None = None,
    target_language: str = "",
    media_type: str = "audio",
    constraints: list[str] | None = None,
) -> MediaContext:
    """Convenience builder for a generation-stage media context."""
    return build_media_context(
        "generation",
        brief=brief,
        target_language=target_language,
        pipeline="from_scratch",
        constraints=constraints
        or [
            "keep deterministic offline demos free of paid APIs",
            f"primary media_type={media_type}",
        ],
        generation_prompts=prompts or [brief],
        metadata={"media_type": media_type, "phase": "generation"},
    )


def build_creation_context(
    brief: str,
    *,
    target_language: str = "",
    pipeline: str = "from_scratch",
    constraints: list[str] | None = None,
) -> MediaContext:
    """Convenience builder for a creation-stage media context."""
    return build_media_context(
        "creation",
        brief=brief,
        target_language=target_language,
        pipeline=pipeline,
        constraints=constraints
        or [
            "define audience, length, format, and rights",
            "prefer explicit handoffs over free-text summaries",
        ],
        metadata={"phase": "creation"},
    )


def build_edition_context(
    *,
    brief: str = "",
    transcript_segments: list[TranscriptSegment] | None = None,
    edition_ops: list[MediaEditionOp] | None = None,
    source: MediaAsset | None = None,
    target_language: str = "",
) -> MediaContext:
    """Convenience builder for an edition-stage media context."""
    ctx = build_media_context(
        "edition",
        brief=brief or "Edit media / transcript",
        target_language=target_language,
        source=source,
        pipeline="edit_existing",
        metadata={"phase": "edition"},
    )
    if transcript_segments:
        ctx.transcript_segments = list(transcript_segments)
    if edition_ops:
        ctx.edition_ops = list(edition_ops)
    return ctx


def media_context_to_workflow_report(
    context: MediaContext,
    *,
    success: bool = True,
) -> MediaWorkflowReport:
    """Fold a media context into the classic MediaWorkflowReport shape."""
    source = context.source or MediaAsset(path="(none)", media_type="unknown")
    return MediaWorkflowReport(
        success=success,
        source=source,
        target_language=context.target_language,
        transcript_segments=list(context.transcript_segments),
        speakers=list(context.speakers),
        dubbing_segments=list(context.dubbing_segments),
        output_files=list(context.output_files),
        warnings=list(context.warnings),
        metadata={
            "operation": context.operation,
            "history": list(context.history),
            "next_operations": list(context.next_operations),
            "brief": context.brief,
            "media_context": context.to_dict(),
        },
    )
