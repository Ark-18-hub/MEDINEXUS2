const db = require('./db');

// Haversine
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);

    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

async function findNearestHospital(userLat, userLon, severity) {

    // 1. Get static list filtered by severity
    const [rows] = await db.query(
        "SELECT * FROM hospital WHERE severity_level = ?",
        [severity]
    );

    if (rows.length === 0) return null;

    let nearest = null;
    let minDist = Infinity;

    for (const item of rows) {

        const lat = parseFloat(item.latitude);
        const lon = parseFloat(item.longitude);

        const dist = getDistance(userLat, userLon, lat, lon);

        // 2. Find REAL hospital (registered)
        const [realHosp] = await db.query(
            "SELECT id FROM hospitals WHERE hospitalName = ? LIMIT 1",
            [item.hospital_name]
        );

        if (realHosp.length === 0) continue; // not registered

        const hospitalId = realHosp[0].id;

        // 3. Check availability
        const [avail] = await db.query(
            "SELECT available_beds FROM hospital_availability WHERE hospital_id = ?",
            [hospitalId]
        );

        const availableBeds = avail?.[0]?.available_beds ?? 0;

        // 4. Skip if zero beds
        if (availableBeds <= 0) continue;

        // 5. If nearest, update
        if (dist < minDist) {
            minDist = dist;
            nearest = {
                id: hospitalId,
                hospital_name: item.hospital_name,
                latitude: lat,
                longitude: lon,
                available_beds: availableBeds,
                distance_km: dist
            };
        }
    }

    return nearest;
}

module.exports = findNearestHospital;
