import express from "express";
import { scrapeDoctors, processExcelFiles } from "../services/scraper.js";

const router = express.Router();

router.get("/scrape", async (req, res) => {
  try {
    const result = await processExcelFiles();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
