const puppeteer = require("puppeteer");
// const cron = require('node-cron');
const fs = require("fs");
const path = require("path");
const xlsx = require("xlsx");
const Doctor = require("../models/Doctor");

const processExcelFiles = async () => {
  console.log(
    `[${new Date().toISOString()}] Starting Excel file processing...`
  );

  const FOLDER_PATH = "./excel_files";
  const PROCESSED_FOLDER_PATH = "./processed_excel_files";
  //   try {
  // Read all files in the directory
  const files = fs.readdirSync(FOLDER_PATH);

  // Filter for Excel files (.xlsx, .xls)
  const excelFiles = files.filter(
    (file) => file.endsWith(".xlsx") || file.endsWith(".xls")
  );

  if (excelFiles.length === 0) {
    console.log("No Excel files found in the directory.");
    return;
  }

  let urlArray = [];

  // Process each Excel file
  for (const file of excelFiles) {
    const filePath = path.join(FOLDER_PATH, file);
    console.log(`Processing file: ${file}`);

    // Read the Excel file
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0]; // Get first sheet
    const worksheet = workbook.Sheets[sheetName];

    // Convert to JSON
    const data = xlsx.utils.sheet_to_json(worksheet);

    // Extract URLs (assuming columns are named 'URL' and 'searchURL')
    const urls = data.map((row) => ({
      url: row.URL,
      searchUrl: row.searchURL,
    }));

    urlArray.push(...urls);
  }

  const destinationPath = path.join(PROCESSED_FOLDER_PATH, file);
  try {
    fs.renameSync(filePath, destinationPath);
    console.log(`Moved file ${file} to ${PROCESSED_FOLDER_PATH}`);
  } catch (error) {
    console.error(`Error moving file ${file}: ${error.message}`);
  }

  let allDoctorUrls = [];

  for (const item of urlArray) {
    // If direct URL exists, add it
    if (item.url) {
      allDoctorUrls.push({ url: item.url });
    }

    // If search URL exists, extract doctor URLs and add them
    if (item.searchUrl) {
      const urlsFromSearch = await scrapeDoctors();
      const wrapped = urlsFromSearch.map((url) => ({ url: url.profileUrl }));
      if (wrapped) allDoctorUrls = allDoctorUrls.concat(wrapped);
    }
  }

  const uniqueDoctorUrls = getUniqueDoctorUrls(allDoctorUrls);

  const batchSize = 2; // Adjust based on your system's capacity and rate limits
  const result = await processInBatches(
    uniqueDoctorUrls,
    batchSize,
    scrapeDoctorDetails,
    Doctor
  );

  return result;
};

const scrapeDoctorDetails = async (url) => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
  );

  try {
    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // Wait for the main content to load
    await page.waitForSelector(".Hero__TitleWrapper-sc-1lw4wit-6", {
      timeout: 10000,
    });

    // Extract doctor details with corrected selectors
    const doctorData = await page.evaluate(async () => {
      const getText = (selector) => {
        const element = document.querySelector(selector);
        return element ? element.textContent.trim() : null;
      };

      const getListItems = (selector) => {
        const items = Array.from(document.querySelectorAll(selector));
        return items.map((item) => item.textContent.trim());
      };

      // Main doctor information
      const nameElement = document.querySelector(".Hero__Name-sc-1lw4wit-4");
      const name = nameElement
        ? nameElement.textContent.replace(/\s+/g, " ").trim()
        : null;

      // These selectors need to be verified from the actual page
      //   const specialty = getText(".Hero__SpecialtyWrapper-sc-1lw4wit-11"); // Need actual class
      //   const subSpecialtiy = getText(
      //     ".Heading-sc-1w5xk2o-0 Specialties__Subspecialty-mzebq4-3"
      //   );
      const location = getText(".Hero__Address-sc-1lw4wit-29"); // Need actual class
      const phone = getText('a[href^="tel:"]');

      // Hospital affiliation might use different selectors
      const hospitalAffiliation = getText(".Affiliation__Wrapper-xxxxxx a"); // Need actual class

      // Get all sections - these selectors need verification
      const about = getText(".AboutSection p");
      const educationItems = getListItems(".EducationSection li");
      const experienceItems = getListItems(".ExperienceSection li");
      const certificationItems = getListItems(".CertificationsSection li");
      // const certifications=await scrapeCertifications(document)
      const certifications = [];
      const licensures = [];
      document
        .querySelectorAll(".mb4, .EducationAndExperience__Item-dbww3o-0")
        .forEach((div) => {
          const orgElement = div.querySelector(".kdaQRj");
          const detailElement = div.querySelector(".cXIEbH");

          if (orgElement && detailElement) {
            const organization = orgElement.textContent.trim();
            const details = detailElement.textContent.trim();

            // Determine if it's a certification or licensure
            if (
              organization.includes("Board") ||
              details.includes("Certified")
            ) {
              certifications.push({
                organization,
                specialty: details.replace("Certified in", "").trim(),
              });
            } else if (organization.includes("License")) {
              licensures.push({
                type: organization.trim(),
                status: details.replace("Active through", "").trim(),
              });
            }
          }
        });

      const items = [];
      const publicationDivs = document.querySelectorAll(".mb4");

      publicationDivs.forEach((div) => {
        const publication = div.querySelector(".kdaQRj")?.textContent.trim();
        const author = div.querySelector(".cXIEbH")?.textContent.trim();

        if (publication && author) {
          items.push({
            publication,
            author,
          });
        }
      });

      const specialtyElement = document.querySelector(
        ".Specialties__SpecialtyName-mzebq4-4"
      );
      let specialty = specialtyElement
        ? specialtyElement.textContent.trim()
        : null;

      const subspecialtyElements = document.querySelectorAll(
        ".Specialties__Subspecialty-mzebq4-3"
      );
      let subSpecialtiy = Array.from(subspecialtyElements).map((el) =>
        el.textContent.trim()
      );

      const degree = document
        .querySelector(".Hero__Name-sc-1lw4wit-4 span")
        .textContent.trim();

      let medicalSchool = null;
      const medicalSchoolItems = document.querySelectorAll(
        ".EducationAndExperience__Item-dbww3o-0"
      );
      for (const item of medicalSchoolItems) {
        const description = item.querySelector(".cXIEbH")?.textContent;
        if (description && description.includes("Medical School")) {
          medicalSchool = item.querySelector(".kdaQRj")?.textContent;
          break;
        }
      }

      return {
        name,
        degree,
        specialty,
        subSpecialtiy,
        location,
        phone,
        certifications,
        license: licensures,
        publications: items,
        totalPublication: items.length,
        medicalSchool,
        scrapedAt: new Date().toISOString(),
      };
    });

    return doctorData;
  } catch (error) {
    console.error("Error during scraping:", error);
    throw error;
  } finally {
    await browser.close();
  }
};

