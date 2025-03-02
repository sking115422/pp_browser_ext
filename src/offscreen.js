// src/offscreen.js

console.log('[Offscreen] - ' + Date.now() + ' - Offscreen document loaded.');

// Imports

import { AutoTokenizer } from '@xenova/transformers';

document.addEventListener('DOMContentLoaded', () => {
  const sandboxIframe = document.getElementById('sandboxIframe');
  if (!sandboxIframe) {
    console.error('[Offscreen] - sandboxIframe not found in DOM.');
  }

  // Open a long-lived offscreenPort to the background script
  const offscreenPort = chrome.runtime.connect({ name: 'offscreenPort' });

  // Init ONNX worker

  let onnxWorker = null;
  try {
    onnxWorker = new Worker(chrome.runtime.getURL('onnx_worker.js'), {
      type: 'module',
    });
    console.log('[Offscreen] - ' + Date.now() + ' - ONNX worker instantiated.');
  } catch (err) {
    console.error('[Offscreen] Error instantiating ONNX worker:', err);
  }

  if (!onnxWorker) {
    console.error('[Offscreen] ONNX worker is not defined.');
  } else {
    onnxWorker.onerror = (err) => {
      console.error('[Offscreen] ONNX worker error:', err);
    };
  }

  // Init tokenizer

  let tokenizer;
  AutoTokenizer.from_pretrained('bert_mini_tokenizer')
    .then((tknzr) => {
      tokenizer = tknzr;
      console.log('[Offscreen] - ' + Date.now() + ' - Tokenizer loaded.');
    })
    .catch((err) => console.error('[Offscreen] Error loading tokenizer:', err));

  // Functions

  // Process the screenshot image to create an image tensor.
  async function processImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const IMG_SIZE = { width: 1920, height: 1080 };
      const IMG_SCALE_FACTOR = 0.5;
      const img = new Image();
      img.onload = () => {
        console.log(
          '[Offscreen] - ' + Date.now() + ' - Image loaded for processing.',
        );
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
        const resizeCtx = resizeCanvas.getContext('2d');
        resizeCtx.drawImage(img, 0, 0, intermediateWidth, intermediateHeight);

        // Pad the image.
        const paddedCanvas = document.createElement('canvas');
        paddedCanvas.width = IMG_SIZE.width;
        paddedCanvas.height = IMG_SIZE.height;
        const paddedCtx = paddedCanvas.getContext('2d');
        paddedCtx.fillStyle = 'black';
        paddedCtx.fillRect(0, 0, IMG_SIZE.width, IMG_SIZE.height);
        const padX = Math.floor((IMG_SIZE.width - intermediateWidth) / 2);
        const padY = Math.floor((IMG_SIZE.height - intermediateHeight) / 2);
        paddedCtx.drawImage(
          resizeCanvas,
          padX,
          padY,
          intermediateWidth,
          intermediateHeight,
        );

        // Scale the padded image.
        const finalWidth = Math.round(IMG_SIZE.width * IMG_SCALE_FACTOR);
        const finalHeight = Math.round(IMG_SIZE.height * IMG_SCALE_FACTOR);
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = finalWidth;
        finalCanvas.height = finalHeight;
        const finalCtx = finalCanvas.getContext('2d');
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
              const destIndex =
                ch * (finalWidth * finalHeight) + c * finalHeight + r;
              transposed[destIndex] = floatData[srcIndex];
            }
          }
        }
        const imageTensor = {
          data: transposed.buffer,
          dims: [1, 3, finalWidth, finalHeight],
        };
        resolve({ imageTensor, resizedDataUrl: finalCanvas.toDataURL() });
      };
      img.onerror = (err) => reject(err);
      img.src = dataUrl;
    });
  }

  async function runInference(ssDataUrlRaw) {
    if (!sandboxIframe || !sandboxIframe.contentWindow) {
      throw new Error('Sandbox iframe not available');
    }

    // Start processing the image and the iframe request at the same time
    const processImagePromise = processImage(ssDataUrlRaw);
    const ocrRequestPromise = new Promise((resolve, reject) => {
      const messageId = Math.random().toString(36).substring(7); // Unique ID for tracking responses

      function handleMessage(event) {
        if (event.source !== sandboxIframe.contentWindow) return; // Ensure message comes from the expected iframe
        if (!event.data || event.data.messageId !== messageId) return; // Ensure correct message response

        window.removeEventListener('message', handleMessage); // Cleanup event listener
        resolve(event.data.response); // Resolve the promise with iframe's response
      }

      window.addEventListener('message', handleMessage);

      sandboxIframe.contentWindow.postMessage(
        { type: 'ssDataUrlRaw', dataUrl: ssDataUrlRaw, messageId },
        '*',
      );
    });

    // Wait for both promises to resolve
    const [ssDataProcessed, ocrResponse] = await Promise.all([
      processImagePromise,
      ocrRequestPromise,
    ]);

    // Tokenize OCR text

    const startTokenTime = Date.now();
    const tokenized = await tokenizer(ocrResponse.text, {
      truncation: true,
      padding: 'max_length',
      max_length: 512,
    });
    const endTokenTime = Date.now();
    const tokenTime = endTokenTime - startTokenTime;
    console.log(
      '[Offscreen] - ' +
        Date.now() +
        ' - Time to tokenize OCR text: ' +
        tokenTime +
        ' ms',
    );

    console.log('ssDataProcessed:', ssDataProcessed);
    console.log('tokenized:', tokenized);

    // Build payload using transferable buffers.
    const inputIdsBuffer = tokenized.input_ids.data.buffer; // Assumed to be an ArrayBuffer or use .buffer if needed
    const attentionMaskBuffer = tokenized.attention_mask.data.buffer; // Likewise

    // Build payload using transferable ArrayBuffers:
    const payload = {
      imageTensor: {
        data: ssDataProcessed.imageTensor.data,
        dims: ssDataProcessed.imageTensor.dims,
      },
      input_ids: inputIdsBuffer,
      attention_mask: attentionMaskBuffer,
    };

    // Send the payload to the ONNX worker and await its response.
    const inferenceResponse = await new Promise((resolve, reject) => {
      onnxWorker.onmessage = (event) => {
        resolve(event.data);
      };
      onnxWorker.onerror = (err) => {
        reject(err);
      };
      onnxWorker.postMessage(
        {
          type: 'runInference',
          payload: payload,
        },
        [ssDataProcessed.imageTensor.data, inputIdsBuffer, attentionMaskBuffer],
      );
    });

    console.log(
      '[Offscreen] - ' + Date.now() + ' - Inference result from ONNX worker:',
      inferenceResponse,
    );
  }

  // Listen for messages from background.js
  offscreenPort.onMessage.addListener((message) => {
    if (message.type === 'ssDataUrlRaw') {
      console.log(
        '[Offscreen] - ' + Date.now() + ' - Received screenshot.',
        message,
      );
      runInference(message.data);
    }
  });
});
