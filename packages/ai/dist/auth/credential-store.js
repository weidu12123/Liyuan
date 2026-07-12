/**
 * Default in-memory credential store. Apps inject persistent stores.
 * Keyed by `Provider.id`, one credential per provider; see `CredentialStore`.
 * Writes are serialized per provider through a promise chain.
 */
export class InMemoryCredentialStore {
    credentials = new Map();
    chains = new Map();
    /** Serialize tasks per provider id. */
    enqueue(providerId, task) {
        const previous = this.chains.get(providerId) ?? Promise.resolve();
        const next = (async () => {
            await previous.catch(() => { });
            return task();
        })();
        this.chains.set(providerId, next.catch(() => { }));
        return next;
    }
    async read(providerId) {
        return this.credentials.get(providerId);
    }
    modify(providerId, fn) {
        return this.enqueue(providerId, async () => {
            const current = this.credentials.get(providerId);
            const next = await fn(current);
            if (next !== undefined)
                this.credentials.set(providerId, next);
            return next ?? current;
        });
    }
    delete(providerId) {
        return this.enqueue(providerId, async () => {
            this.credentials.delete(providerId);
        });
    }
}
//# sourceMappingURL=credential-store.js.map