const scrapeDoctors = async (url) => {
  let browser;
  try {
    // Launch Puppeteer browser
    browser = await puppeteer.launch({
      headless: true, // Run in headless mode for efficiency
      args: ["--no-sandbox", "--disable-setuid-sandbox"], // Required for some environments
    });
    const page = await browser.newPage();

    // Set User-Agent to mimic a real browser
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    );

    // Navigate to the target URL
    // const url =
    //   "https://health.usnews.com/doctors/search?distance=25&location=CA&specialty=Vascular%20Surgery&sort=name-asc";
    await page.goto(url, { waitUntil: "networkidle2" }); // Wait until page is fully loaded

    // Extract doctor links using page.evaluate
    const doctorLinks = await page.evaluate(() => {
      const links = [];
      // Select all <a> tags with href starting with "/doctors/"
      const anchorElements = document.querySelectorAll('a[href^="/doctors/"]');
      anchorElements.forEach((element) => {
        const href = element.getAttribute("href");
        // Match hrefs like "/doctors/[name]-[id]"
        if (href && href.match(/\/doctors\/[a-z-]+\-\d+/)) {
          const profileUrl = `https://health.usnews.com${href}`;
          // Extract name from href (remove the ID part)
          const name = href
            .split("/")[2]
            .split("-")
            .slice(0, -1)
            .join(" ")
            .replace(/(^\w|\s\w)/g, (m) => m.toUpperCase()); // Capitalize name
          links.push({ name, profileUrl });
        }
      });
      return links;
    });

    return doctorLinks;
  } catch (error) {
    console.error("❌ Scraping error:", error.message);
    throw error;
  } finally {
    if (browser) await browser.close();
  }
};

const getUniqueDoctorUrls = (urlObjects) => {
  const seen = {};

  for (const obj of urlObjects) {
    if (!seen[obj.url]) {
      seen[obj.url] = obj;
    }
  }

  // Return the unique values
  return Object.values(seen);
};

const processInBatches = async (urls, batchSize) => {
  const results = [];

  // Split URLs into batches
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    console.log(
      `Processing batch ${i / batchSize + 1} of ${Math.ceil(
        urls.length / batchSize
      )}`
    );

    // Process each batch concurrently
    const batchPromises = batch.map((url) =>
      scrapeDoctorDetails(url.url)
        .then(async (doctorData) => {
          try {
            // Store successful scrapes in database
            const [doctor] = await Doctor.upsert(
              {
                ...doctorData,
                // sourceUrl: doctorData.sourceUrl ? doctorData.sourceUrl : null,
              },
              {
                returning: true,
              }
            );
            return { status: "success", data: doctor, url };
          } catch (error) {
            return {
              status: "error",
              url,
              error: error.message,
              stack:
                process.env.NODE_ENV === "development"
                  ? error.stack
                  : undefined,
            };
          }
        })
        .catch((error) => ({
          status: "error",
          url,
          error: error.message,
          stack:
            process.env.NODE_ENV === "development" ? error.stack : undefined,
        }))
    );

    // Wait for the current batch to complete before starting the next
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  // Separate successes and failures for response
  const successes = results.filter((r) => r.status === "success");
  const failures = results.filter((r) => r.status === "error");

  return {
    message: `Processed ${urls.length} URLs`,
    successes: successes.length,
    failures: failures.length,
    results: {
      successes: successes.map((s) => ({
        url: s.url,
        id: s.data.id,
        name: s.data.name,
      })),
      failures: failures.map((f) => ({
        url: f.url,
        error: f.error,
      })),
    },
  };
};

module.exports = { scrapeDoctors, processExcelFiles, scrapeDoctorDetails };
