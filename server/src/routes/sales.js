import { Router } from "express";
import pool, { query } from "../config/database.js";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const sales = await query(
      "SELECT id, total, payment_method, cashier, customer_id, created_at FROM sales ORDER BY created_at DESC"
    );
    if (sales.length === 0) return res.json([]);
    const saleIds = sales.map((s) => s.id);
    const placeholders = saleIds.map(() => "?").join(",");
    const items = await query(
      `SELECT si.sale_id, si.product_id, si.product_name, si.unit_price AS price, si.quantity,
        p.name AS product_current_name, p.stock AS product_stock, p.cost AS product_cost
       FROM sale_items si
       LEFT JOIN products p ON p.id = si.product_id
       WHERE si.sale_id IN (${placeholders})
       ORDER BY si.sale_id, si.id`,
      saleIds
    );
    const itemsBySale = {};
    for (const it of items) {
      if (!itemsBySale[it.sale_id]) itemsBySale[it.sale_id] = [];
      itemsBySale[it.sale_id].push({
        productId: it.product_id,
        productName: it.product_name,
        price: parseFloat(it.price),
        quantity: it.quantity,
        product: it.product_current_name != null ? { id: it.product_id, name: it.product_current_name, stock: it.product_stock, cost: it.product_cost != null ? parseFloat(it.product_cost) : null } : null,
      });
    }
    const result = sales.map((s) => ({
      id: s.id,
      total: parseFloat(s.total),
      paymentMethod: s.payment_method,
      cashier: s.cashier,
      customerId: s.customer_id ?? null,
      date: s.created_at ? new Date(s.created_at).toISOString() : null,
      items: itemsBySale[s.id] || [],
    }));
    res.json(result);
  } catch (err) {
    console.error("Sales list error:", err);
    res.status(500).json({ error: "Failed to fetch sales" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { items: bodyItems, total, paymentMethod, cashier, customerId } = req.body;
    if (!Array.isArray(bodyItems) || bodyItems.length === 0 || total == null || !paymentMethod || !cashier) {
      return res.status(400).json({ error: "items (array), total, paymentMethod, and cashier are required" });
    }
    for (const it of bodyItems) {
      const productId = it.product?.id ?? it.productId ?? it.product_id;
      const price = it.product?.price ?? it.price ?? it.unitPrice;
      if (productId == null) return res.status(400).json({ error: "Each item must have product.id or productId" });
      if (it.quantity == null || Number(it.quantity) <= 0) return res.status(400).json({ error: "Each item must have a positive quantity" });
      if (price == null) return res.status(400).json({ error: "Each item must have product.price or price" });
    }
    const saleId = `sale-${Date.now()}`;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        "INSERT INTO sales (id, total, payment_method, cashier, customer_id) VALUES (?, ?, ?, ?, ?)",
        [saleId, total, paymentMethod, cashier, customerId || null]
      );
      for (const it of bodyItems) {
        const productId = it.product?.id ?? it.productId ?? it.product_id;
        const productName = it.product?.name ?? it.productName ?? it.product_name ?? "";
        const price = it.product?.price ?? it.price ?? it.unitPrice ?? 0;
        const quantity = Number(it.quantity);
        await conn.execute(
          "INSERT INTO sale_items (sale_id, product_id, product_name, unit_price, quantity) VALUES (?, ?, ?, ?, ?)",
          [saleId, productId, productName, price, quantity]
        );
        await conn.execute("UPDATE products SET stock = stock - ? WHERE id = ?", [quantity, productId]);
      }
      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }
    const [saleRow] = await query(
      "SELECT id, total, payment_method, cashier, customer_id, created_at FROM sales WHERE id = ?",
      [saleId]
    );
    const itemRows = await query("SELECT product_id, product_name, unit_price AS price, quantity FROM sale_items WHERE sale_id = ?", [saleId]);
    const created = {
      id: saleRow.id,
      items: itemRows.map((r) => ({ productId: r.product_id, productName: r.product_name, price: parseFloat(r.price), quantity: r.quantity })),
      total: parseFloat(saleRow.total),
      paymentMethod: saleRow.payment_method,
      customerId: saleRow.customer_id ?? null,
      date: saleRow.created_at ? new Date(saleRow.created_at).toISOString() : null,
      cashier: saleRow.cashier,
    };
    res.status(201).json(created);
  } catch (err) {
    console.error("Sale create error:", err);
    res.status(500).json({ error: "Failed to create sale" });
  }
});

export default router;
