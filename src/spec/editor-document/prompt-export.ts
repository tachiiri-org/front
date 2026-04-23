import type { SpecDocument } from '../editor-schema';
import { viewportIds } from '../editor-schema';

export const exportPromptDocument = (document: SpecDocument): string => {
  const lines = ['# UI Spec Prompt', ''];

  for (const screen of document.screens) {
    lines.push(`Screen: ${screen.nameEn}`);

    for (const viewportId of viewportIds) {
      const viewport = screen.viewports[viewportId];

      lines.push(`Viewport: ${viewport.id}`);

      for (const component of viewport.components) {
        lines.push(
          `- ${component.type} "${component.nameEn}" / "${component.nameJa}" @ (${component.frame.x}, ${component.frame.y}, ${component.frame.w}, ${component.frame.h})`,
        );
      }

      lines.push('');
    }
  }

  return lines.join('\n').trim();
};
