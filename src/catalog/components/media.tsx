import { z } from 'zod';

import type { ComponentDefinition } from './shared';

export const mediaComponents = [
  {
    type: 'Image',
    displayNameJa: '画像',
    displayNameEn: 'Image',
    category: 'Media',
    allowsChildren: false,
    propsSchema: z.object({
      alt: z.string(),
    }),
    defaultProps: { alt: 'Preview image' },
    fields: [{ kind: 'text', name: 'alt', label: 'Alt text' }],
    render: (props) => <div className="spec-image">{String(props.alt ?? '')}</div>,
  },
] as const satisfies readonly ComponentDefinition[];
