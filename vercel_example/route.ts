// Example Next.js Route Handler (app/api/verify-license/route.ts)
// Calls the Docker face validator service from your backend.
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

    const validatorForm = new FormData();
    validatorForm.append("license_image", licenseImage);
    validatorForm.append("selfie_front", selfieFront);
    validatorForm.append("selfie_left", selfieLeft);
    validatorForm.append("selfie_right", selfieRight);
    validatorForm.append("threshold", "0.55");

    const baseUrl = process.env.FACE_VALIDATOR_URL ?? "http://localhost:8080";
    const validatorUrl = `${baseUrl.replace(/\/$/, "")}/verify-license-face`;

    const response = await fetch(validatorUrl, {
      method: "POST",
      body: validatorForm,
    });

    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch {
    return Response.json(
      { error: "Unexpected verification error." },
      { status: 500 }
    );
  }
}
