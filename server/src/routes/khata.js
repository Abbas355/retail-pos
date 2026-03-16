import { Router } from "express";
import { query } from "../config/database.js";
import { toDbDateTimePK, toIsoPK } from "../lib/dateUtils.js";

const router = Router();
const isSqlite = (process.env.DB_TYPE || "mysql").toLowerCase() === "sqlite";

/** GET /api/khata/totals – total debit (money out) and credit (money in). Optional query: from, to (YYYY-MM-DD). */
router.get("/totals", async (req, res) => {
  try {
    const { from, to } = req.query;
    const hasRange = from && to && String(from).trim() && String(to).trim();
    const dateFn = isSqlite ? "date" : "DATE";
    const dateCol = isSqlite ? "date" : "`date`";
    const buildWhere = () =>
      hasRange ? ` WHERE ${dateFn}(${dateCol}) >= ? AND ${dateFn}(${dateCol}) <= ?` : "";
    const params = hasRange ? [String(from).trim(), String(to).trim()] : [];

    const [customerPayments] = await query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM sale_payments${buildWhere()}`,
      params
    );
    const [cashIn] = await query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM cash_in${buildWhere()}`,
      params
    );
    const [supplierPayments] = await query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM supplier_payments${buildWhere()}`,
      params
    );
    const advancesWhere =
      hasRange
        ? ` WHERE category IN ('Urgent', 'Other') AND ${dateFn}(${dateCol}) >= ? AND ${dateFn}(${dateCol}) <= ?`
        : " WHERE category IN ('Urgent', 'Other')";
    const advancesParams = hasRange ? [String(from).trim(), String(to).trim()] : [];
    const [advancesOut] = await query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses${advancesWhere}`,
      advancesParams
    );

    const totalCredit =
      (parseFloat(customerPayments?.total ?? 0) || 0) + (parseFloat(cashIn?.total ?? 0) || 0);
    const totalDebit =
      (parseFloat(supplierPayments?.total ?? 0) || 0) + (parseFloat(advancesOut?.total ?? 0) || 0);
    res.json({ totalCredit, totalDebit });
  } catch (err) {
    console.error("Khata totals error:", err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/khata/entries – list general in/out khata entries (newest first). Optional query: type (in|out), from, to. */
router.get("/entries", async (req, res) => {
  try {
    const { type, from, to } = req.query;
    const colDate = isSqlite ? "date" : "`date`";
    const dateFn = isSqlite ? "date" : "DATE";
    let sql = `SELECT id, type, amount, note, ${colDate} AS entry_date, link_type, link_id, created_at FROM khata_entries WHERE 1=1`;
    const params = [];
    if (type && (type === "in" || type === "out")) {
      sql += " AND type = ?";
      params.push(type);
    }
    if (from && to && String(from).trim() && String(to).trim()) {
      sql += ` AND ${dateFn}(${colDate}) >= ? AND ${dateFn}(${colDate}) <= ?`;
      params.push(String(from).trim(), String(to).trim());
    }
    sql += ` ORDER BY entry_date DESC, created_at DESC`;
    const rows = await query(sql, params);
    const result = (rows || []).map((r) => ({
      id: r.id,
      type: r.type,
      amount: parseFloat(r.amount) || 0,
      note: r.note ?? null,
      date: r.entry_date ? new Date(r.entry_date).toISOString() : (r.created_at ? new Date(r.created_at).toISOString() : null),
      linkType: r.link_type || "random",
      linkId: r.link_id ?? null,
    }));
    res.json(result);
  } catch (err) {
    console.error("Khata entries list error:", err);
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/khata/entries – create general in/out khata entry. */
router.post("/entries", async (req, res) => {
  try {
    const { type, amount, note, date: reqDate, linkType, linkId } = req.body;
    if (!type || (type !== "in" && type !== "out")) {
      return res.status(400).json({ error: "type must be 'in' or 'out'" });
    }
    const amt = parseFloat(amount);
    if (amount == null || Number.isNaN(amt) || amt <= 0) {
      return res.status(400).json({ error: "amount must be a positive number" });
    }
    const link = linkType && ["random", "customer", "supplier", "cashin"].includes(String(linkType)) ? String(linkType) : "random";
    const colDate = isSqlite ? "date" : "`date`";
    const entryId = `khe-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const dateVal = reqDate ? toDbDateTimePK(reqDate) : toDbDateTimePK(new Date());
    const noteVal = note != null ? String(note).trim() : "";
    const linkIdVal = linkId != null && String(linkId).trim() ? String(linkId).trim() : null;

    await query(
      `INSERT INTO khata_entries (id, type, amount, note, date, link_type, link_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [entryId, type, amt, noteVal, dateVal, link, linkIdVal]
    );

    const [row] = await query(
      `SELECT id, type, amount, note, ${colDate} AS entry_date, link_type, link_id, created_at FROM khata_entries WHERE id = ?`,
      [entryId]
    );
    const created = {
      id: row.id,
      type: row.type,
      amount: parseFloat(row.amount),
      note: row.note ?? null,
      date: row.entry_date ? new Date(row.entry_date).toISOString() : (row.created_at ? new Date(row.created_at).toISOString() : null),
      linkType: row.link_type || "random",
      linkId: row.link_id ?? null,
    };
    res.status(201).json(created);
  } catch (err) {
    console.error("Khata entry create error:", err);
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/khata/entries/:id – delete a general khata entry. */
router.delete("/entries/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query("DELETE FROM khata_entries WHERE id = ?", [id]);
    const deleted = result?.affectedRows ?? 0;
    if (deleted === 0) {
      return res.status(404).json({ error: "Entry not found" });
    }
    res.status(204).send();
  } catch (err) {
    console.error("Khata entry delete error:", err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/khata/credit-entries – list of credit entries (customer payments + cash in). Same date filter as /totals. */
router.get("/credit-entries", async (req, res) => {
  try {
    const { from, to } = req.query;
    const hasRange = from && to && String(from).trim() && String(to).trim();
    const dateFn = isSqlite ? "date" : "DATE";
    const dateCol = isSqlite ? "date" : "`date`";
    const colDate = isSqlite ? "date" : "`date`";
    const whereClause = hasRange ? ` WHERE ${dateFn}(sp.${dateCol}) >= ? AND ${dateFn}(sp.${dateCol}) <= ?` : "";
    const params = hasRange ? [String(from).trim(), String(to).trim()] : [];

    const customerPayments = await query(
      `SELECT sp.id, sp.amount, sp.${colDate} AS entry_date, sp.payment_method, c.name AS customer_name
       FROM sale_payments sp
       LEFT JOIN sales s ON s.id = sp.sale_id
       LEFT JOIN customers c ON c.id = s.customer_id
       ${whereClause}
       ORDER BY sp.${colDate} DESC`,
      params
    );
    const cashInWhere = hasRange ? ` WHERE ${dateFn}(${dateCol}) >= ? AND ${dateFn}(${dateCol}) <= ?` : "";
    const cashInParams = hasRange ? [String(from).trim(), String(to).trim()] : [];
    const cashInRows = await query(
      `SELECT id, amount, note, ${colDate} AS entry_date FROM cash_in ${cashInWhere} ORDER BY entry_date DESC`,
      cashInParams
    );

    const creditFromPayments = (customerPayments || []).map((r) => ({
      type: "customer_payment",
      id: r.id,
      date: toIsoPK(r.entry_date),
      amount: parseFloat(r.amount) || 0,
      description: r.customer_name || "Customer payment",
      paymentMethod: r.payment_method,
    }));
    const creditFromCashIn = (cashInRows || []).map((r) => ({
      type: "cash_in",
      id: r.id,
      date: toIsoPK(r.entry_date),
      amount: parseFloat(r.amount) || 0,
      description: r.note || "Cash in",
    }));
    const combined = [...creditFromPayments, ...creditFromCashIn].sort(
      (a, b) => new Date(b.date || 0) - new Date(a.date || 0)
    );
    res.json(combined);
  } catch (err) {
    console.error("Khata credit-entries error:", err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/khata/debit-entries – list of debit entries (supplier payments + advances/expenses). Same date filter as /totals. */
router.get("/debit-entries", async (req, res) => {
  try {
    const { from, to } = req.query;
    const hasRange = from && to && String(from).trim() && String(to).trim();
    const dateFn = isSqlite ? "date" : "DATE";
    const dateCol = isSqlite ? "date" : "`date`";
    const colDate = isSqlite ? "date" : "`date`";
    const whereClause = hasRange ? ` WHERE ${dateFn}(sp.${dateCol}) >= ? AND ${dateFn}(sp.${dateCol}) <= ?` : "";
    const params = hasRange ? [String(from).trim(), String(to).trim()] : [];

    const supplierPayments = await query(
      `SELECT sp.id, sp.amount, sp.${colDate} AS entry_date, sp.payment_method, s.name AS supplier_name
       FROM supplier_payments sp
       LEFT JOIN purchases p ON p.id = sp.purchase_id
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       ${whereClause}
       ORDER BY sp.${colDate} DESC`,
      params
    );
    const advancesWhere =
      hasRange
        ? ` WHERE category IN ('Urgent', 'Other') AND ${dateFn}(${dateCol}) >= ? AND ${dateFn}(${dateCol}) <= ?`
        : " WHERE category IN ('Urgent', 'Other')";
    const advancesParams = hasRange ? [String(from).trim(), String(to).trim()] : [];
    const advanceRows = await query(
      `SELECT id, amount, category, description, ${colDate} AS entry_date FROM expenses ${advancesWhere} ORDER BY entry_date DESC`,
      advancesParams
    );

    const debitFromPayments = (supplierPayments || []).map((r) => ({
      type: "supplier_payment",
      id: r.id,
      date: toIsoPK(r.entry_date),
      amount: parseFloat(r.amount) || 0,
      description: r.supplier_name || "Supplier payment",
      paymentMethod: r.payment_method,
    }));
    const debitFromAdvances = (advanceRows || []).map((r) => ({
      type: "advance",
      id: r.id,
      date: toIsoPK(r.entry_date),
      amount: parseFloat(r.amount) || 0,
      description: r.description || r.category || "Advance",
      category: r.category,
    }));
    const combined = [...debitFromPayments, ...debitFromAdvances].sort(
      (a, b) => new Date(b.date || 0) - new Date(a.date || 0)
    );
    res.json(combined);
  } catch (err) {
    console.error("Khata debit-entries error:", err);
    res.status(500).json({ error: err.message });
  }
});

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

/** GET /api/khata/customers/:id – ledger for a customer: sales (credit/partial), payments, manual khata entries */
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

    let balanceFromSales = sales.reduce((sum, s) => sum + (parseFloat(s.total) - (parseFloat(s.paid_amount) || 0)), 0);

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

    const manualEntries = await query(
      `SELECT id, type, amount, note, ${colDate} AS entry_date, created_at
       FROM customer_khata_entries
       WHERE customer_id = ?
       ORDER BY entry_date DESC, created_at DESC`,
      [id]
    );

    const manualBalance = (manualEntries || []).reduce((sum, e) => {
      const amt = parseFloat(e.amount) || 0;
      return sum + (e.type === "udhaar_added" ? amt : -amt);
    }, 0);
    const balance = balanceFromSales + manualBalance;

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

    const manualForLedger = (manualEntries || []).map((e) => ({
      id: e.id,
      type: e.type,
      amount: parseFloat(e.amount) || 0,
      note: e.note ?? null,
      date: e.entry_date ? new Date(e.entry_date).toISOString() : (e.created_at ? new Date(e.created_at).toISOString() : null),
    }));

    const ledger = [...salesForLedger, ...paymentsForLedger, ...manualForLedger].sort(
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

/** POST /api/khata/customers/:id/entries – manual khata entry (udhaar_added | payment_received) */
router.post("/customers/:id/entries", async (req, res) => {
  try {
    const { id: customerId } = req.params;
    const { type, amount, note, date: reqDate } = req.body;
    const validTypes = ["udhaar_added", "payment_received"];
    if (!type || !validTypes.includes(String(type))) {
      return res.status(400).json({ error: "type must be udhaar_added or payment_received" });
    }
    const amt = parseFloat(amount);
    if (amount == null || Number.isNaN(amt) || amt <= 0) {
      return res.status(400).json({ error: "amount must be a positive number" });
    }
    const customer = await query("SELECT id FROM customers WHERE id = ?", [customerId]);
    if (!customer || customer.length === 0) {
      return res.status(404).json({ error: "Customer not found" });
    }
    const colDate = isSqlite ? "date" : "`date`";
    const entryId = `khe-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const dateVal = reqDate ? toDbDateTimePK(reqDate) : toDbDateTimePK(new Date());
    const noteVal = note != null ? String(note).trim() : "";

    await query(
      `INSERT INTO customer_khata_entries (id, customer_id, type, amount, note, date) VALUES (?, ?, ?, ?, ?, ?)`,
      [entryId, customerId, type, amt, noteVal, dateVal]
    );

    const [row] = await query(
      `SELECT id, type, amount, note, ${colDate} AS entry_date, created_at FROM customer_khata_entries WHERE id = ?`,
      [entryId]
    );
    const created = {
      id: row.id,
      type: row.type,
      amount: parseFloat(row.amount),
      note: row.note ?? null,
      date: row.entry_date ? new Date(row.entry_date).toISOString() : (row.created_at ? new Date(row.created_at).toISOString() : null),
    };
    res.status(201).json(created);
  } catch (err) {
    console.error("Khata customer entry create error:", err);
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

/** GET /api/khata/suppliers/:id – ledger for a supplier: purchases (unpaid/partial), payments, manual entries */
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

    let balanceFromPurchases = purchases.reduce(
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

    const manualEntries = await query(
      `SELECT id, type, amount, note, ${colDate} AS entry_date, created_at
       FROM supplier_khata_entries
       WHERE supplier_id = ?
       ORDER BY entry_date DESC, created_at DESC`,
      [id]
    );

    const manualBalance = (manualEntries || []).reduce((sum, e) => {
      const amt = parseFloat(e.amount) || 0;
      return sum + (e.type === "udhaar_added" ? amt : -amt);
    }, 0);
    const balance = balanceFromPurchases + manualBalance;

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

    const manualForLedger = (manualEntries || []).map((e) => ({
      id: e.id,
      type: e.type,
      amount: parseFloat(e.amount) || 0,
      note: e.note ?? null,
      date: e.entry_date ? new Date(e.entry_date).toISOString() : (e.created_at ? new Date(e.created_at).toISOString() : null),
    }));

    const ledger = [...purchasesForLedger, ...paymentsForLedger, ...manualForLedger].sort(
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

/** POST /api/khata/suppliers/:id/entries – manual supplier khata entry (udhaar_added | payment_received) */
router.post("/suppliers/:id/entries", async (req, res) => {
  try {
    const { id: supplierId } = req.params;
    const { type, amount, note, date: reqDate } = req.body;
    const validTypes = ["udhaar_added", "payment_received"];
    if (!type || !validTypes.includes(String(type))) {
      return res.status(400).json({ error: "type must be udhaar_added or payment_received" });
    }
    const amt = parseFloat(amount);
    if (amount == null || Number.isNaN(amt) || amt <= 0) {
      return res.status(400).json({ error: "amount must be a positive number" });
    }
    const supplier = await query("SELECT id FROM suppliers WHERE id = ? AND deleted_at IS NULL", [supplierId]);
    if (!supplier || supplier.length === 0) {
      return res.status(404).json({ error: "Supplier not found" });
    }
    const colDate = isSqlite ? "date" : "`date`";
    const entryId = `khe-s-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const dateVal = reqDate ? toDbDateTimePK(reqDate) : toDbDateTimePK(new Date());
    const noteVal = note != null ? String(note).trim() : "";

    await query(
      "INSERT INTO supplier_khata_entries (id, supplier_id, type, amount, note, date) VALUES (?, ?, ?, ?, ?, ?)",
      [entryId, supplierId, type, amt, noteVal, dateVal]
    );

    const [row] = await query(
      `SELECT id, type, amount, note, ${colDate} AS entry_date, created_at FROM supplier_khata_entries WHERE id = ?`,
      [entryId]
    );
    const created = {
      id: row.id,
      type: row.type,
      amount: parseFloat(row.amount),
      note: row.note ?? null,
      date: row.entry_date ? new Date(row.entry_date).toISOString() : (row.created_at ? new Date(row.created_at).toISOString() : null),
    };
    res.status(201).json(created);
  } catch (err) {
    console.error("Khata supplier entry create error:", err);
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

/** GET /api/khata/cashin-statement – combined timeline for Cash in Khata (given out + received back + manual entries) */
router.get("/cashin-statement", async (_req, res) => {
  try {
    const colDate = isSqlite ? "date" : "`date`";

    const advancesRows = await query(
      `SELECT id, amount, COALESCE(returned_amount, 0) AS returned_amount, category, description, ${colDate} AS entry_date
       FROM expenses
       WHERE category IN ('Urgent', 'Other') AND (COALESCE(returned_amount, 0) < amount)
       ORDER BY entry_date DESC`
    );
    const cashInRows = await query(
      `SELECT id, amount, note, ${colDate} AS entry_date FROM cash_in ORDER BY entry_date DESC, created_at DESC`
    );
    const manualRows = await query(
      `SELECT id, type, amount, note, ${colDate} AS entry_date, created_at FROM cashin_khata_entries ORDER BY entry_date DESC, created_at DESC`
    );

    const outFromAdvances = (advancesRows || []).map((r) => {
      const amount = parseFloat(r.amount);
      const returned = parseFloat(r.returned_amount) || 0;
      const balance = Math.max(0, amount - returned);
      return {
        id: r.id,
        type: "out",
        amount: balance,
        note: r.description || r.category || "Given out",
        date: r.entry_date ? new Date(r.entry_date).toISOString() : null,
        source: "advance",
      };
    });
    const inFromCashIn = (cashInRows || []).map((r) => ({
      id: r.id,
      type: "in",
      amount: parseFloat(r.amount) || 0,
      note: r.note ?? "Received back",
      date: r.entry_date ? new Date(r.entry_date).toISOString() : null,
      source: "cash_in",
    }));
    const manualEntries = (manualRows || []).map((r) => ({
      id: r.id,
      type: r.type,
      amount: parseFloat(r.amount) || 0,
      note: r.note ?? null,
      date: r.entry_date ? new Date(r.entry_date).toISOString() : (r.created_at ? new Date(r.created_at).toISOString() : null),
      source: "manual",
    }));

    const allEntries = [...outFromAdvances, ...inFromCashIn, ...manualEntries].sort(
      (a, b) => new Date(b.date || 0) - new Date(a.date || 0)
    );

    const totalOut =
      outFromAdvances.reduce((s, e) => s + e.amount, 0) +
      manualEntries.filter((e) => e.type === "out").reduce((s, e) => s + e.amount, 0);
    const totalIn =
      inFromCashIn.reduce((s, e) => s + e.amount, 0) +
      manualEntries.filter((e) => e.type === "in").reduce((s, e) => s + e.amount, 0);

    res.json({ totalOut, totalIn, entries: allEntries });
  } catch (err) {
    console.error("Khata cashin-statement error:", err);
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/khata/cashin-entries – manual Cash in Khata entry (in | out) */
router.post("/cashin-entries", async (req, res) => {
  try {
    const { type, amount, note, date: reqDate } = req.body;
    if (!type || (type !== "in" && type !== "out")) {
      return res.status(400).json({ error: "type must be 'in' or 'out'" });
    }
    const amt = parseFloat(amount);
    if (amount == null || Number.isNaN(amt) || amt <= 0) {
      return res.status(400).json({ error: "amount must be a positive number" });
    }
    const colDate = isSqlite ? "date" : "`date`";
    const entryId = `khe-c-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const dateVal = reqDate ? toDbDateTimePK(reqDate) : toDbDateTimePK(new Date());
    const noteVal = note != null ? String(note).trim() : "";

    await query(
      "INSERT INTO cashin_khata_entries (id, type, amount, note, date) VALUES (?, ?, ?, ?, ?)",
      [entryId, type, amt, noteVal, dateVal]
    );

    const [row] = await query(
      `SELECT id, type, amount, note, ${colDate} AS entry_date, created_at FROM cashin_khata_entries WHERE id = ?`,
      [entryId]
    );
    const created = {
      id: row.id,
      type: row.type,
      amount: parseFloat(row.amount),
      note: row.note ?? null,
      date: row.entry_date ? new Date(row.entry_date).toISOString() : (row.created_at ? new Date(row.created_at).toISOString() : null),
      source: "manual",
    };
    res.status(201).json(created);
  } catch (err) {
    console.error("Khata cashin entry create error:", err);
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/khata/cashin-entries/:id – delete a manual Cash in Khata entry */
router.delete("/cashin-entries/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query("DELETE FROM cashin_khata_entries WHERE id = ?", [id]);
    const deleted = result?.affectedRows ?? 0;
    if (deleted === 0) {
      return res.status(404).json({ error: "Entry not found" });
    }
    res.status(204).send();
  } catch (err) {
    console.error("Khata cashin entry delete error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
