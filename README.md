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

## Project structure

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

## Important for Vercel

Vercel serverless functions cannot call `localhost` inside your machine.

For production:
- Deploy the validator Docker service on a reachable host (Railway, Render, Fly.io, VPS, etc.)
- Set `FACE_VALIDATOR_URL` in Vercel environment variables to:
  `https://your-validator-host`

## Security notes

- Add HTTPS and authentication token between your website backend and validator API.
- Do not expose the validator endpoint publicly without auth.
- Store face images only if legally required, and follow your local privacy law.
