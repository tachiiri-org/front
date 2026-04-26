import { z } from 'zod';

import type { ComponentDefinition } from './shared';
import { createTextStyleFields, getTextStyle, stringSchema, textStyleSchema } from './shared';

export const contentComponents = [
  {
    type: 'Dialog',
    displayNameJa: 'ダイアログ',
    displayNameEn: 'Dialog',
    category: 'Feedback',
    allowsChildren: true,
    allowedChildTypes: ['Heading', 'Text', 'Button', 'Input', 'Textarea'],
    propsSchema: z.object({
      title: stringSchema,
      state: z.enum(['open', 'closed']),
      ...textStyleSchema,
    }),
    defaultProps: {
      title: 'Dialog',
      state: 'open',
      textAlign: 'left',
      fontSize: 16,
      color: '#cccccc',
    },
    fields: [
      { kind: 'textarea', name: 'title', label: 'Title' },
      { kind: 'select', name: 'state', label: 'State', options: ['open', 'closed'] },
      ...createTextStyleFields(),
    ],
    primaryTextProp: 'title',
    render: (props, children) => (
      <div className="spec-dialog">
        <span className="spec-card__eyebrow">{String(props.state ?? 'open')}</span>
        <strong style={getTextStyle(props)}>{String(props.title ?? '')}</strong>
        {children ? <div className="spec-card__children">{children}</div> : null}
      </div>
    ),
  },
  {
    type: 'Heading',
    displayNameJa: '見出し',
    displayNameEn: 'Heading',
    category: 'Content',
    allowsChildren: false,
    propsSchema: z.object({
      title: stringSchema,
      level: z.enum(['1', '2', '3']),
      ...textStyleSchema,
    }),
    defaultProps: {
      title: 'Heading',
      level: '1',
      textAlign: 'left',
      fontSize: 24,
      color: '#ffffff',
    },
    fields: [
      { kind: 'textarea', name: 'title', label: 'Title' },
      { kind: 'select', name: 'level', label: 'Level', options: ['1', '2', '3'] },
      ...createTextStyleFields(),
    ],
    primaryTextProp: 'title',
    render: (props, children) => (
      <div className="spec-heading">
        <strong style={getTextStyle(props)}>{String(props.title ?? '')}</strong>
        {children ? <div className="spec-card__children">{children}</div> : null}
      </div>
    ),
  },
  {
    type: 'Text',
    displayNameJa: 'テキスト',
    displayNameEn: 'Text',
    category: 'Content',
    allowsChildren: false,
    propsSchema: z.object({
      title: stringSchema,
      ...textStyleSchema,
    }),
    defaultProps: {
      title: 'Body text',
      textAlign: 'left',
      fontSize: 16,
      color: '#cccccc',
    },
    fields: [{ kind: 'textarea', name: 'title', label: 'Title' }, ...createTextStyleFields()],
    primaryTextProp: 'title',
    render: (props, children) => (
      <div className="spec-text">
        <p style={getTextStyle(props)}>{String(props.title ?? '')}</p>
        {children ? <div className="spec-card__children">{children}</div> : null}
      </div>
    ),
  },
  {
    type: 'List',
    displayNameJa: 'リスト',
    displayNameEn: 'List',
    category: 'Content',
    allowsChildren: false,
    propsSchema: z.object({
      items: z.string(),
    }),
    defaultProps: { items: 'First item\nSecond item\nThird item' },
    fields: [{ kind: 'textarea', name: 'items', label: 'Items' }],
    render: (props, children) => (
      <div className="spec-list-wrap">
        <ul className="spec-list">
          {String(props.items ?? '')
            .split('\n')
            .filter(Boolean)
            .map((item) => (
              <li key={item}>{item}</li>
            ))}
        </ul>
        {children ? <div className="spec-card__children">{children}</div> : null}
      </div>
    ),
  },
] as const satisfies readonly ComponentDefinition[];
