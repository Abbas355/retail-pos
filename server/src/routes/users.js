import { Router } from "express";
import bcrypt from "bcryptjs";
import { query } from "../config/database.js";

const router = Router();

function toUser(row) {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    name: row.name,
  };
}

router.get("/", async (_req, res) => {
  try {
    const rows = await query("SELECT id, username, role, name FROM users ORDER BY username");
    res.json(rows.map(toUser));
  } catch (err) {
    console.error("Users list error:", err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const [row] = await query("SELECT id, username, role, name FROM users WHERE id = ?", [req.params.id]);
    if (!row) return res.status(404).json({ error: "User not found" });
    res.json(toUser(row));
  } catch (err) {
    console.error("User get error:", err);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { username, password, role, name } = req.body;
    if (!username || typeof username !== "string" || username.trim() === "") {
      return res.status(400).json({ error: "Username required" });
    }
    if (!password || typeof password !== "string" || password.length < 1) {
      return res.status(400).json({ error: "Password required" });
    }
    const [existing] = await query("SELECT id FROM users WHERE username = ?", [username.trim()]);
    if (existing) return res.status(409).json({ error: "Username already exists" });
    const password_hash = await bcrypt.hash(password, 10);
    const id = `u-${Date.now()}`;
    await query(
      "INSERT INTO users (id, username, password_hash, role, name) VALUES (?, ?, ?, ?, ?)",
      [id, username.trim(), password_hash, role || "cashier", (name != null ? String(name).trim() : "") || ""]
    );
    const [row] = await query("SELECT id, username, role, name FROM users WHERE id = ?", [id]);
    res.status(201).json(toUser(row));
  } catch (err) {
    console.error("User create error:", err);
    res.status(500).json({ error: "Failed to create user" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const { name, role, password } = req.body;
    const [existing] = await query("SELECT id, username, role, name FROM users WHERE id = ?", [req.params.id]);
    if (!existing) return res.status(404).json({ error: "User not found" });
    const updates = [];
    const params = [];
    if (name !== undefined) {
      updates.push("name = ?");
      params.push(String(name).trim());
    }
    if (role !== undefined) {
      updates.push("role = ?");
      params.push(role);
    }
    if (password !== undefined && password !== "") {
      updates.push("password_hash = ?");
      params.push(await bcrypt.hash(password, 10));
    }
    if (updates.length === 0) {
      return res.json(toUser(existing));
    }
    params.push(req.params.id);
    await query(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, params);
    const [row] = await query("SELECT id, username, role, name FROM users WHERE id = ?", [req.params.id]);
    res.json(toUser(row));
  } catch (err) {
    console.error("User update error:", err);
    res.status(500).json({ error: "Failed to update user" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const selfId = req.get("X-User-Id");
    if (selfId != null && String(selfId).trim() === String(req.params.id).trim()) {
      return res.status(403).json({ error: "Cannot delete your own user" });
    }
    const [existing] = await query("SELECT id FROM users WHERE id = ?", [req.params.id]);
    if (!existing) return res.status(404).json({ error: "User not found" });
    await query("DELETE FROM users WHERE id = ?", [req.params.id]);
    res.status(204).send();
  } catch (err) {
    console.error("User delete error:", err);
    res.status(500).json({ error: "Failed to delete user" });
  }
});

export default router;
