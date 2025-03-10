// src/background.js

import blockhash from 'blockhash-core';
import { parse } from 'tldts';

// Global settings
const HASH_GRID_SIZE = 8;
const HAMMING_DIST_THOLD = 8;
const RUN_INTERVAL = 5 * 1000;

// Global storage variables
let totalStartTime = 0;
let totalTime = 0;

let offscreenPort = null;
let trancoSet = new Set();

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
  console.log(
    '[Background] - ' + Date.now() + ' - Session storage initialized',
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
        `[Background] - ${Date.now()} - Time to process CSV into Set: ${processingTime} ms`,
      );

      console.log(
        '[Background] - ' + Date.now() + ' - First 5 entries in Tranco Set:',
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
loadTrancoIntoMemory()
  .then((size) =>
    console.log(
      `[Background] - ${Date.now()} - Tranco List Loaded in Memory (${size} domains)`,
    ),
  )
  .catch((error) => console.error(`[Background] Error: ${error}`));

// Setting up message passing ports
chrome.runtime.onConnect.addListener((port) => {
  console.log('[Background] - ' + Date.now() + ' - Connected to:', port.name);

  if (port.name === 'offscreenPort') {
    offscreenPort = port;

    port.onMessage.addListener((message) => {
      if (message.type === 'infResponse') {
        console.log(
          '[Background] - ' + Date.now() + ' - Received infResponse:',
          message.data,
        );

        let totalTime = Date.now() - totalStartTime;

        const sessionData = {
          resizedDataUrl: message.data.resizedDataUrl, // For the screenshot <img>
          classification: message.data.classification,
          method: 'Model inference',
          infTime: message.data.infTime,
          ocrText: message.data.ocrText,
          ocrTime: message.data.ocrTime,
          totalTime: totalTime,
        };

        chrome.storage.session.set(sessionData, () => {
          console.log(
            '[Background] - ' +
              Date.now() +
              ' - Session storage updated with infResponse',
          );
        });
      }
    });

    port.onDisconnect.addListener(() => {
      console.log('[Background] - ' + Date.now() + ' - Popup disconnected.');
      offscreenPort = null;
    });
  }
});

function injectContentScript() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs.length > 0 && tabs[0].id) {
      console.log('[Background] Injecting content.js into tab:', tabs[0].id);
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        files: ['content.js'],
      });
    }
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  // CASE 1: If classification changed to "SE", reinject immediately.
  if (changes.classification && changes.classification.newValue === 'SE') {
    injectContentScript();
    return;
  }

  // CASE 2: If the phash changes, then check if we are on an SE page.
  if (changes.phash) {
    chrome.storage.session.get('classification', (result) => {
      console.log('classification result', result);
      if (result.classification === 'SE') {
        chrome.storage.session.set({ classification: 'benign' });
        return;
      }
    });
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
        '[Background] - ' + Date.now() + ' - Offscreen document created.',
      );
    } else {
      console.log(
        '[Background] - ' +
          Date.now() +
          ' - Offscreen document already exists.',
      );
    }
    return true;
  } catch (err) {
    console.error('Error ensuring offscreen document:', err);
    return false;
  }
}

function captureScreenshot() {
  console.log(
    '[Background] - ' + Date.now() + ' - Attempting to capture screenshot...',
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

      console.log('[Background] - ' + Date.now() + ' - Screenshot captured.');
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
        Date.now() +
        ' - Sending raw screenshot data url to offscreen.',
    );
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
    console.log('tabs', tabs);
    const url = new URL(tabs[0].url);
    const domain = parse(url.hostname).domain;
    callback(domain);
  });
}

// Inference Init Function
async function startInference() {
  const startTakeSsTime = Date.now();
  const ssDataUrlRaw = await captureScreenshot();
  const takeSsTime = Date.now() - startTakeSsTime;
  console.log(
    '[Background] - ' +
      Date.now() +
      ' - Time to take screenshot: ' +
      takeSsTime +
      ' ms',
  );

  let phashNew = await getImagePHash(ssDataUrlRaw);
  chrome.storage.session.get(['phash'], (result) => {
    let phashCurrent = result.phash;
    console.log('[Background] Retrieved phash value:', phashCurrent);
    if (phashCurrent === null || phashCurrent === 'NA') {
      sendSsDataToOffscreen(ssDataUrlRaw);
      chrome.storage.session.set({ phash: phashNew, hammingDistance: null });
    } else {
      let hammingDistance = getHammingDistance(phashCurrent, phashNew);
      if (hammingDistance > HAMMING_DIST_THOLD) {
        sendSsDataToOffscreen(ssDataUrlRaw);
        chrome.storage.session.set({ phash: phashNew, hammingDistance }, () => {
          console.log(
            '[Background] - ' +
              Date.now() +
              ' - Updated session: Phash greater than threshold',
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
          console.log(
            '[Background] - ' +
              Date.now() +
              ' - Session updated for: Phash less than threshold.',
          );
        });
      }
    }
  });
}

// Main Driver Function

setInterval(() => {
  ensureOffscreen();

  chrome.storage.local.get('toggleState', (data) => {
    if (data.toggleState) {
      console.log('[Background] - ' + Date.now() + ' - Toggle is ON.');

      totalStartTime = Date.now();

      getCurrentTabDomain((domain) => {
        if (trancoSet.has(domain)) {
          // if (false) {
          console.log(
            '[Background] - ' + Date.now() + ' - Domain in Tranco set:',
            domain,
          );
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
            console.log(
              '[Background] - ' +
                Date.now() +
                ' - Session updated for: Tranco whitelist.',
            );
          });
        } else {
          console.log(
            '[Background] - ' + Date.now() + ' - Domain not in Tranco set.',
          );
          startInference();
        }
      });
    } else {
      console.log('[Background] - ' + Date.now() + ' - Toggle is OFF.');
    }
  });
}, RUN_INTERVAL);
