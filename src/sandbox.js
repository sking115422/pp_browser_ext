// import { createWorker } from 'tesseract.js';

// Log when the sandbox script is loaded
console.log("Sandbox script loaded");

window.addEventListener('message', async (event) => {
  console.log("Sandbox received message:", event.data);
  if (event.data && event.data.type === 'ocr' && event.data.imageDataUrl) {
    const statusEl = document.getElementById('ocr-status');
    statusEl.innerText = 'Initializing OCR...';
    console.log("Starting OCR process");

    try {
      // Create a Tesseract.js worker using the global Tesseract object
      console.log("Loading Tesseract worker");
      const worker = await Tesseract.createWorker('eng');
      
      console.log("Performing OCR recognition");
      const { data: { text } } = await worker.recognize(event.data.imageDataUrl);
      
      console.log("OCR Completed. Extracted text:", text);
      statusEl.innerText = 'OCR Completed';
      
      // Send the OCR result back to the parent (popup)
      window.parent.postMessage({ type: 'ocr-result', text: text }, '*');
      
      await worker.terminate();
    } catch (error) {
      console.error("OCR error:", error);
      statusEl.innerText = 'Error: ' + error.message;
      window.parent.postMessage({ type: 'ocr-error', error: error.message }, '*');
    }
  }
});

// Log when the sandbox window has finished loading
window.addEventListener('load', () => {
  console.log("Sandbox window loaded");
});
