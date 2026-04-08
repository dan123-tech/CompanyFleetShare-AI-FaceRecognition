// Example Next.js Route Handler (app/api/verify-license/route.ts)
// Main website orchestrator:
// 1) Sends licence image to driving-licence validator service
// 2) Sends licence+selfies to face recognition service
// 3) Merges both responses into one final decision
export async function POST(req: Request) {
  try {
    const body = await req.formData();

    const licenseImage = body.get("license_image");
    const selfieFront = body.get("selfie_front");
    const selfieLeft = body.get("selfie_left");
    const selfieRight = body.get("selfie_right");

    if (!licenseImage || !selfieFront || !selfieLeft || !selfieRight) {
      return Response.json(
        { error: "Missing required files." },
        { status: 400 }
      );
    }

    const threshold = String(body.get("threshold") ?? "0.55");

    // Service A: driving licence validator
    const licenseBaseUrl = process.env.LICENSE_VALIDATOR_URL ?? "http://localhost:8080";
    const licenseEndpoint = process.env.LICENSE_VALIDATOR_ENDPOINT ?? "/validate-license";
    const licenseUrl = `${licenseBaseUrl.replace(/\/$/, "")}${licenseEndpoint}`;
    const licenseForm = new FormData();
    licenseForm.append("license_image", licenseImage);

    const licenseResponse = await fetch(licenseUrl, {
      method: "POST",
      body: licenseForm,
    });
    const licenseResult = await licenseResponse.json().catch(() => ({}));

    // Service B: face recognition + live scan comparison
    const faceBaseUrl = process.env.FACE_VALIDATOR_URL ?? "http://localhost:8080";
    const faceEndpoint = process.env.FACE_VALIDATOR_ENDPOINT ?? "/verify-license-face";
    const faceUrl = `${faceBaseUrl.replace(/\/$/, "")}${faceEndpoint}`;
    const faceForm = new FormData();
    faceForm.append("license_image", licenseImage);
    faceForm.append("selfie_front", selfieFront);
    faceForm.append("selfie_left", selfieLeft);
    faceForm.append("selfie_right", selfieRight);
    faceForm.append("threshold", threshold);

    const faceResponse = await fetch(faceUrl, {
      method: "POST",
      body: faceForm,
    });
    const faceResult = await faceResponse.json().catch(() => ({}));

    const licenseOk = licenseResponse.ok;
    const faceOk = faceResponse.ok;
    const faceMatch = Boolean(faceResult?.match);
    const finalDecision =
      licenseOk && faceOk && faceMatch
        ? "approved"
        : licenseOk && faceOk
          ? "manual_review"
          : "rejected";

    return Response.json(
      {
        final_decision: finalDecision,
        checks: {
          license_validation: {
            ok: licenseOk,
            status: licenseResponse.status,
            response: licenseResult,
          },
          face_validation: {
            ok: faceOk,
            status: faceResponse.status,
            response: faceResult,
          },
        },
      },
      { status: 200 }
    );
  } catch {
    return Response.json(
      { error: "Unexpected orchestration error." },
      { status: 500 }
    );
  }
}
