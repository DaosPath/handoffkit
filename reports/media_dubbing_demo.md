# Media Workflow Report

- Success: `True`
- Source: `examples/input/market_scene_zh.mp4`
- Target language: `es`
- Transcript segments: `3`
- Speakers: `3`
- Dubbing segments: `3`

## Output Files

- `examples\output\media_dubbing_demo\transcript_zh.json`
- `examples\output\media_dubbing_demo\ocr_zh.json`
- `examples\output\media_dubbing_demo\subtitles_zh.srt`
- `examples\output\media_dubbing_demo\subtitles_es.srt`
- `examples\output\media_dubbing_demo\dubbed_audio_es.wav`
- `examples\output\media_dubbing_demo\final_video_es.mp4`

## Speakers

- `SPEAKER_01`: Operations lead -> `es-MX-DaliaNeural`
- `SPEAKER_02`: Support analyst -> `es-MX-DaliaNeural`
- `NARR`: On-screen narrator -> `es-MX-DaliaNeural`

## Dubbing Plan

| # | Time | Speaker | Target text |
| ---: | --- | --- | --- |
| 1 | 00:00:00,000 -> 00:00:03,400 | NARR | Hoy vamos a revisar el nuevo sistema de inventario. |
| 2 | 00:00:03,500 -> 00:00:07,200 | NARR | La sincronización de pedidos falló, pero los registros de pago siguen ahí. |
| 3 | 00:00:07,400 -> 00:00:13,200 | NARR | Primero conserva los logs y luego avisa al equipo técnico. |

## Warnings

- Offline demo only; no real OCR, ASR, TTS, or muxing was run.
- On-screen OCR is canonical; ASR fills spoken-only gaps.
- Review translated dubbing for timing, rights, and voice consent before publishing.
