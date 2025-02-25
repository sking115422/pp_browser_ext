console.log("[Sandbox] Sandbox document loaded.");

// Notify parent (popup) that the sandbox is active.
window.parent.postMessage(
  { type: 'sandboxLoaded', message: "Sandbox document is active." },
  "*"
);

(async () => {
  try {
    console.log("[Sandbox] Initializing Tesseract scheduler with dynamic grid workers");
    const { createScheduler, createWorker } = Tesseract;
    
    // Specify how many rows and columns you want.
    const numRows = 3;  // Change this to the desired number of rows.
    const numCols = 3;  // Change this to the desired number of columns.
    const totalPieces = numRows * numCols;
    
    // Create a scheduler and initialize as many workers as pieces.
    const scheduler = createScheduler();
    for (let i = 0; i < totalPieces; i++) {
      const worker = await createWorker('eng');
      scheduler.addWorker(worker);
    }
    console.log(`[Sandbox] Scheduler initialized with ${totalPieces} workers.`);
    
    // Listen for screenshot messages from the parent.
    window.addEventListener("message", async (event) => {
      const message = event.data;
      if (message.type === 'screenshotCaptured' && message.dataUrl) {
        console.log("[Sandbox] Received screenshot for OCR.");
        
        // Create an image to determine its dimensions.
        const img = new Image();
        img.src = message.dataUrl;
        img.onload = async () => {
          const width = img.naturalWidth;
          const height = img.naturalHeight;
          console.log("[Sandbox] Image dimensions:", width, height);
          
          // Calculate piece dimensions.
          const pieceWidth = Math.floor(width / numCols);
          const pieceHeight = Math.floor(height / numRows);
          
          // Create an array of jobs, each with its grid coordinates.
          let jobs = [];
          for (let row = 0; row < numRows; row++) {
            for (let col = 0; col < numCols; col++) {
              const left = col * pieceWidth;
              const top = row * pieceHeight;
              // Adjust the width/height for the last column/row.
              const rectWidth = (col === numCols - 1) ? (width - left) : pieceWidth;
              const rectHeight = (row === numRows - 1) ? (height - top) : pieceHeight;
              jobs.push({ row, col, rectangle: { left, top, width: rectWidth, height: rectHeight } });
            }
          }
          console.log("[Sandbox] Defined job rectangles:", jobs);
          
          const startTime = performance.now();
          
          try {
            // Submit OCR jobs for each rectangle.
            const jobPromises = jobs.map(job =>
              scheduler.addJob('recognize', message.dataUrl, { rectangle: job.rectangle })
                .then(result => ({ row: job.row, col: job.col, text: result.data.text }))
            );
            const results = await Promise.all(jobPromises);
            
            // Sort results by row then column.
            results.sort((a, b) => {
              if (a.row === b.row) {
                return a.col - b.col;
              }
              return a.row - b.row;
            });
            
            // Concatenate the text in row-major order.
            const combinedText = results.map(r => r.text).join(" ");
            const endTime = performance.now();
            const ocrTime = endTime - startTime;
            console.log("[Sandbox] OCR completed for grid:", combinedText, "Time:", ocrTime, "ms");
            
            // Send the combined OCR text and timing back to the parent.
            window.parent.postMessage({ type: 'ocrResult', text: combinedText, ocrTime }, "*");
          } catch (jobError) {
            console.error("[Sandbox] Error processing OCR jobs:", jobError);
            window.parent.postMessage({ type: 'ocrError', error: jobError.message }, "*");
          }
        };
        img.onerror = (err) => {
          console.error("[Sandbox] Error loading image for OCR:", err);
          window.parent.postMessage({ type: 'ocrError', error: err.message }, "*");
        };
      }
    });
  } catch (error) {
    console.error("[Sandbox] Error initializing scheduler or workers:", error);
  }
})();
