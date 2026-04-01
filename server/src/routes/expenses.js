import { Router } from "express";
import { query } from "../config/database.js";
import { logActivityDelete, inferDeleteSource } from "../lib/activityLog.js";
import { toDbDateTimePK, toIsoPK } from "../lib/dateUtils.js";

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
      // Use exclusive upper bound (date < next day) so full day is included.
      // date <= "2026-03-15" treats "2026-03-15" as midnight, excluding e.g. 14:30.
      const [y, m, d] = String(to).split("-").map(Number);
      const next = new Date(Date.UTC(y, m - 1, d + 1));
      const nextDayStr = next.toISOString().slice(0, 10);
      sql += " AND date < ?";
      params.push(nextDayStr);
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
      date: toIsoPK(r.date),
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
    const dateVal = toDbDateTimePK(date);
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
      date: toIsoPK(row.date),
      createdBy: row.created_by || null,
      source: row.source && String(row.source).toLowerCase() === "whatsapp" ? "whatsapp" : "pos",
    };
    res.status(201).json(created);
  } catch (err) {
    console.error("Expense create error:", err);
    res.status(500).json({ error: "Failed to create expense" });
  }
});

/** GET /api/expenses/:id/activity-log – timeline for one expense (recorded + Khata returns if any). */
router.get("/:id/activity-log", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "Expense id required" });

    const [row] = await query(
      `SELECT id, amount, category, description, date, created_at, created_by,
              COALESCE(source, 'pos') AS source,
              COALESCE(returned_amount, 0) AS returned_amount, returned_at
       FROM expenses WHERE id = ?`,
      [id]
    );
    if (!row) return res.status(404).json({ error: "Expense not found" });

    const amount = parseFloat(row.amount) || 0;
    const category = String(row.category || "");
    const desc = row.description ? String(row.description).trim() : "";
    const createdBy = row.created_by != null && String(row.created_by).trim() ? String(row.created_by).trim() : null;
    const source = row.source && String(row.source).toLowerCase() === "whatsapp" ? "whatsapp" : "pos";
    const createdAt = row.created_at ? toIsoPK(row.created_at) : null;
    const expenseDate = row.date ? toIsoPK(row.date) : null;
    const returned = parseFloat(row.returned_amount) || 0;

    const entries = [];

    const detailParts = [
      `$${amount.toFixed(2)} · ${category}`,
      desc ? `“${desc}”` : null,
      `Source: ${source === "whatsapp" ? "WhatsApp" : "POS"}`,
      createdBy ? `Recorded by: ${createdBy}` : null,
    ].filter(Boolean);

    entries.push({
      kind: "recorded",
      id: `exp-recorded-${row.id}`,
      at: createdAt || expenseDate,
      title: "Expense recorded",
      detail: detailParts.join(" · "),
    });

    if (returned > 0) {
      const full = amount > 0 && returned >= amount - 0.005;
      entries.push({
        kind: "return",
        id: `exp-return-${row.id}`,
        at: row.returned_at ? toIsoPK(row.returned_at) : null,
        title: full ? "Fully returned (Khata)" : "Partial return (Khata)",
        detail: `$${returned.toFixed(2)} returned of $${amount.toFixed(2)} original${full ? "" : " · balance may still be due"}`,
      });
    }

    entries.sort((a, b) => {
      const ta = a.at || "";
      const tb = b.at || "";
      if (!ta && !tb) return 0;
      if (!ta) return 1;
      if (!tb) return -1;
      return tb.localeCompare(ta);
    });
    res.json({ expenseId: row.id, entries });
  } catch (err) {
    console.error("Expense activity-log error:", err);
    res.status(500).json({ error: "Failed to fetch expense activity" });
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
