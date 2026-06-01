const puppeteer = require("puppeteer");

async function generatePdf(url, outputPath) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  const page = await browser.newPage();

  await page.goto(url, {
    waitUntil: "networkidle0",
  });

  await page.pdf({
    path: outputPath,
    format: "A4",
    printBackground: true,
    scale: 0.95,
    margin: {
      top: "5mm",
      bottom: "5mm",
      left: "5mm",
      right: "5mm",
    },
  });

  await browser.close();
}

module.exports = { generatePdf };
