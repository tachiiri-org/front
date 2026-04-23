import seedDocument from '../../../ui/spec-document.json';

import type { NamedOption, SpecDocument } from '../editor-schema';
import { specDocumentSchema } from '../editor-schema';
import { syncStructureNodesFromUiDocument } from './spec-nodes';

const createNamedOption = (id: string, nameJa: string, nameEn: string): NamedOption => ({
  id,
  nameEn,
  nameJa,
});

export const createEmptySpecDocument = (): SpecDocument => ({
  concerns: [
    createNamedOption('local-store', 'local-store', 'local-store'),
    createNamedOption('issue', 'Issue', 'Issue'),
    createNamedOption('src-main', 'main', 'main'),
    createNamedOption('src-preload', 'preload', 'preload'),
    createNamedOption('src-shared', 'shared', 'shared'),
    createNamedOption('src-adapters', 'adapters', 'adapters'),
    createNamedOption('src-bootstrap', 'bootstrap', 'bootstrap'),
    createNamedOption('src-catalog', 'catalog', 'catalog'),
    createNamedOption('src-components', 'components', 'components'),
    createNamedOption('src-contracts', 'contracts', 'contracts'),
    createNamedOption('src-editor', 'editor', 'editor'),
    createNamedOption('src-interactions', 'interactions', 'interactions'),
    createNamedOption('src-layouts', 'layouts', 'layouts'),
    createNamedOption('src-screens', 'screens', 'screens'),
    createNamedOption('src-spec', 'spec', 'spec'),
    createNamedOption('src-state', 'state', 'state'),
  ],
  issues: [],
  specNodes: [],
  tools: [createNamedOption('ui-spec-editor', 'ui-spec-editor', 'ui-spec-editor')],
  screens: [
    {
      id: 'main-screen',
      nameJa: 'メイン画面',
      nameEn: 'Main Screen',
      viewports: {
        desktop: { id: 'desktop', components: [] },
        tablet: { id: 'tablet', components: [] },
        mobile: { id: 'mobile', components: [] },
      },
    },
  ],
});

export const defaultSpecDocument = syncStructureNodesFromUiDocument(
  specDocumentSchema.parse(seedDocument),
);
