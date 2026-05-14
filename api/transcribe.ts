import { GoogleGenAI } from "@google/genai";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { audio_base64 } = req.body;

    if (!audio_base64) {
      return res.status(400).json({ error: "Missing audio data" });
    }

    console.log("Transcribing audio...");

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
      
      const errorMsg = transcriptionError.message || "";
      const errorStatus = transcriptionError.status || (transcriptionError.response && transcriptionError.response.status);
      
      if (errorStatus === 429 || errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED')) {
        transcript = "[Transcription pending: AI Busy. Voice saved.]";
      } else {
        transcript = `[Transcription error: ${errorMsg || "Internal AI Error"}]`;
      }
    }

    res.status(200).json({ success: true, transcript });

  } catch (error: any) {
    console.error("Server error:", error);
    res.status(500).json({ error: error.message });
  }
}
