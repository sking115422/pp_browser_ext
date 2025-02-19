// offscreen.js
import { AutoTokenizer } from '@xenova/transformers';

const IMG_SIZE = { width: 1920, height: 1080 };
const IMG_SCALE_FACTOR = 0.5;

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

    // Original dimensions.
    const origWidth = img.naturalWidth;
    const origHeight = img.naturalHeight;

    // STEP 1: Resize if necessary so that the longest side equals the longest side of IMG_SIZE.
    const targetLongest = Math.max(IMG_SIZE.width, IMG_SIZE.height);
    const origLongest = Math.max(origWidth, origHeight);
    let intermediateWidth, intermediateHeight;

    if (origLongest > targetLongest) {
      const scaleDownFactor = targetLongest / origLongest;
      intermediateWidth = Math.round(origWidth * scaleDownFactor);
      intermediateHeight = Math.round(origHeight * scaleDownFactor);
    } else {
      intermediateWidth = origWidth;
      intermediateHeight = origHeight;
    }

    // Draw the (possibly resized) image on an offscreen canvas.
    const resizeCanvas = new OffscreenCanvas(intermediateWidth, intermediateHeight);
    const resizeCtx = resizeCanvas.getContext("2d");
    resizeCtx.drawImage(img, 0, 0, intermediateWidth, intermediateHeight);

    // STEP 2: Pad the image to ensure it matches IMG_SIZE.
    const paddedCanvas = new OffscreenCanvas(IMG_SIZE.width, IMG_SIZE.height);
    const paddedCtx = paddedCanvas.getContext("2d");

    // Fill the padded canvas with black.
    paddedCtx.fillStyle = "black";
    paddedCtx.fillRect(0, 0, IMG_SIZE.width, IMG_SIZE.height);

    // Compute the coordinates to center the resized image.
    const padX = Math.floor((IMG_SIZE.width - intermediateWidth) / 2);
    const padY = Math.floor((IMG_SIZE.height - intermediateHeight) / 2);
    paddedCtx.drawImage(resizeCanvas, padX, padY, intermediateWidth, intermediateHeight);

    // STEP 3: Scale the padded image by the IMG_SCALE_FACTOR.
    const finalWidth = Math.round(IMG_SIZE.width * IMG_SCALE_FACTOR);
    const finalHeight = Math.round(IMG_SIZE.height * IMG_SCALE_FACTOR);
    const finalCanvas = new OffscreenCanvas(finalWidth, finalHeight);
    const finalCtx = finalCanvas.getContext("2d");
    finalCtx.drawImage(paddedCanvas, 0, 0, finalWidth, finalHeight);

    // Convert the final canvas to a Blob, then to a data URL.
    finalCanvas.convertToBlob().then((blob) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        offscreenState.resizedDataUrl = reader.result;
        console.log("[Offscreen] Resized, padded, and scaled image dataUrl stored.");
      };
      reader.readAsDataURL(blob);
    });

    // Prepare the image tensor from the final canvas.
    const imageData = finalCtx.getImageData(0, 0, finalWidth, finalHeight);
    const { data } = imageData;
    const numPixels = finalWidth * finalHeight;

    // Create a Float32Array to hold normalized pixel values for RGB channels.
    const floatData = new Float32Array(numPixels * 3);
    let j = 0;
    for (let i = 0; i < data.length; i += 4) {
      // Normalize R, G, and B channels.
      floatData[j++] = data[i] / 255.0;
      floatData[j++] = data[i + 1] / 255.0;
      floatData[j++] = data[i + 2] / 255.0;
      // Ignore the alpha channel.
    }

    // Transpose the data from [finalHeight, finalWidth, 3] to [1, 3, finalWidth, finalHeight].
    // Here, for each pixel at row (r) and column (c):
    // - The source index is: (r * finalWidth + c) * 3.
    // - The destination index is computed such that channel data is ordered as (channel, c, r).
    const transposed = new Float32Array(3 * numPixels);
    for (let r = 0; r < finalHeight; r++) {
      for (let c = 0; c < finalWidth; c++) {
        for (let ch = 0; ch < 3; ch++) {
          const srcIndex = (r * finalWidth + c) * 3 + ch;
          const destIndex = ch * (finalWidth * finalHeight) + c * finalHeight + r;
          transposed[destIndex] = floatData[srcIndex];
        }
      }
    }

    // Store the tensor data with dims [1, 3, finalWidth, finalHeight].
    offscreenState.imageTensor = {
      data: transposed.buffer,
      dims: [1, 3, finalWidth, finalHeight]
    };
    console.log("[Offscreen] Image tensor prepared with dims [1, 3, finalWidth, finalHeight].");

    console.log("[Offscreen] Sending screenshot to OCR worker.");
    ocrWorker.postMessage({ type: "performOCR", dataUrl });
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
      max_length: 512,
    });
    
    console.log("[Offscreen] Tokenized text:", { input_ids, attention_mask });
    
    // Extract the underlying typed arrays from the Proxy Tensor objects.
    // Note: input_ids.data and attention_mask.data are BigInt64Array.
    const inputIdsData = input_ids.data;         // BigInt64Array(512)
    const attentionMaskData = attention_mask.data; // BigInt64Array(512)
    
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
    chrome.runtime.sendMessage({type: "inferenceFinished", data: true})
    console.log("[Offscreen] Forwarded results to popup.");
  }
};

ocrWorker.onerror = (e) => console.error("[Offscreen] OCR Worker error:", e);
onnxWorker.onerror = (e) => console.error("[Offscreen] ONNX Worker error:", e);
