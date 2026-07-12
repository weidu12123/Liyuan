type OAuthDeviceCodeIncompletePollResult = {
    status: "pending";
} | {
    status: "slow_down";
} | {
    status: "failed";
    message: string;
};
export type OAuthDeviceCodePollResult<T> = OAuthDeviceCodeIncompletePollResult | {
    status: "complete";
    value: T;
};
export type OAuthDeviceCodePollOptions<T> = {
    intervalSeconds?: number;
    expiresInSeconds?: number;
    poll: () => Promise<OAuthDeviceCodePollResult<T>>;
    signal?: AbortSignal;
};
export declare function pollOAuthDeviceCodeFlow<T>(options: OAuthDeviceCodePollOptions<T>): Promise<T>;
export {};
//# sourceMappingURL=device-code.d.ts.map