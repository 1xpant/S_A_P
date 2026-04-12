import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function analyzeSoilData(data: {
  nitrogen: number;
  phosphorus: number;
  potassium: number;
  temperature: number;
  humidity: number;
}) {
  try {
    const prompt = `
      As an expert agronomist, analyze the following soil sensor data:
      - Nitrogen: ${data.nitrogen} mg/kg
      - Phosphorus: ${data.phosphorus} mg/kg
      - Potassium: ${data.potassium} mg/kg
      - Temperature: ${data.temperature}°C
      - Humidity: ${data.humidity}%

      Provide a concise, professional analysis (max 150 words) including:
      1. Overall soil health assessment.
      2. Specific crop recommendations that would thrive in these conditions.
      3. Fertilizer or soil amendment advice if any nutrient is deficient.
      4. Any potential risks (e.g., heat stress, over-saturation).
      
      Format the response in clean markdown.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });

    return response.text || "No analysis generated.";
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    return "Unable to perform AI analysis at this time. Please check your sensor connection.";
  }
}
