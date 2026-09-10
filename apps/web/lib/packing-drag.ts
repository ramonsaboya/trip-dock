import type { PackingTag } from './packing-client.ts';

export const PACKING_TAG_DRAG_TYPE = 'application/x-tripdock-packing-tag';

// Only accept an active tag in the loaded personal library, never arbitrary drag text.
export function acceptedTagDrop(payload: string, tags: Pick<PackingTag, 'id' | 'archived'>[]) {
  return tags.some(tag => tag.id === payload && !tag.archived) ? payload : null;
}

