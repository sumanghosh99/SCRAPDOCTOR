const express = require("express");
const sequelize = require("./config/database");
const doctorsRouter = require("./routes/doctors");
const cron = require("node-cron");
const { processExcelFiles } = require("./services/scraper");

const app = express();
const PORT = 3000;

// Test database connection
sequelize
  .authenticate()
  .then(() => console.log("✅ Connected to PostgreSQL"))
  .catch((err) => console.error("❌ Connection error:", err));

// Sync models
sequelize
  .sync()
  .then(() => console.log("✅ Database synced"))
  .catch((err) => console.error("❌ Sync error:", err));

// Middleware
app.use(express.json());

// Routes
// app.use("/api/doctors", doctorsRouter);

cron.schedule("0 * * * *", async () => {
  console.log(
    `[${new Date().toISOString()}] Cron job started: Checking for Excel files...`
  );
  try {
    const result = await processExcelFiles();
    console.log(
      `[${new Date().toISOString()}] Cron job completed:`,
      result || { message: "No files processed" }
    );
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Cron job failed: ${error.message}`
    );
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
