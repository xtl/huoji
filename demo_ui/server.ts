/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

let aiClient: GoogleGenAI | null = null;

function getAI(): GoogleGenAI | null {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      console.warn("GEMINI_API_KEY is not defined. AI features will run in fallback/mock mode.");
      return null;
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

// 1. API: AI structured parser for Server Trades
app.post("/api/structure", async (req, res) => {
  const { text, imageUrl } = req.body;

  if (!text && !imageUrl) {
    return res.status(400).json({ error: "Please provide text or image data to parse." });
  }

  const ai = getAI();

  if (!ai) {
    // Return high quality mock data with realistic variations based on text keywords for complete offline preview stability
    console.log("Using Mock Parser (No API Key)");
    const mockStructured = getMockStructuredData(text || "");
    return res.json({ data: mockStructured, isMock: true });
  }

  try {
    let contents: any[] = [];
    
    // Create base instruction
    const systemPrompt = `You are a world-class AI system specializing in Nvidia GPU Server trade negotiations.
Your job is to parse unstructured text (chat records, WeChat forwards, quotations, notes) and optional server labels/nameplate images, and convert them into a precise structured JSON object representing the server product.

Important server trade rules to know:
- 430, 430万, 4.3M generally means 4,300,000 CNY (or 4.3 Million CNY) per unit.
- Server form factors: "SXM整机" (SXM8 system, e.g. Supermicro SYS-821GE-TNHR), "HGX模组" (the SXM GPU baseboard itself, without host system), "PCIe", "NVL72" (rack system).
- Brands: Supermicro (超微), Inspur (浪潮), Dell (戴尔), HP (惠普), Lenovo (联想), ASUS (华硕), Huawei (华为).
- Check for inconsistencies between descriptions and pictures if any, and note them inside "aiAnalysis".
- Estimate evidence level:
  - "L0": Only text chat, zero evidence.
  - "L1": Has images (photos of servers, boxes, or WeChat screenshots) but no visible SN or labels.
  - "L2": Has photos of serial numbers (SN), server nameplates, active BMC diagnostics logs, or live video proofs.

Output the results strictly as a JSON object adhering to this schema:
{
  "gpuModel": "e.g. H100, H200, B200, B300, RTX 5090, H20, RTX 4090",
  "gpuQty": 8, // integer number of GPUs per node (default is 8 for SXM8 systems)
  "formFactor": "e.g. SXM整机, SXM模组, PCIe卡, NVL72, HGX基板",
  "brand": "e.g. Supermicro, Inspur, Dell, HP, ASUS, etc.",
  "modelName": "e.g. SYS-821GE-TNHR, SYS-421GE-TNRT, NF5488M6",
  "cpu": "e.g. Intel Xeon 8480+ * 2 or AMD EPYC 9654 * 2",
  "memory": "e.g. 2TB DDR5",
  "ssd": "e.g. 3.84TB NVMe * 4",
  "networkCard": "e.g. ConnectX-7 NDR 400G * 8 or CX6 200G",
  "cooling": "AIR" | "LIQUID" | "UNKNOWN",
  "powerSupply": "e.g. 3000W * 4",
  "warranty": "e.g. 原厂3年质保, 2年保修 or 待确认",
  "quantity": 10, // integer number of servers offered
  "location": "e.g. 深圳, 香港, 泰国, 北京",
  "deliveryDays": "e.g. 现货, 3天交货, 4周期货",
  "stockType": "READY" | "NEAR_READY" | "FUTURE",
  "condition": "SEALED" | "UNSEALED" | "USED" | "DECOMMISSIONED",
  "minOrderQty": 1, // integer
  "quotedPrice": 430.0, // float, unit price in TEN-THOUSAND (万) RMB, e.g., 430 means 4.3 million.
  "ownerPrice": 420.0, // float, estimate cost/bottom price in WAN RMB if mentioned, otherwise slightly lower than quotedPrice or 0
  "isTaxInclusive": true, // boolean
  "taxType": "e.g. 13%增专, 含税, 不开票",
  "currency": "e.g. CNY, USD",
  "paymentTerms": "e.g. 30%定金+70%款到发货",
  "contactChain": [ // Reconstruct intermediary/source chain mentioned like "老陈 -> 王总 -> 我"
    { "name": "...", "company": "...", "role": "OWNER" | "CHANNEL" | "MIDDLEMAN" | "BUYER" }
  ],
  "evidenceLevel": "L0" | "L1" | "L2" | "L3" | "L4",
  "aiAnalysis": "A brief analysis about configuration integrity, pricing reasonability, and whether there are conflicts between image labels and written text."
}
`;

    if (imageUrl) {
      // Handle Image Part
      const base64Data = imageUrl.replace(/^data:image\/\w+;base64,/, "");
      const mimeType = imageUrl.match(/^data:(image\/\w+);base64,/)?.[1] || "image/png";
      
      contents.push({
        inlineData: {
          mimeType: mimeType,
          data: base64Data
        }
      });
    }

    contents.push({
      text: `Text context to analyze: "${text || "No accompanying text, analyze image nameplate/screen details."}"`
    });

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: contents,
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
      }
    });

    const resultText = response.text?.trim() || "{}";
    const parsedData = JSON.parse(resultText);
    return res.json({ data: parsedData, isMock: false });
  } catch (err: any) {
    console.error("Gemini parse failed:", err);
    // Fallback to high quality mock parser on error
    const mockStructured = getMockStructuredData(text || "");
    return res.json({ data: mockStructured, isMock: true, error: err.message });
  }
});

