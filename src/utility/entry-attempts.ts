import { randomUUID } from 'node:crypto';
import { positive } from '../shared/giveaway-rules';

export interface EntryContext {
    signal?: AbortSignal;
    /** Inherited only from this plugin's Entry Attempted trigger. */
    entryAttemptId?: string;
}
export interface EntryAttempt {
    id: string;
    weight: number;
    cancelled: boolean;
    reason?: string;
    error?: Error;
}

/** Transient controls only: no ticket, admission allowance, or persistent data is changed here. */
export class EntryAttempts {
    private pending = new Map<string, EntryAttempt>();
    private shutdown = new AbortController();
    open(weight: number) {
        this.signal().throwIfAborted();
        const attempt: EntryAttempt = { id: randomUUID(), weight, cancelled: false };
        this.pending.set(attempt.id, attempt);
        return attempt;
    }
    signal(source?: AbortSignal) {
        return source ? AbortSignal.any([source, this.shutdown.signal]) : this.shutdown.signal;
    }
    close(id: string) {
        this.pending.delete(id);
    }
    fail(id: string | undefined, error: unknown) {
        const attempt = id ? this.pending.get(id) : undefined;
        if (attempt) attempt.error = error instanceof Error ? error : new Error(String(error));
    }
    control(id: string | undefined, action: 'cancelAttempt' | 'setAttemptOdds', weight: unknown, reason: unknown) {
        if (!id) throw new Error('Run this action from Entry Attempted or supply an Entry Attempt ID');
        const attempt = this.pending.get(id);
        if (!attempt) throw new Error('Entry attempt is no longer open, no existing ticket was changed');
        if (attempt.cancelled) return { changed: false, attempt };
        try {
            if (action === 'cancelAttempt') {
                if (reason != null && typeof reason !== 'string') throw new Error('Cancellation reason must be text');
                attempt.cancelled = true;
                attempt.reason = (reason as string | undefined)?.trim() || undefined;
            } else attempt.weight = positive(weight, 'Entry weight');
        } catch (error) {
            attempt.error = error instanceof Error ? error : new Error(String(error));
            throw error;
        }
        return { changed: true, attempt };
    }
    stop() {
        this.shutdown.abort(new Error('Giveaway System is unloaded'));
        this.pending.clear();
    }
}

/** Stops waiting on a hook when its source is aborted/unloaded, late effects cannot use a closed token. */
export function awaitEntryHook(hook: Promise<void>, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const abort = () => {
            signal.removeEventListener('abort', abort);
            reject(signal.reason);
        };
        if (signal.aborted) {
            abort();
            hook.catch(() => { });
            return;
        }
        signal.addEventListener('abort', abort, { once: true });
        hook.then(
            () => {
                signal.removeEventListener('abort', abort);
                resolve();
            },
            (error) => {
                signal.removeEventListener('abort', abort);
                reject(error);
            },
        );
    });
}
