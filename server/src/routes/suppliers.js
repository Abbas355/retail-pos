import { Router } from "express";
import { query } from "../config/database.js";
import { logActivityDelete, inferDeleteSource } from "../lib/activityLog.js";

const router = Router();
const isSqlite = (process.env.DB_TYPE || "mysql").toLowerCase() === "sqlite";

router.get("/", async (_req, res) => {
  try {
    const rows = await query("SELECT id, name, phone, email, created_at FROM suppliers WHERE deleted_at IS NULL ORDER BY name");
    res.json(rows);
  } catch (err) {
    console.error("Suppliers list error:", err);
    res.status(500).json({ error: "Failed to fetch suppliers" });
  }
});

/** GET /api/suppliers/:id/activity-log – purchases, supplier payments, manual khata, profile created (newest first). */
router.get("/:id/activity-log", async (req, res) => {
  try {
    const supplierId = req.params.id;
    const colDate = isSqlite ? "date" : "`date`";
    const supRows = await query(
      `SELECT id, name, phone, email, created_at${isSqlite ? "" : ", source"} FROM suppliers WHERE id = ? AND deleted_at IS NULL`,
      [supplierId]
    );
    if (!supRows || supRows.length === 0) {
      return res.status(404).json({ error: "Supplier not found" });
    }
    const sup = supRows[0];
    const entries = [];

    if (sup.created_at) {
      const src = !isSqlite && sup.source ? String(sup.source).toLowerCase() : "pos";
      const srcLabel = src === "whatsapp" ? "WhatsApp" : "POS";
      const contact = [sup.phone, sup.email].filter(Boolean).join(" · ");
      entries.push({
        kind: "created",
        id: `sup-created-${supplierId}`,
        at: new Date(sup.created_at).toISOString(),
        title: "Supplier added",
        detail: `"${sup.name || supplierId}"${contact ? ` · ${contact}` : ""}${!isSqlite ? ` · ${srcLabel}` : ""}`,
      });
    }

    const purchases = await query(
      `SELECT id, total, paid_amount, payment_status, ${colDate} AS purchase_date, created_at,
        COALESCE(source, 'pos') AS source
       FROM purchases WHERE supplier_id = ? ORDER BY created_at DESC`,
      [supplierId]
    );

    const purchaseIds = (purchases || []).map((p) => p.id);
    let itemsByPurchase = {};
    if (purchaseIds.length > 0) {
      const ph = purchaseIds.map(() => "?").join(",");
      const itemRows = await query(
        `SELECT purchase_id, product_name, quantity FROM purchase_items WHERE purchase_id IN (${ph}) ORDER BY purchase_id, id`,
        purchaseIds
      );
      for (const it of itemRows || []) {
        if (!itemsByPurchase[it.purchase_id]) itemsByPurchase[it.purchase_id] = [];
        itemsByPurchase[it.purchase_id].push(`${it.product_name || "?"} ×${it.quantity ?? 1}`);
      }
    }

    for (const p of purchases || []) {
      const total = parseFloat(p.total) || 0;
      const paid = parseFloat(p.paid_amount) || 0;
      const balance = Math.max(0, total - paid);
      const src = String(p.source || "pos").toLowerCase() === "whatsapp" ? "WhatsApp" : "POS";
      const when = p.purchase_date ?? p.created_at;
      const lines = itemsByPurchase[p.id] || [];
      const itemsSummary = lines.length ? lines.join(", ") : "—";
      const status =
        p.payment_status || (paid >= total ? "paid" : paid <= 0 ? "unpaid" : "partial");
      entries.push({
        kind: "purchase",
        id: `pur-${p.id}`,
        at: when ? new Date(when).toISOString() : null,
        title: "Purchase",
        detail: `Total $${total.toFixed(2)} · Paid $${paid.toFixed(2)}${balance > 0 ? ` · Due $${balance.toFixed(2)}` : ""} · ${status} · ${src} · ${itemsSummary}`,
        refId: p.id,
      });
    }

    let payments = [];
    if (purchaseIds.length > 0) {
      const ph = purchaseIds.map(() => "?").join(",");
      payments = await query(
        `SELECT sp.id, sp.purchase_id, sp.amount, sp.payment_method, sp.created_at
         FROM supplier_payments sp
         WHERE sp.purchase_id IN (${ph})
         ORDER BY sp.created_at DESC`,
        purchaseIds
      );
    }
    for (const pay of payments || []) {
      const amt = parseFloat(pay.amount) || 0;
      const pm = (pay.payment_method || "cash").toLowerCase() === "card" ? "Card" : "Cash";
      entries.push({
        kind: "purchase_payment",
        id: `spay-${pay.id}`,
        at: pay.created_at ? new Date(pay.created_at).toISOString() : null,
        title: "Payment on purchase",
        detail: `$${amt.toFixed(2)} · ${pm} · Purchase ${pay.purchase_id}`,
        refId: pay.purchase_id,
      });
    }

    const manualRows = await query(
      `SELECT id, type, amount, note, ${colDate} AS entry_date, created_at
       FROM supplier_khata_entries
       WHERE supplier_id = ?
       ORDER BY created_at DESC`,
      [supplierId]
    );
    for (const e of manualRows || []) {
      const amt = parseFloat(e.amount) || 0;
      const when = e.entry_date ?? e.created_at;
      const isUdhaar = e.type === "udhaar_added";
      entries.push({
        kind: isUdhaar ? "khata_udhaar" : "khata_payment",
        id: `khe-s-${e.id}`,
        at: when ? new Date(when).toISOString() : null,
        title: isUdhaar ? "Khata — udhaar added" : "Khata — payment received",
        detail: `$${amt.toFixed(2)}${e.note ? ` · ${String(e.note).trim()}` : ""}`,
        refId: e.id,
      });
    }

    entries.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
    res.json({
      supplierId,
      supplierName: sup.name || "",
      entries,
    });
  } catch (err) {
    console.error("Supplier activity-log error:", err);
    res.status(500).json({ error: "Failed to fetch supplier activity" });
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
