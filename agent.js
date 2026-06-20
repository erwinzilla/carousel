const { io } = require("socket.io-client");
const print = require("pdf-to-printer");
const fs = require("fs");
const path = require("path");

// GANTI DENGAN IP VPS KAMU!
const VPS_URL = "http://31.56.56.146:22479"; // ← GANTI INI!
const AGENT_ID = "pc-admin-002";
const AGENT_PASSWORD = "agentPassword789";

const socket = io(VPS_URL, {
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
});

socket.on("connect", () => {
  console.log("✅ Terhubung ke VPS server");
  socket.emit("agent-register", {
    agentId: AGENT_ID,
    printerName: "\\\\DEPAN\\HP LaserJet Pro M402-M403 n-dne PCL 6" || "Default Printer",
    password: AGENT_PASSWORD,
  });
});

socket.on("registered", (data) => {
  console.log(`🎉 Agent terdaftar: ${data.agentId}`);
  console.log("🖨️ Siap menerima perintah print...");
});

socket.on("print-command", async (data) => {
  const { jobId, pdfBase64, fileName, printerName, paperSize } = data;
  const tempFile = path.join(__dirname, `temp_${jobId}.pdf`);

  try {
    // Log untuk debug
    console.log(`📨 Menerima job: ${fileName} (${jobId})`);

    // Cek apakah base64 valid
    if (!pdfBase64 || pdfBase64.length === 0) {
      throw new Error("PDF Base64 kosong");
    }

    // Simpan PDF
    const pdfBuffer = Buffer.from(pdfBase64, "base64");
    fs.writeFileSync(tempFile, pdfBuffer);
    console.log(`📄 PDF tersimpan: ${tempFile} (${pdfBuffer.length} bytes)`);

    // CEK PRINTER SEBELUM PRINT
    const printers = await print.getPrinters();
    console.log(
      `🖨️ Printer terdeteksi: ${printers.map((p) => p.name).join(", ")}`,
    );

    const defaultPrinter = printers.find((p) => p.isDefault);
    if (defaultPrinter) {
      console.log(`✅ Printer default: ${defaultPrinter.name}`);
    } else {
      console.log(`⚠️ TIDAK ADA PRINTER DEFAULT!`);
      if (printers.length > 0) {
        console.log(`📌 Akan menggunakan printer pertama: ${printers[0].name}`);
      } else {
        throw new Error("Tidak ada printer yang terinstall!");
      }
    }

    // Cetak
    await print.print(tempFile, {
      printer: printerName ?? "\\\\DEPAN\\HP LaserJet Pro M402-M403 n-dne PCL 6",
      paperSize: paperSize ?? "A4", // Ukuran kertas
      scale: "fit", // Sesuaikan halaman
      silent: true,
    });

    console.log(`✅ Print berhasil: ${jobId}`);

    socket.emit("print-success", { jobId });
    fs.unlinkSync(tempFile);
  } catch (error) {
    console.error(`❌ DETAIL ERROR:`, error);
    console.error(`Stack:`, error.stack);
    socket.emit("print-failed", { jobId, error: error.message });

    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
});

socket.on("error", (err) => {
  console.error("Socket error:", err);
});

socket.on("disconnect", () => {
  console.log("⚠️ Koneksi ke VPS terputus, mencoba reconnect...");
});

console.log(`
╔══════════════════════════════════════╗
║   PRINTER AGENT FOR WINDOWS          ║
║   Connecting to: ${VPS_URL}
║   Agent ID: ${AGENT_ID}
╚══════════════════════════════════════╝
`);
