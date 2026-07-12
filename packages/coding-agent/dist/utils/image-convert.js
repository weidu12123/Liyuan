import { applyExifOrientation } from "./exif-orientation.js";
import { loadPhoton } from "./photon.js";
export async function convertImageBytesToPng(bytes) {
    const photon = await loadPhoton();
    if (!photon) {
        // Photon not available, can't convert
        return null;
    }
    try {
        const rawImage = photon.PhotonImage.new_from_byteslice(bytes);
        const image = applyExifOrientation(photon, rawImage, bytes);
        if (image !== rawImage)
            rawImage.free();
        try {
            return new Uint8Array(image.get_bytes());
        }
        finally {
            image.free();
        }
    }
    catch {
        // Conversion failed
        return null;
    }
}
/**
 * Convert image to PNG format for terminal display.
 * Kitty graphics protocol requires PNG format (f=100).
 */
export async function convertToPng(base64Data, mimeType) {
    // Already PNG, no conversion needed
    if (mimeType === "image/png") {
        return { data: base64Data, mimeType };
    }
    const bytes = new Uint8Array(Buffer.from(base64Data, "base64"));
    const pngBytes = await convertImageBytesToPng(bytes);
    if (!pngBytes) {
        return null;
    }
    return {
        data: Buffer.from(pngBytes).toString("base64"),
        mimeType: "image/png",
    };
}
//# sourceMappingURL=image-convert.js.map