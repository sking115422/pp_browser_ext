import cv2
import numpy as np
import onnxruntime as ort
import pyclipper  # pip install pyclipper

# Load the ONNX models
det_model = ort.InferenceSession("paddle_ocr_det.onnx")
rec_model = ort.InferenceSession("paddle_ocr_rec.onnx")

def resize_to_multiple_of_32(image):
    height, width = image.shape[:2]
    new_height = (height // 32) * 32
    new_width = (width // 32) * 32
    resized_img = cv2.resize(image, (new_width, new_height))
    return resized_img

def preprocess_for_detection(image):
    image = resize_to_multiple_of_32(image)  # Ensure dimensions are multiples of 32
    img = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    img = img.astype(np.float32) / 255.0  # Normalize to [0,1]
    img = np.transpose(img, (2, 0, 1))  # Convert HWC to CHW (C=3)
    img = np.expand_dims(img, axis=0)  # Add batch dimension
    return img

def unclip(box, unclip_ratio=2.0):
    """
    Expand the detected box using pyclipper.
    """
    poly = box.reshape(-1, 2)
    area = cv2.contourArea(poly)
    perimeter = cv2.arcLength(poly, True)
    if perimeter == 0:
        return box
    distance = area * unclip_ratio / perimeter
    offset = pyclipper.PyclipperOffset()
    offset.AddPath(poly.astype(np.int32).tolist(), pyclipper.JT_ROUND, pyclipper.ET_CLOSEDPOLYGON)
    expanded = np.array(offset.Execute(distance))
    return expanded

def postprocess_detection(output, threshold=0.1, unclip_ratio=2.0):
    """
    Process the detection model output to obtain text region contours.
    """
    # Output shape is (1, 1, H, W)
    detection_map = output[0][0]  # shape: (H, W)

    # Debug: print min and max values from the detection map
    print("Detection map min:", detection_map.min(), "max:", detection_map.max())
    
    # Normalize the detection map to 0-255
    output_norm = (detection_map - detection_map.min()) / (detection_map.max() - detection_map.min() + 1e-6)
    output_norm = (output_norm * 255).astype(np.uint8)
    output_norm = np.ascontiguousarray(output_norm)
    
    # Save the normalized detection map for debugging
    cv2.imwrite("detection_output_norm.png", output_norm)
    
    # Apply binary thresholding
    thresh_value = int(threshold * 255)
    _, binary_map = cv2.threshold(output_norm, thresh_value, 255, cv2.THRESH_BINARY)
    
    # Optional: apply dilation
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    binary_map = cv2.dilate(binary_map, kernel, iterations=1)
    
    # Alternatively, you can try a closing operation (dilate then erode)
    # binary_map = cv2.morphologyEx(binary_map, cv2.MORPH_CLOSE, kernel, iterations=1)
    
    binary_map = np.ascontiguousarray(binary_map)
    cv2.imwrite("binary_map.png", binary_map)
    
    # Debug: print number of white pixels
    nonzero = cv2.countNonZero(binary_map)
    print("Non-zero pixels in binary map:", nonzero)
    
    # Find contours in the binary map
    contours, _ = cv2.findContours(binary_map, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    final_contours = []
    for cnt in contours:
        if cnt.shape[0] < 3:  # Need at least 3 points for a valid polygon
            continue
        unclipped = unclip(cnt, unclip_ratio)
        if unclipped is None or len(unclipped) == 0:
            continue
        rect = cv2.minAreaRect(unclipped)
        box = cv2.boxPoints(rect)
        box = np.int0(box)
        final_contours.append(box)
    
    return final_contours

def preprocess_for_recognition(cropped_img):
    cropped_img = cv2.resize(cropped_img, (100, 32))  # Resize to match OCR model input size
    cropped_img = cv2.cvtColor(cropped_img, cv2.COLOR_BGR2GRAY)  # Convert to grayscale
    cropped_img = cropped_img.astype(np.float32) / 255.0
    cropped_img = np.expand_dims(cropped_img, axis=0)  # Add channel dimension
    cropped_img = np.expand_dims(cropped_img, axis=0)  # Add batch dimension
    return cropped_img

def run_text_detection(image):
    input_tensor = preprocess_for_detection(image)
    input_tensor = np.array(input_tensor, dtype=np.float32)
    
    ort_inputs = {det_model.get_inputs()[0].name: input_tensor}
    ort_outs = det_model.run(None, ort_inputs)
    
    print("Detection Model Output Shape:", [x.shape for x in ort_outs])
    
    contours = postprocess_detection(ort_outs, threshold=0.1, unclip_ratio=2.0)
    return contours

def run_text_recognition(image, contours):
    recognized_texts = []
    
    for box in contours:
        # Get the bounding rectangle from the contour box
        x, y, w, h = cv2.boundingRect(box)
        cropped_img = image[y:y+h, x:x+w]
        if cropped_img.size == 0:
            continue
        
        input_tensor = preprocess_for_recognition(cropped_img)
        input_tensor = np.array(input_tensor, dtype=np.float32)
        
        ort_inputs = {rec_model.get_inputs()[0].name: input_tensor}
        ort_outs = rec_model.run(None, ort_inputs)
        
        # Convert the recognition model output to text.
        # (This conversion assumes that the output indices correspond to ASCII codes.)
        recognized_text = "".join([chr(int(c)) for c in np.argmax(ort_outs[0], axis=1)])
        recognized_texts.append((recognized_text, (x, y, w, h)))
    
    return recognized_texts

# Load image
image_path = "./test.png"
image = cv2.imread(image_path)
if image is None:
    print("Error: Image not loaded properly. Check the path:", image_path)
    exit(1)

# Run the OCR pipeline
detected_contours = run_text_detection(image)
print("Number of detected contours:", len(detected_contours))
recognized_texts = run_text_recognition(image, detected_contours)

# Draw detection boxes and recognized text on the image
for text, (x, y, w, h) in recognized_texts:
    cv2.rectangle(image, (x, y), (x+w, y+h), (0, 255, 0), 2)
    cv2.putText(image, text, (x, y - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)

cv2.imshow("OCR Result", image)
cv2.waitKey(0)
cv2.destroyAllWindows()
