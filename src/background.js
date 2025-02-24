// src/background.js

let captureStartTime = 0;
let totalTime = 0;

// Ensure an offscreen document is created (if not already present)
async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) {
    console.log("[Background] Offscreen document already exists.");
    return;
  }
  console.log("[Background] Creating offscreen document...");
  await chrome.offscreen.createDocument({
    url: chrome.runtime.getURL("offscreen.html"),
    reasons: ["WORKERS"], // "WORKERS" is allowed and appropriate for spawning workers.
    justification: "Needed for OCR and model inference."
  });
  console.log("[Background] Offscreen document created.");
}

// Create the offscreen document on install and on startup
chrome.runtime.onInstalled.addListener(() => {
  ensureOffscreenDocument().then(() => {
    console.log("[Background] Offscreen document ensured on install.");
  });
});

chrome.runtime.onStartup.addListener(() => {
  ensureOffscreenDocument().then(() => {
    console.log("[Background] Offscreen document ensured on startup.");
  });
});

// Function to capture a screenshot and send it to the offscreen document
function captureScreenshotAndSend() {
  console.log("[Background] Attempting to capture screenshot...");
  chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
    if (chrome.runtime.lastError || !dataUrl) {
      console.error("[Background] Error capturing screenshot:", chrome.runtime.lastError);
      return;
    }
    console.log("[Background] Screenshot captured. Sending to offscreen document.");
    // Send the screenshot via message passing
    chrome.runtime.sendMessage({ type: 'screenshotCaptured', dataUrl });
  });
}

setInterval(() => {
  chrome.storage.local.get("toggleState", (data) => {
    if (data.toggleState) {
      console.log("[Background] Toggle is ON. Capturing screenshot...");
      // Record the start time
      captureStartTime = performance.now();
      captureScreenshotAndSend();
    } else {
      console.log("[Background] Toggle is OFF; skipping capture.");
    }
  });
}, 10000);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "inferenceFinished" && message.data === true) {
    // Calculate the total time from capture start until inference finished
    totalTime = performance.now() - captureStartTime;
    chrome.runtime.sendMessage({type: "totalTime", data: totalTime})
    console.log("[Background] Total time for capture and inference:", totalTime, "ms");
    // You can store or use totalTime as needed.
  }
});

// Listen for confirmation messages from the offscreen document
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'offscreenLoaded') {
    console.log("[Background] Received offscreenLoaded confirmation:", msg);
  }
});
