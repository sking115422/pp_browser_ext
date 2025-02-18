// src/sandbox.js
console.log("[Sandbox] Sandbox document loaded.");

// Instantiate workers.
// IMPORTANT: The OCR worker must be a classic worker so that Tesseract’s importScripts works.
// const ocrWorker = new Worker('ocr_worker.js', { type: 'classic' });
// const onnxWorker = new Worker('onnx_worker.js', { type: 'module' });
// console.log("[Sandbox] ONNX worker instantiated.");
// console.log("[Sandbox] OCR and ONNX workers instantiated.");

async function createOnnxWorker() {
  const workerCode = `
    importScripts('chrome-extension://bdkaihcdbgcefdbhokfgfiahdibaedpp/onnx_worker.js');
  `;

  const blob = new Blob([workerCode], { type: 'application/javascript' });
  const workerURL = URL.createObjectURL(blob);

  return new Worker(workerURL);
}

(async () => {
  try {
    window.onnxWorker = await createOnnxWorker();
    console.log("[Sandbox] ONNX Worker created successfully.");
  } catch (error) {
    console.error("[Sandbox] Failed to create ONNX Worker:", error);
  }
})();

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

async function runInference(event, processedScreenshotData) {
  return new Promise((resolve, reject) => {
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

    // Send the message to the ONNX worker with transferable buffers
    onnxWorker.postMessage({ type: 'runInference', payload }, [
      payload.imageTensor.data,
      payload.input_ids,
      payload.attention_mask
    ]);

    // Function to handle the worker's response
    const handleMessage = (e) => {
      console.log("[Sandbox] Message received from ONNX worker:", e.data);

      if (e.data.type === 'inferenceResult') {
        // Clean up listener after receiving the expected response
        onnxWorker.removeEventListener('message', handleMessage);

        // Forward inference results to the parent
        event.source.postMessage({ type: 'updateResults', ...e.data }, "*");

        // Resolve the Promise with the inference results
        resolve(e.data);
      }
    };

    // Attach event listener for the ONNX worker
    onnxWorker.addEventListener('message', handleMessage);

    // Handle worker errors
    onnxWorker.onerror = (err) => {
      console.error("[Sandbox] ONNX worker error:", err);
      reject(err);
    };
  });
}


// Message Forwarder
window.addEventListener("message", async (event) => {

  if (event.origin !== "chrome-extension://bdkaihcdbgcefdbhokfgfiahdibaedpp") return;

  switch (event.data.type) {

    case "test_bg_2_sb":
      console.log("[Sandbox] ", event.data.data)
      event.source.postMessage({ type: 'test_sb_2_bg', data: "This is a test message: background.js <- sandbox.js" }, "*");
      break;

    case "screenshot":
      console.log("[Sandbox] Screenshot received.")
      let processedScreenshotData = await processScreenshot(event.data.data)
      console.log(processedScreenshotData)
      await runInference(event, processedScreenshotData)

      break;

    default:
      console.warn("Unknown message type:", event.data.type);
  }
  
});

// // Compute local URLs for your Tesseract assets.
// const workerURL = chrome.runtime.getURL
//   ? chrome.runtime.getURL('libs/tesseract/worker.min.js')
//   : new URL('libs/tesseract/worker.min.js', location.origin).toString();
// const coreURL = chrome.runtime.getURL
//   ? chrome.runtime.getURL('libs/tesseract_core/tesseract-core.wasm.js')
//   : new URL('libs/tesseract_core/tesseract-core.wasm.js', location.origin).toString();

// // Send configuration to the OCR worker with the local asset URLs.
// ocrWorker.postMessage({
//   type: 'config',
//   workerPath: workerURL,
//   corePath: coreURL
// });

// // State variables.
// const sandboxState = {
//   resizedDataUrl: null,
//   imageTensor: null // { data: ArrayBuffer, dims: [1, 3, 224, 224] }
// };

// let latestOCRText = null;
// let ocrWorkerInitialized = false;
// let pendingOCRRequests = [];

// // Listen for messages from the OCR worker.
// ocrWorker.onmessage = (e) => {
//   const data = e.data;
//   if (data.type === 'initialized') {
//     ocrWorkerInitialized = true;
//     console.log("[Sandbox] OCR worker is now initialized.");
//     pendingOCRRequests.forEach(req => ocrWorker.postMessage(req));
//     pendingOCRRequests = [];
//   } else if (data.type === 'ocrResult') {
//     latestOCRText = data.text;
//     console.log("[Sandbox] OCR text received:", latestOCRText);
//     // Prepare dummy arrays for ONNX inference.
//     const dummyInputIds = new Int32Array(128).fill(0);
//     const dummyAttentionMask = new Int32Array(128).fill(1);
//     const payload = {
//       imageTensor: sandboxState.imageTensor,
//       input_ids: dummyInputIds.buffer,
//       attention_mask: dummyAttentionMask.buffer,
//       ocrText: latestOCRText
//     };
//     console.log("[Sandbox] Sending payload to ONNX worker:", payload);
//     onnxWorker.postMessage({ type: 'runInference', payload }, [
//       payload.imageTensor.data,
//       payload.input_ids,
//       payload.attention_mask
//     ]);
//   }
// };

// // Listen for messages from the host (parent window).
// window.addEventListener("message", (event) => {
//   const data = event.data;
//   console.log("[Sandbox] Received message from parent:", data);
//   if (data.type === 'screenshotCaptured') {
//     processScreenshot(data.dataUrl);
//   }
// });

// // Listen for ONNX worker messages and forward them to the parent.
// onnxWorker.onmessage = (e) => {
//   console.log("[Sandbox] Message received from ONNX worker:", e.data);
//   if (e.data.type === 'inferenceResult') {
//     // Forward inference results to the parent.
//     window.parent.postMessage({ type: 'updateResults', ...e.data }, "*");
//   }
// };

// // Handle worker errors.
// ocrWorker.onerror = (e) => console.error("[Sandbox] OCR Worker error:", e);
// onnxWorker.onerror = (e) => console.error("[Sandbox] ONNX Worker error:", e);
