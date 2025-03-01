// src/background.js
let ocrFinised = 0;
let totalStartTime = 0;
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
      console.log("[Background] - " + Date.now() + " - Offscreen document created.");
    } else {
      console.log("[Background]- " + Date.now() + " - Offscreen document already exists.");
    }
    return true;
  } catch (err) {
    console.error("Error ensuring offscreen document:", err);
    return false;
  }
}

function captureScreenshotAndSend() {
  console.log("[Background] - " + Date.now() + " - Attempting to capture screenshot...");
  chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
    if (chrome.runtime.lastError || !dataUrl) {
      console.error("[Background] Error capturing screenshot:", chrome.runtime.lastError);
      return;
    }
    console.log("[Background] - " + Date.now() + " - Screenshot captured. Sending to popup.");
    chrome.runtime.sendMessage({ type: 'screenshotCaptured', dataUrl });
  });
}

setInterval(() => {
  chrome.storage.local.get("toggleState", (data) => {
    if (data.toggleState) {
      console.log("[Background] - " + Date.now() + " - Toggle is ON. Capturing screenshot...");
      const startTakeSsTime = Date.now()
      totalStartTime = startTakeSsTime
      captureScreenshotAndSend();
      const endTakeSsTime = Date.now()
      const takeSsTime = endTakeSsTime - startTakeSsTime;
      console.log("[Background] - " + Date.now() + " - Time to take screenshot: " + takeSsTime + " ms")
    } else {
      console.log("[Background] - " + Date.now() + " - Toggle is OFF; skipping capture.");
    }
  });
}, 1000000);

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  console.log("[Background] - " + Date.now() + " - Message received:", message);

  if (message.type === "ocrFinished") {
    ocrFinised = Date.now()
    ocrFullTime = ocrFinised - totalStartTime
    
    console.log("[Background] - " + Date.now() + " - SS capture to OCR finish time: " + ocrFullTime + ' ms')
  }

  if (message.type === "inferenceFinished" && message.data === true) {
    totalTime = Date.now() - totalStartTime;
    chrome.runtime.sendMessage({ type: "totalTime", data: totalTime });
    console.log("[Background] - " + Date.now() + " - Total time for capture and inference:", totalTime, "ms");
  }

  if (message.type === "runInference") {
    console.log("[Background] - " + Date.now() + " - Received runInference message.");
    const available = await ensureOffscreen();
    if (available) {
      console.log("[Background] - " + Date.now() + " - Forwarding runInference payload to offscreen document.");
      chrome.runtime.sendMessage(message);
    } else {
      console.error("Offscreen document not available. Cannot perform inference.");
    }
  }

  if (message.type === 'sandboxLoaded') {
    console.log("[Background] - " + Date.now() + " - Received sandboxLoaded confirmation:", message);
  }

  if (message.type === "inferenceResult") {
    console.log("[Background] - " + Date.now() + " - Received inference result:", message);
    chrome.runtime.sendMessage(message);
  }
});





///////////////////////////////////////////////////////////////////////////

ensureOffscreen()

chrome.runtime.onConnect.addListener((port) => {
  console.log("Port connected:", port.name);

  port.onMessage.addListener((message) => {
      console.log("Received message:", message.greeting);
      
      // Respond to popup
      port.postMessage({ reply: "Hello from background!" });
  });

  port.onDisconnect.addListener(() => {
      console.log("Port disconnected:", port.name);
  });
});
