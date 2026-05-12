const express = require("express");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const pool = require("./db"); // ✅ Promise-based MySQL pool
const router = express.Router();

/* -------------------------------------------
   Ensure uploads directory exists (future use)
-------------------------------------------- */
const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

/* -------------------------------------------
   Multer storage (for future file uploads)
-------------------------------------------- */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safeExt = path.extname(file.originalname || "").toLowerCase();
    cb(null, Date.now() + "_" + Math.random().toString(36).slice(2) + safeExt);
  },
});
const upload = multer({ storage });

/* -------------------------------------------
   Helpers
-------------------------------------------- */
function sendServerError(res, err, fallback = "Server error") {
  console.error(fallback, err);
  return res.status(500).json({ message: fallback, details: err?.message });
}

/* -------------------------------------------
   ✅ Hospital Registration
   (matches server.js logic with camelCase columns
    and departments stored as JSON)
-------------------------------------------- */
router.post("/register-hospital", async (req, res) => {
  try {
    const data = req.body;
    console.log("📥 Incoming registration:", data);

    // Required fields
    if (!data.hospitalName || !data.username || !data.password) {
      return res.status(400).json({
        message: "Hospital Name, Username, and Password are required."
      });
    }

    // Check if username exists
    const [existing] = await pool.query(
      "SELECT id FROM hospitals WHERE username = ?",
      [data.username]
    );
    if (existing.length > 0) {
      return res.status(400).json({ message: "Username already exists." });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(data.password, 10);

    // Insert query (including longitude & latitude)
    const insertQuery = `
      INSERT INTO hospitals 
      (hospitalName, hospitalType, license, estYear, hospitalEmail, username, password,
       address, city, state, pin, phone, website,
       totalBeds, icuBeds, ventilators, ambulances, doctors, nurses, departments,
       longitude, latitude)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      data.hospitalName,
      data.hospitalType || null,
      data.license || null,
      data.estYear || null,
      data.hospitalEmail || null,
      data.username,
      hashedPassword,
      data.address || null,
      data.city || null,
      data.state || null,
      data.pin || null,
      data.phone || null,
      data.website || null,
      Number(data.totalBeds) || 0,
      Number(data.icuBeds) || 0,
      Number(data.ventilators) || 0,
      Number(data.ambulances) || 0,
      Number(data.doctors) || 0,
      Number(data.nurses) || 0,
      JSON.stringify(data.departments || []),
      data.longitude || null,
      data.latitude || null
    ];

    await pool.query(insertQuery, params);
    console.log("✅ Hospital inserted successfully");
    return res.status(201).json({ message: "Hospital registered successfully!" });

  } catch (err) {
    console.error("❌ MySQL insert error:", err);
    return res.status(500).json({
      message: "Database insert failed",
      sqlMessage: err.sqlMessage,
      code: err.code
    });
  }
});

/* -------------------------------------------
   Hospital Authority Login
-------------------------------------------- */
router.post("/authority-login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: "Username and password are required" });
  }

  try {
    const [rows] = await pool.query(
      "SELECT * FROM hospitals WHERE username = ?",
      [username]
    );
    if (!rows || rows.length === 0) {
      return res.status(404).json({ message: "Hospital not found" });
    }

    const hospital = rows[0];
    const isMatch = await bcrypt.compare(password, hospital.password);
    if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

    return res.status(200).json({
      success: true,
      message: `Welcome ${hospital.hospitalName}`,
      hospital: {
        id: hospital.id,
        name: hospital.hospitalName,
        username: hospital.username,
        type: hospital.hospitalType,
        email: hospital.hospitalEmail,
        phone: hospital.phone,
        city: hospital.city,
        state: hospital.state
      },
    });
  } catch (err) {
    return sendServerError(res, err, "Error during login");
  }
});

/* -------------------------------------------
   Get Hospital Details by Username
-------------------------------------------- */
router.get("/hospital/:username", async (req, res) => {
  const { username } = req.params;
  try {
    const [rows] = await pool.query(
      "SELECT id, hospitalName, hospitalType, hospitalEmail, phone, city, state FROM hospitals WHERE username = ?",
      [username]
    );
    if (!rows || rows.length === 0) {
      return res.status(404).json({ message: "Hospital not found" });
    }
    return res.status(200).json(rows[0]);
  } catch (err) {
    return sendServerError(res, err, "Database error");
  }
});

/* -------------------------------------------
   Health check
-------------------------------------------- */
router.get("/health", (_req, res) => res.json({ status: "ok" }));

module.exports = router;
