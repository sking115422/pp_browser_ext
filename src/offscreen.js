// src/offscreen.js
import * as ort from 'onnxruntime-web';

console.log("[Offscreen] - " + Date.now() + " - Offscreen document loaded.");

let onnxWorker = null;
try {
  onnxWorker = new Worker(chrome.runtime.getURL('onnx_worker.js'), { type: 'module' });
  console.log("[Offscreen] - " + Date.now() + " - ONNX worker instantiated.");
} catch (err) {
  console.error("[Offscreen] Error instantiating ONNX worker:", err);
}

if (!onnxWorker) {
  console.error("[Offscreen] ONNX worker is not defined.");
} else {
  onnxWorker.onerror = (err) => {
    console.error("[Offscreen] ONNX worker error:", err);
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'runInference') {
    console.log("[Offscreen] - " + Date.now() + " - Received runInference message:", message);

    if (onnxWorker) {
      try {
        onnxWorker.postMessage({ type: 'runInference', payload: message.payload });
        console.log("[Offscreen] - " + Date.now() + " - runInference payload posted to ONNX worker.");
      } catch (e) {
        console.error("[Offscreen] Error posting message to ONNX worker:", e);
      }
    } else {
      console.error("[Offscreen] Cannot post message: ONNX worker is not defined.");
    }
  }
});

if (onnxWorker) {
  onnxWorker.onmessage = (event) => {
    console.log("[Offscreen] - " + Date.now() + " - Inference result from ONNX worker:", event.data);
    chrome.runtime.sendMessage(event.data);
  };
}
