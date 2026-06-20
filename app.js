const express = require("express");
const path = require("path");
const fs = require("fs");
const http = require("http");
const socketIo = require("socket.io");

// Services yang sudah ada
const { downloadFile } = require("./services/download");
const { generatePdf } = require("./services/generatePdf");
const { mergePdf } = require("./services/mergePdf");
const { PrintQueue } = require("./services/queue-manager");
// const { printFile } = require("./services/print"); // Biarkan comment dulu

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(express.json({ limit: "50mb" }));

// ============ STORE UNTUK AGENT & QUEUE ============
const agents = new Map(); // key: agentId, value: socket object
const pendingJobs = new Map();
const printQueue = new PrintQueue();

// ============ ENDPOINT YANG SUDAH ADA (DIMODIFIKASI) ============

// Endpoint lama: /print-job (dimodifikasi agar bisa print via agent)
app.post("/print-job", async (req, res) => {
  try {
    const {
      token,
      jobId,
      agentId = "pc-admin-002",
      directPrint = true,
      name,
      printerName,
      paperSize = "A4",
    } = req.body; // ← Tambahkan parameter print (default true)

    console.log(
      `📨 Received print-job request: ${name}, print mode: ${directPrint ? "PRINT" : "ONLY PDF"}`,
    );

    const tempDir = path.join(__dirname, "temp");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const unique = `${jobId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const job1Path = path.join(tempDir, `job-${unique}-1.pdf`);
    const job2Path = path.join(tempDir, `job-${unique}-2.pdf`);
    const finalPath = path.join(tempDir, `job-final-${unique}.pdf`);

    // 1. Download Cakrawala (via Laravel proxy)
    const job1Url = `https://erwinzilla.com/api/cakrawala/invoices/${jobId}/nota-invoice`;
    await downloadFile(job1Url, job1Path, token);

    // 2. Generate Tornado PDF
    const job2Url = `https://pts.erwinzilla.com/work-order/${jobId}/print?token=${token}`;
    await generatePdf(job2Url, job2Path);

    // 3. Merge
    await mergePdf(job1Path, job2Path, finalPath);

    if (!fs.existsSync(finalPath)) {
      return res.status(500).json({ error: "PDF_NOT_FOUND" });
    }

    // ============ CEK MODE PRINT ============
    if (directPrint === true || directPrint === "true") {
      // Mode PRINT: kirim ke agent dan tunggu hasil print
      const agentSocket = agents.get(agentId);

      // Baca PDF dan konversi ke base64
      const pdfBuffer = fs.readFileSync(finalPath);
      const pdfBase64 = pdfBuffer.toString("base64");

      if (agentSocket) {
        // === CASE 1: AGENT ONLINE → LANGSUNG PRINT ===
        console.log(`✅ Agent ${agentId} online, printing immediately...`);

        const printJobId = `${jobId}-${Date.now()}`;

        agentSocket.emit("print-command", {
          jobId: printJobId,
          pdfBase64: pdfBase64,
          fileName: `${name}-${jobId}.pdf`,
        });

        const printPromise = new Promise((resolve, reject) => {
          pendingJobs.set(printJobId, { resolve, reject });
          setTimeout(() => {
            if (pendingJobs.has(printJobId)) {
              pendingJobs.delete(printJobId);
              reject(new Error("Print timeout"));
            }
          }, 120000);
        });

        await printPromise;

        // Cleanup file
        [job1Path, job2Path, finalPath].forEach((file) => {
          fs.unlink(
            file,
            (err) => err && console.error(`Failed delete: ${file}`),
          );
        });

        res.json({
          status: "success",
          message: "Printed immediately",
          mode: "direct",
        });
      } else {
        // === CASE 2: AGENT OFFLINE → MASUKKAN KE QUEUE ===
        console.log(`⚠️ Agent ${agentId} offline, adding to queue...`);

        // Simpan ke queue
        const queuedJob = printQueue.addJob({
          jobId: jobId,
          agentId: agentId,
          pdfBase64: pdfBase64,
          fileName: `${name}-${jobId}.pdf`,
          originalJobId: jobId,
          timestamp: Date.now(),
          printerName: printerName,
          paperSize: paperSize,
        });

        // Simpan PDF sementara (optional, kalau queue besar bisa simpan di disk)
        const queuedPdfPath = path.join(
          __dirname,
          `queued_${queuedJob.id}.pdf`,
        );
        fs.copyFileSync(finalPath, queuedPdfPath);
        queuedJob.pdfPath = queuedPdfPath;
        printQueue.updateJobStatus(queuedJob.id, "pending");

        // Cleanup temp files
        [job1Path, job2Path, finalPath].forEach((file) => {
          fs.unlink(
            file,
            (err) => err && console.error(`Failed delete: ${file}`),
          );
        });

        res.json({
          status: "queued",
          message: `Agent offline, job added to queue (position: ${printQueue.queue.length})`,
          mode: "queued",
          queueId: queuedJob.id,
        });
      }
    } else {
      // Mode PDF ONLY: hanya mengembalikan file PDF (tidak print)
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename=${name}-${unique}.pdf`,
      );
      res.sendFile(finalPath, (err) => {
        if (err) {
          console.error("SendFile error:", err);
        }

        // Hapus file setelah dikirim (opsional, bisa juga disimpan)
        setTimeout(() => {
          [job1Path, job2Path, finalPath].forEach((file) => {
            fs.unlink(
              file,
              (err) => err && console.error(`Failed delete: ${file}`),
            );
          });
        }, 5000); // Tunggu 5 detik sebelum hapus
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "ERROR_GENERATE_PDF" });
  }
});

app.post("/print-invoice", async (req, res) => {
  try {
    const {
      token,
      invoiceId,
      agentId = "pc-admin-002",
      directPrint = true,
      name,
      printerName,
      paperSize = "A4",
    } = req.body; // ← Tambahkan parameter print (default true)

    console.log(
      `📨 Received print-invoice request: ${name}, print mode: ${directPrint ? "PRINT" : "ONLY PDF"}`,
    );

    const tempDir = path.join(__dirname, "temp");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const unique = `${invoiceId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const finalPath = path.join(tempDir, `invoice-${unique}.pdf`);

    // Download Cakrawala (via Laravel proxy)
    const invoiceUrl = `https://erwinzilla.com/api/cakrawala/invoices/${invoiceId}/pdf`;
    await downloadFile(invoiceUrl, finalPath, token);

    if (!fs.existsSync(finalPath)) {
      return res.status(500).json({ error: "PDF_NOT_FOUND" });
    }

    // ============ CEK MODE PRINT ============
    if (directPrint === true || directPrint === "true") {
      // Mode PRINT: kirim ke agent dan tunggu hasil print
      const agentSocket = agents.get(agentId);

      // Baca PDF dan konversi ke base64
      const pdfBuffer = fs.readFileSync(finalPath);
      const pdfBase64 = pdfBuffer.toString("base64");

      if (agentSocket) {
        // === CASE 1: AGENT ONLINE → LANGSUNG PRINT ===
        console.log(`✅ Agent ${agentId} online, printing immediately...`);

        const printInvoiceId = `${invoiceId}-${Date.now()}`;

        agentSocket.emit("print-command", {
          jobId: printInvoiceId,
          pdfBase64: pdfBase64,
          fileName: `${name}-${invoiceId}.pdf`,
        });

        const printPromise = new Promise((resolve, reject) => {
          pendingJobs.set(printInvoiceId, { resolve, reject });
          setTimeout(() => {
            if (pendingJobs.has(printInvoiceId)) {
              pendingJobs.delete(printInvoiceId);
              reject(new Error("Print timeout"));
            }
          }, 120000);
        });

        await printPromise;

        // Cleanup file
        fs.unlink(
          finalPath,
          (err) => err && console.error(`Failed delete: ${finalPath}`),
        );

        res.json({
          status: "success",
          message: "Printed immediately",
          mode: "direct",
        });
      } else {
        // === CASE 2: AGENT OFFLINE → MASUKKAN KE QUEUE ===
        console.log(`⚠️ Agent ${agentId} offline, adding to queue...`);

        // Simpan ke queue
        const queuedJob = printQueue.addJob({
          jobId: invoiceId,
          agentId: agentId,
          pdfBase64: pdfBase64,
          fileName: `${name}-${invoiceId}.pdf`,
          originalJobId: invoiceId,
          timestamp: Date.now(),
          printerName: printerName,
          paperSize: paperSize,
        });

        // Simpan PDF sementara (optional, kalau queue besar bisa simpan di disk)
        const queuedPdfPath = path.join(
          __dirname,
          `queued_${queuedJob.id}.pdf`,
        );
        fs.copyFileSync(finalPath, queuedPdfPath);
        queuedJob.pdfPath = queuedPdfPath;
        printQueue.updateJobStatus(queuedJob.id, "pending");

        // Cleanup temp files
        fs.unlink(
          finalPath,
          (err) => err && console.error(`Failed delete: ${finalPath}`),
        );

        res.json({
          status: "queued",
          message: `Agent offline, job added to queue (position: ${printQueue.queue.length})`,
          mode: "queued",
          queueId: queuedJob.id,
        });
      }
    } else {
      // Mode PDF ONLY: hanya mengembalikan file PDF (tidak print)
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename=${name}-${unique}.pdf`,
      );
      res.sendFile(finalPath, (err) => {
        if (err) {
          console.error("SendFile error:", err);
        }

        // Hapus file setelah dikirim (opsional, bisa juga disimpan)
        setTimeout(() => {
          fs.unlink(
            finalPath,
            (err) => err && console.error(`Failed delete: ${finalPath}`),
          );
        }, 5000); // Tunggu 5 detik sebelum hapus
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "ERROR_GENERATE_PDF" });
  }
});

// Endpoint lama: /print-loan (dimodifikasi)
app.post("/print-loan", async (req, res) => {
  try {
    const {
      token,
      loanId,
      agentId = "pc-admin-002",
      directPrint = true,
      printerName,
      paperSize = "A4",
    } = req.body; // ← Tambahkan parameter print

    console.log(
      `📨 Received print-loan request: ${loanId}, print mode: ${directPrint ? "PRINT" : "ONLY PDF"}`,
    );

    const tempDir = path.join(__dirname, "temp");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const unique = `${loanId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const finalPath = path.join(tempDir, `loan-${unique}.pdf`);

    // Generate Tornado PDF
    const loanUrl = `https://pts.erwinzilla.com/loan/${loanId}/print?token=${token}`;
    await generatePdf(loanUrl, finalPath, { width: "210mm", height: "633px" });

    if (!fs.existsSync(finalPath)) {
      return res.status(500).json({ error: "PDF_NOT_FOUND" });
    }

    // ============ CEK MODE PRINT ============
    if (directPrint === true || directPrint === "true") {
      // Mode PRINT
      const agentSocket = agents.get(agentId);

      const pdfBuffer = fs.readFileSync(finalPath);
      const pdfBase64 = pdfBuffer.toString("base64");

      if (agentSocket) {
        // === CASE 1: AGENT ONLINE → LANGSUNG PRINT ===
        console.log(`✅ Agent ${agentId} online, printing immediately...`);

        const printJobId = `loan-${loanId}-${Date.now()}`;

        agentSocket.emit("print-command", {
          jobId: printJobId,
          pdfBase64: pdfBase64,
          fileName: `loan-${loanId}.pdf`,
        });

        const printPromise = new Promise((resolve, reject) => {
          pendingJobs.set(printJobId, { resolve, reject });

          setTimeout(() => {
            if (pendingJobs.has(printJobId)) {
              pendingJobs.delete(printJobId);
              reject(new Error("Print timeout"));
            }
          }, 120000);
        });

        await printPromise;

        fs.unlink(
          finalPath,
          (err) => err && console.error(`Failed delete: ${finalPath}`),
        );

        res.json({
          status: "success",
          message: "Printed immediately",
          mode: "direct",
        });
      } else {
        // === CASE 2: AGENT OFFLINE → MASUKKAN KE QUEUE ===
        console.log(`⚠️ Agent ${agentId} offline, adding to queue...`);

        // Simpan ke queue
        const queuedJob = printQueue.addJob({
          jobId: loanId,
          agentId: agentId,
          pdfBase64: pdfBase64,
          fileName: `loan-${loanId}.pdf`,
          originalJobId: loanId,
          timestamp: Date.now(),
          printerName: printerName,
          paperSize: paperSize,
        });

        // Simpan PDF sementara (optional, kalau queue besar bisa simpan di disk)
        const queuedPdfPath = path.join(
          __dirname,
          `queued_${queuedJob.id}.pdf`,
        );
        fs.copyFileSync(finalPath, queuedPdfPath);
        queuedJob.pdfPath = queuedPdfPath;
        printQueue.updateJobStatus(queuedJob.id, "pending");

        fs.unlink(
          finalPath,
          (err) => err && console.error(`Failed delete: ${finalPath}`),
        );

        res.json({
          status: "queued",
          message: `Agent offline, job added to queue (position: ${printQueue.queue.length})`,
          mode: "queued",
          queueId: queuedJob.id,
        });
      }
    } else {
      // Mode PDF ONLY
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename=loan-${unique}.pdf`,
      );
      res.sendFile(finalPath, (err) => {
        if (err) console.error("SendFile error:", err);

        setTimeout(() => {
          fs.unlink(
            finalPath,
            (err) => err && console.error(`Failed delete: ${finalPath}`),
          );
        }, 5000);
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "ERROR_GENERATE_PDF" });
  }
});

// ============ ENDPOINT BARU UNTUK PRINT DARI ANDROID LANGSUNG ============
app.post("/api/print-pdf", async (req, res) => {
  try {
    const {
      pdfBase64,
      fileName,
      agentId = "pc-admin-002",
      token,
      directPrint = true,
      printerName,
      paperSize = "A4",
    } = req.body;

    // Validasi token sederhana (opsional)
    const VALID_TOKEN = process.env.API_TOKEN || "3501-mantap";
    if (token !== VALID_TOKEN) {
      return res.status(401).json({ error: "Invalid token" });
    }

    // Validasi input
    if (!pdfBase64) {
      return res.status(400).json({ error: "pdfBase64 is required" });
    }

    // Validasi format base64 (sederhana)
    if (!pdfBase64.match(/^[A-Za-z0-9+/=]+$/)) {
      return res.status(400).json({ error: "Invalid base64 format" });
    }

    console.log(
      `📨 Received print-pdf request: ${fileName}, print mode: ${directPrint ? "PRINT" : "ONLY RETURN"}`,
    );

    // Simpan PDF sementara (opsional, untuk keperluan queue)
    let tempPdfPath = null;
    if (directPrint === true || directPrint === "true") {
      // Hanya simpan ke disk jika akan di-print (untuk queue)
      const tempDir = path.join(__dirname, "temp");
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

      const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      tempPdfPath = path.join(tempDir, `android-pdf-${unique}.pdf`);

      // Konversi base64 ke buffer dan simpan
      const pdfBuffer = Buffer.from(pdfBase64, "base64");
      fs.writeFileSync(tempPdfPath, pdfBuffer);
    }

    // ============ CEK MODE PRINT ============
    if (directPrint === true || directPrint === "true") {
      // Mode PRINT: kirim ke agent atau queue
      const agentSocket = agents.get(agentId);

      if (agentSocket) {
        // === CASE 1: AGENT ONLINE → LANGSUNG PRINT ===
        console.log(`✅ Agent ${agentId} online, printing immediately...`);

        const jobId = `android-${Date.now()}-${Math.random().toString(36).slice(4)}`;

        agentSocket.emit("print-command", {
          jobId: jobId,
          pdfBase64: pdfBase64,
          fileName: fileName || "document.pdf",
          printerName: printerName,
          paperSize: paperSize,
        });

        const printPromise = new Promise((resolve, reject) => {
          pendingJobs.set(jobId, { resolve, reject });
          setTimeout(() => {
            if (pendingJobs.has(jobId)) {
              pendingJobs.delete(jobId);
              reject(new Error("Print timeout (120 seconds)"));
            }
          }, 120000);
        });

        await printPromise;

        // Cleanup temp file jika ada
        if (tempPdfPath && fs.existsSync(tempPdfPath)) {
          fs.unlink(
            tempPdfPath,
            (err) => err && console.error(`Failed delete: ${tempPdfPath}`),
          );
        }

        res.json({
          success: true,
          message: "Print job sent successfully",
          mode: "direct",
          jobId: jobId,
        });
      } else {
        // === CASE 2: AGENT OFFLINE → MASUKKAN KE QUEUE ===
        console.log(`⚠️ Agent ${agentId} offline, adding to queue...`);

        // Simpan ke queue
        const queuedJob = printQueue.addJob({
          jobId: `android-${Date.now()}`,
          agentId: agentId,
          pdfBase64: pdfBase64,
          fileName: fileName || "document.pdf",
          originalJobId: `android-${Date.now()}`,
          timestamp: Date.now(),
          type: "android-pdf",
          printerName: printerName,
          paperSize: paperSize,
        });

        // Simpan PDF ke disk untuk queue
        if (tempPdfPath && fs.existsSync(tempPdfPath)) {
          queuedJob.pdfPath = tempPdfPath;
          printQueue.updateJobStatus(queuedJob.id, "pending");
        } else {
          // Fallback: simpan dari base64 lagi
          const queuePdfPath = path.join(
            __dirname,
            `queued_${queuedJob.id}.pdf`,
          );
          const pdfBuffer = Buffer.from(pdfBase64, "base64");
          fs.writeFileSync(queuePdfPath, pdfBuffer);
          queuedJob.pdfPath = queuePdfPath;
          printQueue.updateJobStatus(queuedJob.id, "pending");
        }

        res.json({
          success: true,
          status: "queued",
          message: `Printer agent offline, job added to queue (position: ${printQueue.queue.filter((j) => j.status === "pending").length})`,
          mode: "queued",
          queueId: queuedJob.id,
          agentId: agentId,
        });
      }
    } else {
      // === MODE PDF ONLY: KEMBALIKAN PDF (TIDAK PRINT) ===
      console.log(`📄 PDF Only mode, returning PDF for: ${fileName}`);

      // Konversi base64 ke buffer
      const pdfBuffer = Buffer.from(pdfBase64, "base64");

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename=${fileName || "document.pdf"}`,
      );
      res.setHeader("Content-Length", pdfBuffer.length);
      res.send(pdfBuffer);

      // Tidak perlu cleanup karena tidak menyimpan file
    }
  } catch (err) {
    console.error("Error in /api/print-pdf:", err);
    res.status(500).json({
      error: err.message || "Internal server error",
      success: false,
    });
  }
});

// ============ SOCKET.IO UNTUK AGENT (PC ADMIN) ============
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Agent register (dari PC Admin)
  socket.on("agent-register", (data) => {
    const { agentId, printerName, password } = data;

    // Validasi password (opsional)
    const AGENT_PASSWORD = process.env.AGENT_PASSWORD || "agentPassword789";
    if (password !== AGENT_PASSWORD) {
      socket.emit("error", "Invalid agent password");
      socket.disconnect();
      return;
    }

    // Simpan agent
    agents.set(agentId, socket);
    socket.agentId = agentId;
    socket.printerName = printerName;

    console.log(`✅ Agent registered: ${agentId} (Printer: ${printerName})`);
    socket.emit("registered", { status: "ok", agentId });

    // ============ PROSES QUEUE UNTUK AGENT INI ============
    console.log(`📋 Checking queue for agent: ${agentId}`);
    printQueue.processQueueForAgent(agentId, socket, pendingJobs);
  });

  // Agent report print success
  socket.on("print-success", (data) => {
    const { jobId } = data;
    console.log(`✅ Print success for job ${jobId}`);

    if (pendingJobs.has(jobId)) {
      const { resolve } = pendingJobs.get(jobId);
      resolve();
      pendingJobs.delete(jobId);
    }
  });

  // Agent report print failed - FIXED: pake => bukan (
  socket.on("print-failed", (data) => {
    const { jobId, error } = data;
    console.log(`❌ Print failed for job ${jobId}: ${error}`);

    if (pendingJobs.has(jobId)) {
      const { reject } = pendingJobs.get(jobId);
      reject(new Error(error));
      pendingJobs.delete(jobId);
    }
  });

  // Agent disconnect
  socket.on("disconnect", () => {
    if (socket.agentId) {
      console.log(`⚠️ Agent disconnected: ${socket.agentId}`);
      agents.delete(socket.agentId);
    }
  });
});

// ============ HEALTH CHECK ============
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    agents: Array.from(agents.keys()),
    agentsCount: agents.size,
    pendingJobs: pendingJobs.size,
    uptime: process.uptime(),
  });
});

