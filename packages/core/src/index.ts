/**
 * @scimem/core
 *
 * Shared types, zod schemas, and constants used by every other package.
 * Kept dependency-free on purpose: anything that must be importable by the
 * web app, the extension, the CLI, and the worker lives here.
 */

/** Version of the core contract. */
export const CORE_VERSION = '0.1.0' as const;

/** Source of a captured event. */
export const SOURCE_TYPES = ['ai_chat', 'web_research', 'git_change', 'note'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/** Lifecycle status of a knowledge item or chunk. */
export const KNOWLEDGE_STATUSES = [
  'ACTIVE',
  'SUPERSEDED',
  'ARCHIVED',
  'CONFLICTING',
  'UNVERIFIED',
  'EXPIRED',
] as const;
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];

/** A minimal greeting — placeholder until real logic lands in later phases. */
export function hello(name: string = 'world'): string {
  return `hello ${name} from @scimem/core (${CORE_VERSION})`;
}