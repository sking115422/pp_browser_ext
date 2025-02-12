// src/background.js

import * as ort from 'onnxruntime-web';

async function loadModel() {
  try {
    // Get the absolute URL to your model file from the extension
    const modelUrl = chrome.runtime.getURL('models/m7_e2.onnx');
    console.log("Loading ONNX model from:", modelUrl);
    
    // Create an inference session using onnxruntime-web
    const session = await ort.InferenceSession.create(modelUrl);
    
    console.log("Model loaded successfully:", session);
  } catch (error) {
    console.error("Error loading ONNX model:", error);
  }
}

loadModel();
