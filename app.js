const express = require("express");
const path = require("path");
const fs = require("fs");

const { downloadFile } = require("./services/download");
const { generatePdf } = require("./services/generatePdf");
const { mergePdf } = require("./services/mergePdf");
// const { printFile } = require("./services/print");

const app = express();
app.use(express.json());

app.post("/print-job", async (req, res) => {
  try {
    const { token, jobId } = req.body;

    const tempDir = path.join(__dirname, "temp");

    const unique = `${jobId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const job1Path = path.join(tempDir, `job-${unique}-1.pdf`);
    const job2Path = path.join(tempDir, `job-${unique}-2.pdf`);
    const finalPath = path.join(tempDir, `job-final-${unique}.pdf`);

    // 🔥 1. Download Cakrawala (via Laravel proxy)
    const job1Url = `https://erwinzilla.com/api/cakrawala/invoices/${jobId}/nota-invoice`;

    await downloadFile(job1Url, job1Path, token);

    // 🔥 2. Generate Tornado PDF
    const job2Url = `https://pts.erwinzilla.com/work-order/${jobId}/print?token=${token}`;

    await generatePdf(job2Url, job2Path);

    // 🔥 3. Merge
    await mergePdf(job1Path, job2Path, finalPath);

    // 🔥 4. Print
    // await printFile(finalPath);

    if (!fs.existsSync(finalPath)) {
      return res.status(500).json({ error: "PDF_NOT_FOUND" });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename=job-final-${unique}.pdf`,
    );
    res.sendFile(finalPath, (err) => {
      if (err) {
        console.error("SendFile error:", err);
      }

      fs.unlink(job1Path, (err) => {
        if (err) console.error("Failed delete job1:", err);
      });
      fs.unlink(job2Path, (err) => {
        if (err) console.error("Failed delete job2:", err);
      });
      fs.unlink(finalPath, (err) => {
        if (err) console.error("Failed delete job-final:", err);
      });
    });

    // res.json({ status: "printed" });
    // res.json({
    //   status: "success",
    //   file: finalPath,
    // });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "ERROR_GENERATE_PDF" });
  }
});

app.post("/print-loan", async (req, res) => {
  try {
    const { token, loanId } = req.body;

    const tempDir = path.join(__dirname, "temp");

    const unique = `${loanId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const finalPath = path.join(tempDir, `loan-${unique}.pdf`);

    // 🔥 2. Generate Tornado PDF
    const loanUrl = `https://pts.erwinzilla.com/loan/${loanId}/print?token=${token}`;
    await generatePdf(loanUrl, finalPath, { width: "210mm", height: "633px" });

    if (!fs.existsSync(finalPath)) {
      return res.status(500).json({ error: "PDF_NOT_FOUND" });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=loan-${unique}.pdf`);
    res.sendFile(finalPath, (err) => {
      if (err) {
        console.error("SendFile error:", err);
      }

      fs.unlink(finalPath, (err) => {
        if (err) console.error("Failed delete loan:", err);
      });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "ERROR_GENERATE_PDF" });
  }
});

app.listen(3000, () => {
  console.log("Print Service running on port 3000");
});

// app.use("/files", express.static("temp"));
