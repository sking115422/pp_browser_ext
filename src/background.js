// src/background.js

let captureStartTime = 0;
let totalTime = 0;

// Function to capture a screenshot and send it to the popup
function captureScreenshotAndSend() {
  console.log("[Background] Attempting to capture screenshot...");
  chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
    if (chrome.runtime.lastError || !dataUrl) {
      console.error("[Background] Error capturing screenshot:", chrome.runtime.lastError);
      return;
    }
    console.log("[Background] Screenshot captured. Sending to popup.");
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
    chrome.runtime.sendMessage({ type: "totalTime", data: totalTime });
    console.log("[Background] Total time for capture and inference:", totalTime, "ms");
  }
});

// Optional: listen for sandbox loaded confirmation forwarded via the popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'sandboxLoaded') {
    console.log("[Background] Received sandboxLoaded confirmation:", msg);
  }
});

