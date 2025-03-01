// src/onnx_worker.js
import * as ort from 'onnxruntime-web';

console.log("[ONNX Worker] Worker started.");

self.onmessage = async (e) => {
  console.log("[ONNX Worker] Message received:", e.data);
  if (e.data.type === 'runInference') {
    const { payload } = e.data;
    try {
      const imageTensor = new ort.Tensor(
        'float32',
        new Float32Array(payload.imageTensor.data),
        payload.imageTensor.dims
      );
      const inputIds = new ort.Tensor(
        'int32',
        new Int32Array(payload.input_ids),
        [1, 128]
      );
      const attentionMask = new ort.Tensor(
        'int32',
        new Int32Array(payload.attention_mask),
        [1, 128]
      );

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
      self.postMessage({ type: 'inferenceResult', classification, inferenceTime: inferenceTime.toFixed(2) });
    } catch (err) {
      console.error("[ONNX Worker] Error during inference:", err);
      self.postMessage({ type: 'inferenceResult', classification: 'error', inferenceTime: "0" });
    }
  }
};
