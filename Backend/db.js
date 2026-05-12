const mysql = require("mysql2");
require("dotenv").config({ path: "E:/Programs/Final/.env" });

console.log("Loaded ENV:", {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT
});

// ✅ Create a pool instead of single connection
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,   // default MySQL port
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// ✅ Wrap the pool with promise support
const promisePool = pool.promise();

module.exports = promisePool;
