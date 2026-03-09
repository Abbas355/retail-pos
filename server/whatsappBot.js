/**
 * WhatsApp Bot — runs independently from the main Express server (src/index.js).
 *
 * Placement: server/whatsappBot.js and server/whatsappBot.cjs (same level as server/src/).
 * Recommended: run "npm run whatsapp" from server/ (uses whatsappBot.cjs for compatibility).
 *
 * Uses whatsapp-web.js (QR login, LocalAuth) and qrcode-terminal.
 * Message processing is delegated to whatsapp/messageProcessor (ready for AI integration).
 */

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { processIncomingMessage } = require("./whatsapp/messageProcessor.cjs");

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: "./.wwebjs_auth",
  }),
});

client.on("qr", (qr) => {
  console.log("Scan this QR with WhatsApp on your phone (Linked Devices):");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("WhatsApp bot is ready.");
});

client.on("message", async (msg) => {
  if (msg.fromMe) return;
  try {
    await processIncomingMessage(msg, client);
  } catch (err) {
    console.error("Message processing error:", err);
  }
});

client.initialize().catch((err) => {
  console.error("WhatsApp init failed:", err);
});
