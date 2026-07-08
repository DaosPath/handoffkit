# Media Workflows

HandoffKit 1.5.0 adds lightweight contracts for audiobook, transcription,
translation, dubbing, and video publishing workflows.

The core package does not install media engines. It only provides structured
state, report objects, subtitle/transcript helpers, and optional wrappers around
an installed `ffmpeg` binary.

## Video Dubbing Shape

```text
Video
  -> Audio Extractor
  -> Transcriber
  -> Speaker Mapper
  -> Translator
  -> Timing Adapter
  -> Voice Generator
  -> Mixer
  -> Publisher
```

Each stage can pass explicit state instead of a vague summary:

- source video/audio paths,
- transcript segments with timestamps,
- detected speaker ids,
- character/persona labels,
- target-language text,
- selected voice profiles,
- generated audio files,
- subtitle files,
- QA warnings and retry notes.

## Public Contracts

```python
from handoffkit import (
    DubbingSegment,
    MediaAsset,
    MediaWorkflowReport,
    SpeakerProfile,
    TranscriptSegment,
)
```

Use these objects when an agent needs to hand off media work to the next stage.

## Subtitle and Transcript Helpers

```python
from handoffkit import TranscriptSegment, write_srt, write_transcript_json

segments = [
    TranscriptSegment(1, 0.0, 2.5, "你好", speaker="SPEAKER_01", language="zh"),
]

write_transcript_json(segments, "examples/output/media/transcript_zh.json")
write_srt(segments, "examples/output/media/subtitles_zh.srt")
```

Translated dubbing segments can be exported as subtitles too:

```python
from handoffkit import SpeakerProfile, build_dubbing_plan, write_srt

speakers = [SpeakerProfile("SPEAKER_01", "Narrator", "es-LATAM-calm", "es")]
dubbing = build_dubbing_plan(segments, {1: "Hola."}, speakers)

write_srt(dubbing, "examples/output/media/subtitles_es.srt", translated=True)
```

## Optional ffmpeg Helpers

These helpers require `ffmpeg` to be installed separately:

```python
from handoffkit import extract_audio, ffmpeg_available, mux_audio

if ffmpeg_available():
    extract_audio("input_zh.mp4", "examples/output/media/original.wav")
    mux_audio("input_zh.mp4", "dubbed_es.wav", "examples/output/media/output_es.mp4")
```

The package never bundles ffmpeg and never runs video processing unless you call
these helpers directly.

## CLI

```bash
handoffkit demo-media
handoffkit media inspect examples/output/media_dubbing_demo/transcript_zh.json
handoffkit media plan input_zh.mp4 --from zh --to es
```

`demo-media` is offline and deterministic. It writes:

- `examples/output/media_dubbing_demo/transcript_zh.json`,
- `examples/output/media_dubbing_demo/subtitles_zh.srt`,
- `examples/output/media_dubbing_demo/subtitles_es.srt`,
- `reports/media_dubbing_demo.json`,
- `reports/media_dubbing_demo.md`.

## Real Provider Path

Real workflows can plug in:

- Whisper or another speech-to-text provider for transcript segments,
- speaker diarization for `SpeakerProfile` assignments,
- a translation model for target-language text,
- TTS for one voice clip per `DubbingSegment`,
- ffmpeg for muxing final audio back into the video.

Those integrations are intentionally opt-in. Normal tests and demos stay
offline and deterministic.

