/**
 * WhatsApp Bot — runs independently from the main Express server (src/index.js).
 *
 * Placement: server/whatsappBot.cjs (same level as server/src/).
 * Run from server directory: node whatsappBot.cjs  (or: npm run whatsapp)
 *
 * Uses whatsapp-web.js (QR login, LocalAuth) and qrcode-terminal.
 * Listens for incoming messages; passes them to messageProcessor (ready for AI integration).
 * Ignores messages sent by the bot itself.
 */

const { Client, LocalAuth } = require("whatsapp-web.js");
const QRCode = require("qrcode");
const qrcodeTerminal = require("qrcode-terminal");
const fs = require("fs");
const path = require("path");
const { processIncomingMessage } = require("./whatsapp/messageProcessor.cjs");

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: "./.wwebjs_auth",
  }),
});

client.on("qr", async (qr) => {
  const htmlPath = path.join(process.cwd(), "whatsapp-qr.html");
  try {
    const dataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 2 });
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>WhatsApp QR</title></head><body style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;font-family:system-ui,sans-serif;background:#111;"><h1 style="color:#fff;margin-bottom:1rem;">Scan with WhatsApp</h1><img src="${dataUrl}" alt="QR Code" style="width:280px;height:280px;background:#fff;padding:12px;border-radius:8px;"><p style="color:#888;margin-top:1rem;">WhatsApp → Settings → Linked devices → Link a device</p></body></html>`;
    fs.writeFileSync(htmlPath, html);
    const cmd = process.platform === "win32"
      ? `start "" "${htmlPath}"`
      : process.platform === "darwin"
        ? `open "${htmlPath}"`
        : `xdg-open "${htmlPath}"`;
    require("child_process").exec(cmd, () => {});
    console.log("QR code opened in your browser. Scan it with WhatsApp (Linked Devices).");
    console.log("If the browser did not open, open whatsapp-qr.html manually.");
  } catch (err) {
    console.log("Scan this QR with WhatsApp on your phone (Linked Devices):");
    qrcodeTerminal.generate(qr, { small: true });
  }
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
