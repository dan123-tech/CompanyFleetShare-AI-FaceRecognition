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
  res.headers.set("Access-Control-Allow-Headers", "content-type, authorization");
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

/** Supports multipart/form-data, application/x-www-form-urlencoded, or application/json. */
async function parseVerifyBody(req) {
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  let sessionId = null;
  let selfie = null;
  let threshold = "0.55";

  if (ct.includes("application/json")) {
    const body = await req.json();
    sessionId = body.session_id ?? body.sessionId;
    threshold = String(body.threshold ?? "0.55");
    const dataUrl = body.selfie_image;
    const b64 = body.selfie_image_base64 ?? body.selfie_base64 ?? body.image_base64;
    const mime = body.selfie_mime ?? body.selfie_type ?? "image/jpeg";
    if (typeof dataUrl === "string" && dataUrl.startsWith("data:")) {
      const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (m) {
        selfie = new File([base64ToBlob(m[2], m[1])], "selfie.jpg", { type: m[1] });
      }
    } else if (typeof b64 === "string" && b64.length > 0) {
      selfie = new File([base64ToBlob(b64, mime)], "selfie.jpg", { type: mime });
    }
    return { sessionId, selfie, threshold };
  }

  if (ct.includes("multipart/form-data") || ct.includes("application/x-www-form-urlencoded")) {
    const form = await req.formData();
    sessionId = form.get("session_id");
    selfie = form.get("selfie_image");
    threshold = String(form.get("threshold") ?? "0.55");
    return { sessionId, selfie, threshold };
  }

  // Some clients omit or mis-set Content-Type; try formData once (may throw).
  try {
    const form = await req.formData();
    sessionId = form.get("session_id");
    selfie = form.get("selfie_image");
    threshold = String(form.get("threshold") ?? "0.55");
    if (sessionId != null && sessionId !== "" && selfie != null) {
      return { sessionId, selfie, threshold };
    }
  } catch {
    // fall through
  }

  throw new Error(
    "Unsupported Content-Type. Use multipart/form-data (fields: session_id, selfie_image) or application/json " +
      "(fields: session_id, selfie_image_base64 or data-URL selfie_image, optional selfie_mime, threshold)."
  );
}

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return withCors(new Response(null, { status: 204 }));
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { sessionId, selfie, threshold } = await parseVerifyBody(req);
    if (!sessionId) return withCors(json({ error: "Missing session_id" }, 400));
    if (!selfie) return withCors(json({ error: "Missing selfie_image (or selfie_image_base64 in JSON)" }, 400));

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

