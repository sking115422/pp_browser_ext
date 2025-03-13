const fs = require('fs');
const path = require('path');

function csvToSet(filePath) {
  return new Promise((resolve, reject) => {
    const absolutePath = path.resolve(filePath); // Convert to absolute path

    fs.readFile(absolutePath, 'utf8', (err, data) => {
      if (err) {
        reject(err); // Handle file read error
        return;
      }

      const startProcessing = Date.now(); // Start timing for processing
      const lines = data.split('\n'); // Split into lines
      const dataSet = new Set();

      for (let line of lines) {
        let values = line.split(',').map((value) => value.trim()); // Trim spaces

        if (values.length > 1 && values[1] !== '') {
          // Ensure the second column exists
          dataSet.add(values[1]); // Add second column (domain) to Set
        }
      }

      const processingTime = Date.now() - startProcessing; // End processing timing
      console.log(`⏳ Time to process CSV into Set: ${processingTime} ms`);

      resolve(dataSet);
    });
  });
}

// Example Usage:
const filePath = './public/tranco.csv'; // Path to your CSV file
const domainToCheck = 'google.com'; // Domain you want to check

const startLoading = Date.now(); // Start timing for loading

csvToSet(filePath)
  .then((dataSet) => {
    const loadTime = Date.now() - startLoading; // End loading timing
    console.log(`✅ Total Unique Domains: ${dataSet.size}`);
    console.log(`⏳ Time to load CSV file: ${loadTime} ms`);

    // Measure lookup time
    const startLookup = Date.now();
    const exists = dataSet.has(domainToCheck);
    const lookupTime = Date.now() - startLookup;

    console.log(
      `🔍 Checking if '${domainToCheck}' exists: ${exists} (Time taken: ${lookupTime} ms)`,
    );
  })
  .catch((err) => console.error('❌ Error:', err));
