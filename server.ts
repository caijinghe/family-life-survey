import "dotenv/config";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "fs";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  // JSON body limit for individual uploads
  app.use(express.json({ limit: '10mb' }));

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  // API Route for Transcription only (protecting Gemini API Key)
  app.post("/api/transcribe", async (req, res) => {
    try {
      const { audio_base64 } = req.body;

      if (!audio_base64) {
        return res.status(400).json({ error: "Missing audio data" });
      }

      console.log("Transcribing audio...");

      // 1. Transcribe with Gemini
      let transcript = "Transcription pending";
      try {
        const result = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: {
            parts: [
              {
                inlineData: {
                  data: audio_base64,
                  mimeType: "audio/webm"
                }
              },
              {
                text: "You are a professional English transcription assistant. Please transcribe the provided English audio verbatim. If the audio is not in English, transcribe it as accurately as possible. If no speech is detected, respond exactly with '[No speech detected]'."
              }
            ]
          }
        });
        transcript = result.text || "[Transcription failed to extract text]";
        console.log(`Transcription result: ${transcript}`);
      } catch (transcriptionError: any) {
        console.error("Gemini Transcription error:", transcriptionError);
        
        // Improve detection for quota errors
        const errorMsg = transcriptionError.message || "";
        const errorStatus = transcriptionError.status || (transcriptionError.response && transcriptionError.response.status);
        
        if (errorStatus === 429 || errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED')) {
          transcript = "[Transcription pending: AI Busy. Voice saved.]";
        } else {
          transcript = `[Transcription error: ${errorMsg || "Internal AI Error"}]`;
        }
      }

      // Always return 200 if we have a "valid" fallback message to avoid blocking the user flow
      res.json({ success: true, transcript });

    } catch (error: any) {
      console.error("Server error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    console.log("Starting server in DEVELOPMENT mode with Vite middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);

    // Standard Vite SPA fallback for index.html
    app.use('*', async (req, res, next) => {
      const url = req.originalUrl;
      // Skip API requests or if headers already sent
      if (url.startsWith('/api') || res.headersSent) return next();

      try {
        let template = readFileSync(path.resolve(process.cwd(), "index.html"), "utf-8");
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e: any) {
        vite.ssrFixStacktrace(e);
        console.error("Vite transformation error:", e);
        next(e);
      }
    });
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

startServer();
