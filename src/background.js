// src/background.js

import blockhash from 'blockhash-core';
import { parse } from 'tldts';

// Global settings
const HASH_GRID_SIZE = 8;
const HAMMING_DIST_THOLD = 3;
const SCAN_INTERVAL = 5 * 1000;
const SAVE_INTERVAL = 60 * 1000;

// Global variables
let sessionStartTime = Date.now();
let totalStartTime = 0;
let totalTime = 0;
let ssDataUrlRaw = null;
let currentDomain = null;

let offscreenPort = null;
let trancoSet = new Set();

function logMessage(message) {
  let timestampedMessage = `[${new Date().toISOString()}] - ${message}`;

  // Log to console
  console.log(timestampedMessage);

  // Store logs in chrome.storage.local
  chrome.storage.local.get({ logs: [] }, (result) => {
    let logs = result.logs;
    logs.push(timestampedMessage);
    chrome.storage.local.set({ logs });
  });
}

function saveLogsToFile() {
  chrome.storage.local.get({ logs: [] }, (result) => {
    let logText = result.logs.join('\n');
    // Create a data URL from the log text
    let url = 'data:text/plain;charset=utf-8,' + encodeURIComponent(logText);

    chrome.downloads.download({
      url: url,
      filename: `${sessionStartTime}/ext_logs_${Date.now()}.txt`,
      saveAs: false,
    });

    // Clear logs after saving (optional)
    chrome.storage.local.set({ logs: [] });
  });
}
// Initialize domain
getCurrentTabDomain((domain) => {
  currentDomain = domain;
});

// Initializing local data
const initLocalData = {
  dataUrl: null,
};

// Initializing session data
const initSessionData = {
  resizedDataUrl: null, // For the screenshot <img>
  classification: null,
  method: null,
  infTime: null,
  ocrText: null,
  ocrTime: null,
  totalTime: null,
  phash: null,
  hammingDistance: null,
};

// Store the values in chrome.storage.session
chrome.storage.session.set(initSessionData, () => {
  logMessage('[Background] - Session storage initialized');
});

// Store the values in chrome.storage.session
chrome.storage.local.set(initLocalData, () => {
  logMessage('[Background] - Local storage initialized');
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
      logMessage(
        `[Background] - Time to process CSV into Set: ${processingTime} ms`,
      );

      logMessage(
        '[Background] - First 5 entries in Tranco Set:',
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

// Load Tranco list at extension startup
let loadTrancoStartTime = Date.now();
loadTrancoIntoMemory()
  .then((size) =>
    logMessage(`[Background] - Tranco List Loaded in Memory (${size} domains)`),
  )
  .catch((error) => console.error(`[Background] Error: ${error}`));
let loadTrancoTotalTime = Date.now() - loadTrancoStartTime;
logMessage(
  `[Background] - Time taken to load Tranco List: ${loadTrancoTotalTime} ms`,
);

// Setting up message passing ports
chrome.runtime.onConnect.addListener((port) => {
  logMessage(`[Background] - Connected to: ${port.name}`);

  if (port.name === 'offscreenPort') {
    offscreenPort = port;

    port.onMessage.addListener((message) => {
      if (message.type === 'infResponse') {
        logMessage('[Background] - Received infResponse');

        let totalTime = Date.now() - totalStartTime;

        const sessionData = {
          resizedDataUrl: message.data.resizedDataUrl, // For the screenshot <img>
          classification: message.data.classification + '_' + Date.now(),
          method: 'Model inference',
          infTime: message.data.infTime,
          ocrText: message.data.ocrText,
          ocrTime: message.data.ocrTime,
          totalTime: totalTime,
        };

        chrome.storage.session.set(sessionData, () => {
          logMessage('[Background] - Session storage updated with infResponse');
        });
      }
    });

    port.onDisconnect.addListener(() => {
      logMessage('[Background] - Popup disconnected.');
      offscreenPort = null;
    });
  }
});

async function saveScreenshot(dataUrl, baseDir, filename) {
  console.log('dataUrl', dataUrl);
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
                    logMessage(
                      `[Background] - Screenshot saved as: ${fullPath}`,
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
      logMessage(`[Background] Injecting content.js into tab: ${tabs[0].id}`);
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        files: ['content.js'],
      });
    }
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  // CASE 1: If classification changed to "malicious", reinject immediately.
  if (
    changes.classification &&
    changes.classification.newValue.split('_')[0] === 'malicious'
  ) {
    injectContentScript();
    chrome.storage.session.get(
      ['phash', 'classification', 'currentDomain'],
      (result) => {
        saveScreenshot(
          ssDataUrlRaw,
          `${sessionStartTime}/${result.classification.split('_')[0]}`,
          `${currentDomain}_${result.phash}_${Date.now()}`,
        );
      },
    );
    return;
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
      logMessage('[Background] - Offscreen document created.');
    } else {
      logMessage('[Background] - Offscreen document already exists.');
    }
    return true;
  } catch (err) {
    console.error('[Background] - Error ensuring offscreen document:', err);
    return false;
  }
}

