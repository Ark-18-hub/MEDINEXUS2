// ------------------ Imports ------------------
const express = require("express");
const path = require("path");
const { exec } = require("child_process");
const bodyParser = require("body-parser");
const multer = require("multer");
const bcrypt = require("bcrypt");         // for password hashing
const findNearestHospital = require('./nearestHospital');
const pool = require("./db");             // ✅ MySQL pool
const authRoutes = require("./auth");     // ✅ auth routes
require("dotenv").config();

// ------------------ App Setup ------------------
const app = express();
const PORT = 5000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public"))); // serve HTML/CSS/JS

// ------------------ File Upload Config ------------------
const UPLOAD_PATH = path.join(__dirname, "test_images");
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_PATH),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// ------------------ Routes ------------------

// ✅ Auth routes
app.use("/auth", authRoutes);

// ✅ Emergency route with YOLO prediction
app.post("/emergency/submit", upload.single("injuryImage"), (req, res) => {
  try {
    const { reportingFor, emergencyType, patientName, mobile, bloodGroup, ambulance } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: "No image uploaded" });
    }

    const imagePath = path.join(UPLOAD_PATH, req.file.filename);
    const pythonScript = path.join(__dirname, "predict.py");

    console.log("Processing image:", imagePath);

    exec(`python "${pythonScript}" "${imagePath}"`, async (err, stdout, stderr) => {
      if (err) {
        console.error("Python error:", err);
        return res.status(500).json({ message: "Prediction failed" });
      }

      // ✅ FIX: Safely extract JSON from Python output
      let prediction = "No result";
      try {
        // Your Python should print something like {"injuryResult":"major injury"}
        const match = stdout.match(/\{.*\}/s);
        if (match) {
          const pyOutput = JSON.parse(match[0]);
          if (pyOutput && pyOutput.injuryResult) {
            prediction = pyOutput.injuryResult;
          }
        } else {
          console.warn("⚠️ No JSON block in Python output:", stdout);
        }
      } catch (parseErr) {
        console.error("JSON parse error:", parseErr, "\nRaw stdout:", stdout);
      }
// ---------------- NEAREST HOSPITAL NEW LOGIC ----------------

// convert user lat/lon
const userLat = parseFloat(req.body.latitude);
const userLon = parseFloat(req.body.longitude);

// determine severity
const severity = prediction.includes("major") ? "major" : "minor";

let nearestHospital = null;

if (!isNaN(userLat) && !isNaN(userLon)) {
  try {
    // this now uses: severity → hospital table → hospitals table → availability table
    nearestHospital = await findNearestHospital(userLat, userLon, severity);

    // ❌ If no hospital found → clear map link
    if (!nearestHospital || nearestHospital.noBeds === true) {
      nearestHospital = null;
    }
  } catch (e) {
    console.error("Error finding nearest hospital:", e);
    nearestHospital = null;
  }
}

      // ✅ Insert into MySQL
      try {
// --- UPDATED Insert Query ---
await pool.query(
  `INSERT INTO emergency_reports
   (reportingFor, emergencyType, patientName, mobile, bloodGroup, ambulance,
    imageName, detection, latitude, longitude, nearestHospital)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [
    reportingFor || null,
    emergencyType || null,
    patientName || null,
    mobile || null,
    bloodGroup || null,
    ambulance || null,
    req.file.filename,
    prediction,
    userLat || null,
    userLon || null,
    nearestHospital ? JSON.stringify(nearestHospital) : null
  ]
);

      } catch (dbErr) {
        console.error("MySQL insert error:", dbErr);
        return res.status(500).json({ message: "Database insert failed" });
      }
let hospitalMapLink = null;
if (nearestHospital && nearestHospital.latitude && nearestHospital.longitude) {
  hospitalMapLink = `https://www.google.com/maps/search/?api=1&query=${nearestHospital.latitude},${nearestHospital.longitude}`;
}

      // ✅ Respond to frontend
      return res.json({
        message: "✅ Emergency submitted successfully!",
        uploadedFile: req.file.filename,
        detection: prediction,
        hospitalMapLink
      });
    });
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// ✅ Hospital Registration (Updated for NEW authority.html)
app.post("/register", async (req, res) => {
  try {
    const data = req.body;
    console.log("📥 Incoming NEW registration:", data);

    // Required fields (after removing deleted ones)
    if (!data.hospitalName || !data.username || !data.password) {
      return res.status(400).json({
        message: "Hospital Name, Username, and Password are required."
      });
    }

    // Check if username already exists
    const [existing] = await pool.query(
      "SELECT id FROM hospitals WHERE username = ?",
      [data.username]
    );
    if (existing.length > 0) {
      return res.status(400).json({ message: "Username already exists." });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(data.password, 10);

    // -------------------------------
    // ✅ UPDATED INSERT QUERY 
    // (Removed license, estYear, hospitalEmail, website, ventilators, nurses, departments)
    // -------------------------------

    const insertQuery = `
      INSERT INTO hospitals 
      (hospitalName, hospitalType, username, password,
       address, city, state, pin, phone,
       totalBeds, icuBeds, ambulances, doctors,
       longitude, latitude)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      data.hospitalName,
      data.hospitalType || null,
      data.username,
      hashedPassword,
      data.address || null,
      data.city || null,
      data.state || null,
      data.pin || null,
      data.phone || null,
      Number(data.totalBeds) || 0,
      Number(data.icuBeds) || 0,
      Number(data.ambulance) || 0,
      Number(data.doctors) || 0,
      data.longitude || null,
      data.latitude || null
    ];

    try {
      await pool.query(insertQuery, params);
      console.log("✅ Hospital inserted successfully (NEW FIELDS)");
      // -------------------------------------------
// ⭐ AUTOMATICALLY CREATE AVAILABILITY RECORD
// -------------------------------------------

// Step 1: Get newly inserted hospital ID
const [hospitalRow] = await pool.query(
  "SELECT id, totalBeds, icuBeds, ambulances, doctors FROM hospitals WHERE username = ?",
  [data.username]
);

if (hospitalRow.length > 0) {
  const newHospitalId = hospitalRow[0].id;

  // Step 2: Insert availability entry with initial values
  await pool.query(
    `INSERT INTO hospital_availability
     (hospital_id, available_beds, available_icu, available_ambulances, available_doctors)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE hospital_id = hospital_id`,
    [
      newHospitalId,
      hospitalRow[0].totalBeds,        // initial bed availability = total beds
      hospitalRow[0].icuBeds,         // initial ICU availability
      hospitalRow[0].ambulances,      // initial ambulance availability
      hospitalRow[0].doctors          // initial doctor count
    ]
  );

  console.log("⭐ Availability row created for hospital →", newHospitalId);
}

      return res.status(200).json({ message: "Hospital registered successfully!" });
    } catch (dbErr) {
      console.error("❌ MySQL insert error:", dbErr);
      return res.status(500).json({
        message: "Database insert failed",
        sqlMessage: dbErr.sqlMessage,
        code: dbErr.code
      });
    }

  } catch (err) {
    console.error("❌ Server error:", err);
    return res.status(500).json({ message: "Server error", details: err.message });
  }
});

// -------------------------------------------------------------
// ✅ AUTHORITY LOGIN
// -------------------------------------------------------------
app.post("/authority-login", async (req, res) => {
  try {
    const { username, password } = req.body;

    // 1. Check empty fields
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "Username and password are required."
      });
    }

    // 2. Find user in MySQL
    const [rows] = await pool.query(
      "SELECT * FROM hospitals WHERE username = ?",
      [username]
    );

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or password."
      });
    }

    const user = rows[0];

    // 3. Compare password
    const valid_password = await bcrypt.compare(password, user.password);

    if (!valid_password) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or password."
      });
    }

    // 4. Login success (no session used – frontend redirects)
    return res.json({
      success: true,
      message: "Login successful!",
      hospitalName: user.hospitalName,
      userId: user.id
    });

  } catch (error) {
    console.error("❌ Login server error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again later."
    });
  }
});

// Serve Authority Dashboard
app.get("/dashboardAuth", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboardAuth.html"));
});
// -------------------------------------------------------------
// ✅ AUTHORITY DASHBOARD: LOAD HOSPITAL INFO + AVAILABILITY
// -------------------------------------------------------------
app.get("/authority/info", async (req, res) => {
  try {
    const username = req.query.username; // OR use session/token (future)

    if (!username) {
      return res.json({ success: false, message: "Username missing." });
    }

    // Step 1: Get hospital info
    const [hosp] = await pool.query(
      "SELECT id, hospitalName, totalBeds, icuBeds, ambulances, doctors FROM hospitals WHERE username = ?",
      [username]
    );

    if (hosp.length === 0) {
      return res.json({ success: false, message: "Hospital not found" });
    }

    const hospitalId = hosp[0].id;

    // Step 2: Get availability info
    const [avail] = await pool.query(
      "SELECT available_beds, available_icu, available_ambulances, available_doctors FROM hospital_availability WHERE hospital_id = ?",
      [hospitalId]
    );

    return res.json({
      success: true,
      hospital: {
        ...hosp[0],
        availableBeds: avail[0]?.available_beds || 0,
        availableICU: avail[0]?.available_icu || 0,
        availableAmb: avail[0]?.available_ambulances || 0,
        availableDoctors: avail[0]?.available_doctors || 0
      }
    });

  } catch (err) {
    console.error("Error loading authority info:", err);
    res.json({ success: false, message: "Server error" });
  }
});
// -------------------------------------------------------------
// ✅ UPDATE AVAILABILITY VALUES
// -------------------------------------------------------------
app.post("/authority/updateAvailability", async (req, res) => {
  try {
    const username = req.body.username; // OR session (future enhancement)

    if (!username) {
      return res.json({ success: false, message: "Username missing." });
    }

    const {
      availableBeds,
      availableICU,
      availableAmb,
      availableDoctors
    } = req.body;

    // Step 1: Get hospital ID
    const [rows] = await pool.query(
      "SELECT id FROM hospitals WHERE username = ?",
      [username]
    );

    if (rows.length === 0) {
      return res.json({ success: false, message: "Hospital not found." });
    }

    const hospitalId = rows[0].id;

    // Step 2: Update availability table
    await pool.query(
      `UPDATE hospital_availability 
       SET available_beds=?, available_icu=?, available_ambulances=?, available_doctors=?
       WHERE hospital_id=?`,
      [availableBeds, availableICU, availableAmb, availableDoctors, hospitalId]
    );

    return res.json({ success: true, message: "Updated successfully!" });

  } catch (err) {
    console.error("Update error:", err);
    res.json({ success: false, message: "Server error" });
  }
});

// -------------------------------------------------------------
// ⭐ FIXED: AUTHORITY → GET ASSIGNED PATIENT THINGSPEAK CHANNEL
// -------------------------------------------------------------
app.get("/authority/live-channel", async (req, res) => {
    try {
        // frontend will send ?authorityId=ID
        const authorityId = req.query.authorityId;

        if (!authorityId) {
            return res.json({ channel: null });
        }

        const [row] = await pool.query(
            "SELECT thingspeak_channel FROM assigned_patients WHERE authority_id = ?",
            [authorityId]
        );

        if (!row.length) {
            return res.json({ channel: null });
        }

        return res.json({ channel: row[0].thingspeak_channel });

    } catch (err) {
        console.error("❌ /authority/live-channel Error:", err);
        return res.status(500).json({ message: "Server error" });
    }
});


// ✅ Default route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "frontpage.html"));
});

// ------------------ Start Server ------------------
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  const url = `http://localhost:${PORT}/`;
  switch (process.platform) {
    case "darwin": exec(`open ${url}`); break;
    case "win32": exec(`start ${url}`); break;
    case "linux": exec(`xdg-open ${url}`); break;
    default: console.log("⚠️ Open manually:", url);
  }
});
