import { Router } from "express";
import pool, { query } from "../config/database.js";
import { logActivityDelete, inferDeleteSource } from "../lib/activityLog.js";

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
        const paidAmount = total;
        const paymentStatus = "paid";
        const source = "pos";
        const insertSql = createdAt
          ? "INSERT INTO sales (id, total, payment_method, cashier, customer_id, created_at, date, paid_amount, payment_status, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
          : "INSERT INTO sales (id, total, payment_method, cashier, customer_id, paid_amount, payment_status, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
        const insertParams = createdAt
          ? [saleId, total, paymentMethod, cashier, customerId, createdAt, createdAt, paidAmount, paymentStatus, source]
          : [saleId, total, paymentMethod, cashier, customerId, paidAmount, paymentStatus, source];
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

/** Get YYYY-MM-DD for a period in Pakistan time (Asia/Karachi). */
function getTargetDatePK(period) {
  const now = new Date();
  const daysBack = period === "yesterday" ? 1 : period === "day_before_yesterday" ? 2 : 0;
  const d = new Date(now);
  d.setDate(d.getDate() - daysBack);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
}

/** GET /api/sales/stats?period=today|yesterday|day_before_yesterday – sales report for that date */
router.get("/stats", async (req, res) => {
  try {
    const period = (req.query.period || "today").toLowerCase();
    const allowed = ["today", "yesterday", "day_before_yesterday"];
    if (!allowed.includes(period)) {
      return res.status(400).json({ error: `period must be one of: ${allowed.join(", ")}` });
    }

    const targetDate = getTargetDatePK(period);
    const dateCond = isSqlite
      ? "date(s.created_at) = ?"
      : "DATE(s.created_at) = ?";
    const params = [targetDate];

    const sales = await query(
      `SELECT s.id, s.total, s.payment_method FROM sales s WHERE ${dateCond} ORDER BY s.created_at DESC`,
      params
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
    let totalProfit = 0;
    if (salesCount > 0) {
      const saleIds = sales.map((s) => s.id);
      const placeholders = saleIds.map(() => "?").join(",");
      const topRows = await query(
        `SELECT si.product_id, si.product_name,
          SUM(si.quantity) as qty, SUM(si.unit_price * si.quantity) as rev
         FROM sale_items si
         WHERE si.sale_id IN (${placeholders})
         GROUP BY si.product_id, si.product_name
         ORDER BY qty DESC, rev DESC LIMIT 1`,
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
      const costRows = await query(
        `SELECT si.unit_price, si.quantity, COALESCE(p.cost, 0) as cost
         FROM sale_items si
         LEFT JOIN products p ON p.id = si.product_id AND p.deleted_at IS NULL
         WHERE si.sale_id IN (${placeholders})`,
        saleIds
      );
      for (const row of costRows || []) {
        const rev = parseFloat(row.unit_price || 0) * (parseInt(row.quantity, 10) || 0);
        const cost = parseFloat(row.cost || 0) * (parseInt(row.quantity, 10) || 0);
        totalProfit += rev - cost;
      }
    }

    const reportDateLabel = new Date(targetDate + "T12:00:00").toLocaleDateString("en-PK", { timeZone: "Asia/Karachi", weekday: "short", month: "short", day: "numeric", year: "numeric" });
    res.json({
      salesCount,
      totalRevenue,
      totalProfit,
      topProduct,
      paymentBreakdown: { cash: byMethod.cash, card: byMethod.card },
      reportDate: targetDate,
      reportDateLabel,
    });
  } catch (err) {
    console.error("Sales stats error:", err);
    res.status(500).json({ error: "Failed to fetch sales stats" });
  }
});

router.get("/", async (_req, res) => {
  try {
    const colDate = isSqlite ? "date" : "`date`";
    const sales = await query(
      `SELECT id, total, payment_method, cashier, customer_id, created_at, ${colDate} AS sale_date, paid_amount, payment_status, COALESCE(source, 'pos') AS source FROM sales ORDER BY created_at DESC`
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
      const totalVal = parseFloat(s.total);
      const paidVal = parseFloat(s.paid_amount ?? s.total ?? 0);
      return {
        id: s.id,
        total: totalVal,
        paidAmount: paidVal,
        paymentStatus: s.payment_status ?? (paidVal >= totalVal ? "paid" : paidVal <= 0 ? "credit" : "partial"),
        balance: Math.max(0, totalVal - paidVal),
        paymentMethod: s.payment_method,
        cashier: s.cashier,
        customerId: s.customer_id ?? null,
        date: dateSource ? new Date(dateSource).toISOString() : null,
        items: itemsBySale[s.id] || [],
        source: s.source && String(s.source).toLowerCase() === "whatsapp" ? "whatsapp" : "pos",
      };
    });
    res.json(result);
  } catch (err) {
    console.error("Sales list error:", err);
    res.status(500).json({ error: "Failed to fetch sales" });
  }
});

function computePaymentStatus(paidAmount, totalAmount) {
  const paid = parseFloat(paidAmount) || 0;
  const total = parseFloat(totalAmount) || 0;
  if (paid >= total) return "paid";
  if (paid <= 0) return "credit";
  return "partial";
}

router.post("/", async (req, res) => {
  try {
    const { items: bodyItems, total, paymentMethod, cashier, customerId, paidAmount: reqPaidAmount, source: reqSource } = req.body;
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
    const totalVal = parseFloat(total);
    const paidAmount = reqPaidAmount != null ? parseFloat(reqPaidAmount) : totalVal;
    const paymentStatus = computePaymentStatus(paidAmount, totalVal);
    if (paidAmount < 0 || paidAmount > totalVal) {
      return res.status(400).json({ error: "paidAmount must be between 0 and total" });
    }
    const saleId = `sale-${Date.now()}`;
    const source = reqSource && String(reqSource).toLowerCase() === "whatsapp" ? "whatsapp" : "pos";
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        "INSERT INTO sales (id, total, payment_method, cashier, customer_id, paid_amount, payment_status, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [saleId, total, paymentMethod, cashier, customerId || null, paidAmount, paymentStatus, source]
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
      "SELECT id, total, payment_method, cashier, customer_id, created_at, paid_amount, payment_status FROM sales WHERE id = ?",
      [saleId]
    );
    const itemRows = await query("SELECT product_id, product_name, unit_price AS price, quantity FROM sale_items WHERE sale_id = ?", [saleId]);
    const t = parseFloat(saleRow.total);
    const p = parseFloat(saleRow.paid_amount ?? saleRow.total ?? 0);
    const created = {
      id: saleRow.id,
      items: itemRows.map((r) => ({ productId: r.product_id, productName: r.product_name, price: parseFloat(r.price), quantity: r.quantity })),
      total: t,
      paidAmount: p,
      paymentStatus: saleRow.payment_status ?? computePaymentStatus(p, t),
      balance: Math.max(0, t - p),
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

/** POST /api/sales/:id/payments – record a payment against a credit/partial sale */
router.post("/:id/payments", async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, paymentMethod, source: reqSource } = req.body;
    const payAmount = parseFloat(amount);
    if (!amount || isNaN(payAmount) || payAmount <= 0) {
      return res.status(400).json({ error: "amount must be a positive number" });
    }
    const pm = (paymentMethod || "cash").toLowerCase() === "card" ? "card" : "cash";

    const sales = await query("SELECT id, total, paid_amount, payment_status FROM sales WHERE id = ?", [id]);
    if (!sales || sales.length === 0) return res.status(404).json({ error: "Sale not found" });
    const sale = sales[0];
    const total = parseFloat(sale.total);
    const paid = parseFloat(sale.paid_amount ?? 0) || 0;
    const balance = total - paid;
    if (balance <= 0) return res.status(400).json({ error: "Sale is already fully paid" });
    if (payAmount > balance) return res.status(400).json({ error: "amount exceeds outstanding balance" });

    const newPaid = paid + payAmount;
    const newStatus = newPaid >= total ? "paid" : "partial";
    const payId = `pay-${Date.now()}`;
    const source = reqSource && String(reqSource).toLowerCase() === "whatsapp" ? "whatsapp" : "pos";

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        "INSERT INTO sale_payments (id, sale_id, amount, payment_method, date, created_at, source) VALUES (?, ?, ?, ?, NOW(), NOW(), ?)",
        [payId, id, payAmount, pm, source]
      );
      await conn.execute(
        "UPDATE sales SET paid_amount = ?, payment_status = ? WHERE id = ?",
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
      "SELECT id, total, paid_amount, payment_status FROM sales WHERE id = ?",
      [id]
    );
    const t = parseFloat(updated.total);
    const p = parseFloat(updated.paid_amount);
    res.status(201).json({
      payment: { id: payId, saleId: id, amount: payAmount, paymentMethod: pm },
      sale: {
        id: updated.id,
        total: t,
        paidAmount: p,
        paymentStatus: updated.payment_status,
        balance: Math.max(0, t - p),
      },
    });
  } catch (err) {
    console.error("Sale payment error:", err);
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/sales/:id – void a sale (restore stock, remove sale). Used for undo. */
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const [sale] = await query("SELECT id, total, payment_method, cashier, source FROM sales WHERE id = ?", [id]);
    const items = await query(
      "SELECT product_id, quantity FROM sale_items WHERE sale_id = ?",
      [id]
    );
    if (!sale || !items || items.length === 0) {
      return res.status(404).json({ error: "Sale not found or already voided" });
    }
    const source = inferDeleteSource(req);
    const deletedBy = req.body?.deletedBy ?? req.query?.deletedBy ?? sale.cashier ?? null;
    await logActivityDelete({
      type: "void_sale",
      entityId: id,
      summary: `Sale voided: Rs ${Number(sale.total || 0).toLocaleString()} (${sale.payment_method || "cash"})`,
      amount: Number(sale.total) || 0,
      source,
      deletedBy: deletedBy ? String(deletedBy).trim() : null,
    });
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
