import { Router } from "express";
import { query } from "../config/database.js";
import { logActivityDelete, inferDeleteSource } from "../lib/activityLog.js";

const router = Router();
const isSqlite = (process.env.DB_TYPE || "mysql").toLowerCase() === "sqlite";

router.get("/", async (_req, res) => {
  try {
    const rows = await query("SELECT id, name, phone, created_at FROM customers WHERE deleted_at IS NULL ORDER BY name");
    res.json(rows);
  } catch (err) {
    console.error("Customers list error:", err);
    res.status(500).json({ error: "Failed to fetch customers" });
  }
});

/** GET /api/customers/:id/activity-log – sales, payments, manual khata, profile created (newest first). */
router.get("/:id/activity-log", async (req, res) => {
  try {
    const customerId = req.params.id;
    const colDate = isSqlite ? "date" : "`date`";
    const custRows = await query(
      `SELECT id, name, phone, created_at${isSqlite ? "" : ", source"} FROM customers WHERE id = ? AND deleted_at IS NULL`,
      [customerId]
    );
    if (!custRows || custRows.length === 0) {
      return res.status(404).json({ error: "Customer not found" });
    }
    const cust = custRows[0];
    const entries = [];

    if (cust.created_at) {
      const src = !isSqlite && cust.source ? String(cust.source).toLowerCase() : "pos";
      const srcLabel = src === "whatsapp" ? "WhatsApp" : "POS";
      entries.push({
        kind: "created",
        id: `cust-created-${customerId}`,
        at: new Date(cust.created_at).toISOString(),
        title: "Customer added",
        detail: `"${cust.name || customerId}"${cust.phone ? ` · ${cust.phone}` : ""}${!isSqlite ? ` · ${srcLabel}` : ""}`,
      });
    }

    const sales = await query(
      `SELECT id, total, paid_amount, payment_status, payment_method, cashier, ${colDate} AS sale_date, created_at,
        COALESCE(source, 'pos') AS source
       FROM sales WHERE customer_id = ? ORDER BY created_at DESC`,
      [customerId]
    );

    const saleIds = (sales || []).map((s) => s.id);
    let itemsBySale = {};
    if (saleIds.length > 0) {
      const ph = saleIds.map(() => "?").join(",");
      const itemRows = await query(
        `SELECT sale_id, product_name, quantity FROM sale_items WHERE sale_id IN (${ph}) ORDER BY sale_id, id`,
        saleIds
      );
      for (const it of itemRows || []) {
        if (!itemsBySale[it.sale_id]) itemsBySale[it.sale_id] = [];
        itemsBySale[it.sale_id].push(`${it.product_name || "?"} ×${it.quantity ?? 1}`);
      }
    }

    for (const s of sales || []) {
      const total = parseFloat(s.total) || 0;
      const paid = parseFloat(s.paid_amount) || 0;
      const balance = Math.max(0, total - paid);
      const pm = (s.payment_method || "cash").toLowerCase() === "card" ? "Card" : "Cash";
      const src = String(s.source || "pos").toLowerCase() === "whatsapp" ? "WhatsApp" : "POS";
      const when = s.sale_date ?? s.created_at;
      const lines = itemsBySale[s.id] || [];
      const itemsSummary = lines.length ? lines.join(", ") : "—";
      const status = s.payment_status || (paid >= total ? "paid" : paid <= 0 ? "credit" : "partial");
      entries.push({
        kind: "sale",
        id: `sale-${s.id}`,
        at: when ? new Date(when).toISOString() : null,
        title: "Sale",
        detail: `Total $${total.toFixed(2)} · Paid $${paid.toFixed(2)}${balance > 0 ? ` · Due $${balance.toFixed(2)}` : ""} · ${pm} · ${status} · ${src} · ${s.cashier || "—"} · ${itemsSummary}`,
        refId: s.id,
      });
    }

    let payments = [];
    if (saleIds.length > 0) {
      const ph = saleIds.map(() => "?").join(",");
      payments = await query(
        `SELECT sp.id, sp.sale_id, sp.amount, sp.payment_method, sp.created_at
         FROM sale_payments sp
         WHERE sp.sale_id IN (${ph})
         ORDER BY sp.created_at DESC`,
        saleIds
      );
    }
    for (const p of payments || []) {
      const amt = parseFloat(p.amount) || 0;
      const pm = (p.payment_method || "cash").toLowerCase() === "card" ? "Card" : "Cash";
      entries.push({
        kind: "sale_payment",
        id: `sp-${p.id}`,
        at: p.created_at ? new Date(p.created_at).toISOString() : null,
        title: "Payment on sale",
        detail: `$${amt.toFixed(2)} · ${pm} · Sale ${p.sale_id}`,
        refId: p.sale_id,
      });
    }

    const manualRows = await query(
      `SELECT id, type, amount, note, ${colDate} AS entry_date, created_at
       FROM customer_khata_entries
       WHERE customer_id = ?
       ORDER BY created_at DESC`,
      [customerId]
    );
    for (const e of manualRows || []) {
      const amt = parseFloat(e.amount) || 0;
      const when = e.entry_date ?? e.created_at;
      const isUdhaar = e.type === "udhaar_added";
      entries.push({
        kind: isUdhaar ? "khata_udhaar" : "khata_payment",
        id: `khe-${e.id}`,
        at: when ? new Date(when).toISOString() : null,
        title: isUdhaar ? "Khata — udhaar added" : "Khata — payment received",
        detail: `$${amt.toFixed(2)}${e.note ? ` · ${String(e.note).trim()}` : ""}`,
        refId: e.id,
      });
    }

    entries.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
    res.json({
      customerId,
      customerName: cust.name || "",
      entries,
    });
  } catch (err) {
    console.error("Customer activity-log error:", err);
    res.status(500).json({ error: "Failed to fetch customer activity" });
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
    const { name, phone, source: reqSource } = req.body;
    if (!name || typeof name !== "string" || name.trim() === "") return res.status(400).json({ error: "Name required" });
    const id = `c-${Date.now()}`;
    const source = reqSource && String(reqSource).toLowerCase() === "whatsapp" ? "whatsapp" : "pos";
    await query("INSERT INTO customers (id, name, phone, source) VALUES (?, ?, ?, ?)", [id, (name || "").trim(), (phone || "").trim(), source]);
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
    const [cust] = await query("SELECT id, name, phone FROM customers WHERE id = ? AND deleted_at IS NULL", [req.params.id]);
    if (!cust) return res.status(404).json({ error: "Customer not found" });
    const fromBody = req.body?.deletedBy != null ? String(req.body.deletedBy).trim() : null;
    const fromQuery = req.query?.deletedBy != null ? String(req.query.deletedBy).trim() : null;
    const deletedBy = fromBody || fromQuery || null;
    const source = inferDeleteSource(req);
    await logActivityDelete({
      type: "delete_customer",
      entityId: cust.id,
      summary: `Customer deleted: ${cust.name || cust.id}${cust.phone ? ` – ${cust.phone}` : ""}`,
      amount: 0,
      source,
      deletedBy,
    });
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
