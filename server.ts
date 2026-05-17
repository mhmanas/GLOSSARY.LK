import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Gemini
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// API endpoint for AI population
app.post("/api/ai/populate", async (req, res) => {
  const { english, category } = req.body;

  if (!english) {
    return res.status(400).json({ error: "English term is required" });
  }

  try {
    const prompt = `Translate the following glossary term from English to Sinhala and Tamil. 
    Also provide a brief administrative definition in English.
    
    Category: ${category || 'General'}
    Term: ${english}`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            sinhala: { type: Type.STRING },
            tamil: { type: Type.STRING },
            description: { type: Type.STRING }
          },
          required: ["sinhala", "tamil", "description"]
        }
      }
    });

    const result = JSON.parse(response.text);
    res.json(result);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Failed to generate translations";
    console.error("Gemini API Error:", error);
    res.status(500).json({ error: errorMessage });
  }
});

async function startServer() {
  // Vite middleware for development
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

startServer();