// Helper Mock generator for offline completeness
function getMockStructuredData(text: string) {
  const norm = text.toLowerCase();
  
  // Model detection
  let gpuModel = "H200";
  if (norm.includes("h100")) gpuModel = "H100";
  else if (norm.includes("b200")) gpuModel = "B200";
  else if (norm.includes("b300")) gpuModel = "B300";
  else if (norm.includes("rtx 4090")) gpuModel = "RTX 4090";
  else if (norm.includes("rtx 5090")) gpuModel = "RTX 5090";
  else if (norm.includes("h20")) gpuModel = "H20";

  // Quantity
  let quantity = 10;
  const qtyMatch = text.match(/(\d+)\s*台/);
  if (qtyMatch) {
    quantity = parseInt(qtyMatch[1], 10);
  }

  // Location
  let location = "深圳";
  if (norm.includes("香港") || norm.includes("hk")) location = "香港";
  else if (norm.includes("泰国")) location = "泰国";
  else if (norm.includes("北京")) location = "北京";

  // Price
  let quotedPrice = 430; // Wan CNY i.e. 430万
  const priceMatch = text.match(/(\d+(\.\d+)?)\s*(万|w)/i) || text.match(/报价\s*(\d+(\.\d+)?)/) || text.match(/(\d{3})/);
  if (priceMatch) {
    const val = parseFloat(priceMatch[1]);
    if (val > 10 && val < 2000) {
      quotedPrice = val;
    }
  }

  let brand = "Supermicro";
  if (norm.includes("超微") || norm.includes("supermicro")) brand = "Supermicro";
  else if (norm.includes("浪潮") || norm.includes("inspur")) brand = "Inspur";
  else if (norm.includes("戴尔") || norm.includes("dell")) brand = "Dell";
  else if (norm.includes("华硕") || norm.includes("asus")) brand = "ASUS";

  let isTaxInclusive = norm.includes("带票") || norm.includes("含税") || norm.includes("税");
  let deliveryDays = norm.includes("现货") ? "现货" : "3-5天";
  let stockType = norm.includes("现货") ? "READY" : "NEAR_READY";
  if (norm.includes("期货")) {
    stockType = "FUTURE";
    deliveryDays = "3-4周";
  }

  let condition = "SEALED";
  if (norm.includes("二手") || norm.includes("拆")) {
    condition = "USED";
  }

  // Contact chain reconstruction
  const contactChain: any[] = [];
  if (norm.includes("陈") || norm.includes("老陈")) {
    contactChain.push({ name: "老陈", company: "渠道合伙人", role: "OWNER" });
  }
  if (norm.includes("张") || norm.includes("张总")) {
    contactChain.push({ name: "张总", company: "居间人", role: "MIDDLEMAN" });
  }

  return {
    gpuModel,
    gpuQty: 8,
    formFactor: "SXM整机",
    brand,
    modelName: brand === "Supermicro" ? "SYS-821GE-TNHR" : "NF5488M6",
    cpu: "Intel Xeon Platinum 8480+ * 2",
    memory: "2TB DDR5",
    ssd: "3.84TB NVMe * 4",
    networkCard: "ConnectX-7 NDR 400G * 8",
    cooling: "AIR",
    powerSupply: "3000W * 4 redundant",
    warranty: "原厂3年质保",
    quantity,
    location,
    deliveryDays,
    stockType,
    condition,
    minOrderQty: 1,
    quotedPrice,
    ownerPrice: Math.round(quotedPrice * 0.96 * 10) / 10, // 4% lower
    isTaxInclusive,
    taxType: isTaxInclusive ? "13%增值税专用发票" : "不开票（不含税）",
    currency: "CNY",
    paymentTerms: "30%款到锁货，70%验货完成后交付前付清",
    contactChain: contactChain.length > 0 ? contactChain : [{ name: "老陈", company: "星际算力", role: "OWNER" }],
    evidenceLevel: "L0",
    aiAnalysis: `[AI 离线结构化分析]: 自动识别到 GPU 型号 ${gpuModel}，数量 ${quantity} 台，所在地 ${location}，对外报价约 ${quotedPrice}万/台。未检测到实物SN或BMC日志图片，归类为口头L0级货源，建议买家要SN防撞单。`
  };
}

// Vite and static handlers Setup
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    // 2. Integration with Vite dev server
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // 3. Static server in production mode
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[货记 Server] CargoNote backend is running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
