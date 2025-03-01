// src/background.js

// Global variables
let ocrFinised = 0;
let totalStartTime = 0;
let totalTime = 0;

let offscreenPort = null;

// Initializing message passing ports

chrome.runtime.onConnect.addListener((port) => {
  console.log('[Background] - ' + Date.now() + ' - Connected to:', port.name);

  if (port.name === 'offscreenPort') {
    offscreenPort = port;

    port.onDisconnect.addListener(() => {
      console.log('[Background] - ' + Date.now() + ' - Popup disconnected.');
      offscreenPort = null;
    });
  }
});

async function ensureOffscreen() {
  if (!chrome.offscreen) {
    console.warn(
      'chrome.offscreen API is not available. Offscreen inference will not work!',
    );
    return false;
  }
  try {
    const hasDocument = await chrome.offscreen.hasDocument();
    if (!hasDocument) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['WORKERS'],
        justification: 'Needed to run ONNX inference',
      });
      console.log(
        '[Background] - ' + Date.now() + ' - Offscreen document created.',
      );
    } else {
      console.log(
        '[Background] - ' +
          Date.now() +
          ' - Offscreen document already exists.',
      );
    }
    return true;
  } catch (err) {
    console.error('Error ensuring offscreen document:', err);
    return false;
  }
}

function captureScreenshot() {
  console.log(
    '[Background] - ' + Date.now() + ' - Attempting to capture screenshot...',
  );

  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) {
        console.error(
          '[Background] Error capturing screenshot:',
          chrome.runtime.lastError,
        );
        reject(chrome.runtime.lastError);
        return;
      }

      console.log('[Background] - ' + Date.now() + ' - Screenshot captured.');
      resolve(dataUrl);
    });
  });
}

async function processImage(dataUrl) {
  console.log('dataUrl1:', dataUrl);
  const IMG_SIZE = { width: 1920, height: 1080 };
  const IMG_SCALE_FACTOR = 0.5;

  // Convert a data URL to a Blob.
  function dataURLtoBlob(dataUrl) {
    const parts = dataUrl.split(',');
    const mimeMatch = parts[0].match(/:(.*?);/);
    if (!mimeMatch) {
      throw new Error('Invalid data URL');
    }
    const mime = mimeMatch[1];
    const bstr = atob(parts[1]);
    const n = bstr.length;
    const u8arr = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      u8arr[i] = bstr.charCodeAt(i);
    }
    return new Blob([u8arr], { type: mime });
  }

  // Load the image as an ImageBitmap.
  const blob = dataURLtoBlob(dataUrl);

  console.log('blob', blob);

  const imageBitmap = await createImageBitmap(blob);

  console.log('bitmap:', imageBitmap);
  const origWidth = imageBitmap.width;
  const origHeight = imageBitmap.height;
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

  // Resize the image using OffscreenCanvas.
  const resizeCanvas = new OffscreenCanvas(
    intermediateWidth,
    intermediateHeight,
  );
  const resizeCtx = resizeCanvas.getContext('2d');
  resizeCtx.drawImage(imageBitmap, 0, 0, intermediateWidth, intermediateHeight);

  // Pad the image.
  const paddedCanvas = new OffscreenCanvas(IMG_SIZE.width, IMG_SIZE.height);
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
  const finalCanvas = new OffscreenCanvas(finalWidth, finalHeight);
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
        const destIndex = ch * (finalWidth * finalHeight) + c * finalHeight + r;
        transposed[destIndex] = floatData[srcIndex];
      }
    }
  }
  const imageTensor = {
    data: transposed.buffer,
    dims: [1, 3, finalWidth, finalHeight],
  };

  console.log('imageTensor', imageTensor);

  // Convert the final canvas to a data URL.
  const finalBlob = await finalCanvas.convertToBlob();
  const resizedDataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(finalBlob);
  });

  console.log('resizedDataUrl:', resizedDataUrl);

  return { imageTensor, resizedDataUrl };
}

function sendSsDataToOffscreen(data) {
  // Send screenshot via open port if connected
  if (offscreenPort) {
    console.log(
      '[Background] - ' +
        Date.now() +
        ' - Sending processed screenshot data to offscreen.',
    );
    offscreenPort.postMessage({ type: 'processedSsData', data });
  } else {
    console.warn(
      '[Background] - offscreen not connected to receive the screenshot.',
    );
  }
}

// function captureScreenshotAndSend() {
//   console.log(
//     '[Background] - ' + Date.now() + ' - Attempting to capture screenshot...',
//   );
//   chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
//     if (chrome.runtime.lastError || !dataUrl) {
//       console.error(
//         '[Background] Error capturing screenshot:',
//         chrome.runtime.lastError,
//       );
//       return;
//     }
//     console.log('[Background] - ' + Date.now() + ' - Screenshot captured.');

//     // Send screenshot via open port if connected
//     if (offscreenPort) {
//       console.log('[Background] - Sending screenshot to offscreen.');
//       offscreenPort.postMessage({ type: 'screenshotCaptured', dataUrl });
//     } else {
//       console.warn(
//         '[Background] - offscreen not connected to receive the screenshot.',
//       );
//     }
//   });
// }

// Inference Init Function

async function runInference() {
  const startTakeSsTime = Date.now();
  totalStartTime = startTakeSsTime;
  // captureScreenshotAndSend();
  const ssDataUrlRaw = await captureScreenshot();
  const endTakeSsTime = Date.now();
  const takeSsTime = endTakeSsTime - startTakeSsTime;
  const ssProcessedData = await processImage(ssDataUrlRaw);
  console.log('ssProcessedData:', ssProcessedData);
  sendSsDataToOffscreen(ssProcessedData);

  console.log(
    '[Background] - ' +
      Date.now() +
      ' - Time to take screenshot: ' +
      takeSsTime +
      ' ms',
  );
}

setInterval(() => {
  ensureOffscreen();

  chrome.storage.local.get('toggleState', (data) => {
    if (data.toggleState) {
      console.log('[Background] - ' + Date.now() + ' - Toggle is ON.');
      runInference();
    } else {
      console.log('[Background] - ' + Date.now() + ' - Toggle is OFF.');
    }
  });
}, 10000);

///////////////////////////////////////////////////////////////////////////
