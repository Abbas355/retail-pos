import { Router } from "express";
import { query } from "../config/database.js";

const router = Router();
const isSqlite = (process.env.DB_TYPE || "mysql").toLowerCase() === "sqlite";

/** GET /api/khata/ledger – all unpaid sales with customer, items, paid, due (for table view) */
router.get("/ledger", async (_req, res) => {
  try {
    const colDate = isSqlite ? "date" : "`date`";
    const sales = await query(
      `SELECT s.id AS sale_id, s.customer_id, s.total, s.paid_amount, s.${colDate} AS sale_date
       FROM sales s
       WHERE s.customer_id IS NOT NULL AND COALESCE(s.paid_amount, 0) < s.total
       ORDER BY s.${colDate} DESC`
    );
    if (!sales.length) return res.json([]);

    const saleIds = sales.map((s) => s.sale_id);
    const placeholders = saleIds.map(() => "?").join(",");

    const itemsRows = await query(
      `SELECT si.sale_id, si.product_name, si.quantity, si.unit_price
       FROM sale_items si
       WHERE si.sale_id IN (${placeholders})`,
      saleIds
    );

    const customerIds = [...new Set(sales.map((s) => s.customer_id).filter(Boolean))];
    const custPlaceholders = customerIds.map(() => "?").join(",");
    const customers = await query(
      `SELECT id, name FROM customers WHERE id IN (${custPlaceholders})`,
      customerIds
    );
    const customerMap = Object.fromEntries(customers.map((c) => [c.id, c.name || "?"]));

    const itemsBySale = {};
    for (const r of itemsRows) {
      if (!itemsBySale[r.sale_id]) itemsBySale[r.sale_id] = [];
      itemsBySale[r.sale_id].push(`${r.quantity} × ${r.product_name}`);
    }

    const result = sales.map((s) => {
      const total = parseFloat(s.total);
      const paid = parseFloat(s.paid_amount) || 0;
      const balance = Math.max(0, total - paid);
      const itemsStr = (itemsBySale[s.sale_id] || []).join(", ");
      return {
        saleId: s.sale_id,
        customerId: s.customer_id,
        customerName: customerMap[s.customer_id] || "?",
        items: itemsStr || "—",
        total,
        paidAmount: paid,
        amountDue: balance,
        date: s.sale_date ? new Date(s.sale_date).toISOString() : null,
      };
    });

    res.json(result);
  } catch (err) {
    console.error("Khata ledger error:", err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/khata/customers – list customers with outstanding balance */
router.get("/customers", async (_req, res) => {
  try {
    const rows = await query(
      `SELECT c.id, c.name, c.phone,
        COALESCE(SUM(s.total - COALESCE(s.paid_amount, 0)), 0) AS balance
       FROM customers c
       LEFT JOIN sales s ON s.customer_id = c.id
         AND COALESCE(s.paid_amount, 0) < s.total
       GROUP BY c.id, c.name, c.phone
       HAVING balance > 0
       ORDER BY balance DESC`
    );
    const result = rows.map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone ?? null,
      balance: parseFloat(r.balance) || 0,
    }));
    res.json(result);
  } catch (err) {
    console.error("Khata customers error:", err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/khata/customers/:id – ledger for a customer: sales (credit/partial), payments */
router.get("/customers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const colDate = isSqlite ? "date" : "`date`";
    const customer = await query("SELECT id, name, phone FROM customers WHERE id = ?", [id]);
    if (!customer || customer.length === 0) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const sales = await query(
      `SELECT id, total, paid_amount, payment_status, ${colDate} AS sale_date, created_at
       FROM sales
       WHERE customer_id = ? AND COALESCE(paid_amount, 0) < total
       ORDER BY sale_date DESC`,
      [id]
    );

    const balance = sales.reduce((sum, s) => sum + (parseFloat(s.total) - (parseFloat(s.paid_amount) || 0)), 0);

    const saleIds = sales.map((s) => s.id);
    let payments = [];
    if (saleIds.length > 0) {
      const placeholders = saleIds.map(() => "?").join(",");
      payments = await query(
        `SELECT id, sale_id, amount, payment_method, date, created_at
         FROM sale_payments
         WHERE sale_id IN (${placeholders})
         ORDER BY created_at DESC`,
        saleIds
      );
    }

    const salesForLedger = sales.map((s) => ({
      id: s.id,
      total: parseFloat(s.total),
      paidAmount: parseFloat(s.paid_amount) || 0,
      paymentStatus: s.payment_status,
      balance: Math.max(0, parseFloat(s.total) - (parseFloat(s.paid_amount) || 0)),
      date: s.sale_date ? new Date(s.sale_date).toISOString() : null,
      type: "sale",
    }));

    const paymentsForLedger = payments.map((p) => ({
      id: p.id,
      saleId: p.sale_id,
      amount: parseFloat(p.amount),
      paymentMethod: p.payment_method,
      date: p.created_at ? new Date(p.created_at).toISOString() : null,
      type: "payment",
    }));

    const ledger = [...salesForLedger, ...paymentsForLedger].sort(
      (a, b) => new Date(b.date || 0) - new Date(a.date || 0)
    );

    res.json({
      customer: { id: customer[0].id, name: customer[0].name, phone: customer[0].phone ?? null },
      balance,
      ledger,
    });
  } catch (err) {
    console.error("Khata ledger error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
