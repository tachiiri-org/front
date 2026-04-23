export { createEmptySpecDocument, defaultSpecDocument } from './editor-document/default-document';
export { loadSpecDocument, normalizeSpecDocument } from './editor-document/normalization';
export { copyViewport, collectDescendantIds, moveComponentTree } from './editor-document/tree';
export { validateComponentInstance } from './editor-document/validation';
export { exportPromptDocument } from './editor-document/prompt-export';
export {
  buildSpecNodeContext,
  exportSpecNodeContextPrompt,
  getDefaultSelectedSpecNodeId,
  getGlobalSpecNode,
  getSpecNode,
  getSpecNodeAncestors,
  getSpecNodeChildren,
  getSpecNodes,
  getToolSpecNodeId,
  globalSpecNodeId,
  isSpecNodeDescendant,
  syncStructureNodesFromUiDocument,
} from './editor-document/spec-nodes';
export {
  buildSurfaceContext,
  createStarterScreenFromGoal,
  exportGitHubIssueDraft,
  exportSurfaceContextPrompt,
} from './surface-context';
