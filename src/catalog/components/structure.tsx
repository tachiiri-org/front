import { z } from 'zod';

import type { ComponentDefinition } from './shared';
import { createTextStyleFields, getTextStyle, stringSchema, textStyleSchema } from './shared';

export const structureComponents = [
  {
    type: 'Page',
    displayNameJa: 'ページ',
    displayNameEn: 'Page',
    category: 'Structure',
    allowsChildren: true,
    allowedChildTypes: [
      'Header',
      'Panel',
      'Footer',
      'Dialog',
      'Text',
      'Heading',
      'Button',
      'Input',
      'Textarea',
      'Image',
      'List',
    ],
    propsSchema: z.object({
      title: stringSchema,
      surface: z.enum(['canvas', 'paper', 'muted']),
      ...textStyleSchema,
    }),
    defaultProps: {
      title: 'Untitled Page',
      surface: 'canvas',
      textAlign: 'left',
      fontSize: 18,
      color: '#cccccc',
    },
    fields: [
      { kind: 'textarea', name: 'title', label: 'Title' },
      { kind: 'select', name: 'surface', label: 'Surface', options: ['canvas', 'paper', 'muted'] },
      ...createTextStyleFields(),
    ],
    primaryTextProp: 'title',
    render: (props) => (
      <div className={`spec-card spec-card--${String(props.surface ?? 'canvas')}`}>
        <span className="spec-card__eyebrow">Page</span>
        <strong style={getTextStyle(props)}>{String(props.title ?? '')}</strong>
      </div>
    ),
  },
  {
    type: 'Panel',
    displayNameJa: 'パネル',
    displayNameEn: 'Panel',
    category: 'Structure',
    allowsChildren: true,
    allowedChildTypes: ['Text', 'Heading', 'Button', 'Input', 'Textarea', 'Image', 'List'],
    propsSchema: z.object({
      title: stringSchema,
      tone: z.enum(['default', 'muted', 'accent']),
      ...textStyleSchema,
    }),
    defaultProps: {
      title: 'Panel',
      tone: 'default',
      textAlign: 'left',
      fontSize: 16,
      color: '#cccccc',
    },
    fields: [
      { kind: 'textarea', name: 'title', label: 'Title' },
      { kind: 'select', name: 'tone', label: 'Tone', options: ['default', 'muted', 'accent'] },
      ...createTextStyleFields(),
    ],
    primaryTextProp: 'title',
    render: (props) => (
      <div className={`spec-card spec-card--${String(props.tone ?? 'default')}`}>
        <span className="spec-card__eyebrow">Panel</span>
        <strong style={getTextStyle(props)}>{String(props.title ?? '')}</strong>
      </div>
    ),
  },
  {
    type: 'Header',
    displayNameJa: 'ヘッダー',
    displayNameEn: 'Header',
    category: 'Structure',
    allowsChildren: true,
    allowedChildTypes: ['Text', 'Heading', 'Button'],
    propsSchema: z.object({
      title: stringSchema,
      ...textStyleSchema,
    }),
    defaultProps: {
      title: 'Header',
      textAlign: 'left',
      fontSize: 18,
      color: '#cccccc',
    },
    fields: [{ kind: 'textarea', name: 'title', label: 'Title' }, ...createTextStyleFields()],
    primaryTextProp: 'title',
    render: (props) => (
      <div className="spec-header">
        <strong style={getTextStyle(props)}>{String(props.title ?? '')}</strong>
      </div>
    ),
  },
  {
    type: 'Footer',
    displayNameJa: 'フッター',
    displayNameEn: 'Footer',
    category: 'Structure',
    allowsChildren: true,
    allowedChildTypes: ['Button', 'Text'],
    propsSchema: z.object({
      tone: z.enum(['default', 'muted', 'inverse']),
    }),
    defaultProps: { tone: 'default' },
    fields: [
      { kind: 'select', name: 'tone', label: 'Tone', options: ['default', 'muted', 'inverse'] },
    ],
    render: (props) => (
      <div className={`spec-footer spec-footer--${String(props.tone ?? 'default')}`}>Footer</div>
    ),
  },
] as const satisfies readonly ComponentDefinition[];
