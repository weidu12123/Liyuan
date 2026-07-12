import type { Credential, CredentialStore } from "./types.ts";
/**
 * Default in-memory credential store. Apps inject persistent stores.
 * Keyed by `Provider.id`, one credential per provider; see `CredentialStore`.
 * Writes are serialized per provider through a promise chain.
 */
export declare class InMemoryCredentialStore implements CredentialStore {
    private credentials;
    private chains;
    /** Serialize tasks per provider id. */
    private enqueue;
    read(providerId: string): Promise<Credential | undefined>;
    modify(providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>): Promise<Credential | undefined>;
    delete(providerId: string): Promise<void>;
}
//# sourceMappingURL=credential-store.d.ts.map