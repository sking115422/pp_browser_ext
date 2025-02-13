// src/ocr_worker.js

import Tesseract from 'tesseract.js';

console.log("[OCR Worker] Worker started.");

self.onmessage = async (e) => {
  console.log("[OCR Worker] Message received:", e.data);
  if (e.data.type === 'performOCR') {
    const { dataUrl } = e.data;
    try {
      console.log("[OCR Worker] Running Tesseract OCR...");
      const result = await Tesseract.recognize(dataUrl, 'eng', { logger: m => console.log("[OCR Worker] Logger:", m) });
      const text = result.data.text;
      console.log("[OCR Worker] OCR result obtained.");
      self.postMessage({ type: 'ocrResult', text });
    } catch (err) {
      console.error("[OCR Worker] Error during OCR:", err);
      self.postMessage({ type: 'ocrResult', text: '' });
    }
  }
};
