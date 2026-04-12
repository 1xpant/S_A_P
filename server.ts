import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // Mock data state
  let soilData = {
    nitrogen: 45.2,
    phosphorus: 32.8,
    potassium: 68.5,
    temperature: 24.5,
    humidity: 58.2,
    latitude: 37.7749,
    longitude: -122.4194,
    lastUpdate: new Date().toLocaleTimeString(),
    source: "Simulated"
  };

  let mockDataEnabled = true;

  // Update mock data periodically (only if real data isn't being received)
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

  // API Routes
  app.get("/api/data", (req, res) => {
    res.json(soilData);
  });

  app.post("/api/data", (req, res) => {
    console.log("--- Telemetry POST Received ---");
    console.log("Headers:", req.headers);
    console.log("Body:", req.body);

    const { nitrogen, phosphorus, potassium, temperature, humidity, latitude, longitude } = req.body;
    
    if (Object.keys(req.body).length === 0) {
      console.warn("Warning: Received empty POST body from ESP32");
      return res.status(400).json({ status: "error", message: "Empty body" });
    }

    // Disable mock data once we receive a real payload
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
      source: "Live (ESP32)"
    };

    console.log("Updated soilData:", soilData);
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
