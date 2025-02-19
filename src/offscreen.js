// offscreen.js
console.log("[Offscreen] Offscreen document loaded.");

chrome.runtime.sendMessage({ type: 'offscreenLoaded', message: "Offscreen document is active." });

// Instantiate workers
const tesseractUrl = chrome.runtime.getURL('libs/tesseract/tesseract.min.js');
const tesseractWorkerUrl = chrome.runtime.getURL('libs/tesseract/worker.min.js');
const ocrWorkerURL = chrome.runtime.getURL('ocr_worker.js');
const ocrWorker = new Worker(ocrWorkerURL, { type: 'classic' });
ocrWorker.postMessage({
  type: 'initOcr',
  tesseractUrl,
  tesseractWorkerUrl
});
console.log("[Offscreen] OCR worker instantiated.");

const onnxWorker = new Worker('onnx_worker.js', { type: 'module' });
console.log("[Offscreen] ONNX worker instantiated.");

const offscreenState = {
  resizedDataUrl: null,
  imageTensor: null // { data: ArrayBuffer, dims: [1, 3, 224, 224] }
};

let latestOCRText = null;

// Listen for messages from the background.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[Offscreen] Message received from background:", message);
  if (message.type === 'screenshotCaptured') {
    processScreenshot(message.dataUrl);
  }
});

async function processScreenshot(dataUrl) {
  console.log("[Offscreen] Processing screenshot...");
  const img = new Image();
  img.src = dataUrl;
  img.onload = () => {
    console.log("[Offscreen] Image loaded from dataUrl.");
    const canvas = new OffscreenCanvas(224, 224);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, 224, 224);

    canvas.convertToBlob().then(blob => {
      const reader = new FileReader();
      reader.onloadend = () => {
        offscreenState.resizedDataUrl = reader.result;
        console.log("[Offscreen] Resized image dataUrl stored.");
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
    offscreenState.imageTensor = {
      data: transposed.buffer,
      dims: [1, 3, 224, 224]
    };
    console.log("[Offscreen] Image tensor prepared.");

    console.log("[Offscreen] Sending screenshot to OCR worker.");
    ocrWorker.postMessage({ type: 'performOCR', dataUrl });
  };

  img.onerror = (err) => {
    console.error("[Offscreen] Error loading image from dataUrl", err);
  };
}

ocrWorker.onmessage = (e) => {
  console.log("[Offscreen] Message received from OCR worker:", e.data);
  if (e.data.type === 'ocrResult') {
    latestOCRText = e.data.text;
    console.log("[Offscreen] OCR text received:", latestOCRText);
    // Prepare dummy token arrays.
    const dummyInputIds = new Int32Array(128).fill(0);
    const dummyAttentionMask = new Int32Array(128).fill(1);
    const payload = {
      imageTensor: offscreenState.imageTensor,
      input_ids: dummyInputIds.buffer,
      attention_mask: dummyAttentionMask.buffer,
      ocrText: latestOCRText
    };
    console.log("[Offscreen] Sending payload to ONNX worker:", payload);
    onnxWorker.postMessage({ type: 'runInference', payload }, [
      payload.imageTensor.data,
      payload.input_ids,
      payload.attention_mask
    ]);
  }
};

onnxWorker.onmessage = (e) => {
  console.log("[Offscreen] Message received from ONNX worker:", e.data);
  if (e.data.type === 'inferenceResult') {
    const { classification, inferenceTime } = e.data;
    console.log("[Offscreen] Inference result received:", classification, inferenceTime);
    // Forward results to the popup.
    chrome.runtime.sendMessage({
      type: 'updateResults',
      classification,
      inferenceTime,
      screenshot: offscreenState.resizedDataUrl
    });
    console.log("[Offscreen] Forwarded results to popup.");
  }
};

ocrWorker.onerror = (e) => console.error("[Offscreen] OCR Worker error:", e);
onnxWorker.onerror = (e) => console.error("[Offscreen] ONNX Worker error:", e);
