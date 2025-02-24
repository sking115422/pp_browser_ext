// ocr_worker.js (classic worker)
// self.onmessage = async function (e) {
//   if (e.data.type === 'initOcr') {
//     const { tesseractWorkerUrl, tesseractCoreUrl } = e.data;
//     // Dynamically import Tesseract (using importScripts)
//     importScripts(e.data.tesseractUrl);
//     // Use the worker API to create a Tesseract worker:
//     const { createWorker } = Tesseract;
//     const worker = createWorker({
//       // Ensure these paths point to your local files
//       workerPath: tesseractWorkerUrl,
//       corePath: tesseractCoreUrl, // optional: if you have a local core file (often ends with .wasm.js)
//       logger: m => console.log("[OCR Worker] Logger:", m),
//     });
//     await worker.load();
//     await worker.loadLanguage('eng');
//     await worker.initialize('eng');
//     // Save the worker instance for later OCR calls.
//     self.tesseractWorkerInstance = worker;
//     self.postMessage({ type: 'initComplete' });
//     return;
//   }

//   if (e.data.type === 'performOCR') {
//     if (!self.tesseractWorkerInstance) {
//       console.error("[OCR Worker] Tesseract worker is not initialized.");
//       self.postMessage({ type: 'ocrResult', text: '' });
//       return;
//     }
//     const { dataUrl } = e.data;
//     try {
//       const { data: { text } } = await self.tesseractWorkerInstance.recognize(dataUrl);
//       console.log("[OCR Worker] OCR result obtained.");
//       self.postMessage({ type: 'ocrResult', text });
//     } catch (err) {
//       console.error("[OCR Worker] Error during OCR:", err);
//       self.postMessage({ type: 'ocrResult', text: '' });
//     }
//   }
// };


self.onmessage = async function (e) {
  if (e.data.type === 'performOCR') {
    console.log("[OCR Worker] Returning Dummy Text");
    self.postMessage({ type: 'ocrResult', text: 'this is dummy text' });
  }
};