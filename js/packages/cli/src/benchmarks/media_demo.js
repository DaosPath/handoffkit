import fs from "node:fs";
import { join } from "node:path";
import {
  MediaAsset,
  TranscriptSegment,
  SpeakerProfile,
  MediaWorkflowReport,
  buildDubbingPlan,
  formatSRT
} from "@handoffkit/recipes";
import { HandoffState } from "@handoffkit/core";
import { writeReportFiles } from "@handoffkit/node";

export async function runMediaDemo({ outputDir = "examples/output/media_dubbing_demo", reportsDir = "reports" } = {}) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(reportsDir, { recursive: true });
  
  const source = new MediaAsset({
    path: "examples/input/market_scene_zh.mp4",
    mediaType: "video",
    language: "zh",
    durationSeconds: 13.2,
    metadata: { mode: "offline-demo", realVideoRequired: false }
  });
  
  const transcript = [
    new TranscriptSegment({
      index: 1,
      start: 0.0,
      end: 3.4,
      speaker: "SPEAKER_01",
      language: "zh",
      text: "我们今天要检查新的库存 system。"
    }),
    new TranscriptSegment({
      index: 2,
      start: 3.5,
      end: 7.2,
      speaker: "SPEAKER_02",
      language: "zh",
      text: "订单同步失败，但付款记录还在。"
    }),
    new TranscriptSegment({
      index: 3,
      start: 7.4,
      end: 13.2,
      speaker: "SPEAKER_01",
      language: "zh",
      text: "先保留日志，然后通知技术团队。"
    })
  ];
  
  const speakers = [
    new SpeakerProfile({
      speakerId: "SPEAKER_01",
      label: "Operations lead",
      voice: "es-LATAM-calm-lead",
      language: "es",
      notes: ["authoritative", "steady pace"]
    }),
    new SpeakerProfile({
      speakerId: "SPEAKER_02",
      label: "Support analyst",
      voice: "es-LATAM-analyst",
      language: "es",
      notes: ["concise", "slightly urgent"]
    })
  ];
  
  const translations = {
    1: "Hoy vamos a revisar el nuevo sistema de inventario.",
    2: "La sincronización de pedidos falló, pero los registros de pago siguen ahí.",
    3: "Primero conserva los logs y luego avisa al equipo técnico."
  };
  
  const dubbingSegments = buildDubbingPlan(transcript, translations, speakers);
  
  const transcriptPath = join(outputDir, "transcript_zh.json");
  fs.writeFileSync(transcriptPath, JSON.stringify(transcript, null, 2), "utf8");
  
  const sourceSrtPath = join(outputDir, "subtitles_zh.srt");
  fs.writeFileSync(sourceSrtPath, formatSRT(transcript), "utf8");
  
  const targetSrtPath = join(outputDir, "subtitles_es.srt");
  fs.writeFileSync(targetSrtPath, formatSRT(dubbingSegments), "utf8");
  
  const handoff = new HandoffState({
    task: "Translate and dub a Chinese operations video into Spanish.",
    fromAgent: "Transcriber",
    toAgent: "DubbingAdapter",
    summary: "Three timestamped Mandarin segments were translated and assigned voices.",
    decisions: [
      "Preserve original timestamps for first pass.",
      "Assign one Spanish voice per detected speaker.",
      "Export SRT files before generating audio."
    ],
    importantFiles: [transcriptPath, sourceSrtPath, targetSrtPath],
    nextSteps: [
      "Run Whisper or another transcriber in real mode.",
      "Generate one TTS clip per DubbingSegment.",
      "Mux final Spanish audio into the video with ffmpeg."
    ],
    metadata: { source_language: "zh", target_language: "es", speakers: 2 }
  });
  
  const report = new MediaWorkflowReport({
    success: true,
    source,
    targetLanguage: "es",
    transcriptSegments: transcript,
    speakers,
    dubbingSegments,
    outputFiles: [
      transcriptPath,
      sourceSrtPath,
      targetSrtPath,
      join(outputDir, "dubbed_audio_es.wav"),
      join(outputDir, "final_video_es.mp4")
    ],
    warnings: [
      "Offline demo only; no real transcription, TTS, diarization, or muxing was run.",
      "Generated dubbing should be reviewed for timing, rights, and voice consent."
    ],
    metadata: { handoff: handoff.toJSON ? handoff.toJSON() : handoff, workflow: "video-dubbing" }
  });
  
  const files = await writeReportFiles(report, "media_dubbing_demo", reportsDir);
  return {
    report,
    jsonPath: files.jsonPath,
    markdownPath: files.markdownPath
  };
}
