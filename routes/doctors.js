const express = require("express");
const router = express.Router();
const { scrapeDoctors, processExcelFiles } = require("../services/scraper");

router.get("/scrape", async (req, res) => {
  try {
    const result = await processExcelFiles();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
