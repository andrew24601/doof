export extern class DominoRemoteRunnerNative {
    static start(port: int): bool;
    static stop(): void;
    static isConnected(): bool;
    static emitEvent(eventName: string, payload: string): void;
    static waitNextEvent(timeoutMillis: int): bool;
    static hasPendingEvents(): bool;
    static lastEventName(): string;
    static lastEventPayload(): string;
}

export function notifyUnity(eventName: string, payload: string): void {
    DominoRemoteRunnerNative.emitEvent(eventName, payload);
}

export function ensureListener(port: int): void {
    if (!DominoRemoteRunnerNative.isConnected()) {
        DominoRemoteRunnerNative.start(port);
    }
}
