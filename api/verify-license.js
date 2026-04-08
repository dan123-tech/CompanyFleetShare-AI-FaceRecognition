export const config = { runtime: "edge" };

function jsonResponse(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default async function handler(req) {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const body = await req.formData();
    const licenseImage = body.get("license_image");
    const selfieFront = body.get("selfie_front");
    const selfieLeft = body.get("selfie_left");
    const selfieRight = body.get("selfie_right");

    if (!licenseImage || !selfieFront || !selfieLeft || !selfieRight) {
      return jsonResponse({ error: "Missing required files." }, 400);
    }

    const threshold = String(body.get("threshold") ?? "0.55");

    const licenseBaseUrl = process.env.LICENSE_VALIDATOR_URL ?? "http://localhost:8080";
    const configuredLicenseEndpoint = process.env.LICENSE_VALIDATOR_ENDPOINT ?? "/validate-license";
    const licenseEndpoints = [
      ...new Set([
        configuredLicenseEndpoint,
        "/validate-license",
        "/validate",
        "/license/validate",
        "/driving-licence/validate",
        "/driving-license/validate",
      ]),
    ];

    let licenseResponse = null;
    let licenseResult = {};
    let usedLicenseEndpoint = licenseEndpoints[0];

    for (const endpoint of licenseEndpoints) {
      const licenseUrl = `${licenseBaseUrl.replace(/\/$/, "")}${endpoint}`;
      const licenseForm = new FormData();
      licenseForm.append("license_image", licenseImage);

      const attempt = await fetch(licenseUrl, { method: "POST", body: licenseForm });
      const attemptJson = await attempt.json().catch(() => ({}));
      if (attempt.status === 404) continue;

      licenseResponse = attempt;
      licenseResult = attemptJson;
      usedLicenseEndpoint = endpoint;
      break;
    }

    if (!licenseResponse) {
      licenseResponse = new Response(null, { status: 404 });
      licenseResult = { detail: "License endpoint not found on validator service." };
    }

    const faceBaseUrl = process.env.FACE_VALIDATOR_URL ?? "http://localhost:8080";
    const configuredFaceEndpoint = process.env.FACE_VALIDATOR_ENDPOINT ?? "/verify-license-face";
    const faceEndpoints = [...new Set([configuredFaceEndpoint, "/match", "/face-match", "/verify-license-face"])];

    let faceResponse = null;
    let faceResult = {};
    let usedFaceEndpoint = faceEndpoints[0];

    for (const endpoint of faceEndpoints) {
      const faceUrl = `${faceBaseUrl.replace(/\/$/, "")}${endpoint}`;
      const faceForm = new FormData();
      faceForm.append("license_image", licenseImage);
      faceForm.append("selfie_front", selfieFront);
      faceForm.append("selfie_left", selfieLeft);
      faceForm.append("selfie_right", selfieRight);
      faceForm.append("threshold", threshold);

      const attempt = await fetch(faceUrl, { method: "POST", body: faceForm });
      const attemptJson = await attempt.json().catch(() => ({}));
      if (attempt.status === 404) continue;

      faceResponse = attempt;
      faceResult = attemptJson;
      usedFaceEndpoint = endpoint;
      break;
    }

    if (!faceResponse) {
      faceResponse = new Response(null, { status: 404 });
      faceResult = { detail: "Face endpoint not found on validator service." };
    }

    const licenseOk = licenseResponse.ok;
    const faceOk = faceResponse.ok;
    const faceMatch = Boolean(faceResult && faceResult.match);

    let finalDecision = "rejected";
    if (licenseOk && faceOk && faceMatch) finalDecision = "approved";
    else if (licenseOk && faceOk) finalDecision = "manual_review";

    return jsonResponse(
      {
        final_decision: finalDecision,
        checks: {
          license_validation: {
            ok: licenseOk,
            status: licenseResponse.status,
            endpoint_used: usedLicenseEndpoint,
            response: licenseResult,
          },
          face_validation: {
            ok: faceOk,
            status: faceResponse.status,
            endpoint_used: usedFaceEndpoint,
            response: faceResult,
          },
        },
      },
      200
    );
  } catch (error) {
    return jsonResponse(
      {
        error: "Unexpected orchestration error.",
        message: error && error.message ? error.message : "Unknown error",
      },
      500
    );
  }
}
