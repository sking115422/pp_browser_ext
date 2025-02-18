// src/background.js
console.log("[Background] Service worker loaded.");

// Instantiate workers.
// IMPORTANT: The OCR worker must be a classic worker so that Tesseract’s importScripts works.
// const ocrWorkerURL = chrome.runtime.getURL('ocr_worker.js');
// const ocrWorker = new Worker(ocrWorkerURL, { type: 'classic' });
// console.log("[Background] OCR workers instantiated.");
const onnxWorkerURL = chrome.runtime.getURL('onnx_worker.js');
const onnxWorker = new Worker(onnxWorkerURL, { type: 'module' });
console.log("[Background] ONNX worker instantiated.");

// Process screenshot image and return processed data
async function processScreenshot(dataUrl) {
  console.log("[Sandbox] Processing screenshot...");

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = dataUrl;

    img.onload = async () => {
      console.log("[Sandbox] Image loaded from dataUrl.");
      const canvas = new OffscreenCanvas(224, 224);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, 224, 224);

      // Convert to Blob and Data URL
      const blob = await canvas.convertToBlob();
      const reader = new FileReader();

      reader.onloadend = () => {
        const resizedDataUrl = reader.result;  // Resized image as data URL
        console.log("[Sandbox] Resized image dataUrl ready.");
        
        // Process Image Data
        const imageData = ctx.getImageData(0, 0, 224, 224);
        const { data } = imageData;
        const floatData = new Float32Array(224 * 224 * 3);
        let j = 0;
        for (let i = 0; i < data.length; i += 4) {
          floatData[j++] = data[i] / 255.0;
          floatData[j++] = data[i + 1] / 255.0;
          floatData[j++] = data[i + 2] / 255.0;
        }
        
        // Transpose Image Data to Channel-First Format
        const numPixels = 224 * 224;
        const transposed = new Float32Array(3 * numPixels);
        for (let c = 0; c < 3; c++) {
          for (let i = 0; i < numPixels; i++) {
            transposed[c * numPixels + i] = floatData[i * 3 + c];
          }
        }

        const imageTensor = {
          data: transposed.buffer,
          dims: [1, 3, 224, 224]
        };

        console.log("[Sandbox] Image tensor prepared.");

        // // OCR Processing request
        // const ocrRequest = { type: 'performOCR', dataUrl };
        // if (ocrWorkerInitialized) {
        //   console.log("[Sandbox] Sending screenshot to OCR worker.");
        //   ocrWorker.postMessage(ocrRequest);
        // } else {
        //   console.log("[Sandbox] OCR worker not ready, queuing OCR request.");
        //   pendingOCRRequests.push(ocrRequest);
        // }

        // Resolve the promise with the processed data
        resolve({ resizedDataUrl, imageTensor });
      };

      reader.onerror = reject;
      reader.readAsDataURL(blob);
    };

    img.onerror = (err) => {
      console.error("[Sandbox] Error loading image from dataUrl", err);
      reject(err);
    };
  });
}

async function runInference(processedScreenshotData) {
  // Prepare dummy arrays for ONNX inference.
  const dummyInputIds = new Int32Array(128).fill(0);
  const dummyAttentionMask = new Int32Array(128).fill(1);
  const payload = {
    imageTensor: processedScreenshotData.imageTensor,
    input_ids: dummyInputIds.buffer,
    attention_mask: dummyAttentionMask.buffer,
    ocrText: "This is dummy text"
  };

  console.log("[Sandbox] Sending payload to ONNX worker:", payload);

  // Await the inference response from the worker.
  const inferenceResponse = await new Promise((resolve, reject) => {
    const handleMessage = (e) => {
      console.log("[Sandbox] Message received from ONNX worker:", e.data);
      if (e.data.type === 'inferenceResult') {
        // Clean up the event listener.
        onnxWorker.removeEventListener('message', handleMessage);
        // Return only the inference result.
        resolve(e.data.inferenceResponse);
      }
    };

    onnxWorker.addEventListener('message', handleMessage);

    // Handle any errors from the worker.
    onnxWorker.onerror = (err) => {
      console.error("[Sandbox] ONNX worker error:", err);
      reject(err);
    };

    // Send the payload to the worker, transferring the buffers.
    onnxWorker.postMessage(
      { type: 'runInference', payload },
      [
        payload.imageTensor.data,
        payload.input_ids,
        payload.attention_mask
      ]
    );
  });

  return inferenceResponse;
}

// Message reciever
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  switch (message.type) {

    case "test_sb_2_bg":
      console.log("[Background] ", message.data);
      break;

    default:
      console.warn("Unknown message type:", message.type);
  }
  
});

// Function to capture and return a screenshot
function captureScreenshotAndSend() {
  console.log("[Background] Attempting to capture screenshot...");
  chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
    if (chrome.runtime.lastError || !dataUrl) {
      console.error("[Background] Error capturing screenshot:", chrome.runtime.lastError);
      return;
    }
    console.log("[Background] Screenshot captured.");
    // Send the screenshot via runtime message.
    return dataUrl;
  });
}



// Periodically capture screenshots if the extension's toggle is ON.
setInterval(() => {
  chrome.storage.local.get("toggleState", (data) => {
    if (data.toggleState) {

      console.log("[Background] Toggle is ON");

      // chrome.runtime.sendMessage({ type: 'test_bg_2_sb', data: 'This is a test message: background.js -> sandbox.js'});      

      let rawScreenshotData = captureScreenshotAndSend();
      console.log(rawScreenshotData)
      let processedScreenshotData = processScreenshot(rawScreenshotData);
      console.log(processedScreenshotData)

    } else {
      console.log("[Background] Toggle is OFF");
    }
  });
}, 10000);
