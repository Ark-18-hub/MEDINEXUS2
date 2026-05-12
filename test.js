const findNearestHospital = require('./nearestHospital');

(async () => {
    try {
        const userLat = 18.553206;
        const userLon = 73.826468;
        const severity = "minor";   // or "major"

        const nearest = await findNearestHospital(userLat, userLon, severity);
        console.log("Nearest Hospital:", nearest);

    } catch (err) {
        console.error("Error:", err);
    }
})();
