import { Router } from "express";
import { query } from "../config/database.js";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { from, to, category } = req.query;
    let sql = "SELECT id, amount, category, description, date, created_at, created_by FROM expenses WHERE 1=1";
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
    }));
    res.json(result);
  } catch (err) {
    console.error("Expenses list error:", err);
    res.status(500).json({ error: "Failed to fetch expenses" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { amount, category, description, date } = req.body;
    if (amount == null || Number(amount) < 0) {
      return res.status(400).json({ error: "amount is required and must be >= 0" });
    }
    if (!category || !String(category).trim()) {
      return res.status(400).json({ error: "category is required" });
    }

    const id = `exp-${Date.now()}`;
    const dateVal = date ? new Date(date).toISOString().slice(0, 19).replace("T", " ") : new Date().toISOString().slice(0, 19).replace("T", " ");
    const desc = description != null ? String(description).trim() : "";

    await query(
      "INSERT INTO expenses (id, amount, category, description, date) VALUES (?, ?, ?, ?, ?)",
      [id, Number(amount), String(category).trim(), desc, dateVal]
    );

    const [row] = await query(
      "SELECT id, amount, category, description, date, created_at, created_by FROM expenses WHERE id = ?",
      [id]
    );
    const created = {
      id: row.id,
      amount: parseFloat(row.amount),
      category: row.category,
      description: row.description || "",
      date: row.date ? new Date(row.date).toISOString() : null,
      createdBy: row.created_by || null,
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
