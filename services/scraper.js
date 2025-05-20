const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const pLimit = require('p-limit').default;
const fs = require("fs");
const path = require("path");
const xlsx = require("xlsx");
const Doctor = require("../models/Doctor");
const { Console } = require("console");

puppeteer.use(StealthPlugin());

// Main scraping function
const scrapeDoctors = async (searchUrl) => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.goto(searchUrl, { waitUntil: "domcontentloaded" });

    // Get total pages
    const totalPages = await page.evaluate(() => {
      const text = document.querySelector(".page-numbers__Label-sc-138ov1k-8")?.innerText || "";
      return parseInt(text.match(/Page\s+\d+\s+of\s+(\d+)/i)?.[1] || 1);
    });
    await page.close();

    // Process all pages with concurrency control
    const limit = pLimit(1); // Optimal concurrency level
    const pagePromises = Array.from({ length: totalPages }, (_, i) => 
      limit(() => scrapeDoctorPage(browser, i + 1, searchUrl))
    );

    const results = await Promise.all(pagePromises);
    return results.flat();
  } finally {
    await browser.close();
  }
};

// Scrape a single page of doctor listings
const scrapeDoctorPage = async (browser, pageNum, baseUrl) => {
  const page = await browser.newPage();
  try {
    await page.setRequestInterception(true);
    page.on('request', req => {
      ['image', 'stylesheet', 'font', 'media'].includes(req.resourceType()) 
        ? req.abort() 
        : req.continue();
    });

    await page.goto(`${baseUrl}&page_num=${pageNum}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    return await page.evaluate(() => {
      const professionals = [];
      document.querySelectorAll('div.DetailCardDoctor__TitleWrapper-dno04z-6.htJfNr').forEach(div => {
        const anchor = div.querySelector('a');
        if (!anchor) return;
        
        const href = anchor.getAttribute('href');
        const h2 = anchor.querySelector('h2');
        if (!h2) return;
        
        professionals.push({
          name: h2.textContent
            .trim()
            .replace(/\s+/g, ' ')
            .replace(/\s?<!--.*?-->\s?/g, ' '),
          profileUrl: `https://health.usnews.com${href}`
        });
      });
      return professionals;
    });
  } finally {
    await page.close();
  }
};

// Scrape individual doctor details
const scrapeDoctorDetails = async (url) => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await page.waitForSelector(".Hero__TitleWrapper-sc-1lw4wit-6", { timeout: 10000 });

    return await page.evaluate(() => {
      const getText = (selector) => document.querySelector(selector)?.textContent.trim() || null;
      const getList = (selector) => Array.from(document.querySelectorAll(selector)).map(el => el.textContent.trim());

      // Extract basic info
      const name = getText(".Hero__Name-sc-1lw4wit-4")?.replace(/\s+/g, " ");
      const degree = document.querySelector(".Hero__Name-sc-1lw4wit-4 span")?.textContent.trim();
      const location = getText(".Hero__Address-sc-1lw4wit-29");
      const phone = getText('a[href^="tel:"]');
      const specialty = getText(".Specialties__SpecialtyName-mzebq4-4");
      const subSpecialtiy = getList(".Specialties__Subspecialty-mzebq4-3");

      // Extract education and certifications
      const certifications = [];
      const licensures = [];
      document.querySelectorAll(".mb4, .EducationAndExperience__Item-dbww3o-0").forEach(div => {
        const org = div.querySelector(".kdaQRj")?.textContent.trim();
        const details = div.querySelector(".cXIEbH")?.textContent.trim();
        if (!org || !details) return;

        if (org.includes("Board") || details.includes("Certified")) {
          certifications.push({
            organization: org,
            specialty: details.replace("Certified in", "").trim()
          });
        } else if (org.includes("License")) {
          licensures.push({
            type: org,
            status: details.replace("Active through", "").trim()
          });
        }
      });

      // Extract publications
      const publications = [];
      document.querySelectorAll(".mb4").forEach(div => {
        const pub = div.querySelector(".kdaQRj")?.textContent.trim();
        const author = div.querySelector(".cXIEbH")?.textContent.trim();
        if (pub && author) publications.push({ publication: pub, author });
      });

      // Find medical school
      let medicalSchool = null;
      document.querySelectorAll(".EducationAndExperience__Item-dbww3o-0").forEach(item => {
        const desc = item.querySelector(".cXIEbH")?.textContent;
        if (desc?.includes("Medical School")) {
          medicalSchool = item.querySelector(".kdaQRj")?.textContent;
        }
      });

      return {
        name,
        degree,
        specialty,
        subSpecialtiy,
        location,
        phone,
        certifications,
        license: licensures,
        publications,
        totalPublication: publications.length,
        medicalSchool,
        scrapedAt: new Date().toISOString()
      };
    });
  } finally {
    await browser.close();
  }
};

// Process Excel files and scrape all doctors
const processExcelFiles = async () => {
  const FOLDER_PATH = "./excel_files";
  const PROCESSED_FOLDER_PATH = "./processed_excel_files";

  // Ensure processed folder exists
  if (!fs.existsSync(PROCESSED_FOLDER_PATH)) {
    fs.mkdirSync(PROCESSED_FOLDER_PATH);
  }

  const files = fs.readdirSync(FOLDER_PATH).filter(f => f.endsWith(".xlsx") || f.endsWith(".xls"));

  if (files.length === 0) {
    console.log("No Excel files found");
    return [];
  }

  let urlArray = [];
  for (const file of files) {
    const filePath = path.join(FOLDER_PATH, file);
    const workbook = xlsx.readFile(filePath);
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
    urlArray.push(...data.map(row => ({ url: row.URL, searchUrl: row.searchURL })));

    try {
      fs.renameSync(filePath, path.join(PROCESSED_FOLDER_PATH, file));
    } catch (err) {
      console.error(`❌ Failed to move file "${file}": ${err.message}`);
    }
  }

  // Get unique URLs with p-limit concurrency
  const limit = pLimit(1);
  const uniqueUrls = [...new Set(urlArray.filter(u => u.url).map(u => u.url))];
  const searchUrls = urlArray.filter(u => u.searchUrl).map(u => u.searchUrl);

  const doctorLinks = (await Promise.all(
    searchUrls.map(url => limit(() => scrapeDoctors(url)))
  )).flat().map(d => ({ url: d.profileUrl }));

  const allUrls = [...uniqueUrls, ...doctorLinks.map(d => d.url)];
  console.log('------------------',allUrls)
  const uniqueDoctorUrls = [...new Set(allUrls)].map(url => ({ url }));
  console.log(uniqueDoctorUrls.length)
  const res = []
  const results = await Promise.all(
    uniqueDoctorUrls.map(doctor =>
      limit(() =>
        scrapeDoctorDetails(doctor.url)
          .then(data => {
            res.push(data)
            // Doctor.upsert(data, { returning: true })
          })
          .catch(error => ({
            status: "error",
            url: doctor.url,
            error: error.message
          }))
      )
    )
  );
  console.log('------------------res',res.length)

  return {
    total: uniqueDoctorUrls.length,
    success: results.filter(r => !r.status).length,
    errors: results.filter(r => r.status === "error")
  };
};

// processExcelFiles().then(()=>{
//   console.log('processed')
// })
// .catch(e=>{
//   console.error(e)
// })
module.exports = { scrapeDoctors, processExcelFiles, scrapeDoctorDetails };