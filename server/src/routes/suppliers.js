import { Router } from "express";
import { query } from "../config/database.js";
import { logActivityDelete, inferDeleteSource } from "../lib/activityLog.js";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const rows = await query("SELECT id, name, phone, email, created_at FROM suppliers WHERE deleted_at IS NULL ORDER BY name");
    res.json(rows);
  } catch (err) {
    console.error("Suppliers list error:", err);
    res.status(500).json({ error: "Failed to fetch suppliers" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const rows = await query("SELECT id, name, phone, email, created_at FROM suppliers WHERE id = ? AND deleted_at IS NULL", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Supplier not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("Supplier get error:", err);
    res.status(500).json({ error: "Failed to fetch supplier" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { name, phone, email, source: reqSource } = req.body || {};
    const headerSource = (req.headers["x-source"] || req.headers["X-Source"] || "").toLowerCase().trim();
    const source = (reqSource && String(reqSource).toLowerCase() === "whatsapp") || headerSource === "whatsapp"
      ? "whatsapp"
      : "pos";
    if (!name || typeof name !== "string" || name.trim() === "") {
      return res.status(400).json({ error: "Name required" });
    }
    const id = `s-${Date.now()}`;
    await query("INSERT INTO suppliers (id, name, phone, email, source) VALUES (?, ?, ?, ?, ?)", [
      id,
      (name || "").trim(),
      (phone != null ? String(phone).trim() : "") || "",
      (email != null ? String(email).trim() : "") || "",
      source,
    ]);
    const [row] = await query("SELECT id, name, phone, email, created_at FROM suppliers WHERE id = ?", [id]);
    res.status(201).json(row);
  } catch (err) {
    console.error("Supplier create error:", err);
    res.status(500).json({ error: "Failed to create supplier" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const { name, phone, email } = req.body;
    if (!name || typeof name !== "string" || name.trim() === "") {
      return res.status(400).json({ error: "Name required" });
    }
    const result = await query(
      "UPDATE suppliers SET name = ?, phone = ?, email = ? WHERE id = ? AND deleted_at IS NULL",
      [
        (name || "").trim(),
        (phone != null ? String(phone).trim() : "") || "",
        (email != null ? String(email).trim() : "") || "",
        req.params.id,
      ]
    );
    const affectedRows = result?.affectedRows ?? result?.[0]?.affectedRows ?? 0;
    if (affectedRows === 0) return res.status(404).json({ error: "Supplier not found" });
    const [row] = await query("SELECT id, name, phone, email, created_at FROM suppliers WHERE id = ?", [req.params.id]);
    res.json(row);
  } catch (err) {
    console.error("Supplier update error:", err);
    res.status(500).json({ error: "Failed to update supplier" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const [sup] = await query("SELECT id, name, phone, email FROM suppliers WHERE id = ? AND deleted_at IS NULL", [req.params.id]);
    if (!sup) return res.status(404).json({ error: "Supplier not found" });
    const fromBody = req.body?.deletedBy != null ? String(req.body.deletedBy).trim() : null;
    const fromQuery = req.query?.deletedBy != null ? String(req.query.deletedBy).trim() : null;
    const deletedBy = fromBody || fromQuery || null;
    const source = inferDeleteSource(req);
    await logActivityDelete({
      type: "delete_supplier",
      entityId: sup.id,
      summary: `Supplier deleted: ${sup.name || sup.id}${sup.phone || sup.email ? ` – ${sup.phone || sup.email}` : ""}`,
      amount: 0,
      source,
      deletedBy,
    });
    const result = await query(
      "UPDATE suppliers SET deleted_at = NOW(), deleted_by = ? WHERE id = ? AND deleted_at IS NULL",
      [deletedBy || null, req.params.id]
    );
    const affectedRows = result?.affectedRows ?? result?.[0]?.affectedRows ?? 0;
    if (affectedRows === 0) return res.status(404).json({ error: "Supplier not found" });
    res.status(204).send();
  } catch (err) {
    console.error("Supplier delete error:", err);
    res.status(500).json({ error: err.message || "Failed to delete supplier" });
  }
});

export default router;