// ============ ENDPOINT UNTUK CEK QUEUE STATUS ============
app.get("/queue/status", (req, res) => {
  res.json({
    totalQueued: printQueue.queue.length,
    pendingJobs: printQueue.queue.filter((j) => j.status === "pending").length,
    processingJobs: printQueue.queue.filter((j) => j.status === "processing")
      .length,
    completedJobs: printQueue.queue.filter((j) => j.status === "completed")
      .length,
    failedJobs: printQueue.queue.filter((j) => j.status === "failed").length,
    queue: printQueue.queue.map((j) => ({
      id: j.id,
      status: j.status,
      createdAt: j.createdAt,
      agentId: j.agentId,
      fileName: j.fileName,
    })),
  });
});

// ============ ENDPOINT UNTUK CANCEL QUEUE ============
app.delete("/queue/cancel/:jobId", (req, res) => {
  const { jobId } = req.params;
  const job = printQueue.queue.find((j) => j.id === jobId);

  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  if (job.status !== "pending") {
    return res
      .status(400)
      .json({ error: `Cannot cancel job with status: ${job.status}` });
  }

  printQueue.removeJob(jobId);

  // Hapus file PDF jika ada
  if (job.pdfPath && fs.existsSync(job.pdfPath)) {
    fs.unlinkSync(job.pdfPath);
  }

  res.json({ success: true, message: `Job ${jobId} cancelled` });
});

