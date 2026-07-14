import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API endpoint for chat messages
  app.post("/api/chat", async (req, res) => {
    try {
      const payload = req.body;
      let responseText = "";

      if (payload.type === 'init') {
        responseText = `API: Sesión ${payload.sessionId} inicializada para ${payload.userContext?.userName} (${payload.userContext?.clientCode})`;
      } else if (payload.type === 'text') {
        if (!payload.message) {
          res.status(400).json({ error: "Message is required for text type" });
          return;
        }
        responseText = `API recibió texto: ${payload.message}`;
      } else if (payload.type === 'selection') {
        responseText = `API procesó selección: ${payload.selection?.label} (Valor: ${payload.selection?.value})`;
      } else {
        responseText = `Echo genérico o tipo desconocido: ${JSON.stringify(payload)}`;
      }

      res.json({ text: responseText });
    } catch (error: any) {
      console.error("API Error:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  // Vite middleware for development or static server for production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
