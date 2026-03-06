import dotenv from "dotenv";

dotenv.config();

const dbType = (process.env.DB_TYPE || "mysql").toLowerCase();

let pool;
let queryFn;

if (dbType === "sqlite") {
  const sqlite = await import("./database-sqlite.js");
  pool = sqlite.default;
  queryFn = sqlite.query;
} else {
  const mysql = await import("mysql2/promise");
  pool = mysql.default.createPool({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "retail_pos",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });
  queryFn = async (sql, params = []) => {
    const [rows] = await pool.execute(sql, params);
    return rows;
  };
}

export async function query(sql, params = []) {
  return queryFn(sql, params);
}

export { pool };
export default pool;
