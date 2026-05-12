import sys
import json
import cv2
from ultralytics import YOLO
import os
os.environ["YOLO_VERBOSE"] = "False"

# ----------------------------- Paths -----------------------------
MODEL_PATH = r"E:\Programs\runs\detect\train6\weights\best.pt"
OUTPUT_DIR = r"E:\Programs\test_images\output"

if not os.path.exists(OUTPUT_DIR):
    os.makedirs(OUTPUT_DIR)

# ----------------------------- Load Model -----------------------------
model = YOLO(MODEL_PATH)

# ----------------------------- Image from Node -----------------------------
img_path = sys.argv[1]  # Node.js passes image path

# ----------------------------- YOLO Prediction -----------------------------
results = model.predict(
    source=img_path,
    conf=0.01,
    iou=0.3,
    imgsz=1024,
    save=True,
    save_txt=False,
    verbose=False   # 🚨 stops printing logs to stdout
)

# ----------------------------- Process Results -----------------------------
final_result = "No injury detected"   # default message
for r in results:
    # Save annotated image
    annotated_img = r.plot()
    base_name = os.path.basename(img_path)
    output_file = os.path.join(OUTPUT_DIR, f"annotated_{base_name}")
    cv2.imwrite(output_file, annotated_img)

    # Check detected classes
    if hasattr(r, 'boxes') and r.boxes is not None and len(r.boxes) > 0:
        for cls in r.boxes.cls:
            class_id = int(cls)
            if class_id == 0:
                final_result = "major injury"
                break        # stop if we find major
            elif class_id == 1:
                final_result = "minor injury"

# ✅ Output a simple JSON for Node.js
print(json.dumps({"injuryResult": final_result}))