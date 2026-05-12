const express = require("express");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const pool = require("./db"); // Using the same pool as hospital
const router = express.Router();

/* -------------------------------------------
   Ensure uploads directory exists
-------------------------------------------- */
const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

/* -------------------------------------------
   Multer storage
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
  return res.status(500).json({ message: fallback });
}

/* -------------------------------------------
   Create tables if not exists
-------------------------------------------- */
async function createIfNotExists() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_name VARCHAR(100) UNIQUE NOT NULL,
        age INT NOT NULL,
        email VARCHAR(150) UNIQUE NOT NULL,
        blood_group VARCHAR(5) NOT NULL,
        mobile VARCHAR(20) UNIQUE NOT NULL,
        user_password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS emergency_form (
        id INT AUTO_INCREMENT PRIMARY KEY,
        reporting_for VARCHAR(50) NOT NULL,
        emergency_type VARCHAR(100) NOT NULL,
        name VARCHAR(120) NOT NULL,
        mobile VARCHAR(20) NOT NULL,
        blood_group VARCHAR(5),
        ambulance_required ENUM('Yes','No') NOT NULL,
        latitude VARCHAR(50),
        longitude VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS symptom_reports (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        mobile VARCHAR(20) NOT NULL,
        blood_group VARCHAR(5) NOT NULL,
        duration_days INT NOT NULL,
        ambulance_required ENUM('Yes','No') NOT NULL,
        prescription_image VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB;
    `);
  } catch (err) {
    console.error("Error creating tables:", err);
  }
}
createIfNotExists();

/* -------------------------------------------
   Register
-------------------------------------------- */
router.post("/register", async (req, res) => {
  const { user_name, age, email, blood_group, mobile, user_password, confirmPassword } = req.body;

  if (!user_name || !age || !email || !blood_group || !mobile || !user_password || !confirmPassword) {
    return res.status(400).json({ message: "All fields are required" });
  }
  if (user_password !== confirmPassword) {
    return res.status(400).json({ message: "Passwords do not match" });
  }

  try {
    const hashedPassword = await bcrypt.hash(user_password, 10);

    // Check duplicate
    const [existing] = await pool.query(
      "SELECT id FROM users WHERE user_name = ? OR email = ? OR mobile = ?",
      [user_name, email, mobile]
    );

    if (existing.length > 0) {
      return res.status(409).json({ message: "Username, email, or mobile already exists" });
    }

    await pool.query(
      "INSERT INTO users (user_name, age, email, blood_group, mobile, user_password) VALUES (?, ?, ?, ?, ?, ?)",
      [user_name, Number(age), email, blood_group, mobile, hashedPassword]
    );

    res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    return sendServerError(res, error);
  }
});

/* -------------------------------------------
   Login
-------------------------------------------- */
router.post("/login", async (req, res) => {
  const { user_name, user_password } = req.body;

  if (!user_name || !user_password) {
    return res.status(400).json({ message: "Username and password are required" });
  }

  try {
    const [results] = await pool.query("SELECT * FROM users WHERE user_name = ?", [user_name]);
    if (!results || results.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const user = results[0];
    const isMatch = await bcrypt.compare(user_password, user.user_password);
    if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

    res.status(200).json({
      message: `Welcome ${user.user_name} on Med-Connect`,
      user: {
        user_name: user.user_name,
        mobile: user.mobile,
        blood_group: user.blood_group,
      },
    });
  } catch (err) {
    return sendServerError(res, err, "Login failed");
  }
});

/* -------------------------------------------
   Get logged-in user details
-------------------------------------------- */
router.get("/me/:username", async (req, res) => {
  const { username } = req.params;
  try {
    const [results] = await pool.query(
      "SELECT user_name, mobile, blood_group, age, email FROM users WHERE user_name = ?",
      [username]
    );
    if (!results || results.length === 0) return res.status(404).json({ message: "User not found" });
    res.status(200).json(results[0]);
  } catch (err) {
    return sendServerError(res, err);
  }
});

/* -------------------------------------------
   Emergency Report
-------------------------------------------- */
const emergencyUpload = upload.none();
router.post("/emergency/submit", (req, res) => emergencyUpload(req, res, async () => {
  const { reporting_for, emergency_type, name, mobile, blood_group, ambulance_required, latitude, longitude } = req.body;

  if (!reporting_for || !emergency_type || !name || !mobile || !ambulance_required) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO emergency_form 
      (reporting_for, emergency_type, name, mobile, blood_group, ambulance_required, latitude, longitude)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [reporting_for, emergency_type, name, mobile, blood_group, ambulance_required, latitude, longitude]
    );

    res.status(201).json({
      message: "Emergency report submitted successfully.",
      receipt: {
        id: result.insertId,
        reporting_for,
        emergency_type,
        name,
        mobile,
        blood_group,
        ambulance_required,
        latitude,
        longitude,
        timestamp: new Date(),
      },
    });
  } catch (err) {
    return sendServerError(res, err);
  }
}));

/* -------------------------------------------
   Symptoms Report
-------------------------------------------- */
const symptomsUpload = upload.single("prescription_image");
router.post("/symptoms", (req, res) => {
  const contentType = (req.headers["content-type"] || "").toLowerCase();
  if (contentType.includes("multipart/form-data")) {
    return symptomsUpload(req, res, async () => handleSymptoms(req, res));
  }
  return handleSymptoms(req, res);
});

async function handleSymptoms(req, res) {
  const { name, mobile, blood_group, duration_days, ambulance_required } = req.body;
  const prescriptionImage = req.file ? req.file.filename : null;

  if (!name || !mobile || !blood_group || !duration_days || !ambulance_required) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO symptom_reports
        (name, mobile, blood_group, duration_days, ambulance_required, prescription_image)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, mobile, blood_group, Number(duration_days), ambulance_required, prescriptionImage]
    );

    res.status(201).json({
      message: "Symptoms report submitted successfully.",
      receipt: {
        id: result.insertId,
        name,
        mobile,
        blood_group,
        duration_days,
        ambulance_required,
        prescription_image: prescriptionImage,
        timestamp: new Date(),
      },
    });
  } catch (err) {
    return sendServerError(res, err);
  }
}

/* -------------------------------------------
   Health check
-------------------------------------------- */
router.get("/health", (_req, res) => res.json({ status: "ok" }));

module.exports = router;
