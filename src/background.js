// src/background.js
let captureStartTime = 0;
let totalTime = 0;
let popupPort = null;
let offscreenPort = null;

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

function captureScreenshotAndStore() {
  console.log("[Background] Attempting to capture screenshot...");
  chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
    if (chrome.runtime.lastError || !dataUrl) {
      console.error("[Background] Error capturing screenshot:", chrome.runtime.lastError);
      return;
    }
    console.log("[Background] Screenshot captured. Storing in session storage.");
    captureStartTime = performance.now();
    chrome.storage.session.set({ screenshotData: dataUrl });
  });
}

setInterval(() => {
  chrome.storage.local.get("toggleState", (data) => {
    if (data.toggleState) {
      console.log("[Background] Toggle is ON. Capturing screenshot...");
      captureScreenshotAndStore();
    } else {
      console.log("[Background] Toggle is OFF; skipping capture.");
    }
  });
}, 10000);

// Listen for incoming long-lived port connections.
chrome.runtime.onConnect.addListener((port) => {
  console.log("[Background] Port connected:", port.name);
  if (port.name === "popup") {
    popupPort = port;
    port.onMessage.addListener((msg) => {
      console.log("[Background] Received message from popup via port:", msg);
      if (msg.type === "runInference") {
        (async () => {
          const available = await ensureOffscreen();
          if (available) {
            if (offscreenPort) {
              offscreenPort.postMessage(msg);
            } else {
              // Fallback: if the offscreen port is not connected, use one‑time messaging.
              chrome.runtime.sendMessage(msg);
            }
          } else {
            console.error("Offscreen document not available. Cannot perform inference.");
          }
        })();
      }
      if (msg.type === "inferenceFinished" && msg.data === true) {
        totalTime = performance.now() - captureStartTime;
        chrome.storage.session.set({ totalTime });
        console.log("[Background] Total time for capture and inference:", totalTime, "ms");
      }
      if (msg.type === "sandboxLoaded") {
        console.log("[Background] Received sandboxLoaded confirmation from popup:", msg);
      }
    });
    port.onDisconnect.addListener(() => {
      console.log("[Background] Popup port disconnected.");
      popupPort = null;
    });
  } else if (port.name === "offscreen") {
    offscreenPort = port;
    port.onMessage.addListener((msg) => {
      console.log("[Background] Received message from offscreen via port:", msg);
      if (msg.type === "inferenceResult") {
        // Forward the inference result to the popup.
        if (popupPort) {
          popupPort.postMessage(msg);
        } else {
          chrome.runtime.sendMessage(msg);
        }
      }
    });
    port.onDisconnect.addListener(() => {
      console.log("[Background] Offscreen port disconnected.");
      offscreenPort = null;
    });
  }
});
