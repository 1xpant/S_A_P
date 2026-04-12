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

  // NO LOCAL DATA STORAGE OR MOCKING
  // The server now only serves the static frontend
  
  // GET: Used by the React Dashboard (Legacy fallback - now returns empty or 404)
  app.get("/api/data", (req, res) => {
    res.status(404).json({ message: "Use Firestore direct connection" });
  });

  // POST: Disabled - ESP32 now goes direct to Firebase
  app.post("/api/data", (req, res) => {
    res.status(410).json({ message: "Endpoint retired. Connect to Firestore REST API directly." });
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
