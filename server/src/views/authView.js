/**
 * Auth View – format auth data for API responses.
 */

/**
 * Format user for login success response (no password), with permissions for the role.
 * @param {object} user – { id, username, role, name }
 * @param {string[]} permissions – list of permission keys for the user's role
 * @returns {{ id: string, username: string, role: string, name: string, permissions: string[] }}
 */
export function toLoginResponse(user, permissions = []) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    name: user.name,
    permissions: permissions || [],
  };
}
