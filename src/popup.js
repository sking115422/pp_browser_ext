import { createWorker } from 'tesseract.js';

document.addEventListener('DOMContentLoaded', async () => {
  // Request a screenshot from the background script
  chrome.runtime.sendMessage({ action: 'capture' }, async (response) => {
    if (chrome.runtime.lastError || response.error) {
      const errorMessage = chrome.runtime.lastError?.message || response.error;
      console.error('Error capturing screenshot:', errorMessage);
      document.getElementById('ocr-result').innerText = 'Error: ' + errorMessage;
      return;
    }

    const screenshotDataUrl = response.screenshot;

    // Display the screenshot under the "Screenshot" heading
    const screenshotContainer = document.getElementById('screenshot-container');
    const imgElement = document.createElement('img');
    imgElement.src = screenshotDataUrl;
    imgElement.style.width = '100%';
    screenshotContainer.appendChild(imgElement);

    // Perform OCR using WASM
    performOCR(screenshotDataUrl);
  });
});

// ✅ Load Tesseract.js worker from local extension files
async function performOCR(imageDataUrl) {
  console.log("Initializing OCR...");

  // Create a Tesseract.js worker without Web Workers
  const worker = await createWorker({
    workerPath: chrome.runtime.getURL("libs/tesseract.js/worker.min.js"),
    corePath: chrome.runtime.getURL("libs/tesseract.js-core"),
    langPath: chrome.runtime.getURL("libs/langs"),
    logger: (m) => console.log(m) // Log OCR progress
  });

  await worker.load();
  await worker.loadLanguage("eng");
  await worker.initialize("eng");

  const { data: { text } } = await worker.recognize(imageDataUrl);

  console.log("OCR Extracted Text:", text);
  document.getElementById('ocr-result').innerText = text;

  await worker.terminate();
}