// Endpoint untuk retry job yang failed
app.post("/queue/retry/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;
    const { agentId } = req.body;

    const job = printQueue.queue.find((j) => j.id === jobId);

    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    if (job.status !== "failed") {
      return res
        .status(400)
        .json({ error: `Cannot retry job with status: ${job.status}` });
    }

    // Reset status
    printQueue.updateJobStatus(jobId, "pending");

    // Cek apakah agent online
    const agentSocket = agents.get(agentId ?? job.agentId ?? "pc-admin-002");

    if (agentSocket) {
      // Langsung proses ulang
      agentSocket.emit("print-command", {
        jobId: `${job.jobId}-retry-${Date.now()}`,
        pdfBase64: job.pdfBase64,
        fileName: job.fileName,
        printerName: job.printerName,
        paperSize: job.paperSize,
      });

      const printPromise = new Promise((resolve, reject) => {
        const retryJobId = `${job.jobId}-retry-${Date.now()}`;
        pendingJobs.set(retryJobId, { resolve, reject });
        setTimeout(() => {
          if (pendingJobs.has(retryJobId)) {
            pendingJobs.delete(retryJobId);
            reject(new Error("Retry print timeout"));
          }
        }, 30000);
      });

      await printPromise;

      res.json({
        success: true,
        message: "Job retried successfully",
        mode: "direct",
      });
    } else {
      res.json({
        success: true,
        message: "Job added to queue for retry",
        mode: "queued",
        queueId: jobId,
      });
    }
  } catch (err) {
    console.error("Error retrying job:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============ START SERVER ============
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════╗
║     PRINT SERVICE WITH PRINTER AGENT READY         ║
╠════════════════════════════════════════════════════╣
║  🖨️  HTTP Server: http://localhost:${PORT}         ║
║  📡 Socket.IO:  ws://localhost:${PORT}             ║
║  📊 Health:     http://localhost:${PORT}/health    ║
╠════════════════════════════════════════════════════╣
║  Endpoints:                                        ║
║  POST /print-job     (existing, with print)        ║
║  POST /print-invoice (existing, with print)        ║
║  POST /print-loan    (existing, with print)        ║
║  POST /api/print-pdf (new, for Android)            ║
╚════════════════════════════════════════════════════╝
    `);
});
