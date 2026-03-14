import { Router } from "express";
import { buildReceiptEscPos } from "../lib/receiptEscPos.js";
import { sendToNetworkPrinter } from "../lib/networkPrinter.js";

const router = Router();

router.post("/receipt", async (req, res) => {
  try {
    const { sale, settings, locale } = req.body;
    if (!sale || !settings) {
      return res.status(400).json({ error: "sale and settings are required" });
    }
    const buffer = buildReceiptEscPos(sale, settings, locale || "en");
    await sendToNetworkPrinter(buffer);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Print receipt error:", err);
    res.status(500).json({ error: err.message || "Print failed" });
  }
});

export default router;
