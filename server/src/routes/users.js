import { Router } from "express";
import bcrypt from "bcryptjs";
import { query } from "../config/database.js";
import { logUserAudit } from "../lib/userAuditLog.js";
import { toIsoPK } from "../lib/dateUtils.js";

const router = Router();

function toUser(row) {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    name: row.name,
    disabled: Number(row.is_disabled) === 1,
  };
}

function auditActionTitle(action) {
  switch (action) {
    case "profile":
      return "Profile updated";
    case "password":
      return "Password changed";
    case "login_disabled":
      return "Login disabled";
    case "login_enabled":
      return "Login enabled";
    case "deleted":
      return "Account deleted";
    default:
      return action.replace(/_/g, " ");
  }
}

function auditKind(action) {
  switch (action) {
    case "password":
      return "password_changed";
    case "login_disabled":
      return "login_disabled";
    case "login_enabled":
      return "login_enabled";
    case "deleted":
      return "deleted";
    case "profile":
    default:
      return "updated";
  }
}

router.get("/", async (_req, res) => {
  try {
    const rows = await query(
      "SELECT id, username, role, name, COALESCE(is_disabled, 0) AS is_disabled FROM users ORDER BY username"
    );
    res.json(rows.map(toUser));
  } catch (err) {
    console.error("Users list error:", err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

/** GET /api/users/:id/activity-log — account created + audit trail (newest first). */
router.get("/:id/activity-log", async (req, res) => {
  try {
    const userId = req.params.id;
    const userRows = await query(
      "SELECT id, username, role, name, COALESCE(is_disabled, 0) AS is_disabled, created_at FROM users WHERE id = ?",
      [userId]
    );
    if (!userRows || userRows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const u = userRows[0];
    const entries = [];

    if (u.created_at) {
      entries.push({
        kind: "created",
        id: `user-created-${userId}`,
        at: toIsoPK(u.created_at),
        title: "Account created",
        detail: `Username ${u.username} · Role ${u.role} · ${u.name || "—"}`,
      });
    }

    const audits = await query(
      "SELECT id, action, detail, actor_id, created_at FROM user_audit_log WHERE user_id = ? ORDER BY created_at DESC",
      [userId]
    );

    const actorIds = [...new Set((audits || []).map((a) => a.actor_id).filter(Boolean))];
    const actorMap = {};
    if (actorIds.length > 0) {
      const ph = actorIds.map(() => "?").join(",");
      const actors = await query(`SELECT id, username, name FROM users WHERE id IN (${ph})`, actorIds);
      for (const a of actors || []) {
        actorMap[a.id] = (a.name && String(a.name).trim()) || a.username || a.id;
      }
    }

    for (const row of audits || []) {
      const meta = row.actor_id ? actorMap[row.actor_id] || row.actor_id : undefined;
      entries.push({
        kind: auditKind(row.action),
        id: row.id,
        at: toIsoPK(row.created_at),
        title: auditActionTitle(row.action),
        detail: row.detail || "",
        meta: meta || undefined,
      });
    }

    entries.sort((a, b) => {
      const ta = a.at ? new Date(a.at).getTime() : 0;
      const tb = b.at ? new Date(b.at).getTime() : 0;
      return tb - ta;
    });

    res.json({
      userId: u.id,
      username: u.username,
      entries,
    });
  } catch (err) {
    console.error("User activity-log error:", err);
    res.status(500).json({ error: "Failed to fetch user activity" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const [row] = await query(
      "SELECT id, username, role, name, COALESCE(is_disabled, 0) AS is_disabled FROM users WHERE id = ?",
      [req.params.id]
    );
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
      "INSERT INTO users (id, username, password_hash, role, name, is_disabled) VALUES (?, ?, ?, ?, ?, 0)",
      [id, username.trim(), password_hash, role || "cashier", (name != null ? String(name).trim() : "") || ""]
    );
    const [row] = await query(
      "SELECT id, username, role, name, COALESCE(is_disabled, 0) AS is_disabled, created_at FROM users WHERE id = ?",
      [id]
    );
    res.status(201).json(toUser(row));
  } catch (err) {
    console.error("User create error:", err);
    res.status(500).json({ error: "Failed to create user" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const { name, role, password, disabled } = req.body;
    const actorId = req.get("X-User-Id") != null ? String(req.get("X-User-Id")).trim() || null : null;
    const [existing] = await query(
      "SELECT id, username, role, name, COALESCE(is_disabled, 0) AS is_disabled FROM users WHERE id = ?",
      [req.params.id]
    );
    if (!existing) return res.status(404).json({ error: "User not found" });
    const updates = [];
    const params = [];
    if (name !== undefined) {
      const nextName = String(name).trim();
      if (nextName !== String(existing.name || "").trim()) {
        await logUserAudit({
          userId: req.params.id,
          action: "profile",
          detail: `Name: "${existing.name || ""}" → "${nextName}"`,
          actorId,
        });
      }
      updates.push("name = ?");
      params.push(nextName);
    }
    if (role !== undefined) {
      if (String(role) !== String(existing.role)) {
        await logUserAudit({
          userId: req.params.id,
          action: "profile",
          detail: `Role: ${existing.role} → ${role}`,
          actorId,
        });
      }
      updates.push("role = ?");
      params.push(role);
    }
    if (password !== undefined && password !== "") {
      updates.push("password_hash = ?");
      params.push(await bcrypt.hash(password, 10));
      await logUserAudit({
        userId: req.params.id,
        action: "password",
        detail: "Password was changed",
        actorId,
      });
    }
    if (disabled !== undefined) {
      const wantDisabled = Boolean(disabled);
      const selfId = req.get("X-User-Id");
      if (wantDisabled && selfId != null && String(selfId).trim() === String(req.params.id).trim()) {
        return res.status(403).json({ error: "Cannot disable your own account" });
      }
      const wasDisabled = Number(existing.is_disabled) === 1;
      if (wantDisabled !== wasDisabled) {
        await logUserAudit({
          userId: req.params.id,
          action: wantDisabled ? "login_disabled" : "login_enabled",
          detail: wantDisabled ? "This user can no longer sign in." : "Sign-in has been restored for this user.",
          actorId,
        });
      }
      updates.push("is_disabled = ?");
      params.push(wantDisabled ? 1 : 0);
    }
    if (updates.length === 0) {
      return res.json(toUser(existing));
    }
    params.push(req.params.id);
    await query(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, params);
    const [row] = await query(
      "SELECT id, username, role, name, COALESCE(is_disabled, 0) AS is_disabled FROM users WHERE id = ?",
      [req.params.id]
    );
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
    const actorId = selfId != null ? String(selfId).trim() || null : null;
    await logUserAudit({
      userId: req.params.id,
      action: "deleted",
      detail: "User account was removed from the system.",
      actorId,
    });
    await query("DELETE FROM users WHERE id = ?", [req.params.id]);
    res.status(204).send();
  } catch (err) {
    console.error("User delete error:", err);
    res.status(500).json({ error: "Failed to delete user" });
  }
});

export default router;
