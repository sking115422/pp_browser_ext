// src/onnx_worker.js
import * as ort from 'onnxruntime-web';

console.log('[ONNX Worker] - ' + Date.now() + ' - Worker started.');

self.onmessage = async (e) => {
  console.log('[ONNX Worker] - ' + Date.now() + ' - Message received:', e.data);
  if (e.data.type === 'runInference') {
    const { payload } = e.data;
    try {
      // Re-create the image tensor from the transferred ArrayBuffer.
      const imageTensor = new ort.Tensor(
        'float32',
        new Float32Array(payload.imageTensor.data),
        payload.imageTensor.dims,
      );

      // Re-create the input_ids as a BigInt64Array from the transferred ArrayBuffer.
      const inputIdsArray = new BigInt64Array(payload.input_ids);
      const inputIds = new ort.Tensor('int64', inputIdsArray, [1, 512]);

      // Re-create the attention_mask as a BigInt64Array, then convert it to a Float32Array.
      const attentionMaskArray = new BigInt64Array(payload.attention_mask);
      const attentionMaskFloat = new Float32Array(attentionMaskArray.length);
      for (let i = 0; i < attentionMaskArray.length; i++) {
        attentionMaskFloat[i] = Number(attentionMaskArray[i]);
      }
      const attentionMask = new ort.Tensor(
        'float32',
        attentionMaskFloat,
        [1, 512],
      );

      const feeds = {
        image: imageTensor,
        input_ids: inputIds,
        attention_mask: attentionMask,
      };

      console.log(
        '[ONNX Worker] - ' + Date.now() + ' - Model input (feeds):',
        feeds,
      );

      // Lazy load the model session.
      if (!self.session) {
        const modelUrl = new URL(
          '../public/models/m7_e2_960x540_512.onnx',
          import.meta.url,
        ).toString();
        console.log(
          '[ONNX Worker] - ' + Date.now() + ' - Loading model from:',
          modelUrl,
        );
        self.session = await ort.InferenceSession.create(modelUrl);
        console.log('[ONNX Worker] - ' + Date.now() + ' - Model loaded.');
      }
      const session = self.session;
      console.log('[ONNX Worker] - ' + Date.now() + ' - Running inference...');
      const start = Date.now();
      const output = await session.run(feeds);
      const onnxInferenceTime = Date.now() - start;
      let classification = 'benign';
      if (output && output.output) {
        const logits = output.output.data;
        classification = logits[1] > logits[0] ? 'SE' : 'benign';
      }
      console.log(
        '[ONNX Worker] - ' +
          Date.now() +
          ' - Inference complete. Classification:',
        classification,
        'Time:',
        onnxInferenceTime,
      );
      // Post the inference result back.
      self.postMessage({
        type: 'inferenceResult',
        classification,
        onnxInferenceTime: onnxInferenceTime.toFixed(2),
      });
    } catch (err) {
      console.error('[ONNX Worker] Error during inference:', err);
      self.postMessage({
        type: 'inferenceResult',
        classification: 'error',
        onnxInferenceTime: '0',
      });
    }
  }
};
