import puppeteer from "puppeteer";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(__dirname, "..", "public", "docs.html");
const pdfPath  = path.join(__dirname, "..", "public", "pygmy-technical-docs.pdf");

const browser = await puppeteer.launch({ headless: true });
const page    = await browser.newPage();

await page.goto(`file:///${htmlPath.replace(/\\/g, "/")}`, { waitUntil: "networkidle0", timeout: 30000 });

// Wait for Inter font to load
await page.evaluateHandle("document.fonts.ready");

await page.pdf({
  path: pdfPath,
  format: "A4",
  printBackground: true,
  margin: { top: "48px", right: "56px", bottom: "48px", left: "56px" },
  displayHeaderFooter: true,
  headerTemplate: `<div style="font-size:8px;color:#9ca3af;width:100%;text-align:center;font-family:sans-serif;">Pygmy — Technical Documentation</div>`,
  footerTemplate: `<div style="font-size:8px;color:#9ca3af;width:100%;text-align:center;font-family:sans-serif;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
});

await browser.close();
console.log("PDF saved →", pdfPath);
