import { Router } from "express";
import pool, { query } from "../config/database.js";

const router = Router();
const isSqlite = (process.env.DB_TYPE || "mysql").toLowerCase() === "sqlite";

function toIso(d) {
  if (!d) return null;
  try {
    return new Date(d).toISOString();
  } catch {
    return null;
  }
}

router.get("/", async (req, res) => {
  try {
    const from = req.query.from ? String(req.query.from).slice(0, 10) : null;
    const to = req.query.to ? String(req.query.to).slice(0, 10) : null;
    const dateCol = isSqlite ? "date(b.created_at)" : "DATE(b.created_at)";
    const conds = [];
    const params = [];
    if (from) {
      conds.push(`${dateCol} >= ?`);
      params.push(from);
    }
    if (to) {
      conds.push(`${dateCol} <= ?`);
      params.push(to);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const sql = `SELECT b.id, b.customer_id, b.customer_name, b.total, b.status, b.notes, b.bill_date, b.created_at
      FROM bills b ${where} ORDER BY b.created_at DESC LIMIT 500`;
    const bills = await query(sql, params);
    if (!bills.length) return res.json([]);

    const ids = bills.map((b) => b.id);
    const ph = ids.map(() => "?").join(",");
    const itemRows = await query(
      `SELECT id, bill_id, description, quantity, unit_price FROM bill_items WHERE bill_id IN (${ph}) ORDER BY bill_id, id`,
      ids
    );
    const byBill = {};
    for (const it of itemRows) {
      if (!byBill[it.bill_id]) byBill[it.bill_id] = [];
      byBill[it.bill_id].push({
        id: String(it.id),
        description: it.description || "",
        quantity: Number(it.quantity) || 0,
        unitPrice: parseFloat(it.unit_price) || 0,
        lineTotal: Math.round(Number(it.quantity) * parseFloat(it.unit_price) * 100) / 100,
      });
    }

    const result = bills.map((b) => ({
      id: b.id,
      customerId: b.customer_id || null,
      customerName: b.customer_name || "",
      total: parseFloat(b.total) || 0,
      status: b.status || "draft",
      notes: b.notes || "",
      billDate: toIso(b.bill_date),
      date: toIso(b.created_at),
      items: byBill[b.id] || [],
    }));
    res.json(result);
  } catch (err) {
    console.error("Bills list error:", err);
    res.status(500).json({ error: "Failed to fetch bills" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const [b] = await query(
      "SELECT id, customer_id, customer_name, total, status, notes, bill_date, created_at FROM bills WHERE id = ?",
      [req.params.id]
    );
    if (!b) return res.status(404).json({ error: "Bill not found" });
    const itemRows = await query(
      "SELECT id, description, quantity, unit_price FROM bill_items WHERE bill_id = ? ORDER BY id",
      [b.id]
    );
    const items = itemRows.map((it) => ({
      id: String(it.id),
      description: it.description || "",
      quantity: Number(it.quantity) || 0,
      unitPrice: parseFloat(it.unit_price) || 0,
      lineTotal: Math.round(Number(it.quantity) * parseFloat(it.unit_price) * 100) / 100,
    }));
    res.json({
      id: b.id,
      customerId: b.customer_id || null,
      customerName: b.customer_name || "",
      total: parseFloat(b.total) || 0,
      status: b.status || "draft",
      notes: b.notes || "",
      billDate: toIso(b.bill_date),
      date: toIso(b.created_at),
      items,
    });
  } catch (err) {
    console.error("Bill get error:", err);
    res.status(500).json({ error: "Failed to fetch bill" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { customerName, customerId, items: bodyItems, notes, status: reqStatus, billDate: reqBillDate } = req.body;
    if (!Array.isArray(bodyItems) || bodyItems.length === 0) {
      return res.status(400).json({ error: "At least one line item is required" });
    }
    for (const it of bodyItems) {
      const desc = it.description ?? it.label ?? "";
      if (!String(desc).trim()) return res.status(400).json({ error: "Each item needs a description" });
      const qty = Number(it.quantity ?? it.qty ?? 1);
      const price = parseFloat(it.unitPrice ?? it.price ?? 0);
      if (qty <= 0 || Number.isNaN(price) || price < 0) {
        return res.status(400).json({ error: "Invalid quantity or price on line items" });
      }
    }

    let total = 0;
    const normalized = bodyItems.map((it) => {
      const qty = Number(it.quantity ?? it.qty ?? 1);
      const price = parseFloat(it.unitPrice ?? it.price ?? 0);
      const line = Math.round(qty * price * 100) / 100;
      total += line;
      return {
        description: String(it.description ?? it.label ?? "").trim(),
        quantity: qty,
        unitPrice: price,
      };
    });
    total = Math.round(total * 100) / 100;

    const status = ["draft", "sent", "paid"].includes(String(reqStatus || "").toLowerCase())
      ? String(reqStatus).toLowerCase()
      : "draft";
    const name = customerName != null ? String(customerName).trim() : "";
    const cid = customerId && String(customerId).trim() ? String(customerId).trim() : null;
    const notesStr = notes != null ? String(notes).trim().slice(0, 1000) : "";
    const billId = `bill-${Date.now()}`;

    const billDateVal = reqBillDate ? String(reqBillDate).slice(0, 19) : null;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      if (isSqlite) {
        await conn.execute(
          `INSERT INTO bills (id, customer_id, customer_name, total, status, notes, bill_date) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
          [billId, cid, name, total, status, notesStr || null, billDateVal]
        );
        for (const it of normalized) {
          await conn.execute(
            "INSERT INTO bill_items (bill_id, description, quantity, unit_price) VALUES (?, ?, ?, ?)",
            [billId, it.description, it.quantity, it.unitPrice]
          );
        }
      } else {
        await conn.execute(
          `INSERT INTO bills (id, customer_id, customer_name, total, status, notes, bill_date) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, NOW()))`,
          [billId, cid, name, total, status, notesStr || null, billDateVal]
        );
        for (const it of normalized) {
          await conn.execute(
            "INSERT INTO bill_items (bill_id, description, quantity, unit_price) VALUES (?, ?, ?, ?)",
            [billId, it.description, it.quantity, it.unitPrice]
          );
        }
      }
      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }

    const [row] = await query(
      "SELECT id, customer_id, customer_name, total, status, notes, bill_date, created_at FROM bills WHERE id = ?",
      [billId]
    );
    const itemRows = await query(
      "SELECT id, description, quantity, unit_price FROM bill_items WHERE bill_id = ? ORDER BY id",
      [billId]
    );
    const items = itemRows.map((it) => ({
      id: String(it.id),
      description: it.description || "",
      quantity: Number(it.quantity) || 0,
      unitPrice: parseFloat(it.unit_price) || 0,
      lineTotal: Math.round(Number(it.quantity) * parseFloat(it.unit_price) * 100) / 100,
    }));

    res.status(201).json({
      id: row.id,
      customerId: row.customer_id || null,
      customerName: row.customer_name || "",
      total: parseFloat(row.total) || 0,
      status: row.status || "draft",
      notes: row.notes || "",
      billDate: toIso(row.bill_date),
      date: toIso(row.created_at),
      items,
    });
  } catch (err) {
    console.error("Bill create error:", err);
    res.status(500).json({ error: err.message || "Failed to create bill" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const { status } = req.body;
    if (!status || !["draft", "sent", "paid"].includes(String(status).toLowerCase())) {
      return res.status(400).json({ error: "status must be draft, sent, or paid" });
    }
    const result = await query("UPDATE bills SET status = ? WHERE id = ?", [String(status).toLowerCase(), req.params.id]);
    const affected = result?.affectedRows ?? result?.changes ?? 0;
    if (!affected) return res.status(404).json({ error: "Bill not found" });
    const [row] = await query(
      "SELECT id, customer_id, customer_name, total, status, notes, bill_date, created_at FROM bills WHERE id = ?",
      [req.params.id]
    );
    const itemRows = await query(
      "SELECT id, description, quantity, unit_price FROM bill_items WHERE bill_id = ? ORDER BY id",
      [req.params.id]
    );
    const items = itemRows.map((it) => ({
      id: String(it.id),
      description: it.description || "",
      quantity: Number(it.quantity) || 0,
      unitPrice: parseFloat(it.unit_price) || 0,
      lineTotal: Math.round(Number(it.quantity) * parseFloat(it.unit_price) * 100) / 100,
    }));
    res.json({
      id: row.id,
      customerId: row.customer_id || null,
      customerName: row.customer_name || "",
      total: parseFloat(row.total) || 0,
      status: row.status || "draft",
      notes: row.notes || "",
      billDate: toIso(row.bill_date),
      date: toIso(row.created_at),
      items,
    });
  } catch (err) {
    console.error("Bill patch error:", err);
    res.status(500).json({ error: "Failed to update bill" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const result = await query("DELETE FROM bills WHERE id = ?", [req.params.id]);
    const affected = result?.affectedRows ?? result?.changes ?? 0;
    if (!affected) return res.status(404).json({ error: "Bill not found" });
    res.status(204).send();
  } catch (err) {
    console.error("Bill delete error:", err);
    res.status(500).json({ error: "Failed to delete bill" });
  }
});

export default router;
