import type { Api, ImagesApi, ImagesModel, Model, ProviderEnv } from "../types.ts";
import type { AuthContext, AuthResult, CredentialStore, ProviderAuth } from "./types.ts";
export type ModelsErrorCode = "model_source" | "model_validation" | "provider" | "stream" | "auth" | "oauth";
export interface AuthResolutionOverrides {
    apiKey?: string;
    env?: ProviderEnv;
}
export declare class ModelsError extends Error {
    readonly code: ModelsErrorCode;
    constructor(code: ModelsErrorCode, message: string, options?: {
        cause?: unknown;
    });
}
/** Model shape auth resolution receives: chat or image-generation models. */
export type AuthModel = Model<Api> | ImagesModel<ImagesApi>;
/**
 * Auth resolution shared by the `Models` and `ImagesModels` collections.
 * A stored credential owns the provider: ambient/env is consulted only when
 * nothing is stored. No silent env fallback after a failed refresh or for a
 * credential type without a matching handler.
 */
export declare function resolveProviderAuth(provider: {
    id: string;
    auth: ProviderAuth;
}, model: AuthModel, credentials: CredentialStore, authContext: AuthContext, overrides?: AuthResolutionOverrides): Promise<AuthResult | undefined>;
//# sourceMappingURL=resolve.d.ts.map