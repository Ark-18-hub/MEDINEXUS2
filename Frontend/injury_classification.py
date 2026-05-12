from ultralytics import YOLO
import cv2

# -----------------------------
# Paths
# -----------------------------
MODEL_PATH = r"E:/Programs/runs/detect/train4/weights/best.pt"
IMAGE_PATH = r"E:/Programs/test_images/"
OUTPUT_PATH = r"E:/Programs/test_images/output/"

# -----------------------------
# Load the YOLOv8 model
# -----------------------------
model = YOLO(MODEL_PATH)

# -----------------------------
# Run prediction
# -----------------------------
results = model.predict(
    source=IMAGE_PATH,
    conf=0.01,      # very low confidence to detect small objects
    iou=0.3,        # IoU threshold
    imgsz=1024,     # larger image size for better detection of small objects
    save=True,      # save annotated image in runs/detect/predict
    save_txt=False  # optionally save detection coordinates
)

# -----------------------------
# Process results
# -----------------------------
for r in results:
    # Annotated image as numpy array
    annotated_img = r.plot()

    # Save annotated image to disk
    cv2.imwrite(OUTPUT_PATH, annotated_img)
    print(f"Annotated image saved at: {OUTPUT_PATH}")

    # Show annotated image
    r.show()  # opens a window with bounding boxes

    # Print detected classes and confidence
    if hasattr(r, 'boxes') and r.boxes is not None and len(r.boxes) > 0:
        for cls, conf in zip(r.boxes.cls, r.boxes.conf):
            class_id = int(cls)
            print(f"Detected Class: {model.names[class_id]}, Confidence: {conf:.2f}")
    else:
        print("No objects detected in this image.")
