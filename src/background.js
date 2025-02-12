// src/background.js

function captureScreenshotAndSend() {
  console.log("[Background] Attempting to capture screenshot...");
  chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
    if (chrome.runtime.lastError || !dataUrl) {
      console.error("[Background] Error capturing screenshot:", chrome.runtime.lastError);
      return;
    }
    console.log("[Background] Screenshot captured. Sending to sandbox.");
    // Send the screenshot to the sandbox page.
    chrome.runtime.sendMessage({ type: 'screenshotCaptured', dataUrl });
  });
}

setInterval(() => {
  chrome.storage.local.get("toggleState", (data) => {
    if (data.toggleState) {
      console.log("[Background] Toggle is ON. Capturing screenshot...");
      captureScreenshotAndSend();
    } else {
      console.log("[Background] Toggle is OFF; skipping capture.");
    }
  });
}, 30000);
