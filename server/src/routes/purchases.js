import { Router } from "express";
import pool, { query } from "../config/database.js";
import { getNowPK } from "../lib/dateUtils.js";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const purchases = await query(
      "SELECT id, supplier_id, total, paid_amount, payment_status, created_at FROM purchases ORDER BY created_at DESC"
    );
    if (purchases.length === 0) return res.json([]);
    const purchaseIds = purchases.map((p) => p.id);
    const placeholders = purchaseIds.map(() => "?").join(",");
    const items = await query(
      `SELECT purchase_id, product_id, product_name, quantity, cost
       FROM purchase_items WHERE purchase_id IN (${placeholders})
       ORDER BY purchase_id, id`,
      purchaseIds
    );
    const itemsByPurchase = {};
    for (const it of items) {
      if (!itemsByPurchase[it.purchase_id]) itemsByPurchase[it.purchase_id] = [];
      itemsByPurchase[it.purchase_id].push({
        productId: it.product_id,
        productName: it.product_name,
        quantity: it.quantity,
        cost: parseFloat(it.cost),
      });
    }
    const result = purchases.map((p) => ({
      id: p.id,
      supplierId: p.supplier_id,
      total: parseFloat(p.total),
      paidAmount: parseFloat(p.paid_amount ?? 0) || 0,
      paymentStatus: p.payment_status ?? "unpaid",
      date: p.created_at ? new Date(p.created_at).toISOString() : null,
      items: itemsByPurchase[p.id] || [],
    }));
    res.json(result);
  } catch (err) {
    console.error("Purchases list error:", err);
    res.status(500).json({ error: "Failed to fetch purchases" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { supplierId, items: bodyItems, total, source: reqSource, paidAmount: reqPaidAmount, paymentMethod: reqPaymentMethod } = req.body;
    if (!supplierId || !Array.isArray(bodyItems) || bodyItems.length === 0 || total == null) {
      return res.status(400).json({ error: "supplierId, items (array), and total are required" });
    }
    for (const it of bodyItems) {
      if (it.productId == null && it.product_id == null) return res.status(400).json({ error: "Each item must have productId or product_id" });
      if (it.quantity == null || Number(it.quantity) <= 0) return res.status(400).json({ error: "Each item must have a positive quantity" });
      if (it.cost == null) return res.status(400).json({ error: "Each item must have cost" });
    }
    const totalNum = parseFloat(total);
    const paidAmount = Math.max(0, parseFloat(reqPaidAmount ?? 0) || 0);
    if (paidAmount > totalNum) return res.status(400).json({ error: "paidAmount cannot exceed total" });
    const paymentStatus = paidAmount >= totalNum ? "paid" : paidAmount > 0 ? "partial" : "unpaid";
    const pm = (reqPaymentMethod || "cash").toLowerCase() === "card" ? "card" : "cash";

    const purchaseId = `pur-${Date.now()}`;
    const source = reqSource && String(reqSource).toLowerCase() === "whatsapp" ? "whatsapp" : "pos";
    const date = getNowPK();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        "INSERT INTO purchases (id, supplier_id, total, date, source, paid_amount, payment_status) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [purchaseId, supplierId, total, date, source, paidAmount, paymentStatus]
      );
      for (const it of bodyItems) {
        const productId = it.productId ?? it.product_id;
        const productName = it.productName ?? it.product_name ?? "";
        const quantity = Number(it.quantity);
        const cost = Number(it.cost);
        await conn.execute(
          "INSERT INTO purchase_items (purchase_id, product_id, product_name, quantity, cost) VALUES (?, ?, ?, ?, ?)",
          [purchaseId, productId, productName, quantity, cost]
        );
        await conn.execute("UPDATE products SET stock = stock + ? WHERE id = ?", [quantity, productId]);
      }
      if (paidAmount > 0) {
        const payId = `spay-${Date.now()}`;
        await conn.execute(
          "INSERT INTO supplier_payments (id, purchase_id, amount, payment_method, date, created_at, source) VALUES (?, ?, ?, ?, NOW(), NOW(), ?)",
          [payId, purchaseId, paidAmount, pm, source]
        );
      }
      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }
    const [purchaseRow] = await query(
      "SELECT id, supplier_id, total, paid_amount, payment_status, created_at FROM purchases WHERE id = ?",
      [purchaseId]
    );
    const itemRows = await query(
      "SELECT product_id, product_name, quantity, cost FROM purchase_items WHERE purchase_id = ?",
      [purchaseId]
    );
    const created = {
      id: purchaseRow.id,
      supplierId: purchaseRow.supplier_id,
      total: parseFloat(purchaseRow.total),
      paidAmount: parseFloat(purchaseRow.paid_amount) || 0,
      paymentStatus: purchaseRow.payment_status,
      date: purchaseRow.created_at ? new Date(purchaseRow.created_at).toISOString() : null,
      items: itemRows.map((r) => ({
        productId: r.product_id,
        productName: r.product_name,
        quantity: r.quantity,
        cost: parseFloat(r.cost),
      })),
    };
    res.status(201).json(created);
  } catch (err) {
    console.error("Purchase create error:", err);
    res.status(500).json({ error: "Failed to create purchase" });
  }
});

/** POST /api/purchases/:id/payments – record a payment against a purchase (supplier khata) */
router.post("/:id/payments", async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, paymentMethod, source: reqSource } = req.body;
    const payAmount = parseFloat(amount);
    if (!amount || isNaN(payAmount) || payAmount <= 0) {
      return res.status(400).json({ error: "amount must be a positive number" });
    }
    const pm = (paymentMethod || "cash").toLowerCase() === "card" ? "card" : "cash";

    const rows = await query("SELECT id, total, paid_amount, payment_status FROM purchases WHERE id = ?", [id]);
    if (!rows || rows.length === 0) return res.status(404).json({ error: "Purchase not found" });
    const purchase = rows[0];
    const total = parseFloat(purchase.total);
    const paid = parseFloat(purchase.paid_amount ?? 0) || 0;
    const balance = total - paid;
    if (balance <= 0) return res.status(400).json({ error: "Purchase is already fully paid" });
    if (payAmount > balance) return res.status(400).json({ error: "amount exceeds outstanding balance" });

    const newPaid = paid + payAmount;
    const newStatus = newPaid >= total ? "paid" : "partial";
    const payId = `spay-${Date.now()}`;
    const source = reqSource && String(reqSource).toLowerCase() === "whatsapp" ? "whatsapp" : "pos";

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        "INSERT INTO supplier_payments (id, purchase_id, amount, payment_method, date, created_at, source) VALUES (?, ?, ?, ?, NOW(), NOW(), ?)",
        [payId, id, payAmount, pm, source]
      );
      await conn.execute(
        "UPDATE purchases SET paid_amount = ?, payment_status = ? WHERE id = ?",
        [newPaid, newStatus, id]
      );
      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }

    const [updated] = await query(
      "SELECT id, total, paid_amount, payment_status FROM purchases WHERE id = ?",
      [id]
    );
    const t = parseFloat(updated.total);
    const p = parseFloat(updated.paid_amount);
    res.status(201).json({
      payment: { id: payId, purchaseId: id, amount: payAmount, paymentMethod: pm },
      purchase: {
        id: updated.id,
        total: t,
        paidAmount: p,
        paymentStatus: updated.payment_status,
        balance: Math.max(0, t - p),
      },
    });
  } catch (err) {
    console.error("Purchase payment error:", err);
    res.status(500).json({ error: "Failed to record payment" });
  }
});

export default router;
