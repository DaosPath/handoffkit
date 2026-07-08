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
