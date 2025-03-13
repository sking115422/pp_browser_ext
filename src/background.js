// src/background.js

////// INITIALIZATION

import blockhash from 'blockhash-core';
import { parse } from 'tldts';
import { getHrTimestamp } from './utils';

// Global settings
const HASH_GRID_SIZE = 8;
const HAMMING_DIST_THOLD = 3;
const SCAN_INTERVAL = 5 * 1000;
const SAVE_INTERVAL = 30 * 1000;

// Global variables

let sessionStartTime = Date.now();
let scanStartTime = 0;
let pureAllInfStartTime = 0;
let scanId = null;

let ssDataUrlRaw = null;
let currentDomain = null;

let offscreenPort = null;
let trancoSet = new Set();
let logs = [];

function logMessage(message) {
  chrome.storage.local.get(
    ['mainToggleState', 'performanceToggleState'],
    (result) => {
      if (result.performanceToggleState) {
        let timestampedMessage = `[${new Date().toISOString()}] - ${message}`;
        logs.push(timestampedMessage);

        // Update storage with the full logs array.
        chrome.storage.local.set({ logs }, () => {
          if (chrome.runtime.lastError) {
            console.error('Error updating logs:', chrome.runtime.lastError);
          }
        });
        // console.log(timestampedMessage);
      }
    },
  );
}

function saveLogsToFile() {
  chrome.storage.local.get({ logs: [] }, (result) => {
    let logText = result.logs.join('\n');
    // Create a data URL from the log text
    let url = 'data:text/plain;charset=utf-8,' + encodeURIComponent(logText);

    chrome.downloads.download({
      url: url,
      filename: `${sessionStartTime}/logs/performance_${getHrTimestamp()}.txt`,
      saveAs: false,
    });

    // Clear logs after saving (optional)
    logs = [];
    chrome.storage.local.set({ logs: [] });
  });
}

// Initializing local data
const initLocalData = {
  dataUrl: null,
  mainToggleState: false,
  ssToggleState: false,
  performanceToggleState: true,
  backgroundInitialized: false,
  offscreenInitialized: false,
  resizedDataUrl: null,
  classification: null,
  method: null,
  infTime: null,
  ocrText: null,
  ocrTime: null,
  totalTime: null,
  phash: null,
  hammingDistance: null,
};

// Store the values in chrome.storage.local
chrome.storage.local.set(initLocalData, () => {
  console.log(
    '[Background] - ' + getHrTimestamp() + ' - Local storage initialized',
  );
});

// Tranco list init
function loadTrancoIntoMemory(filePath = './tranco_100k.csv') {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = function (event) {
      const startProcessing = Date.now();
      const text = event.target.result;
      const lines = text.split('\n');

      trancoSet.clear(); // Ensure we start fresh

      for (let line of lines) {
        let values = line.split(',').map((value) => value.trim());

        if (values.length > 1 && values[1] !== '') {
          // Store only the domain names
          trancoSet.add(values[1]);
        }
      }

      const processingTime = Date.now() - startProcessing;
      console.log(
        `[Background] - ${getHrTimestamp()} - Time to process CSV into Set: ${processingTime} ms`,
      );

      console.log(
        '[Background] - ' +
          getHrTimestamp() +
          ' - First 5 entries in Tranco Set:',
        [...trancoSet].slice(0, 5),
      );

      resolve(trancoSet.size); // Resolve with size of Set
    };

    reader.onerror = () => reject('Error reading the file.');

    // Fetch and read the CSV file
    fetch(chrome.runtime.getURL(filePath))
      .then((response) => response.blob())
      .then((blob) => reader.readAsText(blob))
      .catch((error) => reject(`Fetch Error: ${error}`));
  });
}

