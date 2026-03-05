# Server scripts

- **seed.js** – Seeds users (admin, manager, cashier), sample products, customers, suppliers. Run: `npm run seed`.
- **seed-roles-permissions.js** – Seeds `permissions` and `role_permissions`. Run: `npm run seed:roles`. Requires `permissions` and `role_permissions` tables (see schema or add_role_permissions.sql).

Run schema/migrations first, then `npm run seed`, then `npm run seed:roles` if using roles.
