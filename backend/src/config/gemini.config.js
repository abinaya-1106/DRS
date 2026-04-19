import { GEMINI_API_KEY } from "./env.js";
import { GoogleGenAI } from "@google/genai";

const geminiClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

export default geminiClient;