// Initialization for background
async function initBackground() {
  try {
    let initBackgroundStartTime = Date.now();
    // Creating offscreen doc
    let offscreenCreateStartTime = Date.now();
    await ensureOffscreen();
    let offscreenCreateTotalTime = Date.now() - offscreenCreateStartTime;
    console.log(
      `[Background] - ${getHrTimestamp()} - Offscreen doc created in ${offscreenCreateTotalTime} ms`,
    );
    logMessage(
      `[Background] - offscreen doc creation time: ${offscreenCreateTotalTime} ms`,
    );
    // Load Tranco list at extension startup
    let loadTrancoStartTime = Date.now();
    let size = await loadTrancoIntoMemory();
    let loadTrancoTotalTime = Date.now() - loadTrancoStartTime;
    console.log(
      `[Background] - ${getHrTimestamp()} - Tranco List Loaded (${size} domains) in ${loadTrancoTotalTime} ms`,
    );
    logMessage(
      `[Background] - tranco list load time: ${loadTrancoTotalTime} ms`,
    );
    chrome.storage.local.set({ backgroundInitialized: true });
    let initBackgroundTotalTime = Date.now() - initBackgroundStartTime;
    console.log(
      `[Background] - ${getHrTimestamp()} - Backgroung initialized in ${initBackgroundTotalTime} ms`,
    );
    logMessage(
      `[Background] - background init time: ${initBackgroundTotalTime} ms`,
    );
  } catch (error) {
    console.error(`[Background] - Error initializing background: ${error}`);
  }
}
initBackground();

// Setting up message passing ports for heavier and more frequent messaging
chrome.runtime.onConnect.addListener((port) => {
  console.log(
    `[Background] - ${getHrTimestamp()} - Connected to: ${port.name}`,
  );

  if (port.name === 'offscreenPort') {
    offscreenPort = port;

    port.onMessage.addListener((message) => {
      if (message.type === 'infResponse') {
        console.log(
          '[Background] - ' + getHrTimestamp() + ' - Received infResponse',
        );

        let pureAllInfTotalTime = Date.now() - pureAllInfStartTime;
        console.log(
          `[Background] - ${getHrTimestamp()} - Pure all inference completed in ${pureAllInfTotalTime} ms.`,
        );
        logMessage(
          `[Background] - pure all inference time: ${pureAllInfTotalTime} ms`,
        );

        const infData = {
          resizedDataUrl: message.data.resizedDataUrl, // For the screenshot <img>
          classification: message.data.classification + '_' + Date.now(),
          method: 'Model inference',
          infTime: message.data.infTime,
          ocrText: message.data.ocrText,
          ocrTime: message.data.ocrTime,
        };

        console.log(
          `[Background] - ${getHrTimestamp()} - Pure ONNX inference time: ${
            message.data.infTime
          } ms.`,
        );
        logMessage(
          `[Background] - pure onnx inference time: ${message.data.infTime} ms`,
        );
        console.log(
          `[Background] - ${getHrTimestamp()} - Pure OCR inference time ${
            message.data.ocrTime
          } ms.`,
        );
        logMessage(
          `[Background] - pure ocr inference time: ${message.data.ocrTime} ms`,
        );

        chrome.storage.local.set(infData, () => {
          console.log(
            '[Background] - ' +
              getHrTimestamp() +
              ' - Local storage updated with infResponse',
          );
        });
      }
      // Offscreen init feedback
      if (message.type === 'offscreenInit') {
        chrome.storage.local.set({ offscreenInitialized: true });
        console.log(
          `[Background] - ${getHrTimestamp()} - ONNX worker created in ${
            message.data.onnxInitTime
          } ms`,
        );
        logMessage(
          `[Background] - onnx worker creation time: ${message.data.onnxInitTime} ms`,
        );
        console.log(
          `[Background] - ${getHrTimestamp()} - Tokenizer initialized in ${
            message.data.tokenizerInitTime
          } ms`,
        );
        logMessage(
          `[Background] - tokenizer initialization time: ${message.data.tokenizerInitTime} ms`,
        );
        console.log(
          `[Background] - ${getHrTimestamp()} - OCR initialized in ${
            message.data.ocrInitTime
          } ms`,
        );
        logMessage(
          `[Background] - ocr initialization time: ${message.data.ocrInitTime} ms`,
        );
        console.log(
          `[Background] - ${getHrTimestamp()} - Offscreen initialized in ${
            message.data.offscreenInitTime
          } ms`,
        );
        logMessage(
          `[Background] - offscreen initialization time: ${message.data.offscreenInitTime} ms`,
        );
      }
    });

    port.onDisconnect.addListener(() => {
      console.log(
        '[Background] - ' + getHrTimestamp() + ' - Popup disconnected.',
      );
      offscreenPort = null;
    });
  }
});

