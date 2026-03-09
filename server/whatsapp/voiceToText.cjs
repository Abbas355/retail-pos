/**
 * Voice message transcription.
 * Uses Gemini (GEMINI_API_KEY) when set, else OpenAI Whisper (OPENAI_API_KEY).
 * Gemini supports ogg/opus directly; Whisper needs mp3 (ffmpeg converts).
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const GEMINI_MODELS_TO_TRY = ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.0-flash"];

async function callGeminiGenerateContent(genAI, modelId, parts) {
  const model = genAI.getGenerativeModel({ model: modelId });
  return await model.generateContent(parts);
}

async function transcribeWithGemini(mediaBuffer, mimetype) {
  const apiKey = process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim();
  if (!apiKey) return null;

  const mime = mimetype && mimetype.includes("ogg") ? "audio/ogg" : "audio/mpeg";
  const b64 = mediaBuffer.toString("base64");
  const parts = [
    {
      inlineData: { mimeType: mime, data: b64 },
    },
    "Transcribe this voice message. Return only the exact spoken text, nothing else. No punctuation unless spoken.",
  ];

  const { GoogleGenerativeAI } = require("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(apiKey);

  for (const modelId of GEMINI_MODELS_TO_TRY) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await callGeminiGenerateContent(genAI, modelId, parts);
        const response = result.response;
        if (response && response.text) {
          const text = response.text().trim();
          if (text) return text;
        }
      } catch (err) {
        const is429 = err.message && err.message.includes("429");
        if (is429 && attempt === 1) {
          const waitMs = 22000;
          console.error(`Gemini quota (429) for ${modelId}, retrying in ${waitMs / 1000}s...`);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        if (attempt === 2 || !is429) {
          console.error(`Gemini transcription error (${modelId}):`, err.message);
        }
      }
    }
  }
  return null;
}

async function transcribeWithOpenAI(mediaBuffer, mimetype) {
  const apiKey = process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim();
  if (!apiKey) return null;

  const isOgg = !mimetype || mimetype.includes("ogg") || mimetype.includes("opus");
  const ext = isOgg ? "ogg" : "mp3";
  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, `wa-voice-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
  const outputPath = path.join(tmpDir, `wa-voice-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`);

  try {
    fs.writeFileSync(inputPath, mediaBuffer);

    let fileToTranscribe = inputPath;
    if (isOgg) {
      const ffmpeg = require("fluent-ffmpeg");
      const ffmpegPath = require("ffmpeg-static");
      if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .toFormat("mp3")
          .on("end", resolve)
          .on("error", reject)
          .save(outputPath);
      });
      fileToTranscribe = outputPath;
    }

    const openaiModule = await import("openai");
    const OpenAI = openaiModule.default;
    const toFile = openaiModule.toFile;
    const openai = new OpenAI({ apiKey });
    const buffer = fs.readFileSync(fileToTranscribe);
    const file = await toFile(buffer, "audio.mp3");
    const transcription = await openai.audio.transcriptions.create({
      file,
      model: "whisper-1",
    });
    return (transcription && transcription.text && transcription.text.trim()) || null;
  } catch (err) {
    console.error("OpenAI Whisper transcription error:", err.message);
    return null;
  } finally {
    try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch (_) {}
    try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (_) {}
  }
}

async function transcribeVoice(mediaBuffer, mimetype) {
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
    const text = await transcribeWithGemini(mediaBuffer, mimetype || "");
    if (text) return text;
  }
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim()) {
    return await transcribeWithOpenAI(mediaBuffer, mimetype);
  }
  return null;
}

module.exports = { transcribeVoice };
