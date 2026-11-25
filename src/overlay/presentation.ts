import firebot from '@crowbartools/firebot-types';
import { randomUUID } from 'node:crypto';
import type { GiveawayState, GiveawayWinner } from '../types/types';
type DisplayWinner = GiveawayWinner & { displayName?: string };
/** Match the main winner rotation and ticker without looking up the entire archived winner list. */
function displayedWinners(state: GiveawayState): DisplayWinner[] {
    if (state.giveawayData.display.showWinner === false) return [];
    const pending = state.pendingWinners || [],
        completed = state.winners || [];
    return [
        ...pending,
        ...(state.giveawayData.display.rotateWinners ? completed : pending.length ? [] : completed.slice(-1)),
    ];
}
export class Presentation {
    readonly generation = randomUUID();
    private revision = 0;
    private packets = new Map<string, any>();
    private stopped = false;
    private names = new Map<string, { value: string; expires: number }>();
    private nameLookups = new Map<string, Promise<string>>();
    private cachedName(name: string) {
        const cached = this.names.get(name);
        return cached && cached.expires > Date.now() ? cached.value : undefined;
    }
    private displayName(name: string): Promise<string> {
        const cached = this.cachedName(name);
        if (cached) return Promise.resolve(cached);
        const pending = this.nameLookups.get(name);
        if (pending) return pending;
        const lookup = Promise.resolve()
            .then(() => firebot.viewers?.getViewerByUsername(name))
            .then((viewer) => (typeof viewer?.displayName === 'string' ? viewer.displayName.trim() || name : name))
            .catch(() => name)
            .then((value) => {
                if (!this.stopped) {
                    this.names.set(name, { value, expires: Date.now() + 5 * 60_000 });
                    if (this.names.size > 512) this.names.delete(this.names.keys().next().value!);
                }
                return value;
            })
            .finally(() => this.nameLookups.delete(name));
        this.nameLookups.set(name, lookup);
        return lookup;
    }
    private enrichNames(key: string, packet: any, names: string[]) {
        if (!names.length) return;
        void Promise.all(names.map(async (name) => [name, await this.displayName(name)] as const))
            .then((results) => {
                // Late results cannot undo a newer update, move, hide, or plugin unload.
                if (this.stopped || this.packets.get(key) !== packet) return;
                const resolved = new Map(results),
                    enriched = structuredClone(packet);
                let changed = false;
                for (const winner of displayedWinners(enriched.config)) {
                    const name = resolved.get(winner.username);
                    if (name && name !== winner.displayName) {
                        winner.displayName = name;
                        changed = true;
                    }
                }
                if (!changed) return;
                enriched.revision = ++this.revision;
                this.packets.set(key, enriched);
                firebot.webServer.sendWebSocketEvent('msgg:giveaway-system', enriched);
            })
            .catch((error) => firebot.logger.warn('Unable to update giveaway display names', error));
    }
    publish(
        giveawayId: string,
        state: GiveawayState,
        type: 'update' | 'remove' | 'show',
        detail?: Record<string, unknown>,
    ) {
        if (this.stopped) return;
        if (type === 'update' && ![...this.packets.values()].some((p) => p.giveawayId === giveawayId)) return;
        const styles = structuredClone(state.giveawayData.styles);
        if (styles.imageMode === 'local' && styles.imageFile && styles.imagePlacement !== 'none') {
            try {
                styles.imageToken = firebot.webServer.createResourceToken(
                    styles.imageFile,
                    Math.max(60, state.retentionDays * 86400),
                );
            } catch (error) {
                firebot.logger.warn('Unable to prepare giveaway image', error);
                delete styles.imageToken;
            }
        }
        for (const [oldKey, previous] of this.packets)
            if (previous.giveawayId === giveawayId && previous.instance !== (state.overlayInstance || '')) {
                this.packets.delete(oldKey);
                firebot.webServer.sendWebSocketEvent('msgg:giveaway-system', {
                    ...previous,
                    type: 'remove',
                    revision: ++this.revision,
                });
            }
        const packet = {
            protocol: 1,
            generation: this.generation,
            revision: ++this.revision,
            giveawayId,
            uuid: state.uuid,
            instance: state.overlayInstance || '',
            type: type === 'show' ? 'update' : type,
            generated: true,
            config: {
                ...structuredClone(state),
                giveawayId,
                giveawayTitle: state.giveawayData.title,
                giveawayData: { ...structuredClone(state.giveawayData), styles },
                styles,
                display: state.giveawayData.display,
            },
            detail,
        };
        const key = JSON.stringify([packet.instance, giveawayId]);
        const winners = type === 'remove' ? [] : displayedWinners(packet.config);
        const missing = new Set<string>();
        for (const winner of winners) {
            const name = this.cachedName(winner.username);
            winner.displayName = name || winner.username;
            if (!name) missing.add(winner.username);
        }
        if (type === 'remove') this.packets.delete(key);
        else this.packets.set(key, packet);
        firebot.webServer.sendWebSocketEvent('msgg:giveaway-system', packet);
        this.enrichNames(key, packet, [...missing]);
        return packet;
    }
    snapshot(instance: string, id: string) {
        return this.packets.get(JSON.stringify([instance, id])) || null;
    }
    dispatch(sender: (data: any, instance?: string) => void, state: GiveawayState, id: string) {
        const packet = this.snapshot(state.overlayInstance || '', id);
        if (packet) sender(packet, packet.instance || undefined);
    }
    dispose() {
        if (this.stopped) return;
        this.stopped = true;
        this.packets.clear();
        this.names.clear();
        this.nameLookups.clear();
        firebot.webServer.sendWebSocketEvent('msgg:giveaway-system', {
            protocol: 1,
            generation: this.generation,
            revision: ++this.revision,
            type: 'dispose',
        });
    }
}
/** Served as an overlay dependency and evaluated independently of the backend bundle. */
export function initializeOverlayBridge(expectedGeneration: string) {
    const host = window as any;
    if (host.__msggGiveawayBridge) return;
    const instance = new URL(location.href).searchParams.get('instance') || '';
    const frames = new Map<string, any>(),
        versions = new Map<string, number>(),
        retired = new Set<string>();
    let socket: WebSocket | undefined,
        reconnect: ReturnType<typeof setTimeout> | undefined,
        stopped = false;
    const frameConfig = (entry: any) => {
        const fontCss = document.getElementById('firebot-overlay-fonts')?.textContent || '';
        entry.frame.contentWindow?.postMessage({ ...entry.packet, fontCss }, '*');
    };
    const apply = (packet: any) => {
        if (
            packet?.protocol !== 1 ||
            typeof packet.generation !== 'string' ||
            retired.has(packet.generation) ||
            !Number.isFinite(packet.revision)
        )
            return;
        if (packet.generation !== expectedGeneration) {
            if (packet.type !== 'update') return;
            retired.add(expectedGeneration);
            expectedGeneration = packet.generation;
        }
        if (packet.type === 'dispose') {
            dispose();
            delete host.__msggGiveawayBridge;
            return;
        }
        if ((packet.instance || '') !== instance || typeof packet.giveawayId !== 'string') return;
        const versionKey = JSON.stringify([packet.generation, packet.giveawayId]);
        if ((versions.get(versionKey) || 0) >= packet.revision) return;
        versions.set(versionKey, packet.revision);
        const existing = frames.get(packet.giveawayId);
        if (packet.type === 'remove') {
            if (existing && existing.packet.uuid === packet.uuid) {
                existing.frame.remove();
                frames.delete(packet.giveawayId);
            }
            return;
        }
        if (packet.type === 'draw') {
            existing?.frame.contentWindow?.postMessage(packet, '*');
            return;
        }
        if (packet.type !== 'update') return;
        if (existing && existing.packet.uuid === packet.uuid && existing.packet.generation === packet.generation) {
            existing.packet = packet;
            frameConfig(existing);
            return;
        }
        existing?.frame.remove();
        frames.delete(packet.giveawayId);
        if (!packet.generated) return;
        const frame = document.createElement('iframe');
        frame.title = 'Giveaway display';
        frame.dataset.giveawayId = packet.giveawayId;
        frame.setAttribute('sandbox', 'allow-scripts');
        Object.assign(frame.style, {
            position: 'fixed',
            inset: '0',
            width: '100%',
            height: '100%',
            border: '0',
            background: 'transparent',
            pointerEvents: 'none',
        });
        const entry = { frame, packet };
        frames.set(packet.giveawayId, entry);
        frame.onload = () => {
            if (frames.get(packet.giveawayId) === entry) frameConfig(entry);
        };
        frame.src = new URL('/plugins/giveaway-system/giveaway-system.html', location.href).href;
        document.body.appendChild(frame);
    };
    const synchronize = async () => {
        for (const [id, entry] of frames) {
            try {
                const url = new URL('/plugins/giveaway-system/state', location.href);
                url.searchParams.set('instance', instance);
                url.searchParams.set('id', id);
                const response = await fetch(url);
                if (!response.ok) continue;
                const packet = await response.json();
                if (frames.get(id) !== entry) continue;
                if (packet) apply(packet);
                else {
                    entry.frame.remove();
                    frames.delete(id);
                }
            } catch { }
        }
    };
    const connect = () => {
        if (stopped) return;
        const url = new URL(location.href);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        url.pathname = '/';
        url.search = '';
        url.hash = '';
        socket = new WebSocket(url.href);
        socket.onopen = () => {
            socket?.send(JSON.stringify({ type: 'invoke', id: 1, name: 'subscribe-events' }));
            void synchronize();
        };
        socket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                if (message.type === 'event' && message.name === 'custom-event:msgg:giveaway-system')
                    apply(message.data);
            } catch { }
        };
        socket.onclose = () => {
            if (!stopped) reconnect = setTimeout(connect, 1000);
        };
    };
    const dispose = () => {
        stopped = true;
        clearTimeout(reconnect);
        socket?.close();
        for (const entry of frames.values()) entry.frame.remove();
        frames.clear();
    };
    host.__msggGiveawayBridge = { apply, dispose, frames };
    window.addEventListener('pagehide', dispose, { once: true });
    connect();
}
export const onGiveawayOverlayEvent = (data: unknown) => {
    (window as any).__msggGiveawayBridge?.apply(data);
};
