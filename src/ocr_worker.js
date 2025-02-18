// src/ocr_worker.js
import Tesseract from 'tesseract.js';

console.log("[OCR Worker] Worker started.");

let localWorkerPath = null;
let localCorePath = null;

self.onmessage = async (e) => {
  const data = e.data;
  console.log("[OCR Worker] Message received:", data);
  if (data.type === 'config') {
    localWorkerPath = data.workerPath;
    localCorePath = data.corePath;
    console.log("[OCR Worker] Config set:", localWorkerPath, localCorePath);
    self.postMessage({ type: 'initialized' });
  } else if (data.type === 'performOCR') {
    if (!localWorkerPath || !localCorePath) {
      console.error("[OCR Worker] Config not set. Cannot perform OCR.");
      self.postMessage({ type: 'ocrResult', text: '', error: 'Worker not configured' });
      return;
    }
    try {
      console.log("[OCR Worker] Running Tesseract OCR...");
      const result = await Tesseract.recognize(
        data.dataUrl,
        'eng',
        {
          logger: m => console.log("[OCR Worker] Logger:", m),
          workerPath: localWorkerPath,
          corePath: localCorePath
        }
      );
      const text = result.data.text;
      console.log("[OCR Worker] OCR result obtained:", text);
      self.postMessage({ type: 'ocrResult', text });
    } catch (err) {
      console.error("[OCR Worker] Error during OCR:", err);
      self.postMessage({ type: 'ocrResult', text: '', error: err.message });
    }
  }
};

