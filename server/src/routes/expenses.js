import { Router } from "express";
import { query } from "../config/database.js";
import { logActivityDelete, inferDeleteSource } from "../lib/activityLog.js";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { from, to, category } = req.query;
    let sql = "SELECT id, amount, category, description, date, created_at, created_by, COALESCE(source, 'pos') AS source FROM expenses WHERE 1=1";
    const params = [];

    if (from) {
      sql += " AND date >= ?";
      params.push(from);
    }
    if (to) {
      sql += " AND date <= ?";
      params.push(to);
    }
    if (category && String(category).trim()) {
      sql += " AND category = ?";
      params.push(String(category).trim());
    }

    sql += " ORDER BY date DESC, created_at DESC";

    const rows = await query(sql, params);
    const result = (rows || []).map((r) => ({
      id: r.id,
      amount: parseFloat(r.amount),
      category: r.category,
      description: r.description || "",
      date: r.date ? new Date(r.date).toISOString() : null,
      createdBy: r.created_by || null,
      source: r.source && String(r.source).toLowerCase() === "whatsapp" ? "whatsapp" : "pos",
    }));
    res.json(result);
  } catch (err) {
    console.error("Expenses list error:", err);
    res.status(500).json({ error: "Failed to fetch expenses" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { amount, category, description, date, source: reqSource } = req.body;
    if (amount == null || Number(amount) < 0) {
      return res.status(400).json({ error: "amount is required and must be >= 0" });
    }
    if (!category || !String(category).trim()) {
      return res.status(400).json({ error: "category is required" });
    }

    const id = `exp-${Date.now()}`;
    const dateVal = date ? new Date(date).toISOString().slice(0, 19).replace("T", " ") : new Date().toISOString().slice(0, 19).replace("T", " ");
    const desc = description != null ? String(description).trim() : "";
    const source = reqSource && String(reqSource).toLowerCase() === "whatsapp" ? "whatsapp" : "pos";

    await query(
      "INSERT INTO expenses (id, amount, category, description, date, source) VALUES (?, ?, ?, ?, ?, ?)",
      [id, Number(amount), String(category).trim(), desc, dateVal, source]
    );

    const [row] = await query(
      "SELECT id, amount, category, description, date, created_at, created_by, source FROM expenses WHERE id = ?",
      [id]
    );
    const created = {
      id: row.id,
      amount: parseFloat(row.amount),
      category: row.category,
      description: row.description || "",
      date: row.date ? new Date(row.date).toISOString() : null,
      createdBy: row.created_by || null,
      source: row.source && String(row.source).toLowerCase() === "whatsapp" ? "whatsapp" : "pos",
    };
    res.status(201).json(created);
  } catch (err) {
    console.error("Expense create error:", err);
    res.status(500).json({ error: "Failed to create expense" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const [exp] = await query("SELECT id, amount, category, description, source, created_by FROM expenses WHERE id = ?", [id]);
    if (!exp) return res.status(404).json({ error: "Expense not found" });
    const source = inferDeleteSource(req);
    const deletedBy = req.body?.deletedBy ?? req.query?.deletedBy ?? exp.created_by ?? null;
    await logActivityDelete({
      type: "delete_expense",
      entityId: id,
      summary: `Expense deleted: ${exp.description || exp.category || "Expense"} – Rs ${Number(exp.amount || 0).toLocaleString()}`,
      amount: Number(exp.amount) || 0,
      source,
      deletedBy: deletedBy ? String(deletedBy).trim() : null,
    });
    const result = await query("DELETE FROM expenses WHERE id = ?", [id]);
    const affected = result?.affectedRows ?? result?.[0]?.affectedRows ?? 0;
    if (affected === 0) return res.status(404).json({ error: "Expense not found" });
    res.status(204).send();
  } catch (err) {
    console.error("Expense delete error:", err);
    res.status(500).json({ error: "Failed to delete expense" });
  }
});

export default router;
