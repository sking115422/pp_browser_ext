// src/background.js
let captureStartTime = 0;
let totalTime = 0;

async function ensureOffscreen() {
  if (!chrome.offscreen) {
    console.warn("chrome.offscreen API is not available. Offscreen inference will not work!");
    return false;
  }
  try {
    const hasDocument = await chrome.offscreen.hasDocument();
    if (!hasDocument) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['WORKERS'],
        justification: 'Needed to run ONNX inference'
      });
      console.log("[Background] Offscreen document created.");
    } else {
      console.log("[Background] Offscreen document already exists.");
    }
    return true;
  } catch (err) {
    console.error("Error ensuring offscreen document:", err);
    return false;
  }
}

function captureScreenshotAndSend() {
  console.log("[Background] Attempting to capture screenshot...");
  chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
    if (chrome.runtime.lastError || !dataUrl) {
      console.error("[Background] Error capturing screenshot:", chrome.runtime.lastError);
      return;
    }
    console.log("[Background] Screenshot captured. Sending to popup.");
    captureStartTime = performance.now();
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
}, 10000);

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  console.log("[Background] Message received:", message);

  if (message.type === "inferenceFinished" && message.data === true) {
    totalTime = performance.now() - captureStartTime;
    chrome.runtime.sendMessage({ type: "totalTime", data: totalTime });
    console.log("[Background] Total time for capture and inference:", totalTime, "ms");
  }

  if (message.type === "runInference") {
    console.log("[Background] Received runInference message.");
    const available = await ensureOffscreen();
    if (available) {
      console.log("[Background] Forwarding runInference payload to offscreen document.");
      chrome.runtime.sendMessage(message);
    } else {
      console.error("Offscreen document not available. Cannot perform inference.");
    }
  }

  if (message.type === 'sandboxLoaded') {
    console.log("[Background] Received sandboxLoaded confirmation:", message);
  }

  if (message.type === "inferenceResult") {
    console.log("[Background] Received inference result:", message);
    chrome.runtime.sendMessage(message);
  }
});
