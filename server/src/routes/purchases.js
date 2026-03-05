import { Router } from "express";
import pool, { query } from "../config/database.js";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const purchases = await query(
      "SELECT id, supplier_id, total, created_at FROM purchases ORDER BY created_at DESC"
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
    const { supplierId, items: bodyItems, total } = req.body;
    if (!supplierId || !Array.isArray(bodyItems) || bodyItems.length === 0 || total == null) {
      return res.status(400).json({ error: "supplierId, items (array), and total are required" });
    }
    for (const it of bodyItems) {
      if (it.productId == null && it.product_id == null) return res.status(400).json({ error: "Each item must have productId or product_id" });
      if (it.quantity == null || Number(it.quantity) <= 0) return res.status(400).json({ error: "Each item must have a positive quantity" });
      if (it.cost == null) return res.status(400).json({ error: "Each item must have cost" });
    }
    const purchaseId = `pur-${Date.now()}`;
    const date = new Date().toISOString().slice(0, 19).replace("T", " ");
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        "INSERT INTO purchases (id, supplier_id, total, date) VALUES (?, ?, ?, ?)",
        [purchaseId, supplierId, total, date]
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
      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }
    const [purchaseRow] = await query(
      "SELECT id, supplier_id, total, created_at FROM purchases WHERE id = ?",
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

export default router;
