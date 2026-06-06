// queue-manager.js
const fs = require("fs");
const path = require("path");

class PrintQueue {
  constructor() {
    this.queueFile = path.join(__dirname, "print-queue.json");
    this.queue = [];
    this.loadQueue();
  }

  // Load queue dari file (persistent)
  loadQueue() {
    if (fs.existsSync(this.queueFile)) {
      try {
        this.queue = JSON.parse(fs.readFileSync(this.queueFile, "utf8"));
        console.log(`📋 Loaded ${this.queue.length} pending jobs from queue`);
      } catch (err) {
        console.error("Failed to load queue:", err);
        this.queue = [];
      }
    }
  }

  // Save queue ke file
  saveQueue() {
    fs.writeFileSync(this.queueFile, JSON.stringify(this.queue, null, 2));
  }

  // Tambah job ke queue
  addJob(job) {
    const queueJob = {
      id: `${job.jobId}-${Date.now()}`,
      ...job,
      createdAt: new Date().toISOString(),
      status: "pending",
    };
    this.queue.push(queueJob);
    this.saveQueue();
    console.log(
      `📥 Job added to queue: ${queueJob.id}, total queue: ${this.queue.length}`,
    );
    return queueJob;
  }

  // Ambil semua job untuk agent tertentu
  getJobsForAgent(agentId) {
    return this.queue.filter(
      (job) => job.agentId === agentId && job.status === "pending",
    );
  }

  // Update status job
  updateJobStatus(jobId, status, error = null) {
    const job = this.queue.find((j) => j.id === jobId);
    if (job) {
      job.status = status;
      if (error) job.error = error;
      if (status === "completed" || status === "failed") {
        job.completedAt = new Date().toISOString();
      }
      this.saveQueue();
    }
  }

  // Hapus job dari queue (jika sudah selesai/gagal permanen)
  removeJob(jobId) {
    this.queue = this.queue.filter((j) => j.id !== jobId);
    this.saveQueue();
  }

  // Proses queue ketika agent online
  async processQueueForAgent(agentId, agentSocket, pendingJobsMap) {
    const pendingJobs = this.getJobsForAgent(agentId);

    if (pendingJobs.length === 0) {
      console.log(`📭 No pending jobs for agent: ${agentId}`);
      return;
    }

    console.log(
      `📤 Processing ${pendingJobs.length} pending jobs for ${agentId}`,
    );

    for (const job of pendingJobs) {
      console.log(`🔄 Processing queued job: ${job.id}`);

      // Update status ke processing
      this.updateJobStatus(job.id, "processing");

      // Kirim ke agent
      agentSocket.emit("print-command", {
        jobId: job.id,
        pdfBase64: job.pdfBase64,
        fileName: job.fileName,
      });

      // Simpan promise untuk response
      const printPromise = new Promise((resolve, reject) => {
        pendingJobsMap.set(job.id, {
          resolve,
          reject,
          queueJob: true,
          originalJobId: job.originalJobId,
        });

        // Timeout 30 detik
        setTimeout(() => {
          if (pendingJobsMap.has(job.id)) {
            pendingJobsMap.delete(job.id);
            reject(new Error("Print timeout"));
          }
        }, 30000);
      });

      try {
        await printPromise;
        // Print sukses
        this.updateJobStatus(job.id, "completed");
        console.log(`✅ Queued job completed: ${job.id}`);
      } catch (error) {
        // Print gagal
        this.updateJobStatus(job.id, "failed", error.message);
        console.log(`❌ Queued job failed: ${job.id} - ${error.message}`);
      }
    }
  }
}

module.exports = { PrintQueue };