// For light weight messaging
// Listening for message to restart webpage scanning
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'resumeScans') {
    console.log(
      '[Background] - ' +
        getHrTimestamp() +
        ' - Resuming scan interval upon user interaction with popup',
    );
    runScans();
  }
});

////// FUNCTIONS

async function saveScreenshot(dataUrl, baseDir, filename) {
  chrome.storage.local.get(
    ['mainToggleState', 'ssToggleState'],
    async (data) => {
      if (data.mainToggleState && data.ssToggleState) {
        if (!dataUrl) {
          dataUrl = await captureScreenshot();
        }
        fetch(dataUrl)
          .then((res) => res.blob())
          .then((blob) => {
            const reader = new FileReader();
            reader.onloadend = function () {
              const dataUrlResult = reader.result;
              const fullPath = `${baseDir}/${filename}.png`;
              chrome.downloads.download(
                {
                  url: dataUrlResult,
                  filename: fullPath, // Specifies the directory inside Downloads
                  saveAs: false, // Automatically saves without prompt
                },
                (downloadId) => {
                  if (chrome.runtime.lastError) {
                    console.error('Download error:', chrome.runtime.lastError);
                  } else {
                    console.log(
                      `[Background] - ${getHrTimestamp()} - Screenshot saved as: ${fullPath}`,
                    );
                  }
                },
              );
            };
            reader.readAsDataURL(blob);
          })
          .catch((error) => console.error('Error saving screenshot:', error));
      }
    },
  );
}

function injectContentScript() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs.length > 0 && tabs[0].id) {
      console.log(
        `[Background] - ${getHrTimestamp()} - Injecting content.js into tab: ${
          tabs[0].id
        }`,
      );
      chrome.scripting.executeScript(
        {
          target: { tabId: tabs[0].id },
          files: ['content.js'],
        },
        () => {
          // Pause the scanning interval once the content script is injected
          if (scanId) {
            clearInterval(scanId);
            console.log(
              `[Background] - ${getHrTimestamp()} - Scanning paused.`,
            );
          }
        },
      );
    }
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local') {
    // Injection content script if new malicious page is detected
    if (
      changes.classification &&
      changes.classification.newValue.split('_')[0] === 'malicious'
    ) {
      injectContentScript();
      let case23TotalTime = Date.now() - scanStartTime;

      chrome.storage.local.set({ totalTime: case23TotalTime });

      console.log(
        `[Background] - ${getHrTimestamp()} - Case 2 or 3 (phash = null | phash > thold) scan completed in ${case23TotalTime} ms.`,
      );
      logMessage(
        `[Background] - case 2 or 3 total time: ${case23TotalTime} ms`,
      );

      chrome.storage.local.get(
        ['phash', 'classification', 'currentDomain'],
        (result) => {
          saveScreenshot(
            ssDataUrlRaw,
            `${sessionStartTime}/${result.classification.split('_')[0]}`,
            `${currentDomain}_${result.phash}_${getHrTimestamp()}`,
          );
        },
      );
      return;
    }
  }
});

async function ensureOffscreen() {
  if (!chrome.offscreen) {
    console.warn(
      'chrome.offscreen API is not available. Offscreen inference will not work!',
    );
    return false;
  }
  try {
    const hasDocument = await chrome.offscreen.hasDocument();
    if (!hasDocument) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['WORKERS'],
        justification: 'Needed to run ONNX inference',
      });
      console.log(
        '[Background] - ' + getHrTimestamp() + ' - Offscreen document created.',
      );
    } else {
      console.log(
        '[Background] - ' +
          getHrTimestamp() +
          ' - Offscreen document already exists.',
      );
    }
    return true;
  } catch (err) {
    console.error(
      '[Background] - ' +
        getHrTimestamp() +
        ' - Error ensuring offscreen document:',
      err,
    );
    return false;
  }
}

