import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function scoutCropProfile(cropName: string) {
  try {
    const prompt = `
      Search for and provide growth details for the plant: "${cropName}".
      Include ideal NPK levels (mg/kg), ideal temperature range (Celsius), and ideal humidity range (%).
      Also provide:
      1. Difficulty level (1-5, where 1 is "Plant and forget" and 5 is "Needs a PhD").
      2. Management level (Low, Medium, or High).
      3. Typical days to harvest from planting.
      4. Water needs (Low, Medium, or High).
      5. A brief, punchy 1-sentence description.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            category: { type: Type.STRING, description: "One of: Vegetable, Fruit, Grain, Other" },
            idealNPK: {
              type: Type.OBJECT,
              properties: {
                n: { type: Type.NUMBER },
                p: { type: Type.NUMBER },
                k: { type: Type.NUMBER }
              },
              required: ["n", "p", "k"]
            },
            idealTemp: {
              type: Type.OBJECT,
              properties: {
                min: { type: Type.NUMBER },
                max: { type: Type.NUMBER }
              },
              required: ["min", "max"]
            },
            idealHumidity: {
              type: Type.OBJECT,
              properties: {
                min: { type: Type.NUMBER },
                max: { type: Type.NUMBER }
              },
              required: ["min", "max"]
            },
            description: { type: Type.STRING },
            difficulty: { type: Type.NUMBER },
            managementLevel: { type: Type.STRING },
            daysToHarvest: { type: Type.NUMBER },
            waterNeeds: { type: Type.STRING }
          },
          required: ["name", "category", "idealNPK", "idealTemp", "idealHumidity", "description", "difficulty", "managementLevel", "daysToHarvest", "waterNeeds"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No data returned from AI");
    return JSON.parse(text);
  } catch (error) {
    console.error("Crop Scouting Error:", error);
    throw error;
  }
}

export async function analyzeSoilData(data: {
  nitrogen: number;
  phosphorus: number;
  potassium: number;
  temperature: number;
  humidity: number;
}, cropContext?: any) {
  try {
    const prompt = `
      You're a super chill but brilliant agronomist. Talk to me like a knowledgeable friend, keep it casual but accurate. No corporate talk. Use phrases like "Looking good!", "Heads up,", "You might want to...", etc.
      
      Analyze this soil data:
      - Nitrogen: ${data.nitrogen} mg/kg
      - Phosphorus: ${data.phosphorus} mg/kg
      - Potassium: ${data.potassium} mg/kg
      - Temperature: ${data.temperature}°C
      - Humidity: ${data.humidity}%

      ${cropContext ? `CROP VIBE CHECK:
      We're growing: ${cropContext.name}
      Goal NPK: N:${cropContext.idealNPK.n} P:${cropContext.idealNPK.p} K:${cropContext.idealNPK.k}
      Goal Temp: ${cropContext.idealTemp.min}-${cropContext.idealTemp.max}°C
      Goal Humidity: ${cropContext.idealHumidity.min}-${cropContext.idealHumidity.max}%` : ""}

      Gimme a quick breakdown (max 150 words):
      1. How's the soil looking? Be honest.
      2. What should I do next to get those levels perfect?
      3. Any sketchy stuff I should worry about?
      
      Format the response in clean markdown. NEVER use asterisks (*) for formatting.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });

    return response.text || "No analysis generated.";
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    return "Unable to perform AI analysis at this time.";
  }
}
