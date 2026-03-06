import { Router } from "express";
import { pullFromMysql, pushToMysql } from "../sync/index.js";

const router = Router();

router.post("/pull", async (_req, res) => {
  try {
    const result = await pullFromMysql();
    if (result.ok) res.json({ ok: true, message: result.message });
    else res.status(400).json({ ok: false, error: result.error });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/push", async (_req, res) => {
  try {
    const result = await pushToMysql();
    if (result.ok) res.json({ ok: true, message: result.message });
    else res.status(400).json({ ok: false, error: result.error });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
