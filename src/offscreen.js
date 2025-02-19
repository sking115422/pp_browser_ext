// offscreen.js
import { AutoTokenizer } from '@xenova/transformers';

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

// Initialize the tokenizer once.
// We store the promise so that later we can await it if needed.
// const localTokenizerPath = chrome.runtime.getURL('models/bert_mini_tokenizer/');
// console.log("[Offscreen] Tokenizer path: ", localTokenizerPath)
const tokenizerPromise = AutoTokenizer.from_pretrained('bert_mini_tokenizer').then(tokenizer => {
  console.log("[Offscreen] Local tokenizer loaded.");
  return tokenizer;
})
.catch(err => {
  console.error("[Offscreen] Error loading local tokenizer:", err);
});

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

// OCR Worker Call
ocrWorker.onmessage = async (e) => {
  console.log("[Offscreen] Message received from OCR worker:", e.data);
  if (e.data.type === 'ocrResult') {
    latestOCRText = e.data.text;
    console.log("[Offscreen] OCR text received:", latestOCRText);
    
    // Await the tokenizer if it hasn't loaded yet.
    const tokenizer = await tokenizerPromise;

    // Tokenize the OCR text.
    const { input_ids, attention_mask } = await tokenizer(latestOCRText, {
      truncation: true,
      padding: 'max_length',
      max_length: 128,
    });
    
    console.log("[Offscreen] Tokenized text:", { input_ids, attention_mask });
    
    // Extract the underlying typed arrays from the Proxy Tensor objects.
    // Note: input_ids.data and attention_mask.data are BigInt64Array.
    const inputIdsData = input_ids.data;         // BigInt64Array(128)
    const attentionMaskData = attention_mask.data; // BigInt64Array(128)
    
    const payload = {
      imageTensor: offscreenState.imageTensor,
      // Pass the underlying buffers
      input_ids: inputIdsData.buffer,
      attention_mask: attentionMaskData.buffer,
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

// ONNX Worker Call
onnxWorker.onmessage = (e) => {
  console.log("[Offscreen] Message received from ONNX worker:", e.data);
  if (e.data.type === 'inferenceResult') {
    const { classification, inferenceTime, ocrText } = e.data;
    console.log("[Offscreen] Inference result received:", classification, inferenceTime);
    // Forward results to the popup.
    chrome.runtime.sendMessage({
      type: 'updateResults',
      classification,
      inferenceTime,
      screenshot: offscreenState.resizedDataUrl,
      ocrText
    });
    console.log("[Offscreen] Forwarded results to popup.");
  }
};

ocrWorker.onerror = (e) => console.error("[Offscreen] OCR Worker error:", e);
onnxWorker.onerror = (e) => console.error("[Offscreen] ONNX Worker error:", e);
