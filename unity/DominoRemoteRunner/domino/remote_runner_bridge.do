export extern class DominoRemoteRunnerNative {
    static function start(port: int): bool;
    static function stop(): void;
    static function isConnected(): bool;
    static function emitEvent(eventName: string, payload: string): void;
    static function waitNextEvent(timeoutMillis: int): bool;
    static function hasPendingEvents(): bool;
    static function lastEventName(): string;
    static function lastEventPayload(): string;
}

export function notifyUnity(eventName: string, payload: string): void {
    DominoRemoteRunnerNative.emitEvent(eventName, payload);
}

export function ensureListener(port: int): void {
    if (!DominoRemoteRunnerNative.isConnected()) {
        DominoRemoteRunnerNative.start(port);
    }
}
