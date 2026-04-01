/**
 * Auth Controller – handle auth HTTP requests, delegate to Model and View.
 */

import * as authModel from "../models/authModel.js";
import * as permissionModel from "../models/permissionModel.js";
import * as authView from "../views/authView.js";

/**
 * POST /login – authenticate user and return safe user data with permissions for their role.
 */
export async function login(req, res) {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }
    const user = await authModel.findByUsername(username);
    if (!user || !(await authModel.verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: "Invalid username or password" });
    }
    if (Number(user.is_disabled) === 1) {
      return res.status(403).json({ error: "This account has been disabled." });
    }
    const permissions = await permissionModel.getPermissionsForRole(user.role);
    const payload = authView.toLoginResponse(user, permissions);
    res.json(payload);
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
}
