const fs = require("fs");
const { PDFDocument } = require("pdf-lib");

async function mergePdf(job1Path, job2Path, outputPath) {
  const pdf1 = await PDFDocument.load(fs.readFileSync(job1Path));
  const pdf2 = await PDFDocument.load(fs.readFileSync(job2Path));

  const finalPdf = await PDFDocument.create();

  // halaman 1 dari job-1
  const [page1] = await finalPdf.copyPages(pdf1, [0]);
  finalPdf.addPage(page1);

  // semua halaman dari job-2
  const pages2 = await finalPdf.copyPages(pdf2, pdf2.getPageIndices());
  pages2.forEach((p) => finalPdf.addPage(p));

  const bytes = await finalPdf.save();
  fs.writeFileSync(outputPath, bytes);
}

module.exports = { mergePdf };
