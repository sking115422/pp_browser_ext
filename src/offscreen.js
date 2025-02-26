// src/offscreen.js
import * as ort from 'onnxruntime-web';

console.log("[Offscreen] Offscreen document loaded.");

let onnxWorker = null;
try {
  onnxWorker = new Worker(chrome.runtime.getURL('onnx_worker.js'), { type: 'module' });
  console.log("[Offscreen] ONNX worker instantiated.");
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

// Establish a long-lived port connection to the background.
const bgPort = chrome.runtime.connect({ name: "offscreen" });
bgPort.onMessage.addListener((msg) => {
  console.log("[Offscreen] Received message via port:", msg);
  if (msg.type === 'runInference') {
    if (onnxWorker) {
      try {
        onnxWorker.postMessage({ type: 'runInference', payload: msg.payload });
        console.log("[Offscreen] runInference payload posted to ONNX worker.");
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
    console.log("[Offscreen] Inference result from ONNX worker:", event.data);
    bgPort.postMessage(event.data);
  };
}
