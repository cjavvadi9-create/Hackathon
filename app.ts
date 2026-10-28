import express from "express";
import path from "node:path";
import { registerApplicationRoutes } from "./server/_core/app.js";

// Vercel invokes this exported Express application as a serverless function.
// Vite writes the production SPA and its assets to root public/.
export function createVercelApplication(publicDir = path.resolve(process.cwd(), "public")) {
  const app = express();
  registerApplicationRoutes(app);

  // Keep unknown API requests in the API namespace, never in the SPA fallback.
  app.use("/api", (_req, res) => res.status(404).json({ error: "API route not found" }));

  // Vercel normally serves public files from its CDN. This also serves assets
  // when a request reaches the Express function, such as a missing CDN path.
  app.use(express.static(publicDir, { fallthrough: true, index: false }));

  // Missing bundles must be real 404s. Returning index.html here causes module
  // script MIME errors that leave the application blank in the browser.
  app.use((req, res, next) => {
    if (req.path.startsWith("/assets/") || /\.(?:js|css)$/i.test(req.path)) {
      res.sendStatus(404);
      return;
    }
    next();
  });

  // Non-asset paths are client-side routes and use the SPA entry document.
  app.use((_req, res, next) => {
    res.sendFile(path.join(publicDir, "index.html"), error => {
      if (error) next(error);
    });
  });
  return app;
}

const app = createVercelApplication();
export default app;
