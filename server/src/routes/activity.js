import { Router } from "express";
import { query } from "../config/database.js";

const router = Router();
const isSqlite = (process.env.DB_TYPE || "mysql").toLowerCase() === "sqlite";

/**
 * GET /api/activity?limit=50&source=whatsapp
 * Audit log: recent sales and expenses. Optional source=whatsapp to filter.
 */
router.get("/", async (req, res) => {
  try {
    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 50), 100);
    const sourceFilter = String(req.query.source || "").toLowerCase();
    const filterWhatsApp = sourceFilter === "whatsapp";
    const filterPos = !filterWhatsApp;

    const sourceCol = "COALESCE(NULLIF(TRIM(s.source), ''), CASE WHEN s.cashier = 'WhatsApp User' OR s.cashier LIKE '%WhatsApp%' THEN 'whatsapp' ELSE 'pos' END)";
    const sourceColExp = "COALESCE(NULLIF(TRIM(e.source), ''), 'pos')";
    const sourceColCust = "COALESCE(NULLIF(TRIM(c.source), ''), 'pos')";
    const sourceColSup = "COALESCE(NULLIF(TRIM(sup.source), ''), 'pos')";
    const sourceColProd = "COALESCE(NULLIF(TRIM(p.source), ''), 'pos')";
    const sourceColPur = "COALESCE(NULLIF(TRIM(pur.source), ''), 'pos')";
    const sourceColPay = "COALESCE(NULLIF(TRIM(sp.source), ''), 'pos')";

    const salesWhere = filterWhatsApp ? `LOWER(${sourceCol}) = 'whatsapp'` : (filterPos ? `LOWER(${sourceCol}) = 'pos'` : "1=1");
    const salesSql = `SELECT s.id, s.total, s.created_at, s.cashier, ${sourceCol} AS source FROM sales s WHERE ${salesWhere} ORDER BY s.created_at DESC LIMIT ${limit}`;
    const sales = await query(salesSql);

    const expWhere = filterWhatsApp ? `LOWER(${sourceColExp}) = 'whatsapp'` : (filterPos ? `LOWER(${sourceColExp}) = 'pos'` : "1=1");
    const expensesSql = `SELECT e.id, e.amount, e.category, e.description, e.created_at, ${sourceColExp} AS source FROM expenses e WHERE ${expWhere} ORDER BY e.created_at DESC LIMIT ${limit}`;
    const expenses = await query(expensesSql);

    const custWhere = filterWhatsApp ? `LOWER(${sourceColCust}) = 'whatsapp'` : (filterPos ? `LOWER(${sourceColCust}) = 'pos'` : "1=1");
    const customersSql = `SELECT c.id, c.name, c.phone, c.created_at, ${sourceColCust} AS source FROM customers c WHERE c.deleted_at IS NULL AND ${custWhere} ORDER BY c.created_at DESC LIMIT ${limit}`;
    const customers = await query(customersSql);

    const supWhere = filterWhatsApp ? `LOWER(${sourceColSup}) = 'whatsapp'` : (filterPos ? `LOWER(${sourceColSup}) = 'pos'` : "1=1");
    const suppliersSql = `SELECT sup.id, sup.name, sup.phone, sup.created_at, ${sourceColSup} AS source FROM suppliers sup WHERE sup.deleted_at IS NULL AND ${supWhere} ORDER BY sup.created_at DESC LIMIT ${limit}`;
    const suppliers = await query(suppliersSql);

    const prodWhere = filterWhatsApp ? `LOWER(${sourceColProd}) = 'whatsapp'` : (filterPos ? `LOWER(${sourceColProd}) = 'pos'` : "1=1");
    const productsSql = `SELECT p.id, p.name, p.price, p.created_at, ${sourceColProd} AS source FROM products p WHERE p.deleted_at IS NULL AND ${prodWhere} ORDER BY p.created_at DESC LIMIT ${limit}`;
    const products = await query(productsSql);

    const purWhere = filterWhatsApp ? `LOWER(${sourceColPur}) = 'whatsapp'` : (filterPos ? `LOWER(${sourceColPur}) = 'pos'` : "1=1");
    const purchasesSql = `SELECT pur.id, pur.total, pur.created_at, pur.supplier_id, ${sourceColPur} AS source FROM purchases pur WHERE ${purWhere} ORDER BY pur.created_at DESC LIMIT ${limit}`;
    const purchases = await query(purchasesSql);

    const payWhere = filterWhatsApp ? `LOWER(${sourceColPay}) = 'whatsapp'` : (filterPos ? `LOWER(${sourceColPay}) = 'pos'` : "1=1");
    const paymentsSql = `SELECT sp.id, sp.sale_id, sp.amount, sp.created_at, ${sourceColPay} AS source FROM sale_payments sp WHERE ${payWhere} ORDER BY sp.created_at DESC LIMIT ${limit}`;
    const payments = await query(paymentsSql);

    const logWhere = filterWhatsApp ? "LOWER(COALESCE(source, 'pos')) = 'whatsapp'" : (filterPos ? "LOWER(COALESCE(source, 'pos')) = 'pos'" : "1=1");
    const activityLogSql = `SELECT id, type, entity_id, summary, amount, source, deleted_by, created_at FROM activity_log WHERE ${logWhere} ORDER BY created_at DESC LIMIT ${limit}`;
    let activityLogRows = [];
    try {
      activityLogRows = await query(activityLogSql);
    } catch (_) {}

    const deleteActions = (activityLogRows || []).map((row) => ({
      type: row.type,
      id: row.id,
      summary: row.summary || `${row.type} – ${row.entity_id || ""}`,
      amount: parseFloat(row.amount) || 0,
      source: row.source && String(row.source).toLowerCase() === "whatsapp" ? "whatsapp" : "pos",
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
      cashier: row.deleted_by || null,
    }));

    const saleActions = (sales || []).map((s) => ({
      type: "sale",
      id: s.id,
      summary: `Sale – Rs ${Number(s.total).toLocaleString()}`,
      amount: parseFloat(s.total),
      source: s.source && String(s.source).toLowerCase() === "whatsapp" ? "whatsapp" : "pos",
      createdAt: s.created_at ? new Date(s.created_at).toISOString() : null,
      cashier: s.cashier || null,
    }));

    const expenseActions = (expenses || []).map((e) => ({
      type: "expense",
      id: e.id,
      summary: `${e.description || e.category || "Expense"} – Rs ${Number(e.amount).toLocaleString()}`,
      amount: parseFloat(e.amount),
      source: e.source && String(e.source).toLowerCase() === "whatsapp" ? "whatsapp" : "pos",
      createdAt: e.created_at ? new Date(e.created_at).toISOString() : null,
    }));

    const customerActions = (customers || []).map((c) => ({
      type: "add_customer",
      id: c.id,
      summary: `Customer added: ${c.name || "?"}${c.phone ? ` – ${c.phone}` : ""}`,
      amount: 0,
      source: c.source && String(c.source).toLowerCase() === "whatsapp" ? "whatsapp" : "pos",
      createdAt: c.created_at ? new Date(c.created_at).toISOString() : null,
    }));

    const supplierActions = (suppliers || []).map((s) => ({
      type: "add_supplier",
      id: s.id,
      summary: `Supplier added: ${s.name || "?"}`,
      amount: 0,
      source: s.source && String(s.source).toLowerCase() === "whatsapp" ? "whatsapp" : "pos",
      createdAt: s.created_at ? new Date(s.created_at).toISOString() : null,
    }));

    const productActions = (products || []).map((p) => ({
      type: "add_product",
      id: p.id,
      summary: `Product added: ${p.name || "?"} – Rs ${Number(p.price || 0).toLocaleString()}`,
      amount: parseFloat(p.price) || 0,
      source: p.source && String(p.source).toLowerCase() === "whatsapp" ? "whatsapp" : "pos",
      createdAt: p.created_at ? new Date(p.created_at).toISOString() : null,
    }));

    const purchaseActions = (purchases || []).map((pu) => ({
      type: "add_purchase",
      id: pu.id,
      summary: `Purchase – Rs ${Number(pu.total || 0).toLocaleString()}`,
      amount: parseFloat(pu.total) || 0,
      source: pu.source && String(pu.source).toLowerCase() === "whatsapp" ? "whatsapp" : "pos",
      createdAt: pu.created_at ? new Date(pu.created_at).toISOString() : null,
    }));

    const paymentActions = (payments || []).map((pay) => ({
      type: "payment",
      id: pay.id,
      summary: `Khata payment – Rs ${Number(pay.amount || 0).toLocaleString()}`,
      amount: parseFloat(pay.amount) || 0,
      source: pay.source && String(pay.source).toLowerCase() === "whatsapp" ? "whatsapp" : "pos",
      createdAt: pay.created_at ? new Date(pay.created_at).toISOString() : null,
    }));

    const combined = [...saleActions, ...expenseActions, ...customerActions, ...supplierActions, ...productActions, ...purchaseActions, ...paymentActions, ...deleteActions]
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
      .slice(0, limit);

    res.json(combined);
  } catch (err) {
    console.error("Activity list error:", err);
    res.status(500).json({ error: "Failed to fetch activity" });
  }
});

export default router;
