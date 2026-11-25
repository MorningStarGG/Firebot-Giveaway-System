import type { EffectModel } from './types';
export type DataArea =
    | 'summary'
    | 'configuration'
    | 'entries'
    | 'pending'
    | 'winners'
    | 'history'
    | 'backups'
    | 'templates';
export interface Change {
    generation: string;
    revision: number;
    giveawayIds: string[];
    areas: DataArea[];
}
export interface RowQuery {
    area: 'entries' | 'pending' | 'winners' | 'history' | 'backups' | 'templates';
    id?: string;
    search?: string;
    page?: number;
    pageSize?: number;
}
export interface GiveawayTemplate {
    id: string;
    name: string;
    description: string;
    configuration: EffectModel;
    createdAt: string;
    updatedAt: string;
}
export interface TemplateAsset {
    type: string;
    data: string;
}
export interface TemplateBundle {
    format: 'msgg:giveaway-templates';
    version: 1;
    templates: { name: string; description: string; configuration: EffectModel; image?: string }[];
    assets: Record<string, TemplateAsset>;
}
