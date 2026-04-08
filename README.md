# AI Driving Licence Validator (Docker)

This project creates a **Docker face validation service** that your other Docker app or Vercel backend can call.

It verifies:
- Face on driving licence image
- Face from user selfie (front)
- Face from user selfie (left)
- Face from user selfie (right)

It then returns a match decision (`accept` or `reject`) with confidence metrics.

## Free technology used

This uses fully free/open-source libraries:
- `face_recognition` (dlib embeddings) for face matching
- `MediaPipe` for face detection and pose direction checks

No paid cloud API is required.

## FaceRecognition folder and Vercel

The `FaceRecognition/` Python API (dlib, MediaPipe, OpenCV) **cannot** run on Vercel serverless: total install size is far above the ~500 MB limit. Deploy it with **Docker** (Render, Railway, Fly.io, VPS) and set `FACE_VALIDATOR_URL` on your Vercel API project to that public URL.

If you link a Vercel project to `FaceRecognition/`, it deploys only a **static** `index.html` plus `.vercelignore` so heavy files are not bundled.

## Project structure

- `FaceRecognition/` - Python face API + Dockerfile (host on Docker, not Vercel Python)
- `ai_driving_licence_validator/app.py` - Python API script
- `ai_driving_licence_validator/Dockerfile` - Validator container
- `docker-compose.yml` - Two-container communication example
- `vercel_example/route.ts` - Example Vercel/Next.js route proxy

## Run with Docker

From project root:

```bash
docker compose up --build
```

Your existing validator API runs on:

`http://localhost:8080`

Health check:

`GET /health`

## Verification endpoint

`POST /verify-license-face` (multipart/form-data)

Alias endpoint also supported:

`POST /face-match`

Required form fields:
- `license_image` (file)
- `selfie_front` (file)
- `selfie_left` (file)
- `selfie_right` (file)
- `threshold` (optional number, default `0.55`)

Example cURL:

```bash
curl -X POST "http://localhost:8080/verify-license-face" \
  -F "license_image=@license.jpg" \
  -F "selfie_front=@front.jpg" \
  -F "selfie_left=@left.jpg" \
  -F "selfie_right=@right.jpg" \
  -F "threshold=0.55"
```

## Live scan (no manual photo upload)

If you do not want file upload inputs, use webcam live capture:

- Open `vercel_example/live_scan.html`
- It captures in sequence: `license_image` -> `selfie_front` -> `selfie_left` -> `selfie_right`
- It sends frames directly to `/api/verify-license` (your main backend orchestrator)

This is still multipart under the hood, but the user does not upload photos manually.

## Main backend orchestration flow

`vercel_example/route.ts` now matches your requested logic:

1. User provides licence image + live face scan frames
2. Main backend sends licence image to **Driving Licence Validator**
3. Main backend sends licence + front/left/right frames to **Face Recognition**
4. Main backend merges both results and returns one final decision

Environment variables for this route:

- `LICENSE_VALIDATOR_URL` (default `http://localhost:8080`)
- `LICENSE_VALIDATOR_ENDPOINT` (default `/validate-license`)
- `FACE_VALIDATOR_URL` (default `http://localhost:8080`)
- `FACE_VALIDATOR_ENDPOINT` (default `/verify-license-face`)

Example merged response:

```json
{
  "final_decision": "approved",
  "checks": {
    "license_validation": { "ok": true, "status": 200, "response": {} },
    "face_validation": { "ok": true, "status": 200, "response": { "match": true } }
  }
}
```

## Important for Vercel

Vercel serverless functions cannot call `localhost` inside your machine.

For production:
- Deploy the validator Docker service on a reachable host (Railway, Render, Fly.io, VPS, etc.)
- Set `FACE_VALIDATOR_URL` in Vercel environment variables to:
  `https://your-validator-host`

## API-only “phone handoff” (Veriff-like)

This repo also contains **API-only** endpoints (no UI) that your main app can use to implement:
- desktop uploads licence image → backend returns `session_id`
- main app shows QR/email link to phone (your UI)
- phone captures selfie → main app uploads selfie + `session_id` → backend compares

Endpoints:

- `POST /api/session-create`
  - **multipart/form-data**: `license_image` (file)
  - **or** `Content-Type: application/json`: `license_image_base64` (string), optional `license_mime` (default `image/jpeg`), or `license_image` as a `data:image/...;base64,...` data URL
  - returns `{ session_id, expires_in_seconds }`

- `POST /api/session-verify`
  - **multipart/form-data**: `session_id`, `selfie_image` (file), optional `threshold`
  - **or** `Content-Type: application/json`: `session_id`, `selfie_image_base64` (or `selfie_image` data URL), optional `selfie_mime`, `threshold`
  - returns `{ ok, status, endpoint_used, response }`

Required Vercel env vars for these endpoints:
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `FACE_VALIDATOR_URL`
- optional: `FACE_VALIDATOR_ENDPOINT`

## Security notes

- Add HTTPS and authentication token between your website backend and validator API.
- Do not expose the validator endpoint publicly without auth.
- Store face images only if legally required, and follow your local privacy law.
