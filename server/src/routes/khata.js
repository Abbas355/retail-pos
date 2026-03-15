import { Router } from "express";
import { query } from "../config/database.js";
import { toDbDateTimePK, toIsoPK } from "../lib/dateUtils.js";

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

/** GET /api/khata/supplier-ledger – all unpaid/partial purchases with supplier, paid, due (for table view, like customer ledger) */
router.get("/supplier-ledger", async (_req, res) => {
  try {
    const colDate = isSqlite ? "date" : "`date`";
    const purchases = await query(
      `SELECT p.id AS purchase_id, p.supplier_id, p.total, p.paid_amount, p.${colDate} AS purchase_date
       FROM purchases p
       WHERE COALESCE(p.paid_amount, 0) < p.total
       ORDER BY p.${colDate} DESC`
    );
    if (!purchases.length) return res.json([]);

    const purchaseIds = purchases.map((p) => p.purchase_id);
    const placeholders = purchaseIds.map(() => "?").join(",");
    const itemsRows = await query(
      `SELECT pi.purchase_id, pi.product_name, pi.quantity, pi.cost
       FROM purchase_items pi
       WHERE pi.purchase_id IN (${placeholders})`,
      purchaseIds
    );
    const supplierIds = [...new Set(purchases.map((p) => p.supplier_id).filter(Boolean))];
    const supPlaceholders = supplierIds.map(() => "?").join(",");
    const suppliers = await query(
      `SELECT id, name FROM suppliers WHERE id IN (${supPlaceholders}) AND deleted_at IS NULL`,
      supplierIds
    );
    const supplierMap = Object.fromEntries(suppliers.map((s) => [s.id, s.name || "?"]));

    const itemsByPurchase = {};
    for (const r of itemsRows) {
      if (!itemsByPurchase[r.purchase_id]) itemsByPurchase[r.purchase_id] = [];
      itemsByPurchase[r.purchase_id].push(`${r.quantity} × ${r.product_name}`);
    }

    const result = purchases.map((p) => {
      const total = parseFloat(p.total);
      const paid = parseFloat(p.paid_amount) || 0;
      const balance = Math.max(0, total - paid);
      const itemsStr = (itemsByPurchase[p.purchase_id] || []).join(", ");
      return {
        purchaseId: p.purchase_id,
        supplierId: p.supplier_id,
        supplierName: supplierMap[p.supplier_id] || "?",
        items: itemsStr || "—",
        total,
        paidAmount: paid,
        amountDue: balance,
        date: p.purchase_date ? new Date(p.purchase_date).toISOString() : null,
      };
    });

    res.json(result);
  } catch (err) {
    console.error("Khata supplier-ledger error:", err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/khata/suppliers – list suppliers with outstanding balance */
router.get("/suppliers", async (_req, res) => {
  try {
    const rows = await query(
      `SELECT sup.id, sup.name, sup.phone,
        COALESCE(SUM(p.total - COALESCE(p.paid_amount, 0)), 0) AS balance
       FROM suppliers sup
       LEFT JOIN purchases p ON p.supplier_id = sup.id
         AND COALESCE(p.paid_amount, 0) < p.total
       WHERE sup.deleted_at IS NULL
       GROUP BY sup.id, sup.name, sup.phone
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
    console.error("Khata suppliers error:", err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/khata/suppliers/:id – ledger for a supplier: purchases (unpaid/partial), payments */
router.get("/suppliers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const colDate = isSqlite ? "date" : "`date`";
    const supplier = await query(
      "SELECT id, name, phone FROM suppliers WHERE id = ? AND deleted_at IS NULL",
      [id]
    );
    if (!supplier || supplier.length === 0) {
      return res.status(404).json({ error: "Supplier not found" });
    }

    const purchases = await query(
      `SELECT id, total, paid_amount, payment_status, ${colDate} AS purchase_date, created_at
       FROM purchases
       WHERE supplier_id = ? AND COALESCE(paid_amount, 0) < total
       ORDER BY purchase_date DESC`,
      [id]
    );

    const balance = purchases.reduce(
      (sum, p) => sum + (parseFloat(p.total) - (parseFloat(p.paid_amount) || 0)),
      0
    );

    const purchaseIds = purchases.map((p) => p.id);
    let payments = [];
    if (purchaseIds.length > 0) {
      const placeholders = purchaseIds.map(() => "?").join(",");
      payments = await query(
        `SELECT id, purchase_id, amount, payment_method, date, created_at
         FROM supplier_payments
         WHERE purchase_id IN (${placeholders})
         ORDER BY created_at DESC`,
        purchaseIds
      );
    }

    const purchasesForLedger = purchases.map((p) => ({
      id: p.id,
      total: parseFloat(p.total),
      paidAmount: parseFloat(p.paid_amount) || 0,
      paymentStatus: p.payment_status,
      balance: Math.max(0, parseFloat(p.total) - (parseFloat(p.paid_amount) || 0)),
      date: p.purchase_date ? new Date(p.purchase_date).toISOString() : null,
      type: "purchase",
    }));

    const paymentsForLedger = payments.map((p) => ({
      id: p.id,
      purchaseId: p.purchase_id,
      amount: parseFloat(p.amount),
      paymentMethod: p.payment_method,
      date: p.created_at ? new Date(p.created_at).toISOString() : null,
      type: "payment",
    }));

    const ledger = [...purchasesForLedger, ...paymentsForLedger].sort(
      (a, b) => new Date(b.date || 0) - new Date(a.date || 0)
    );

    res.json({
      supplier: { id: supplier[0].id, name: supplier[0].name, phone: supplier[0].phone ?? null },
      balance,
      ledger,
    });
  } catch (err) {
    console.error("Khata supplier ledger error:", err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/khata/advances-out – expenses with category Urgent or Other with balance still to be returned */
router.get("/advances-out", async (_req, res) => {
  try {
    const colDate = isSqlite ? "date" : "`date`";
    const rows = await query(
      `SELECT id, amount, COALESCE(returned_amount, 0) AS returned_amount, category, description, ${colDate} AS entry_date
       FROM expenses
       WHERE category IN ('Urgent', 'Other') AND (COALESCE(returned_amount, 0) < amount)
       ORDER BY entry_date DESC`
    );
    const result = (rows || []).map((r) => {
      const amount = parseFloat(r.amount);
      const returned = parseFloat(r.returned_amount) || 0;
      const balance = Math.max(0, amount - returned);
      return {
        id: r.id,
        amount,
        returnedAmount: returned,
        balance,
        category: r.category,
        description: r.description ?? "",
        date: toIsoPK(r.entry_date),
      };
    });
    res.json(result);
  } catch (err) {
    console.error("Khata advances-out error:", err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/khata/cash-in – list cash in / advances returned (money received back) */
router.get("/cash-in", async (_req, res) => {
  try {
    const colDate = isSqlite ? "date" : "`date`";
    const rows = await query(
      `SELECT id, amount, note, ${colDate} AS entry_date, created_at FROM cash_in ORDER BY entry_date DESC, created_at DESC`
    );
    const result = (rows || []).map((r) => ({
      id: r.id,
      amount: parseFloat(r.amount),
      note: r.note ?? "",
      date: toIsoPK(r.entry_date),
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
    }));
    res.json(result);
  } catch (err) {
    console.error("Khata cash-in list error:", err);
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/khata/cash-in – record money received back (advance returned). Optional expenseId: partial or full return. */
router.post("/cash-in", async (req, res) => {
  try {
    const { amount, note, date: reqDate, expenseId } = req.body;
    const amt = parseFloat(amount);
    if (amount == null || isNaN(amt) || amt <= 0) {
      return res.status(400).json({ error: "amount is required and must be a positive number" });
    }

    if (expenseId && String(expenseId).trim()) {
      const expId = String(expenseId).trim();
      const [exp] = await query(
        "SELECT id, amount, COALESCE(returned_amount, 0) AS returned_amount FROM expenses WHERE id = ? AND category IN ('Urgent', 'Other')",
        [expId]
      );
      if (!exp || exp.length === 0) return res.status(404).json({ error: "Expense not found" });
      const total = parseFloat(exp.amount);
      const returned = parseFloat(exp.returned_amount) || 0;
      const balance = Math.max(0, total - returned);
      if (amt > balance) return res.status(400).json({ error: "amount exceeds outstanding balance" });
    }

    const id = `cashin-${Date.now()}`;
    const dateVal = reqDate ? toDbDateTimePK(reqDate) : toDbDateTimePK(new Date());
    const noteVal = note != null ? String(note).trim() : "";

    await query(
      "INSERT INTO cash_in (id, amount, note, date) VALUES (?, ?, ?, ?)",
      [id, amt, noteVal, dateVal]
    );

    if (expenseId && String(expenseId).trim()) {
      const expId = String(expenseId).trim();
      const nowVal = toDbDateTimePK(new Date());
      await query(
        "UPDATE expenses SET returned_amount = COALESCE(returned_amount, 0) + ?, returned_at = CASE WHEN (COALESCE(returned_amount, 0) + ?) >= amount THEN ? ELSE NULL END WHERE id = ? AND category IN ('Urgent', 'Other')",
        [amt, amt, nowVal, expId]
      );
    }

    const [row] = await query("SELECT id, amount, note, date, created_at FROM cash_in WHERE id = ?", [id]);
    const created = {
      id: row.id,
      amount: parseFloat(row.amount),
      note: row.note ?? "",
      date: toIsoPK(row.date),
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    };
    res.status(201).json(created);
  } catch (err) {
    console.error("Khata cash-in create error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
