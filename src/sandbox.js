console.log("[Sandbox] Sandbox document loaded.");

// Notify parent (popup) that the sandbox is active.
window.parent.postMessage(
  { type: 'sandboxLoaded', message: "Sandbox document is active." },
  "*"
);

// Initialize Tesseract worker (using the globally imported Tesseract from CDN).
let ocrWorker;
(async () => {
  try {
    console.log("[Sandbox] Initializing Tesseract worker");
    ocrWorker = await Tesseract.createWorker('eng');
    console.log("[Sandbox] Tesseract worker initialized.");
  } catch (error) {
    console.error("[Sandbox] Error initializing Tesseract worker:", error);
  }
})();

// Listen for screenshot messages from the parent.
window.addEventListener("message", async (event) => {
  const message = event.data;
  if (message.type === 'screenshotCaptured' && message.dataUrl) {
    console.log("[Sandbox] Received screenshot for OCR.");
    if (!ocrWorker) {
      console.error("[Sandbox] Tesseract worker is not ready.");
      return;
    }
    try {
      const { data: { text } } = await ocrWorker.recognize(message.dataUrl);
      console.log("[Sandbox] OCR completed:", text);
      window.parent.postMessage({ type: 'ocrResult', text }, "*");
    } catch (err) {
      console.error("[Sandbox] OCR error:", err);
      window.parent.postMessage({ type: 'ocrError', error: err.message }, "*");
    }
  }
});
