// src/onnx_worker.js
import * as ort from 'onnxruntime-web';

console.log("[ONNX Worker] Worker started.");

self.onmessage = async (e) => {
  console.log("[ONNX Worker] Message received:", e.data);
  if (e.data.type === 'runInference') {
    const { payload } = e.data;
    try {
      // Re-create typed arrays from plain arrays.
      const imageTensor = new ort.Tensor(
        'float32',
        new Float32Array(payload.imageTensor.data),
        payload.imageTensor.dims
      );
      const inputIdsArray = new BigInt64Array(payload.input_ids.map(x => BigInt(x)));
      const inputIds = new ort.Tensor('int64', inputIdsArray, [1, 512]);
      const attentionMaskBig = new BigInt64Array(payload.attention_mask.map(x => BigInt(x)));
      const attentionMaskFloat = new Float32Array(attentionMaskBig.length);
      for (let i = 0; i < attentionMaskBig.length; i++) {
        attentionMaskFloat[i] = Number(attentionMaskBig[i]);
      }
      const attentionMask = new ort.Tensor('float32', attentionMaskFloat, [1, 512]);
      const feeds = {
        image: imageTensor,
        input_ids: inputIds,
        attention_mask: attentionMask
      };
      console.log("[ONNX Worker] Model input (feeds):", feeds);
      if (!self.session) {
        const modelUrl = new URL('../public/models/m7_e2_960x540_512.onnx', import.meta.url).toString();
        console.log("[ONNX Worker] Loading model from:", modelUrl);
        self.session = await ort.InferenceSession.create(modelUrl);
        console.log("[ONNX Worker] Model loaded.");
      }
      const session = self.session;
      console.log("[ONNX Worker] Running inference...");
      const start = performance.now();
      const output = await session.run(feeds);
      const onnxInferenceTime = performance.now() - start;
      let classification = 'benign';
      if (output && output.output) {
        const logits = output.output.data;
        classification = logits[1] > logits[0] ? 'SE' : 'benign';
      }
      console.log("[ONNX Worker] Inference complete. Classification:", classification, "Time:", onnxInferenceTime);
      self.postMessage({ type: 'inferenceResult', classification, onnxInferenceTime: onnxInferenceTime.toFixed(2), ocrText: payload.ocrText });
    } catch (err) {
      console.error("[ONNX Worker] Error during inference:", err);
      self.postMessage({ type: 'inferenceResult', classification: 'error', onnxInferenceTime: "0" });
    }
  }
};
