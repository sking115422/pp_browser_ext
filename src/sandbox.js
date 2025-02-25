// src/sandbox.js
import { AutoTokenizer } from '@xenova/transformers';

const IMG_SIZE = { width: 1920, height: 1080 };
const IMG_SCALE_FACTOR = 0.5;

console.log("[Sandbox] Sandbox document loaded.");

// Notify parent (popup) that the sandbox is active.
window.parent.postMessage({ type: 'sandboxLoaded', message: "Sandbox document is active." }, "*");

// Instantiate workers

// Load Tesseract worker.
let ocrWorker;
try {
  console.log("[Sandbox] Loading Tesseract worker");
  ocrWorker = await Tesseract.createWorker('eng');
  console.log("[Sandbox] Tesseract worker loaded and instantiated.");
} catch (error) {
  console.error("[Sandbox] Tesseract worker loading error: ", error);
}

// Instantiate the ONNX worker.
const onnxWorker = new Worker('onnx_worker.js', { type: 'module' });
console.log("[Sandbox] ONNX worker instantiated.");

// Object to store state (resized image and tensor).
const offscreenState = {
  resizedDataUrl: null,
  imageTensor: null // { data: ArrayBuffer, dims: [1, 3, 224, 224] }
};

let latestOCRText = null;

// Initialize the tokenizer once.
const tokenizerPromise = AutoTokenizer.from_pretrained('bert_mini_tokenizer')
  .then(tokenizer => {
    console.log("[Sandbox] Local tokenizer loaded.");
    return tokenizer;
  })
  .catch(err => {
    console.error("[Sandbox] Error loading local tokenizer:", err);
  });

// Listen for messages from the parent (popup).
window.addEventListener("message", (event) => {
  const message = event.data;
  console.log("[Sandbox] Message received from parent:", message);
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

    // Get original dimensions.
    const origWidth = img.naturalWidth;
    const origHeight = img.naturalHeight;

    // STEP 1: Resize if necessary so that the longest side equals the target.
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

    // STEP 2: Pad the image to match IMG_SIZE.
    const paddedCanvas = new OffscreenCanvas(IMG_SIZE.width, IMG_SIZE.height);
    const paddedCtx = paddedCanvas.getContext("2d");
    paddedCtx.fillStyle = "black";
    paddedCtx.fillRect(0, 0, IMG_SIZE.width, IMG_SIZE.height);
    const padX = Math.floor((IMG_SIZE.width - intermediateWidth) / 2);
    const padY = Math.floor((IMG_SIZE.height - intermediateHeight) / 2);
    paddedCtx.drawImage(resizeCanvas, padX, padY, intermediateWidth, intermediateHeight);

    // STEP 3: Scale the padded image.
    const finalWidth = Math.round(IMG_SIZE.width * IMG_SCALE_FACTOR);
    const finalHeight = Math.round(IMG_SIZE.height * IMG_SCALE_FACTOR);
    const finalCanvas = new OffscreenCanvas(finalWidth, finalHeight);
    const finalCtx = finalCanvas.getContext("2d");
    finalCtx.drawImage(paddedCanvas, 0, 0, finalWidth, finalHeight);

    // Convert the final canvas to a Blob and then to a data URL.
    finalCanvas.convertToBlob().then((blob) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        offscreenState.resizedDataUrl = reader.result;
        console.log("[Sandbox] Resized, padded, and scaled image dataUrl stored.");
      };
      reader.readAsDataURL(blob);
    });

    // Prepare the image tensor.
    const imageData = finalCtx.getImageData(0, 0, finalWidth, finalHeight);
    const { data } = imageData;
    const numPixels = finalWidth * finalHeight;
    const floatData = new Float32Array(numPixels * 3);
    let j = 0;
    for (let i = 0; i < data.length; i += 4) {
      floatData[j++] = data[i] / 255.0;
      floatData[j++] = data[i + 1] / 255.0;
      floatData[j++] = data[i + 2] / 255.0;
    }

    // Transpose data from [H, W, 3] to [1, 3, W, H].
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

    offscreenState.imageTensor = {
      data: transposed.buffer,
      dims: [1, 3, finalWidth, finalHeight]
    };
    console.log("[Sandbox] Image tensor prepared with dims [1, 3, finalWidth, finalHeight].");

    console.log("[Sandbox] Sending screenshot to OCR worker.");
    // Send the screenshot to the OCR worker.
    ocrWorker.postMessage({ type: "performOCR", dataUrl });
  };

  img.onerror = (err) => {
    console.error("[Sandbox] Error loading image from dataUrl", err);
  };
}

// Handle OCR worker messages.
ocrWorker.onmessage = async (e) => {
  console.log("[Sandbox] Message received from OCR worker:", e.data);
  if (e.data.type === 'ocrResult') {
    latestOCRText = e.data.text;
    console.log("[Sandbox] OCR text received:", latestOCRText);
    
    // Await the tokenizer.
    const tokenizer = await tokenizerPromise;
    const { input_ids, attention_mask } = await tokenizer(latestOCRText, {
      truncation: true,
      padding: 'max_length',
      max_length: 512,
    });
    
    console.log("[Sandbox] Tokenized text:", { input_ids, attention_mask });
    
    const payload = {
      imageTensor: offscreenState.imageTensor,
      input_ids: input_ids.data.buffer,
      attention_mask: attention_mask.data.buffer,
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
    const { classification, inferenceTime, ocrText } = e.data;
    console.log("[Sandbox] Inference result received:", classification, inferenceTime);
    // Forward results to the parent (popup).
    window.parent.postMessage({
      type: 'updateResults',
      classification,
      inferenceTime,
      screenshot: offscreenState.resizedDataUrl,
      ocrText
    }, "*");
    window.parent.postMessage({ type: "inferenceFinished", data: true }, "*");
    console.log("[Sandbox] Forwarded results to parent.");
  }
};

ocrWorker.onerror = (e) => console.error("[Sandbox] OCR Worker error:", e);
onnxWorker.onerror = (e) => console.error("[Sandbox] ONNX Worker error:", e);

