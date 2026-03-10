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
  const transcriptionInstructions = `Transcribe the user's voice message accurately.

Rules:
1. The user may speak in Roman Urdu, Urdu, or English, or a mix.
2. Convert the speech into clear, readable text that a POS (point-of-sale) bot can understand.
3. Keep numbers accurate (e.g., "7 eggs", "3 milk").
4. Do not change the meaning of the sentence.
5. Preserve intent when mixing languages.

Roman Urdu SALE phrases (all mean SELL) – normalize to "sell":
- sale kr do, sale kardo, bech do, de do, nikal do, dedena → "sell"

Roman Urdu PAYMENT phrases – normalize so payment method is clear:
- cash rakh lo, cash par, cash payment, cash → "payment cash" or "pay with cash"
- card se, card par, card payment → "payment card" or "pay with card"
- online payment, bank transfer → "payment card" (use card for POS)

Quantity: If a number appears before a product name, keep it (that number = quantity).
Product names: "anday" = eggs. Keep other product names as spoken.

Roman Urdu DELETE phrases (all mean DELETE PRODUCT FROM INVENTORY) – keep product name and delete intent clear:
- delete kar do, delete kr do, delete krdo, remove kar do, remove kr do, remove krdo
- inventory se hata do, inventory se delete krdo, product hata do, <product> inventory se hata do
Transcribe so the product name is preserved and the delete/remove/hata intent is clear (e.g. "paratha delete kr do" or "inventory se coca cola hata do").

Roman Urdu EXPENSE phrases (ADD EXPENSE) – keep category/description and amount accurate:
- add kr do, add kardo = add (expense)
- "mera bijli ka bill add kr do 7000" → transcribe as "mera bijli ka bill add kr do 7000" (or "bijli ka bill add kr do 7000")
- "acha yar" / "oy" / "yar" at start = filler; keep the rest (e.g. "mera rent add kardo 5000")
- Preserve numbers exactly (7000, 5000, 1.5 etc.). Preserve category words: bijli, bill, rent, gas, salary, utilities, kharcha, lagan.

Examples:
- "7 anday bech do" → "sell 7 eggs"
- "2 coke sale kr do" → "sell 2 coke"
- "3 bread cash par" → "sell 3 bread payment cash"
- "7 eggs sale kr do aur payment cash rakhni hai" → "sell 7 eggs and set payment method to cash"
- "3 coke bech do cash par" → "sell 3 coke payment cash"
- "2 bread card se payment" → "sell 2 bread payment card"
- "paratha delete kr do" → "paratha delete kr do"
- "inventory se coca cola hata do" → "inventory se coca cola hata do"
- "egg product remove kr do" → "egg remove kr do" or "egg product remove kr do"
- "acha yar mera bijli ka bill add kr do 7000" → "mera bijli ka bill add kr do 7000" or "acha yar mera bijli ka bill add kr do 7000"
- "rent 5000 add kr do" → "rent 5000 add kr do"
- "7000 add kr do bijli ka bill" → "7000 add kr do bijli ka bill"
- "undo" / "undo kar do" / "pehla undo karo" / "dusra undo karo" / "last wala undo karo" / "undo 1" / "undo 2" / "undo 3" – transcribe as spoken

Return ONLY the transcribed text. No punctuation unless it helps. No explanation.`;

  const parts = [
    {
      inlineData: { mimeType: mime, data: b64 },
    },
    transcriptionInstructions,
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
