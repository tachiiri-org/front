import type { SpecNode, SpecNodeDocItem } from '../../spec/editor-schema';

export type SelectedDocumentSource = 'spec' | 'global';

export const createSelectedGlobalDocumentNode = (
  globalNode: SpecNode,
  item: SpecNodeDocItem,
): SpecNode => ({
  ...globalNode,
  id: `global-doc-item:${item.id ?? 'unknown'}`,
  titleEn: item.text || 'Untitled',
  titleJa: item.text || 'Untitled',
  doc: { items: item.children },
});

export const getSelectedSpecOutlineNodeId = (
  source: SelectedDocumentSource,
  selectedSpecNodeId: string | null,
): string | null => (source === 'spec' ? selectedSpecNodeId : null);

export const getSelectedGlobalOutlineItemId = (
  source: SelectedDocumentSource,
  selectedGlobalItemId: string | null,
): string | null => (source === 'global' ? selectedGlobalItemId : null);
