/** Embedded in Firebot's serialized controller, no backend closure may be referenced. */
function createEditor($scope: any, communicator: any) {
    const host = window as any;
    const bridge = (host.__msggGiveawayEditor ||= (() => {
        const pending = new Map<string, any>();
        const subscriptions = new Set<(change: any) => void>();
        communicator.on(
            'msgg:giveaway:changed',
            async (change: any) => {
                for (const callback of subscriptions) callback(change);
            },
            true,
        );
        let sequence = 0;
        communicator.on(
            'msgg:giveaway:reply',
            async (message: any) => {
                const entry = pending.get(message?.requestId);
                if (!entry) return;
                pending.delete(message.requestId);
                clearTimeout(entry.timer);
                message.error ? entry.reject(new Error(message.error)) : entry.resolve(message.result);
            },
            true,
        );
        return { pending, subscriptions, id: () => `${Date.now()}-${++sequence}-${Math.random()}` };
    })());
    const provided = new Set<string>(),
        auto = new Map<string, any>(),
        requests = new Set<string>(),
        latest = new Map<string, string>();
    let destroyed = false;
    const subscriptions = new Set<(change: any) => void>();
    function leaves(value: any, prefix: string, visit: (path: string, value: any) => void) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            for (const [key, child] of Object.entries(value)) leaves(child, prefix ? `${prefix}.${key}` : key, visit);
        } else if (value !== undefined) visit(prefix, value);
    }
    leaves($scope.effect || {}, '', (path) => provided.add(path));
    const selection = () =>
        JSON.stringify([
            $scope.effect?.giveawayTitle,
            $scope.effect?.manualGiveawayTitle,
            $scope.effect?.giveawaySelectionMode,
            $scope.effect?.mode,
            $scope.effect?.setting?.type,
        ]);
    const get = (path: string) => path.split('.').reduce((object, key) => object?.[key], $scope.effect);
    $scope.$on('$destroy', () => {
        destroyed = true;
        for (const callback of subscriptions) bridge.subscriptions.delete(callback);
        for (const id of requests) {
            const entry = bridge.pending.get(id);
            if (entry) {
                clearTimeout(entry.timer);
                bridge.pending.delete(id);
                entry.reject(new Error('Editor closed'));
            }
        }
        requests.clear();
    });
    return {
        captureDefaults() {
            leaves($scope.effect, '', (path, value) => auto.set(path, value));
        },
        prefill(path: string, value: any) {
            leaves(value, path, (key, child) => {
                if (destroyed || provided.has(key) || !Object.is(get(key), auto.get(key))) return;
                const keys = key.split('.');
                let object = $scope.effect;
                for (const part of keys.slice(0, -1)) object = object[part] ||= {};
                object[keys.at(-1)!] = child;
                auto.set(key, child);
            });
        },
        client: {
            on(_name: string, callback: (change: any) => void) {
                const wrapped = (change: any) => {
                    if (!destroyed) {
                        callback(change);
                        $scope.$evalAsync();
                    }
                };
                subscriptions.add(wrapped);
                bridge.subscriptions.add(wrapped);
            },
            fireEventAsync(action: string, payload: any = {}) {
                if (destroyed) return Promise.reject(Object.assign(new Error('Editor closed'), { name: 'AbortError' }));
                const requestId = bridge.id(),
                    original = selection(),
                    key = JSON.stringify([action, payload]),
                    tracksSelection = action === 'getGiveawayData';
                latest.set(key, requestId);
                const request = new Promise<any>((resolve, reject) => {
                    const timer = setTimeout(() => {
                        bridge.pending.delete(requestId);
                        requests.delete(requestId);
                        reject(new Error('Giveaway request timed out'));
                    }, 10000);
                    bridge.pending.set(requestId, { resolve, reject, timer });
                    requests.add(requestId);
                    try {
                        communicator.fireEvent('msgg:giveaway:request', { requestId, action, payload });
                    } catch (error) {
                        clearTimeout(timer);
                        bridge.pending.delete(requestId);
                        reject(error);
                    }
                });
                return request.then(
                    (result) => {
                        requests.delete(requestId);
                        if (
                            destroyed ||
                            (tracksSelection && (original !== selection() || latest.get(key) !== requestId))
                        )
                            throw Object.assign(new Error('Request superseded or editor closed'), {
                                name: 'AbortError',
                            });
                        $scope.$evalAsync();
                        return result;
                    },
                    (error) => {
                        requests.delete(requestId);
                        if (
                            destroyed ||
                            (tracksSelection && (original !== selection() || latest.get(key) !== requestId))
                        )
                            throw Object.assign(new Error('Request superseded or editor closed'), {
                                name: 'AbortError',
                            });
                        if (!$scope.silentRequestErrors)
                            $scope.$evalAsync(() => {
                                $scope.giveawayError = error.message;
                            });
                        throw error;
                    },
                );
            },
        },
    };
}
export function withEditor(
    parameters: string[],
    callback: (...args: any[]) => void,
    constants?: unknown,
): (...args: any[]) => void {
    return new Function(
        `return (${parameters.join(',')})=>{const editor=(${createEditor.toString()})($scope,backendCommunicator);return (${callback.toString()})(editor,$scope,editor.client${parameters
            .slice(2)
            .map((name) => `,${name}`)
            .join('')},${JSON.stringify(constants) ?? 'undefined'});}`,
    )();
}

/** Firebot evaluates UI callbacks as raw JavaScript. Constructors must serialize as expressions,
 * rather than function declarations (which evaluate to undefined in its UI loader).
 * Keep the original constructible function and its normal Angular `this` binding.
 */
export function rendererExpression<T extends Function>(callback: T): T {
    const expression = `(${callback.toString()})`;
    Object.defineProperty(callback, 'toString', { value: () => expression });
    return callback;
}
