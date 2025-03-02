// src/background.js

// Global variables
let ocrFinised = 0;
let totalStartTime = 0;
let totalTime = 0;

let offscreenPort = null;

// Initializing message passing ports

chrome.runtime.onConnect.addListener((port) => {
  console.log('[Background] - ' + Date.now() + ' - Connected to:', port.name);

  if (port.name === 'offscreenPort') {
    offscreenPort = port;

    port.onDisconnect.addListener(() => {
      console.log('[Background] - ' + Date.now() + ' - Popup disconnected.');
      offscreenPort = null;
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

// Inference Init Function

async function startInference() {
  const startTakeSsTime = Date.now();
  totalStartTime = startTakeSsTime;
  // captureScreenshotAndSend();
  const ssDataUrlRaw = await captureScreenshot();
  const endTakeSsTime = Date.now();
  const takeSsTime = endTakeSsTime - startTakeSsTime;
  console.log(
    '[Background] - ' +
      Date.now() +
      ' - Time to take screenshot: ' +
      takeSsTime +
      ' ms',
  );
  sendSsDataToOffscreen(ssDataUrlRaw);
}

// Main Driver Function

setInterval(() => {
  ensureOffscreen();

  chrome.storage.local.get('toggleState', (data) => {
    if (data.toggleState) {
      console.log('[Background] - ' + Date.now() + ' - Toggle is ON.');
      startInference();
    } else {
      console.log('[Background] - ' + Date.now() + ' - Toggle is OFF.');
    }
  });
}, 10000);
