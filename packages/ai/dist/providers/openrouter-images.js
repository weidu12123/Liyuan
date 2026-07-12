import { openrouterImagesApi } from "../api/openrouter-images.lazy.js";
import { envApiKeyAuth } from "../auth/helpers.js";
import { IMAGE_MODELS } from "../image-models.generated.js";
import { createImagesProvider } from "../images-models.js";
export function openrouterImagesProvider() {
    return createImagesProvider({
        id: "openrouter",
        name: "OpenRouter",
        auth: { apiKey: envApiKeyAuth("OpenRouter API key", ["OPENROUTER_API_KEY"]) },
        models: Object.values(IMAGE_MODELS.openrouter),
        api: openrouterImagesApi(),
    });
}
//# sourceMappingURL=openrouter-images.js.map