function captureScreenshot() {
  console.log(
    '[Background] - ' +
      getHrTimestamp() +
      ' - Attempting to capture screenshot...',
  );

  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) {
        console.error(
          '[Background] Error capturing screenshot:',
          chrome.runtime.lastError,
        );
        reject(chrome.runtime.lastError);
        return;
      }

      console.log(
        '[Background] - ' + getHrTimestamp() + ' - Screenshot captured.',
      );
      resolve(dataUrl);
    });
  });
}

function getHammingDistance(hash1, hash2) {
  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) {
      distance++;
    }
  }
  return distance;
}

async function getImagePHash(dataUrl) {
  try {
    // Fetch the image as a blob from the data URL.
    const response = await fetch(dataUrl);
    const blob = await response.blob();

    // Create an ImageBitmap from the blob.
    const bitmap = await createImageBitmap(blob);

    // Create an OffscreenCanvas with the dimensions of the bitmap.
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');

    // Draw the bitmap onto the canvas.
    ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);

    // Extract the image data from the canvas.
    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);

    // Generate the perceptual hash.
    const hash = blockhash.bmvbhash(imageData, HASH_GRID_SIZE); // 8x8 hash grid

    return hash;
  } catch (error) {
    throw error;
  }
}

function sendSsDataToOffscreen(data) {
  // Send screenshot via open port if connected
  if (offscreenPort) {
    console.log(
      '[Background] - ' +
        getHrTimestamp() +
        ' - Sending raw screenshot data url to offscreen.',
    );
    offscreenPort.postMessage({ type: 'ssDataUrlRaw', data: data });
  } else {
    console.warn(
      '[Background] - ' +
        getHrTimestamp() +
        ' - offscreen not connected to receive the screenshot.',
    );
  }
}

function getCurrentTabDomain(callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length === 0) {
      callback(null); // No active tab found
      return;
    }
    const url = new URL(tabs[0].url);
    const domain = parse(url.hostname).domain;
    callback(domain);
  });
}

// Inference Init Function
async function startInference() {
  // Capturing screenshot
  let startTakeSsTime = Date.now();
  ssDataUrlRaw = await captureScreenshot();
  chrome.storage.local.set({ dataUrl: ssDataUrlRaw });
  let takeSsTime = Date.now() - startTakeSsTime;
  console.log(
    `[Background] - ${getHrTimestamp()} - Time to take screenshot: ${takeSsTime} ms`,
  );
  logMessage(`[Background] - screenshot capture time: ${takeSsTime} ms`);

  // Computing phash
  let phashStartTime = Date.now();
  let phashNew = await getImagePHash(ssDataUrlRaw);
  let phashTotalTime = Date.now() - phashStartTime;
  console.log(
    `[Background] - ${getHrTimestamp()} - Time to phash: ${phashTotalTime} ms`,
  );
  logMessage(`[Background] - phash computation time: ${phashTotalTime} ms`);

  // Selecting appropriate case
  chrome.storage.local.get(['phash'], (result) => {
    let phashCurrent = result.phash;
    console.log(
      `[Background] - ${getHrTimestamp()} - Retrieved phash value: ${phashCurrent}`,
    );
    // CASE 2 - No phash -> inference
    if (phashCurrent === null || phashCurrent === 'NA') {
      pureAllInfStartTime = Date.now();
      sendSsDataToOffscreen(ssDataUrlRaw);
      chrome.storage.local.set({ phash: phashNew, hammingDistance: null });
    } else {
      let hammingDistance = getHammingDistance(phashCurrent, phashNew);
      // CASE 3 - HD > thold -> inference
      if (hammingDistance >= HAMMING_DIST_THOLD) {
        pureAllInfStartTime = Date.now();
        sendSsDataToOffscreen(ssDataUrlRaw);
        chrome.storage.local.set({ phash: phashNew, hammingDistance }, () => {
          console.log(
            '[Background] - ' +
              getHrTimestamp() +
              ' - Updated local storage: Phash greater than threshold',
          );
        });
        // CASE 4 - phash < thold -> keep current classification
      } else {
        let case4TotalTime = Date.now() - scanStartTime;
        console.log(
          `[Background] - ${getHrTimestamp()} - Case 4 (phash < thold) scan complete in ${case4TotalTime} ms.`,
        );
        logMessage(`[Background] - case 4 total time: ${case4TotalTime} ms`);
        const case4Data = {
          resizedDataUrl: 'NA',
          method: 'Phash less than threshold',
          infTime: 'NA',
          ocrText: 'NA',
          ocrTime: 'NA',
          hammingDistance,
          totalTime: case4TotalTime,
        };
        chrome.storage.local.set(case4Data, () => {
          console.log(
            '[Background] - ' +
              getHrTimestamp() +
              ' - Local storage updated: (Case 4) Phash less than threshold.',
          );
        });
        chrome.storage.local.get(['phash', 'classification'], (result) => {
          saveScreenshot(
            ssDataUrlRaw,
            `${sessionStartTime}/${result.classification.split('_')[0]}`,
            `${currentDomain}_${result.phash}_${getHrTimestamp()}`,
          );
        });
      }
    }
  });
}

