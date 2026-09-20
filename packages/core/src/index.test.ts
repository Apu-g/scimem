import { describe, expect, it } from 'vitest';
import { CORE_VERSION, KNOWLEDGE_STATUSES, SOURCE_TYPES, hello } from './index.js';

describe('@scimem/core', () => {
  it('hello() greets with the package version', () => {
    expect(hello('apu')).toBe(`hello apu from @scimem/core (${CORE_VERSION})`);
  });

  it('exposes the source-type enum that the schema will use', () => {
    expect(SOURCE_TYPES).toEqual(['ai_chat', 'web_research', 'git_change', 'note']);
  });

  it('exposes the knowledge-status enum from Appendix A', () => {
    expect(KNOWLEDGE_STATUSES).toContain('SUPERSEDED');
  });
});