function captureScreenshot() {
  logMessage('[Background] - Attempting to capture screenshot...');

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

      logMessage('[Background] - Screenshot captured.');
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
    logMessage('[Background] - Sending raw screenshot data url to offscreen.');
    offscreenPort.postMessage({ type: 'ssDataUrlRaw', data: data });
  } else {
    console.warn(
      '[Background] - offscreen not connected to receive the screenshot.',
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
  const startTakeSsTime = Date.now();
  ssDataUrlRaw = await captureScreenshot();
  chrome.storage.local.set({ dataUrl: ssDataUrlRaw });
  const takeSsTime = Date.now() - startTakeSsTime;
  logMessage(`[Background] - Time to take screenshot: ${takeSsTime} ms`);

  let phashNew = await getImagePHash(ssDataUrlRaw);
  chrome.storage.session.get(['phash'], (result) => {
    let phashCurrent = result.phash;
    logMessage(`[Background] Retrieved phash value: ${phashCurrent}`);
    if (phashCurrent === null || phashCurrent === 'NA') {
      sendSsDataToOffscreen(ssDataUrlRaw);
      chrome.storage.session.set({ phash: phashNew, hammingDistance: null });
    } else {
      let hammingDistance = getHammingDistance(phashCurrent, phashNew);
      if (hammingDistance >= HAMMING_DIST_THOLD) {
        sendSsDataToOffscreen(ssDataUrlRaw);
        chrome.storage.session.set({ phash: phashNew, hammingDistance }, () => {
          logMessage(
            '[Background] - Updated session: Phash greater than threshold',
          );
        });
      } else {
        const sessionData = {
          resizedDataUrl: 'NA',
          method: 'Phash less than threshold',
          infTime: 'NA',
          ocrText: 'NA',
          ocrTime: 'NA',
          hammingDistance,
          totalTime: Date.now() - totalStartTime,
        };
        chrome.storage.session.set(sessionData, () => {
          logMessage(
            '[Background] - Session updated for: Phash less than threshold.',
          );
        });
        chrome.storage.session.get(['phash', 'classification'], (result) => {
          saveScreenshot(
            ssDataUrlRaw,
            `${sessionStartTime}/${result.classification.split('_')[0]}`,
            `${currentDomain}_${result.phash}_${Date.now()}`,
          );
        });
      }
    }
  });
}

// Main Driver Function

setInterval(() => {
  ensureOffscreen();

  chrome.storage.local.get(['mainToggleState'], (data) => {
    if (data.mainToggleState) {
      logMessage('[Background] - Toggle is ON.');

      totalStartTime = Date.now();

      getCurrentTabDomain((domain) => {
        currentDomain = domain;
        if (trancoSet.has(domain)) {
          // if (false) {
          logMessage(`[Background] - Domain in Tranco set: ${domain}`);
          const sessionData = {
            resizedDataUrl: 'NA',
            classification: 'benign',
            method: `Tranco whitelist - ${domain}`,
            infTime: 'NA',
            ocrText: 'NA',
            ocrTime: 'NA',
            phash: 'NA',
            hammingDistance: 'NA',
            totalTime: Date.now() - totalStartTime,
          };
          chrome.storage.session.set(sessionData, () => {
            logMessage('[Background] - Session updated for: Tranco whitelist.');
          });

          saveScreenshot(
            ssDataUrlRaw,
            `${sessionStartTime}/benign`,
            `${domain}_wl_${Date.now()}`,
          );
        } else {
          logMessage('[Background] - Domain not in Tranco set.');
          startInference();
        }
      });
    } else {
      logMessage('[Background] - Toggle is OFF.');
    }
  });
}, SCAN_INTERVAL);

setInterval(() => {
  chrome.storage.local.get(['mainToggleState', 'debugToggleState'], (data) => {
    if (data.mainToggleState && data.debugToggleState) {
      saveLogsToFile();
    }
  });
}, SAVE_INTERVAL);