////// DRIVERS

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (changes.offscreenInitialized || changes.backgroundInitialized) {
    chrome.storage.local.get(
      ['offscreenInitialized', 'backgroundInitialized'],
      (result) => {
        if (result.offscreenInitialized && result.backgroundInitialized) {
          let initTotalTime = Date.now() - sessionStartTime;
          console.log(
            `[Background] - ${getHrTimestamp()} - Initialization completed in ${initTotalTime} ms`,
          );
          logMessage(
            `[Background] - initialization completion time: ${initTotalTime} ms`,
          );
          runScans();
        }
      },
    );
    return;
  }
});

// Main function
function runScans() {
  scanId = setInterval(() => {
    chrome.storage.local.get(['mainToggleState'], (data) => {
      if (data.mainToggleState) {
        console.log('[Background] - ' + getHrTimestamp() + ' - Toggle is ON.');

        scanStartTime = Date.now();

        getCurrentTabDomain((domain) => {
          currentDomain = domain;
          // CASE 1
          if (trancoSet.has(domain)) {
            // if (false) {
            console.log(
              `[Background] - ${getHrTimestamp()} - Domain in Tranco set: ${domain}`,
            );
            let case1TotalTime = Date.now() - scanStartTime;
            const case1Data = {
              resizedDataUrl: 'NA',
              classification: 'benign',
              method: `Tranco whitelist - ${domain}`,
              infTime: 'NA',
              ocrText: 'NA',
              ocrTime: 'NA',
              phash: 'NA',
              hammingDistance: 'NA',
              totalTime: case1TotalTime,
            };
            chrome.storage.local.set(case1Data, () => {
              console.log(
                '[Background] - ' +
                  getHrTimestamp() +
                  ' - Local storage updated: (Case 1) Tranco whitelist.',
              );
            });
            console.log(
              `[Background] - ${getHrTimestamp()} - Case 1 (white list) scan completed in ${case1TotalTime} ms`,
            );
            logMessage(
              `[Background] - case 1 total time: ${case1TotalTime} ms`,
            );

            saveScreenshot(
              ssDataUrlRaw,
              `${sessionStartTime}/benign`,
              `${domain}_wl_${getHrTimestamp()}`,
            );
          } else {
            console.log(
              '[Background] - ' +
                getHrTimestamp() +
                ' - Domain not in Tranco set.',
            );
            startInference();
          }
        });
      } else {
        console.log('[Background] - ' + getHrTimestamp() + ' - Toggle is OFF.');
      }
    });
  }, SCAN_INTERVAL);
}

// Performance logging
setInterval(() => {
  chrome.storage.local.get(
    ['mainToggleState', 'performanceToggleState'],
    (data) => {
      if (data.performanceToggleState) {
        saveLogsToFile();
      }
    },
  );
}, SAVE_INTERVAL);
