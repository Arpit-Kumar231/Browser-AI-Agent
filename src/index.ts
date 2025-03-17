import { chromium } from "playwright";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Set up __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function generateInstructions(command: string) {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
  const prompt = `You are an assistant that instructs a browser to interact with Vercel V0 with the following exact workflow:
  
  1. Navigate to "https://v0.dev/".
  2. Wait for 2000 milliseconds.
  3. Click on the anchor tag with text "Sign in".
  4. Wait for 2000 milliseconds.
  5. In the textarea with id "chat-main-textarea", type the prompt: "${command}".
  6. Click on the button with data-testid "prompt-form-send-button".
  7. Wait for 3000 milliseconds for the UI to generate.
  8. Extract the generated UI code from the element with class ".landing-page-ui".
  9. Wait for 1000 milliseconds.
  10. Refine the extracted UI code with the instruction: "Add responsive design using CSS media queries.".
  11. Wait for 1000 milliseconds.
  12. Refine the UI code further with the instruction: "Optimize layout for better user experience.".
  
  Return the instructions as valid JSON, an array of objects where each object is in the format:
  {
    "action": "<action name>",
    "details": <action details>
  }
  
  For actions:
  - "navigate" expects a URL string.
  - "wait" expects a number in milliseconds.
  - "type" expects an object with "selector" and "text".
  - "click" expects a CSS selector string (use the data attribute for the button, e.g., [data-testid='prompt-form-send-button'] or a text based selector for the anchor).
  - "extractCode" expects a CSS selector string.
  - "refineCode" expects an object with a "refinement" key.
  
  Return only the JSON.`;

  const response = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 500,
    n: 1,
  });

  const text = response?.choices[0]?.message?.content?.trim() ?? "";
  try {
    return JSON.parse(text);
  } catch (error) {
    console.error("Failed to parse instructions. Response text:", text);
    throw new Error("Invalid JSON from LLM");
  }
}

async function refineUICode(
  currentCode: string,
  refinementInstructions: string
) {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
  const prompt =
    `You are an expert UI developer. You are given the following UI code:\n\n${currentCode}\n\n` +
    `Improve the code based on the following instruction: "${refinementInstructions}". ` +
    "Return only the updated code.";

  const response = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.4,
    max_tokens: 800,
    n: 1,
  });
  return response?.choices[0]?.message?.content?.trim() ?? "";
}

async function runBrowserAgent(command: string) {
  console.log("Processing command:", command);
  const instructions = await generateInstructions(command);
  console.log("Generated Instructions:", instructions);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  let currentUIcode = "";
  let iterationCount = 0;

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
    } else if (action === "click") {
      console.log(`Clicking element with selector "${details}"`);
      const locator = page.locator(details);
      await locator.click({ timeout: 10000 });
      await page.waitForTimeout(2000);
    } else if (action === "wait") {
      const duration = parseInt(details);
      console.log(`Waiting for ${duration} ms`);
      await page.waitForTimeout(duration);
    } else if (action === "extractCode") {
      console.log(`Extracting UI code from element with selector "${details}"`);
      const codeElement = await page.waitForSelector(details, {
        timeout: 10000,
      });
      currentUIcode = await codeElement.innerHTML();
      fs.writeFileSync(
        path.join(__dirname, "extracted_ui.html"),
        currentUIcode,
        "utf8"
      );
      console.log("Extracted UI code saved as extracted_ui.html");
    } else if (action === "refineCode") {
      if (currentUIcode) {
        if (typeof details === "object" && details.refinement) {
          console.log(
            `Refining UI code with instruction: "${details.refinement}"`
          );
          const refinedCode = await refineUICode(
            currentUIcode,
            details.refinement
          );
          currentUIcode = refinedCode;
          iterationCount++;
          const filename = `refined_ui_iteration_${iterationCount}.html`;
          fs.writeFileSync(path.join(__dirname, filename), refinedCode, "utf8");
          console.log(`Refined UI code saved as ${filename}`);
        } else {
          console.warn("Invalid details for refineCode action:", details);
        }
      } else {
        console.warn("No UI code available to refine. Use extractCode first.");
      }
    } else {
      console.warn("Unknown action:", action);
    }
  }

  await page.screenshot({ path: "final_ui.png" });
  console.log("Final UI screenshot saved as final_ui.png");

  if (currentUIcode) {
    console.log("Final refined UI code:\n", currentUIcode);
  }

  // Uncomment the next line to automatically close the browser after execution.
  // await browser.close();
}

// Read natural language command from command line input or use a default.
const userCommand =
  process.argv[2] ||
  "On Vercel V0, build an initial landing page UI, extract the UI code, then iteratively improve it to look more modern and responsive by refining the code multiple times.";
runBrowserAgent(userCommand).catch((error) => {
  console.error("Error running browser agent:", error);
});
