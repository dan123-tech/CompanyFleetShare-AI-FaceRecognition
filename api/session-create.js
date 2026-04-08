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

async function fileToBase64(file) {
  const buf = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function upstashSet(key, value, ttlSeconds) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Missing UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN");

  const res = await fetch(`${url}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify([value, { ex: ttlSeconds }]),
  });
  if (!res.ok) throw new Error(`Upstash set failed (${res.status})`);
}

function randomId() {
  return crypto.randomUUID().replace(/-/g, "");
}

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return withCors(new Response(null, { status: 204 }));
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const form = await req.formData();
    const licenseImage = form.get("license_image");
    if (!licenseImage) return json({ error: "Missing license_image" }, 400);

    const sessionId = randomId();
    const b64 = await fileToBase64(licenseImage);
    const contentType = licenseImage.type || "image/jpeg";

    // Store minimal payload (base64 + mime). TTL 15 minutes.
    await upstashSet(`session:${sessionId}`, JSON.stringify({ b64, contentType }), 15 * 60);
    return withCors(json({ session_id: sessionId, expires_in_seconds: 15 * 60 }, 200));
  } catch (e) {
    return withCors(json({ error: "Failed to create session", message: e?.message || "Unknown error" }, 500));
  }
}

