// src/popup.js
import { AutoTokenizer } from '@xenova/transformers';

document.addEventListener("DOMContentLoaded", () => {
  console.log("[Popup] - " + Date.now() + " - Popup loaded.");
  const screenshotEl = document.getElementById("screenshot");
  const ocrTextEl = document.getElementById("ocrText");
  const classificationEl = document.getElementById("classification");
  const onnxInferenceTimeEl = document.getElementById("onnxInferenceTime");
  const totalTimeEl = document.getElementById("totalTime");
  const toggleButton = document.getElementById("toggleButton");
  const sandboxIframe = document.getElementById("sandboxIframe");
  const ocrTimeEl = document.getElementById('ocrTime');
  const ssProcessingTimeEl = document.getElementById('ssProcessingTime')
  const tokenTimeEl = document.getElementById('tokenTime')

  // Update the toggle button based on stored state.
  chrome.storage.local.get("toggleState", (data) => {
    updateToggleButton(data.toggleState ?? false);
  });
  
  toggleButton.addEventListener("click", () => {
    chrome.storage.local.get("toggleState", (data) => {
      const newState = !data.toggleState;
      chrome.storage.local.set({ toggleState: newState }, () => {
        updateToggleButton(newState);
        console.log("[Popup] - " + Date.now() + " - Toggle state updated:", newState);
      });
    });
  });

  function updateToggleButton(isOn) {
    toggleButton.textContent = isOn ? "ON" : "OFF";
    toggleButton.className = isOn ? "on" : "off";
    console.log("[Popup] - " + Date.now() + " - Toggle button updated:", isOn);
  }

  // Load the tokenizer.
  let tokenizer;
  AutoTokenizer.from_pretrained('bert_mini_tokenizer')
    .then(tknzr => {
      tokenizer = tknzr;
      console.log("[Popup] - " + Date.now() + " - Tokenizer loaded.");
    })
    .catch(err => console.error("[Popup] Error loading tokenizer:", err));

  // Process the screenshot image to create an image tensor.
  async function processImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const IMG_SIZE = { width: 1920, height: 1080 };
      const IMG_SCALE_FACTOR = 0.5;
      const img = new Image();
      img.onload = () => {
        console.log("[Popup] - " + Date.now() + " - Image loaded for processing.");
        const origWidth = img.naturalWidth;
        const origHeight = img.naturalHeight;
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
        
        // Resize the image.
        const resizeCanvas = document.createElement('canvas');
        resizeCanvas.width = intermediateWidth;
        resizeCanvas.height = intermediateHeight;
        const resizeCtx = resizeCanvas.getContext("2d");
        resizeCtx.drawImage(img, 0, 0, intermediateWidth, intermediateHeight);
        
        // Pad the image.
        const paddedCanvas = document.createElement('canvas');
        paddedCanvas.width = IMG_SIZE.width;
        paddedCanvas.height = IMG_SIZE.height;
        const paddedCtx = paddedCanvas.getContext("2d");
        paddedCtx.fillStyle = "black";
        paddedCtx.fillRect(0, 0, IMG_SIZE.width, IMG_SIZE.height);
        const padX = Math.floor((IMG_SIZE.width - intermediateWidth) / 2);
        const padY = Math.floor((IMG_SIZE.height - intermediateHeight) / 2);
        paddedCtx.drawImage(resizeCanvas, padX, padY, intermediateWidth, intermediateHeight);
        
        // Scale the padded image.
        const finalWidth = Math.round(IMG_SIZE.width * IMG_SCALE_FACTOR);
        const finalHeight = Math.round(IMG_SIZE.height * IMG_SCALE_FACTOR);
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = finalWidth;
        finalCanvas.height = finalHeight;
        const finalCtx = finalCanvas.getContext("2d");
        finalCtx.drawImage(paddedCanvas, 0, 0, finalWidth, finalHeight);
        
        // Create the image tensor.
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
        // Transpose from [H, W, 3] to [1, 3, W, H].
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
        const imageTensor = {
          data: transposed.buffer,
          dims: [1, 3, finalWidth, finalHeight]
        };
        resolve({ imageTensor, resizedDataUrl: finalCanvas.toDataURL() });
      };
      img.onerror = (err) => reject(err);
      img.src = dataUrl;
    });
  }

  // Listen for messages from the background.
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("[Popup] - " + Date.now() + " - Message received from background:", message);
    if (message.type === 'screenshotCaptured' && message.dataUrl) {
      if (screenshotEl) screenshotEl.src = message.dataUrl;
      // Forward the screenshot to the sandbox for OCR.
      if (sandboxIframe && sandboxIframe.contentWindow) {
        sandboxIframe.contentWindow.postMessage({ type: 'screenshotCaptured', dataUrl: message.dataUrl }, "*");
      }

      // Process the image locally to create the image tensor.
      const startSsProcessing = Date.now();
      processImage(message.dataUrl)
        .then(result => {
          window.processedImage = result;
          console.log("[Popup] - " + Date.now() + " - Image processing complete.");
        })
        .catch(err => console.error("[Popup] Error processing image:", err));
       const endSsProcessing = Date.now();
       const ssProcessingTime = endSsProcessing-startSsProcessing;
       console.log("[Popup] - " + Date.now() + " - Screenshot processing time: " + ssProcessingTime + ' ms')
      //  if (ssProcessingTimeEl) ssProcessingTimeEl.textContent = ssProcessingTime + " ms"
    }
    
    if (message.type === 'inferenceResult') {
      console.log("[Popup] - " + Date.now() + " - Inference result received:", message);
      if (classificationEl) classificationEl.textContent = message.classification;
      if (onnxInferenceTimeEl) onnxInferenceTimeEl.textContent = message.onnxInferenceTime + " ms";
      // if (ocrTextEl) ocrTextEl.textContent = message.ocrText;
      chrome.runtime.sendMessage({ type: "inferenceFinished", data: true });
    }
    
    if (message.type === 'totalTime') {
      if (totalTimeEl) totalTimeEl.textContent = message.data + " ms";
      console.log("[Popup] - " + Date.now() + " - Total time updated:", message.data);
    }
  });

  // Listen for messages from the sandbox (OCR result).
  window.addEventListener("message", async (event) => {
    console.log("[Popup] - " + Date.now() + " - Message received from sandbox:", event.data);

    const data = event.data;

    if (data.type === 'sandboxLoaded') {
      console.log("[Popup] - " + Date.now() + " - Sandbox loaded:", data.message);
      chrome.runtime.sendMessage(data);
    }
    if (data.type === 'ocrResult' && data.text) {
      console.log("[Popup] - " + Date.now() + " - OCR result received from sandbox:", data.text);

      if (ocrTimeEl && data.ocrTime) {
        ocrTimeEl.textContent = data.ocrTime.toFixed(2) + " ms";
      }
      if (ocrTextEl && data.text) {
        ocrTextEl.textContent = data.text;
      }

      chrome.runtime.sendMessage({type: "ocrFinished"})
      
      const processed = window.processedImage;
      if (!processed) {
        console.error("[Popup] Processed image not available.");
        return;
      }
      if (!tokenizer) {
        console.error("[Popup] Tokenizer not loaded yet.");
        return;
      }
      
      const startTokenTime = Date.now()
      const tokenized = await tokenizer(data.text, {
        truncation: true,
        padding: 'max_length',
        max_length: 512,
      });
      const endTokenTime = Date.now()
      const tokenTime = endTokenTime - startTokenTime;
      console.log("[Popup] - " + Date.now() + " - Time to tokenize OCR text: " + tokenTime + ' ms')
      // if (tokenTimeEl) tokenTimeEl.textContent = tokenTime + " ms"

      const payload = {
        imageTensor: {
          // Convert the Float32Array into a regular array.
          data: Array.from(new Float32Array(window.processedImage.imageTensor.data)),
          dims: window.processedImage.imageTensor.dims
        },
        // Convert the BigInt64Array to a regular array of numbers (or strings if needed)
        // Note: BigInts don’t serialize as numbers, so you may need to convert them to strings.
        input_ids: Array.from(new BigInt64Array(tokenized.input_ids.data)).map(x => x.toString()),
        attention_mask: Array.from(new BigInt64Array(tokenized.attention_mask.data)).map(x => x.toString()),
        ocrText: data.text
      };
      
      console.log("[Popup] - " + Date.now() + " - Sending runInference message to background with payload:", payload);
      chrome.runtime.sendMessage({ type: 'runInference', payload });
    }
  });
});





///////////////////////////////////////////////////////////////////

// Open a long-lived popupPort to the background script
const popupPort = chrome.runtime.connect({ name: "popup" });

// Listen for messages from background.js
popupPort.onMessage.addListener((message) => {
    console.log("Received from background:", message);
});

setInterval(() => {
  console.log("Sending message to background...");
  popupPort.postMessage({ greeting: "Hello from popup!" });
}, 3000);


