import { type ImagesProvider, type MutableImagesModels } from "../images-models.ts";
import { MODELS } from "../models.generated.ts";
import { type CreateModelsOptions, type MutableModels, type Provider } from "../models.ts";
import type { Api, KnownProvider, Model } from "../types.ts";
type BuiltinModelApi<TProvider extends KnownProvider, TModelId extends keyof (typeof MODELS)[TProvider]> = (typeof MODELS)[TProvider][TModelId] extends {
    api: infer TApi;
} ? (TApi extends Api ? TApi : never) : never;
/** Typed read of the generated built-in catalog. */
export declare function getBuiltinModel<TProvider extends KnownProvider, TModelId extends keyof (typeof MODELS)[TProvider]>(provider: TProvider, modelId: TModelId): Model<BuiltinModelApi<TProvider, TModelId>>;
export declare function getBuiltinProviders(): KnownProvider[];
export declare function getBuiltinModels<TProvider extends KnownProvider>(provider: TProvider): Model<BuiltinModelApi<TProvider, keyof (typeof MODELS)[TProvider]>>[];
/** All built-in providers, freshly constructed. */
export declare function builtinProviders(): Provider[];
/** A `Models` collection with every built-in provider registered. */
export declare function builtinModels(options?: CreateModelsOptions): MutableModels;
/** All built-in image-generation providers, freshly constructed. */
export declare function builtinImagesProviders(): ImagesProvider[];
/** An `ImagesModels` collection with every built-in image-generation provider registered. */
export declare function builtinImagesModels(options?: CreateModelsOptions): MutableImagesModels;
export {};
//# sourceMappingURL=all.d.ts.map