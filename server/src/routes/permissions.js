import { Router } from "express";
import { query } from "../config/database.js";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const rows = await query(
      "SELECT permission_key, description FROM permissions ORDER BY permission_key"
    );
    res.json(rows);
  } catch (err) {
    console.error("Permissions list error:", err);
    res.status(500).json({ error: "Failed to fetch permissions" });
  }
});

router.get("/role-permissions", async (_req, res) => {
  try {
    const rows = await query(
      "SELECT role, permission_key FROM role_permissions ORDER BY role, permission_key"
    );
    res.json(rows);
  } catch (err) {
    console.error("Role permissions list error:", err);
    res.status(500).json({ error: "Failed to fetch role permissions" });
  }
});

export default router;
