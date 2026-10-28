import express from "express";
import path from "node:path";
import { registerApplicationRoutes } from "./server/_core/app.js";

// Vercel invokes this exported Express application as a serverless function.
// Vite's build command writes the SPA to root public/, which Vercel serves via
// its CDN. This fallback handles client-side routes that are not static files.
const app = express();
registerApplicationRoutes(app);
app.use("/api", (_req, res) => res.status(404).json({ error: "API route not found" }));
app.use((_req, res, next) => {
  res.sendFile(path.resolve(process.cwd(), "public", "index.html"), error => {
    if (error) next(error);
  });
});

export default app;
