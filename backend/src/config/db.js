import { DB_CONFIG } from "./env.js";
import mysql2 from "mysql2/promise";

const pool = mysql2.createPool({
  host: DB_CONFIG.HOST,
  user: DB_CONFIG.USER,
  password: DB_CONFIG.PASSWORD,
  database: DB_CONFIG.DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// The connection is established when the pool is created
export const connectDB = async () => {
  try {
    const connection = await pool.getConnection();
    console.log("Database connected successfully.");
    connection.release();
  } catch (err) {
    console.error("Database connection failed:", err);
  }
};

export default pool;
