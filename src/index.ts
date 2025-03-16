import { chromium } from "playwright";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Set up __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function generateInstructions(command) {
  const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
  });
  const openai = new OpenAIApi(configuration);

  const prompt = `Agentic Prompt first For actions:
- "navigate" expects a URL string.
- "wait" expects a number in milliseconds.
- "type" expects an object with "selector" and "text".`;

  const response = await openai.createCompletion({
    model: "gpt-3.5-turbo",
    prompt,
    temperature: 0.3,
    max_tokens: 300,
    n: 1,
    stop: null,
  });

  const text = response.data.choices[0].text.trim();
  try {
    return JSON.parse(text);
  } catch (error) {
    console.error("Failed to parse instructions. Response text:", text);
    throw new Error("Invalid JSON from LLM");
  }
}

async function runBrowserAgent(command: string) {
  console.log("Processing command:", command);
  const instructions = await generateInstructions(command);
  console.log("Generated Instructions:", instructions);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  

  for (const step of instructions) {
    const { action, details } = step;
    if (action === "navigate") {
      console.log(`Navigating to ${details}`);
      await page.goto(details);
      await page.waitForTimeout(2000);
    } else if (action === "type") {
      if (typeof details === "object" && details.selector && details.text) {
        console.log(
          `Typing "${details.text}" into element with selector ${details.selector}`
        );
        await page.fill(details.selector, details.text);
        await page.waitForTimeout(1000);
      } else {
        console.warn("Invalid details for type action:", details);
      }
    }
  }
}
