import { Router } from "express";
import { query } from "../config/database.js";

const router = Router();

function toProduct(row) {
  return {
    id: row.id,
    name: row.name,
    nameUr: row.name_ur ?? undefined,
    price: parseFloat(row.price),
    cost: parseFloat(row.cost),
    stock: row.stock,
    category: row.category,
    lowStockThreshold: row.low_stock_threshold,
    hasSales: Boolean(row.has_sales),
  };
}

router.get("/", async (_req, res) => {
  try {
    const rows = await query(
      `SELECT p.*, EXISTS(SELECT 1 FROM sale_items si WHERE si.product_id = p.id) AS has_sales
       FROM products p WHERE p.deleted_at IS NULL ORDER BY p.name`
    );
    res.json(rows.map(toProduct));
  } catch (err) {
    console.error("Products list error:", err);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const [row] = await query(
      `SELECT p.*, EXISTS(SELECT 1 FROM sale_items si WHERE si.product_id = p.id) AS has_sales
       FROM products p WHERE p.id = ? AND p.deleted_at IS NULL`,
      [req.params.id]
    );
    if (!row) return res.status(404).json({ error: "Product not found" });
    res.json(toProduct(row));
  } catch (err) {
    console.error("Product get error:", err);
    res.status(500).json({ error: "Failed to fetch product" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { name, nameUr, price, cost, stock, category, lowStockThreshold } = req.body;
    if (!name || price == null) return res.status(400).json({ error: "Name and price required" });
    const id = `p-${Date.now()}`;
    await query(
      "INSERT INTO products (id, name, name_ur, price, cost, stock, category, low_stock_threshold) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, name, nameUr ?? null, price || 0, cost ?? 0, stock ?? 0, category || "", lowStockThreshold ?? 5]
    );
    const [row] = await query("SELECT * FROM products WHERE id = ?", [id]);
    res.status(201).json(toProduct(row));
  } catch (err) {
    console.error("Product create error:", err);
    res.status(500).json({ error: "Failed to create product" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const { name, nameUr, price, cost, stock, category, lowStockThreshold } = req.body;
    const result = await query(
      "UPDATE products SET name=?, name_ur=?, price=?, cost=?, stock=?, category=?, low_stock_threshold=? WHERE id=? AND deleted_at IS NULL",
      [name ?? "", nameUr ?? null, price ?? 0, cost ?? 0, stock ?? 0, category ?? "", lowStockThreshold ?? 5, req.params.id]
    );
    const affectedRows = result?.affectedRows ?? result?.[0]?.affectedRows ?? 0;
    if (affectedRows === 0) return res.status(404).json({ error: "Product not found" });
    const [row] = await query("SELECT * FROM products WHERE id = ?", [req.params.id]);
    res.json(toProduct(row));
  } catch (err) {
    console.error("Product update error:", err);
    res.status(500).json({ error: "Failed to update product" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const [hasSalesRow] = await query(
      "SELECT 1 FROM sale_items WHERE product_id = ? LIMIT 1",
      [req.params.id]
    );
    if (hasSalesRow) {
      return res.status(403).json({
        error: "Cannot delete product with sales history. Only products with no sales can be removed.",
      });
    }
    const fromBody = req.body?.deletedBy != null ? String(req.body.deletedBy).trim() : null;
    const fromQuery = req.query?.deletedBy != null ? String(req.query.deletedBy).trim() : null;
    const deletedBy = fromBody || fromQuery || null;
    const deletedByRole =
      req.body?.deletedByRole != null ? String(req.body.deletedByRole).trim() : null;
    const result = await query(
      "UPDATE products SET deleted_at = NOW(), deleted_by = ?, deleted_by_role = ? WHERE id = ? AND deleted_at IS NULL",
      [deletedBy || null, deletedByRole || null, req.params.id]
    );
    const affectedRows = result?.affectedRows ?? result?.[0]?.affectedRows ?? 0;
    if (affectedRows === 0) return res.status(404).json({ error: "Product not found" });
    res.status(204).send();
  } catch (err) {
    console.error("Product delete error:", err);
    res.status(500).json({ error: "Failed to delete product" });
  }
});

export default router;
