// src/onnx_worker.js
import * as ort from 'onnxruntime-web';

console.log("[ONNX Worker] Worker started.");

self.onmessage = async (e) => {
  console.log("[ONNX Worker] Message received:", e.data);
  if (e.data.type === 'runInference') {
    const { payload } = e.data;

    try {
      
      // Image tensor: already a float32 tensor
      const imageTensor = new ort.Tensor(
        'float32',
        new Float32Array(payload.imageTensor.data),
        payload.imageTensor.dims
      );

      // For input_ids, convert the transferred ArrayBuffer (from dummyInputIds) to a 32-bit typed view first.
      const inputIdsArray = new Int32Array(payload.input_ids);

      // Convert each element to BigInt and store in a BigInt64Array.
      const bigIntInputIds = new BigInt64Array(inputIdsArray.length);
      for (let i = 0; i < inputIdsArray.length; i++) {
        bigIntInputIds[i] = BigInt(inputIdsArray[i]);
      }

      // Create an ONNX tensor for input_ids as int64.
      const inputIds = new ort.Tensor('int64', bigIntInputIds, [1, 128]);

      // For attention_mask, we want float32.
      // Create a typed view from the transferred ArrayBuffer.
      const attentionMaskArray = new Int32Array(payload.attention_mask);
      // Convert to Float32Array.
      const attentionMaskFloat = new Float32Array(attentionMaskArray.length);
      for (let i = 0; i < attentionMaskArray.length; i++) {
        attentionMaskFloat[i] = attentionMaskArray[i];
      }
      const attentionMask = new ort.Tensor('float32', attentionMaskFloat, [1, 128]);

      // Assemble the feeds.
      const feeds = {
        image: imageTensor,
        input_ids: inputIds,
        attention_mask: attentionMask
      };

      if (!self.session) {
        const modelUrl = new URL('../public/models/m7_e2.onnx', import.meta.url).toString();
        console.log("[ONNX Worker] Loading model from:", modelUrl);
        self.session = await ort.InferenceSession.create(modelUrl);
        console.log("[ONNX Worker] Model loaded.");
      }
      const session = self.session;

      console.log("[ONNX Worker] Running inference...");
      const start = performance.now();
      const output = await session.run(feeds);
      const end = performance.now();
      const inferenceTime = end - start;

      let classification = 'benign';
      if (output && output.output) {
        const logits = output.output.data;
        classification = logits[1] > logits[0] ? 'SE' : 'benign';
      }
      console.log("[ONNX Worker] Inference complete. Classification:", classification, "Time:", inferenceTime);
      self.postMessage({ type: 'inferenceResult', classification, inferenceTime: inferenceTime.toFixed(2), ocrText: payload.ocrText });
    } catch (err) {
      console.error("[ONNX Worker] Error during inference:", err);
      self.postMessage({ type: 'inferenceResult', classification: 'error', inferenceTime: "0" });
    }
  }
};
