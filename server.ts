import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Current state of the soil
  let soilData = {
    nitrogen: 45.2,
    phosphorus: 32.8,
    potassium: 68.5,
    temperature: 24.5,
    humidity: 58.2,
    latitude: 37.7749,
    longitude: -122.4194,
    lastUpdate: new Date().toLocaleTimeString(),
    source: "Simulated",
    lastPostTime: "Never"
  };

  let mockDataEnabled = true;

  // Mock data simulation (runs until real ESP32 data arrives)
  const mockInterval = setInterval(() => {
    if (!mockDataEnabled) return;
    soilData = {
      ...soilData,
      nitrogen: Math.max(0, Math.min(100, soilData.nitrogen + (Math.random() - 0.5) * 2)),
      phosphorus: Math.max(0, Math.min(100, soilData.phosphorus + (Math.random() - 0.5) * 1.5)),
      potassium: Math.max(0, Math.min(100, soilData.potassium + (Math.random() - 0.5) * 2.5)),
      temperature: Math.max(10, Math.min(40, soilData.temperature + (Math.random() - 0.5) * 0.5)),
      humidity: Math.max(20, Math.min(90, soilData.humidity + (Math.random() - 0.5) * 1.2)),
      lastUpdate: new Date().toLocaleTimeString(),
      source: "Simulated"
    };
  }, 2000);

  // GET: Used by the React Dashboard
  app.get("/api/data", (req, res) => {
    res.json(soilData);
  });

  // POST: Used by your ESP32
  app.post("/api/data", (req, res) => {
    console.log("\n--- [TELEMETRY INBOUND] ---");
    console.log("Time:", new Date().toISOString());
    console.log("Headers:", JSON.stringify(req.headers, null, 2));
    console.log("Body:", JSON.stringify(req.body, null, 2));

    const { nitrogen, phosphorus, potassium, temperature, humidity, latitude, longitude } = req.body;
    
    if (!req.body || Object.keys(req.body).length === 0) {
      console.error("!!! ERROR: Received empty body from ESP32 !!!");
      return res.status(400).json({ status: "error", message: "Empty body received" });
    }

    // Disable mock data once we receive a real payload from the ESP32
    mockDataEnabled = false;

    soilData = {
      nitrogen: Number(nitrogen ?? soilData.nitrogen),
      phosphorus: Number(phosphorus ?? soilData.phosphorus),
      potassium: Number(potassium ?? soilData.potassium),
      temperature: Number(temperature ?? soilData.temperature),
      humidity: Number(humidity ?? soilData.humidity),
      latitude: Number(latitude ?? soilData.latitude),
      longitude: Number(longitude ?? soilData.longitude),
      lastUpdate: new Date().toLocaleTimeString(),
      source: "Live (ESP32)",
      lastPostTime: new Date().toLocaleTimeString()
    };

    // Write to a file so the agent can verify receipt
    try {
      const fs = await import('fs');
      fs.writeFileSync('telemetry_log.json', JSON.stringify({
        timestamp: new Date().toISOString(),
        data: soilData,
        receivedBody: req.body
      }, null, 2));
    } catch (e) {
      console.error("Failed to write telemetry log:", e);
    }

    console.log("--- [STATE UPDATED] ---");
    console.log(soilData);
    res.json({ status: "success", message: "Telemetry updated" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
