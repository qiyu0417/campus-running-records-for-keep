import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createApp, startServer } from "./app.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = createApp();
app.use(express.static(path.join(__dirname, "public")));

startServer(app, process.env.PORT || 3000);
