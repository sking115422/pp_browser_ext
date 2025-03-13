import cv2
import numpy as np
import onnxruntime as ort

def ctc_greedy_decoder(predictions, alphabet, blank=0):
    """
    Decodes the output of a CTC-based recognition model using greedy decoding.
    predictions: numpy array of shape (batch, seq_len, num_classes)
    alphabet: string or list mapping indices to characters.
    blank: index representing the blank token.
    """
    # Assume batch size is 1.
    preds = predictions[0]
    pred_indices = np.argmax(preds, axis=1)
    
    char_list = []
    prev_idx = -1
    for idx in pred_indices:
        if idx != prev_idx and idx != blank:
            if idx < len(alphabet):
                char_list.append(alphabet[idx])
        prev_idx = idx
    return "".join(char_list)

# Define the alphabet.
# Ensure this matches your training setup (often index 0 is the blank token).
alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"

def preprocess_for_detection(img, target_size=(640, 640)):
    """
    Preprocess the input image for the detection model.
    Resizes the image to target_size, converts BGR to RGB,
    normalizes to [0, 1], and rearranges to CHW format.
    """
    img_resized = cv2.resize(img, target_size)
    img_rgb = cv2.cvtColor(img_resized, cv2.COLOR_BGR2RGB)
    img_norm = img_rgb.astype('float32') / 255.0
    img_transposed = np.transpose(img_norm, (2, 0, 1))
    input_tensor = np.expand_dims(img_transposed, axis=0)
    return input_tensor

def preprocess_for_recognition(cropped_img, target_size=(100, 48)):
    """
    Preprocess the cropped text region for the recognition model.
    Resizes to target_size (width, height), converts to RGB,
    normalizes to [0, 1], and rearranges to CHW format.
    """
    img_resized = cv2.resize(cropped_img, target_size)
    img_rgb = cv2.cvtColor(img_resized, cv2.COLOR_BGR2RGB)
    img_norm = img_rgb.astype('float32') / 255.0
    img_transposed = np.transpose(img_norm, (2, 0, 1))
    input_tensor = np.expand_dims(img_transposed, axis=0)
    return input_tensor

def postprocess_detection(det_output, detection_input_size=(640, 640), original_img_shape=None, threshold=0.3):
    """
    Processes the raw detection output to extract bounding boxes.
    
    Args:
        det_output: Raw output from the detection model (expected shape: (1, 1, H, W)).
        detection_input_size: The size used in preprocessing (e.g., (640, 640)).
        original_img_shape: Tuple (height, width) of the original image.
        threshold: Threshold for binarizing the probability map.
        
    Returns:
        A list of bounding boxes [x1, y1, x2, y2] scaled to the original image.
    """
    if original_img_shape is None:
        raise ValueError("Original image shape must be provided.")
    
    # Remove extra dimensions. We assume the output is (1, 1, H, W).
    prob_map = det_output[0, 0, :, :]
    
    # Threshold the probability map to get a binary image.
    _, binary_map = cv2.threshold(prob_map, threshold, 1, cv2.THRESH_BINARY)
    binary_map = (binary_map * 255).astype(np.uint8)
    
    # Find contours from the binary map.
    contours, _ = cv2.findContours(binary_map, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    
    boxes = []
    orig_h, orig_w = original_img_shape
    scale_x = orig_w / detection_input_size[0]
    scale_y = orig_h / detection_input_size[1]
    
    for contour in contours:
        # Optionally, filter out very small contours.
        if cv2.contourArea(contour) < 10:
            continue
        x, y, w, h = cv2.boundingRect(contour)
        # Scale the box coordinates to the original image size.
        x1 = int(x * scale_x)
        y1 = int(y * scale_y)
        x2 = int((x + w) * scale_x)
        y2 = int((y + h) * scale_y)
        boxes.append([x1, y1, x2, y2])
    return boxes

# ----------------- Main Script -----------------

# Load the test image.
img = cv2.imread("test.png")
if img is None:
    raise ValueError("Image file 'test.png' not found.")

orig_h, orig_w = img.shape[:2]

# Preprocess the image for the detection model.
det_input = preprocess_for_detection(img, target_size=(640, 640))

# Load the ONNX detection model.
det_session = ort.InferenceSession("paddle_ocr_det.onnx")
det_input_name = det_session.get_inputs()[0].name

# Run detection inference.
det_outputs = det_session.run(None, {det_input_name: det_input})
print("Detection model raw output shape:", det_outputs[0].shape)

# Post-process the detection output to obtain bounding boxes.
detected_boxes = postprocess_detection(det_outputs[0], detection_input_size=(640, 640), original_img_shape=(orig_h, orig_w))
print("Detected boxes:", detected_boxes)

# Load the ONNX recognition model.
rec_session = ort.InferenceSession("paddle_ocr_rec.onnx")
rec_input_name = rec_session.get_inputs()[0].name

# Loop over each detected bounding box, run recognition, and decode the text.
for idx, box in enumerate(detected_boxes):
    x1, y1, x2, y2 = box
    cropped_img = img[y1:y2, x1:x2]
    
    # Preprocess the cropped region for the recognition model.
    rec_input = preprocess_for_recognition(cropped_img, target_size=(100, 48))
    
    # Run recognition inference.
    rec_outputs = rec_session.run(None, {rec_input_name: rec_input})
    
    # Decode the raw recognition output to text.
    recognized_text = ctc_greedy_decoder(rec_outputs[0], alphabet, blank=0)
    print(f"Detected text for box {idx}: {recognized_text}")
