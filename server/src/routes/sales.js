import { Router } from "express";
import pool, { query } from "../config/database.js";

const router = Router();
const isSqlite = (process.env.DB_TYPE || "mysql").toLowerCase() === "sqlite";

/** POST /api/sales/sync – push localStorage sales to backend (for Reports/WhatsApp) */
router.post("/sync", async (req, res) => {
  try {
    const { sales: bodySales } = req.body;
    if (!Array.isArray(bodySales) || bodySales.length === 0) {
      return res.json({ ok: true, pushed: 0, message: "No sales to sync" });
    }
    let pushed = 0;
    const existing = await query("SELECT id, total, created_at FROM sales");
    const existingKeys = new Set(existing.map((s) => `${s.total}-${String(s.created_at).slice(0, 10)}`));

    for (const s of bodySales) {
      const items = s.items || [];
      const total = parseFloat(s.total);
      const paymentMethod = (s.paymentMethod || "cash").toLowerCase() === "card" ? "card" : "cash";
      const cashier = String(s.cashier || "Unknown").trim() || "Unknown";
      const customerId = s.customerId || null;
      const dateStr = s.date ? String(s.date).slice(0, 10) : null;
      const key = `${total}-${dateStr || ""}`;
      if (existingKeys.has(key)) continue;

      const bodyItems = items.map((i) => ({
        productId: i.product?.id ?? i.productId,
        productName: i.product?.name ?? i.productName ?? "",
        price: i.product?.price ?? i.price ?? 0,
        quantity: i.quantity ?? 0,
      })).filter((it) => it.productId && it.quantity > 0);
      if (bodyItems.length === 0) continue;

      const saleId = `sale-${Date.now()}-${pushed}`;
      const createdAt = dateStr ? `${dateStr} 12:00:00` : null;
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const insertSql = createdAt
          ? "INSERT INTO sales (id, total, payment_method, cashier, customer_id, created_at, date) VALUES (?, ?, ?, ?, ?, ?, ?)"
          : "INSERT INTO sales (id, total, payment_method, cashier, customer_id) VALUES (?, ?, ?, ?, ?)";
        const insertParams = createdAt
          ? [saleId, total, paymentMethod, cashier, customerId, createdAt, createdAt]
          : [saleId, total, paymentMethod, cashier, customerId];
        await conn.execute(insertSql, insertParams);
        for (const it of bodyItems) {
          await conn.execute(
            "INSERT INTO sale_items (sale_id, product_id, product_name, unit_price, quantity) VALUES (?, ?, ?, ?, ?)",
            [saleId, it.productId, it.productName || "", parseFloat(it.price) || 0, parseInt(it.quantity, 10) || 1]
          );
        }
        await conn.commit();
        existingKeys.add(key);
        pushed++;
      } catch (txErr) {
        await conn.rollback();
        console.warn("Sales sync: skip sale", total, txErr.message);
      } finally {
        conn.release();
      }
    }
    res.json({ ok: true, pushed, message: `Synced ${pushed} sale(s)` });
  } catch (err) {
    console.error("Sales sync error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** GET /api/sales/stats?period=today – today's sales report */
router.get("/stats", async (req, res) => {
  try {
    const period = (req.query.period || "today").toLowerCase();
    if (period !== "today") {
      return res.status(400).json({ error: "Only period=today is supported" });
    }

    const dateCond = isSqlite
      ? "date(s.created_at) = date('now', 'localtime')"
      : "DATE(s.created_at) = CURDATE()";

    const sales = await query(
      `SELECT s.id, s.total, s.payment_method FROM sales s WHERE ${dateCond} ORDER BY s.created_at DESC`
    );

    const salesCount = sales.length;
    let totalRevenue = 0;
    const byMethod = { cash: 0, card: 0 };
    for (const s of sales) {
      const t = parseFloat(s.total) || 0;
      totalRevenue += t;
      const m = (s.payment_method || "cash").toLowerCase();
      if (m === "card") byMethod.card += t;
      else byMethod.cash += t;
    }

    let topProduct = null;
    if (salesCount > 0) {
      const saleIds = sales.map((s) => s.id);
      const placeholders = saleIds.map(() => "?").join(",");
      const topRows = await query(
        `SELECT si.product_id, si.product_name,
          SUM(si.quantity) as qty, SUM(si.unit_price * si.quantity) as rev
         FROM sale_items si
         WHERE si.sale_id IN (${placeholders})
         GROUP BY si.product_id, si.product_name
         ORDER BY rev DESC LIMIT 1`,
        saleIds
      );
      if (topRows && topRows.length > 0) {
        const r = topRows[0];
        topProduct = {
          productId: r.product_id,
          productName: r.product_name || "Unknown",
          quantitySold: parseInt(r.qty, 10) || 0,
          revenue: parseFloat(r.rev) || 0,
          percentageOfRevenue: totalRevenue > 0 ? Math.round((parseFloat(r.rev) / totalRevenue) * 100) : 0,
        };
      }
    }

    res.json({
      salesCount,
      totalRevenue,
      topProduct,
      paymentBreakdown: { cash: byMethod.cash, card: byMethod.card },
    });
  } catch (err) {
    console.error("Sales stats error:", err);
    res.status(500).json({ error: "Failed to fetch sales stats" });
  }
});

router.get("/", async (_req, res) => {
  try {
    const sales = await query(
      "SELECT id, total, payment_method, cashier, customer_id, created_at, `date` AS sale_date FROM sales ORDER BY created_at DESC"
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
    const result = sales.map((s) => {
      const dateSource = s.sale_date ?? s.created_at;
      return {
        id: s.id,
        total: parseFloat(s.total),
        paymentMethod: s.payment_method,
        cashier: s.cashier,
        customerId: s.customer_id ?? null,
        date: dateSource ? new Date(dateSource).toISOString() : null,
        items: itemsBySale[s.id] || [],
      };
    });
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

/** DELETE /api/sales/:id – void a sale (restore stock, remove sale). Used for undo. */
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const items = await query(
      "SELECT product_id, quantity FROM sale_items WHERE sale_id = ?",
      [id]
    );
    if (!items || items.length === 0) {
      return res.status(404).json({ error: "Sale not found or already voided" });
    }
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const it of items) {
        await conn.execute(
          "UPDATE products SET stock = stock + ? WHERE id = ?",
          [Number(it.quantity) || 0, it.product_id]
        );
      }
      await conn.execute("DELETE FROM sale_items WHERE sale_id = ?", [id]);
      await conn.execute("DELETE FROM sales WHERE id = ?", [id]);
      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }
    res.status(204).send();
  } catch (err) {
    console.error("Sale void error:", err);
    res.status(500).json({ error: "Failed to void sale" });
  }
});

export default router;
