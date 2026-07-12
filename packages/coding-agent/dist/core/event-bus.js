import { EventEmitter } from "node:events";
export function createEventBus() {
    const emitter = new EventEmitter();
    return {
        emit: (channel, data) => {
            emitter.emit(channel, data);
        },
        on: (channel, handler) => {
            const safeHandler = async (data) => {
                try {
                    await handler(data);
                }
                catch (err) {
                    console.error(`Event handler error (${channel}):`, err);
                }
            };
            emitter.on(channel, safeHandler);
            return () => emitter.off(channel, safeHandler);
        },
        clear: () => {
            emitter.removeAllListeners();
        },
    };
}
//# sourceMappingURL=event-bus.js.map