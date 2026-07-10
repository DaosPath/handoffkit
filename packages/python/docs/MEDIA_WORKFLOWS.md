# Media Workflows

HandoffKit media contracts cover audiobook, transcription, translation,
dubbing, video publishing, and (from **1.13.0**) explicit **media -ion
operations** with **context handoffs** between stages.

The core package does not install media engines. It only provides structured
state, report objects, subtitle/transcript helpers, optional wrappers around
an installed `ffmpeg` binary, and portable `MediaContext` objects for agent
handoffs.

## Media operations (-ion) — 1.13

Every built-in media stage is an English noun ending in **-ion**:

| Operation | Role |
|-----------|------|
| `creation` | Brief, format, audience, rights |
| `generation` | Produce audio/video/image/script assets |
| `edition` | Edit timing, copy, cuts |
| `transcription` | Speech → timestamped text |
| `translation` | Target-language copy |
| `localization` | Voices, locale adaptation |
| `adaptation` | Format/length/tone shifts |
| `composition` | Mux, mix, multi-clip |
| `inspection` | Read-only probe |
| `validation` | QA gates |
| `publication` | Deliverables + report |
| `production` | End-to-end orchestration |

Named pipelines chain these stages (`from_scratch`, `video_dubbing`,
`audiobook`, `subtitle_localization`, `edit_existing`).

```python
from handoffkit import (
    build_creation_context,
    handoff_media_context,
    plan_media_pipeline,
    media_operation_catalog,
)

# Catalog
for op in media_operation_catalog():
    print(op.name, "→", op.agent_role)

# creation → generation → edition handoff
ctx = build_creation_context("30s product explainer", target_language="es")
ctx = handoff_media_context(ctx, "generation", from_agent="creator", to_agent="generator")
ctx = handoff_media_context(ctx, "edition", from_agent="generator", to_agent="editor")

# Project into a standard HandoffState for Team / agents
state = ctx.to_handoff_state(from_agent="editor", to_agent="validator")

# Full pipeline skeletons
stages = plan_media_pipeline("video_dubbing", brief="Dub market clip", target_language="es")
```

### CLI (1.13)

```bash
handoffkit media ops
handoffkit media pipeline from_scratch --brief "Explainer" --to es
handoffkit media pipeline video_dubbing --video input.mp4 --to es
handoffkit demo-media-context
```

### JavaScript parity (`@handoffkit/recipes`)

Same -ion catalog, pipelines, and `MediaContext` handoffs (1:1 with Python).
Wire JSON uses snake_case; JS constructors use camelCase.

```js
import {
  buildCreationContext,
  handoffMediaContext,
  planMediaPipeline,
  mediaOperationCatalog,
} from "@handoffkit/recipes";

let ctx = buildCreationContext("30s product explainer", { targetLanguage: "es" });
ctx = handoffMediaContext(ctx, "generation", { fromAgent: "creator", toAgent: "generator" });
const state = ctx.toHandoffState({ fromAgent: "generator", toAgent: "editor" });
```

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

