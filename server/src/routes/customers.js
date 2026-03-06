import { Router } from "express";
import { query } from "../config/database.js";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const rows = await query("SELECT id, name, phone, created_at FROM customers WHERE deleted_at IS NULL ORDER BY name");
    res.json(rows);
  } catch (err) {
    console.error("Customers list error:", err);
    res.status(500).json({ error: "Failed to fetch customers" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const rows = await query("SELECT id, name, phone, created_at FROM customers WHERE id = ? AND deleted_at IS NULL", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Customer not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("Customer get error:", err);
    res.status(500).json({ error: "Failed to fetch customer" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { name, phone } = req.body;
    if (!name || typeof name !== "string" || name.trim() === "") return res.status(400).json({ error: "Name required" });
    const id = `c-${Date.now()}`;
    await query("INSERT INTO customers (id, name, phone) VALUES (?, ?, ?)", [id, (name || "").trim(), (phone || "").trim()]);
    const [row] = await query("SELECT * FROM customers WHERE id = ?", [id]);
    res.status(201).json(row);
  } catch (err) {
    console.error("Customer create error:", err);
    res.status(500).json({ error: "Failed to create customer" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const { name, phone } = req.body;
    if (!name || typeof name !== "string" || name.trim() === "") return res.status(400).json({ error: "Name required" });
    const result = await query("UPDATE customers SET name = ?, phone = ? WHERE id = ? AND deleted_at IS NULL", [
      (name || "").trim(),
      (phone || "").trim(),
      req.params.id,
    ]);
    const affectedRows = result?.affectedRows ?? result?.[0]?.affectedRows ?? 0;
    if (affectedRows === 0) return res.status(404).json({ error: "Customer not found" });
    const [row] = await query("SELECT * FROM customers WHERE id = ?", [req.params.id]);
    res.json(row);
  } catch (err) {
    console.error("Customer update error:", err);
    res.status(500).json({ error: "Failed to update customer" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    // Support deletedBy from body or query (query is more reliable for DELETE when body is stripped)
    const fromBody = req.body?.deletedBy != null ? String(req.body.deletedBy).trim() : null;
    const fromQuery = req.query?.deletedBy != null ? String(req.query.deletedBy).trim() : null;
    const deletedBy = fromBody || fromQuery || null;
    const result = await query(
      "UPDATE customers SET deleted_at = NOW(), deleted_by = ? WHERE id = ? AND deleted_at IS NULL",
      [deletedBy || null, req.params.id]
    );
    const affectedRows = result?.affectedRows ?? result?.[0]?.affectedRows ?? 0;
    if (affectedRows === 0) return res.status(404).json({ error: "Customer not found" });
    res.status(204).send();
  } catch (err) {
    console.error("Customer delete error:", err);
    res.status(500).json({ error: err.message || "Failed to delete customer" });
  }
});

export default router;
