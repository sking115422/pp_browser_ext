// src/sandbox.js

console.log("[Sandbox] Sandbox page loaded.");
// Inform background that sandbox is loaded.
chrome.runtime.sendMessage({ type: 'sandboxLoaded', message: "Sandbox page is active." });

window.parent.postMessage({ action: "getData" }, "*");

// Instantiate the two workers.
const ocrWorker = new Worker('ocr_worker.js', { type: 'module' });
const onnxWorker = new Worker('onnx_worker.js', { type: 'module' });
console.log("[Sandbox] OCR and ONNX workers instantiated.");

const sandboxState = {
  resizedDataUrl: null,
  imageTensor: null // { data: ArrayBuffer, dims: [1, 3, 224, 224] }
};

let latestOCRText = null;

// Listen for messages from the background.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[Sandbox] Message received from background:", message);
  if (message.type === 'screenshotCaptured') {
    processScreenshot(message.dataUrl);
  }
});

async function processScreenshot(dataUrl) {
  console.log("[Sandbox] Processing screenshot...");
  const img = new Image();
  img.src = dataUrl;
  img.onload = () => {
    console.log("[Sandbox] Image loaded from dataUrl.");
    const canvas = new OffscreenCanvas(224, 224);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, 224, 224);

    canvas.convertToBlob().then(blob => {
      const reader = new FileReader();
      reader.onloadend = () => {
        sandboxState.resizedDataUrl = reader.result;
        console.log("[Sandbox] Resized image dataUrl stored.");
      };
      reader.readAsDataURL(blob);
    });

    const imageData = ctx.getImageData(0, 0, 224, 224);
    const { data } = imageData;
    const floatData = new Float32Array(224 * 224 * 3);
    let j = 0;
    for (let i = 0; i < data.length; i += 4) {
      floatData[j++] = data[i] / 255.0;
      floatData[j++] = data[i + 1] / 255.0;
      floatData[j++] = data[i + 2] / 255.0;
    }
    const numPixels = 224 * 224;
    const transposed = new Float32Array(3 * numPixels);
    for (let c = 0; c < 3; c++) {
      for (let i = 0; i < numPixels; i++) {
        transposed[c * numPixels + i] = floatData[i * 3 + c];
      }
    }
    sandboxState.imageTensor = {
      data: transposed.buffer,
      dims: [1, 3, 224, 224]
    };
    console.log("[Sandbox] Image tensor prepared.");

    console.log("[Sandbox] Sending screenshot to OCR worker.");
    ocrWorker.postMessage({ type: 'performOCR', dataUrl });
  };

  img.onerror = (err) => {
    console.error("[Sandbox] Error loading image from dataUrl", err);
  };
}

ocrWorker.onmessage = (e) => {
  console.log("[Sandbox] Message received from OCR worker:", e.data);
  if (e.data.type === 'ocrResult') {
    latestOCRText = e.data.text;
    console.log("[Sandbox] OCR text received:", latestOCRText);
    const dummyInputIds = new Int32Array(128).fill(0);
    const dummyAttentionMask = new Int32Array(128).fill(1);
    const payload = {
      imageTensor: sandboxState.imageTensor,
      input_ids: dummyInputIds.buffer,
      attention_mask: dummyAttentionMask.buffer,
      ocrText: latestOCRText
    };
    console.log("[Sandbox] Sending payload to ONNX worker:", payload);
    onnxWorker.postMessage({ type: 'runInference', payload }, [
      payload.imageTensor.data,
      payload.input_ids,
      payload.attention_mask
    ]);
  }
};

onnxWorker.onmessage = (e) => {
  console.log("[Sandbox] Message received from ONNX worker:", e.data);
  if (e.data.type === 'inferenceResult') {
    const { classification, inferenceTime } = e.data;
    console.log("[Sandbox] Inference result received:", classification, inferenceTime);
    chrome.runtime.sendMessage({
      type: 'updateResults',
      classification,
      inferenceTime,
      screenshot: sandboxState.resizedDataUrl
    });
    console.log("[Sandbox] Forwarded results to popup.");
  }
};

ocrWorker.onerror = (e) => console.error("[Sandbox] OCR Worker error:", e);
onnxWorker.onerror = (e) => console.error("[Sandbox] ONNX Worker error:", e);
