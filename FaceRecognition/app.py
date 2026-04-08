from typing import Dict, Tuple

import cv2
import face_recognition
import mediapipe as mp
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="AI Driving Licence Validator", version="1.0.0")

# Allow your Vercel app and other Docker apps to call this API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

mp_face_detection = mp.solutions.face_detection


def _read_upload_to_bgr(upload: UploadFile) -> np.ndarray:
    raw = upload.file.read()
    if not raw:
        raise HTTPException(status_code=400, detail=f"Image '{upload.filename}' is empty.")
    arr = np.frombuffer(raw, np.uint8)
    image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail=f"Image '{upload.filename}' is not a valid image.")
    return image


def _bgr_to_rgb(image_bgr: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)


def _extract_single_encoding(image_bgr: np.ndarray, label: str) -> np.ndarray:
    rgb = _bgr_to_rgb(image_bgr)
    locations = face_recognition.face_locations(rgb, model="hog")
    if len(locations) == 0:
        raise HTTPException(status_code=400, detail=f"No face found in {label}.")
    if len(locations) > 1:
        raise HTTPException(status_code=400, detail=f"Multiple faces found in {label}.")
    encodings = face_recognition.face_encodings(rgb, known_face_locations=locations)
    if not encodings:
        raise HTTPException(status_code=400, detail=f"Could not encode face in {label}.")
    return encodings[0]


def _estimate_pose(image_bgr: np.ndarray, label: str) -> Tuple[str, Dict[str, float]]:
    """
    Returns pose label: front, left, right.
    Uses relative nose-to-eyes position from MediaPipe keypoints.
    """
    rgb = _bgr_to_rgb(image_bgr)
    with mp_face_detection.FaceDetection(model_selection=1, min_detection_confidence=0.6) as detector:
        result = detector.process(rgb)

    if not result.detections:
        raise HTTPException(status_code=400, detail=f"No face detected for pose check in {label}.")
    if len(result.detections) > 1:
        raise HTTPException(status_code=400, detail=f"Multiple faces detected for pose check in {label}.")

    keypoints = result.detections[0].location_data.relative_keypoints
    left_eye = keypoints[0]
    right_eye = keypoints[1]
    nose_tip = keypoints[2]

    eye_mid_x = (left_eye.x + right_eye.x) / 2.0
    eye_distance = abs(left_eye.x - right_eye.x) + 1e-6
    yaw_ratio = (nose_tip.x - eye_mid_x) / eye_distance

    if abs(yaw_ratio) < 0.06:
        pose = "front"
    elif yaw_ratio >= 0.06:
        pose = "left"
    else:
        pose = "right"

    return pose, {"yaw_ratio": float(yaw_ratio)}


def _validate_required_three_angles(front_pose: str, left_pose: str, right_pose: str) -> None:
    if front_pose != "front":
        raise HTTPException(status_code=400, detail="Front selfie is not frontal enough.")
    if left_pose != "left":
        raise HTTPException(status_code=400, detail="Left selfie does not look left enough.")
    if right_pose != "right":
        raise HTTPException(status_code=400, detail="Right selfie does not look right enough.")


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/verify-license-face")
@app.post("/face-match")
async def verify_license_face(
    license_image: UploadFile = File(...),
    selfie_front: UploadFile = File(...),
    selfie_left: UploadFile = File(...),
    selfie_right: UploadFile = File(...),
    threshold: float = Form(0.55),
) -> Dict[str, object]:
    """
    Compares driving licence face to three user selfies.
    Returns match status and per-angle face distances.
    Lower distance means better match.
    """
    if threshold <= 0 or threshold >= 1:
        raise HTTPException(status_code=400, detail="Threshold must be between 0 and 1.")

    license_bgr = _read_upload_to_bgr(license_image)
    front_bgr = _read_upload_to_bgr(selfie_front)
    left_bgr = _read_upload_to_bgr(selfie_left)
    right_bgr = _read_upload_to_bgr(selfie_right)

    front_pose, front_pose_meta = _estimate_pose(front_bgr, "selfie_front")
    left_pose, left_pose_meta = _estimate_pose(left_bgr, "selfie_left")
    right_pose, right_pose_meta = _estimate_pose(right_bgr, "selfie_right")
    _validate_required_three_angles(front_pose, left_pose, right_pose)

    license_encoding = _extract_single_encoding(license_bgr, "license_image")
    front_encoding = _extract_single_encoding(front_bgr, "selfie_front")
    left_encoding = _extract_single_encoding(left_bgr, "selfie_left")
    right_encoding = _extract_single_encoding(right_bgr, "selfie_right")

    distances = {
        "front": float(face_recognition.face_distance([license_encoding], front_encoding)[0]),
        "left": float(face_recognition.face_distance([license_encoding], left_encoding)[0]),
        "right": float(face_recognition.face_distance([license_encoding], right_encoding)[0]),
    }
    avg_distance = float(sum(distances.values()) / len(distances))
    match = avg_distance <= threshold

    return {
        "match": match,
        "threshold": threshold,
        "average_distance": avg_distance,
        "distances": distances,
        "pose_validation": {
            "front": {"detected_pose": front_pose, **front_pose_meta},
            "left": {"detected_pose": left_pose, **left_pose_meta},
            "right": {"detected_pose": right_pose, **right_pose_meta},
        },
        "recommendation": "accept" if match else "reject",
    }


@app.post("/verify")
@app.post("/match")
@app.post("/api/verify")
@app.post("/api/match")
@app.post("/api/face-match")
async def verify_simple_face_match(
    licence: UploadFile = File(...),
    liveScan: UploadFile | None = File(default=None),
    selfie: UploadFile | None = File(default=None),
    image: UploadFile | None = File(default=None),
    threshold: float = Form(0.55),
) -> Dict[str, object]:
    """
    Compatibility endpoint for clients that send:
      - licence + liveScan (preferred), or
      - licence + selfie/image
    Returns a simple match payload expected by frontend integrations.
    """
    if threshold <= 0 or threshold >= 1:
        raise HTTPException(status_code=400, detail="Threshold must be between 0 and 1.")

    probe = liveScan or selfie or image
    if probe is None:
        raise HTTPException(
            status_code=400,
            detail="Missing live scan image. Provide one of: liveScan, selfie, image.",
        )

    license_bgr = _read_upload_to_bgr(licence)
    probe_bgr = _read_upload_to_bgr(probe)
    license_encoding = _extract_single_encoding(license_bgr, "licence")
    probe_encoding = _extract_single_encoding(probe_bgr, "liveScan")

    distance = float(face_recognition.face_distance([license_encoding], probe_encoding)[0])
    similarity = max(0.0, min(1.0, 1.0 - distance))
    match = distance <= threshold

    return {
        "match": match,
        "score": similarity,
        "similarity": similarity,
        "distance": distance,
        "threshold": threshold,
        "recommendation": "accept" if match else "reject",
    }
