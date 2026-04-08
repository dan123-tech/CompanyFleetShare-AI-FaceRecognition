export const config = { runtime: "edge" };

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function withCors(res) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "content-type");
  return res;
}

async function upstashGet(key) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Missing UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN");

  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Upstash get failed (${res.status})`);
  const data = await res.json();
  return data?.result ?? null;
}

function base64ToBlob(b64, contentType) {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: contentType || "image/jpeg" });
}

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return withCors(new Response(null, { status: 204 }));
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const form = await req.formData();
    const sessionId = form.get("session_id");
    const selfie = form.get("selfie_image");
    const threshold = String(form.get("threshold") ?? "0.55");
    if (!sessionId) return withCors(json({ error: "Missing session_id" }, 400));
    if (!selfie) return withCors(json({ error: "Missing selfie_image" }, 400));

    const raw = await upstashGet(`session:${sessionId}`);
    if (!raw) return withCors(json({ error: "Session not found or expired" }, 404));
    const payload = JSON.parse(raw);
    const licenseBlob = base64ToBlob(payload.b64, payload.contentType);
    const licenseFile = new File([licenseBlob], "license.jpg", { type: payload.contentType || "image/jpeg" });

    const faceBaseUrl = process.env.FACE_VALIDATOR_URL;
    if (!faceBaseUrl) return withCors(json({ error: "Missing FACE_VALIDATOR_URL" }, 500));

    // Prefer simple endpoints that accept a single selfie.
    const endpoints = [
      process.env.FACE_VALIDATOR_ENDPOINT || "/match",
      "/match",
      "/verify",
      "/face-match",
      "/api/match",
      "/api/verify",
      "/api/face-match",
    ];
    const faceEndpoints = [...new Set(endpoints)];

    let used = faceEndpoints[0];
    let resp = null;
    let result = {};

    for (const ep of faceEndpoints) {
      const url = `${faceBaseUrl.replace(/\/$/, "")}${ep}`;
      const faceForm = new FormData();
      faceForm.append("licence", licenseFile);
      faceForm.append("liveScan", selfie);
      faceForm.append("threshold", threshold);

      const attempt = await fetch(url, { method: "POST", body: faceForm });
      const attemptJson = await attempt.json().catch(() => ({}));
      if (attempt.status === 404) continue;
      resp = attempt;
      result = attemptJson;
      used = ep;
      break;
    }

    if (!resp) return withCors(json({ error: "Face endpoint not found on validator service" }, 404));

    return withCors(
      json(
        {
          ok: resp.ok,
          status: resp.status,
          endpoint_used: used,
          response: result,
        },
        200
      )
    );
  } catch (e) {
    return withCors(json({ error: "Failed to verify session", message: e?.message || "Unknown error" }, 500));
  }
}

