import { z } from 'zod';

import type { ComponentDefinition } from './shared';
import { createTextStyleFields, getTextStyle, stringSchema, textStyleSchema } from './shared';

export const inputComponents = [
  {
    type: 'Button',
    displayNameJa: 'ボタン',
    displayNameEn: 'Button',
    category: 'Input',
    allowsChildren: false,
    propsSchema: z.object({
      emphasis: z.enum(['primary', 'secondary', 'ghost']),
      title: stringSchema,
      ...textStyleSchema,
    }),
    defaultProps: {
      title: 'Button',
      emphasis: 'primary',
      textAlign: 'center',
      fontSize: 14,
      color: '#ffffff',
    },
    fields: [
      { kind: 'textarea', name: 'title', label: 'Title' },
      {
        kind: 'select',
        name: 'emphasis',
        label: 'Emphasis',
        options: ['primary', 'secondary', 'ghost'],
      },
      ...createTextStyleFields(),
    ],
    primaryTextProp: 'title',
    render: (props) => (
      <button
        className={`spec-button spec-button--${String(props.emphasis ?? 'primary')}`}
        style={getTextStyle(props)}
        type="button"
      >
        {String(props.title ?? '')}
      </button>
    ),
  },
  {
    type: 'Input',
    displayNameJa: '入力欄',
    displayNameEn: 'Input',
    category: 'Input',
    allowsChildren: false,
    propsSchema: z.object({
      placeholder: z.string(),
    }),
    defaultProps: { placeholder: 'Type here' },
    fields: [{ kind: 'text', name: 'placeholder', label: 'Placeholder' }],
    render: (props) => (
      <input className="spec-input" placeholder={String(props.placeholder ?? '')} readOnly />
    ),
  },
  {
    type: 'Textarea',
    displayNameJa: '複数行入力',
    displayNameEn: 'Textarea',
    category: 'Input',
    allowsChildren: false,
    propsSchema: z.object({
      placeholder: z.string(),
    }),
    defaultProps: { placeholder: 'Write details' },
    fields: [{ kind: 'text', name: 'placeholder', label: 'Placeholder' }],
    render: (props) => (
      <textarea
        className="spec-textarea"
        placeholder={String(props.placeholder ?? '')}
        readOnly
        rows={3}
      />
    ),
  },
] as const satisfies readonly ComponentDefinition[];
