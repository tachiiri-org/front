// One-shot R2 cleanup: delete dead objects and strip default values from screen JSONs.
// Usage: node scripts/cleanup-r2.mjs [--local] [--dry-run]
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const BUCKET = 'layouts-dev';
const LOCAL = process.argv.includes('--local');
const REMOTE = process.argv.includes('--remote');
const DRY_RUN = process.argv.includes('--dry-run');
const flags = LOCAL ? ' --local' : REMOTE ? ' --remote' : '';

const DEAD_KEYS = [
  'demo/components/demo/grid.json',
  'sample/components/editor/grid.json',
  'schemas/grid.json',
  'schemas/placement.json',
];

const EDITOR_JSON = {
  head: { title: 'Editor', meta: [] },
  shell: { width: '1920px', height: '1080px' },
  grid: { kind: 'grid', columns: 120, rows: 120 },
  frames: [
    {
      kind: 'list',
      id: 'screens',
      targetComponentId: 'e6170fc1-428c-4719-8a13-523698b2b543',
      style: { margin: '0', padding: '0', overflowY: 'auto' },
      itemStyle: { listStyle: 'none', padding: '6px 12px', cursor: 'pointer' },
      placement: { x: 1, y: 13, width: 16, height: 98 },
      src: '/api/layouts/json-files',
      name: 'list-1',
    },
    {
      kind: 'canvas',
      id: 'e6170fc1-428c-4719-8a13-523698b2b543',
      style: { overflow: 'hidden' },
      cellStyle: { border: '1px solid rgba(0,0,0,0.15)', cursor: 'pointer', boxSizing: 'border-box' },
      placement: { x: 17, y: 13, width: 81, height: 98 },
      viewportWidth: 1920,
      viewportHeight: 1080,
      rows: 1,
      columns: 1,
      name: 'canvas-1',
    },
    {
      id: 'a67c0c88-5cbb-4f66-a865-1c96afbfa6b2',
      placement: { x: 1, y: 1, width: 120, height: 6 },
      kind: 'element',
      tag: 'div',
      style: {},
      text: 'test',
      name: 'element-1',
    },
    {
      id: 'props',
      placement: { x: 98, y: 13, width: 23, height: 98 },
      kind: 'component-editor',
      sections: [
        { label: 'Placement', source: 'placement' },
        { label: 'Properties', source: 'properties' },
      ],
      sourceCanvasId: 'e6170fc1-428c-4719-8a13-523698b2b543',
      name: 'editor-1',
    },
  ],
};

const SAMPLE_JSON = {
  head: { title: 'Sample', meta: [] },
  shell: {},
  grid: { kind: 'grid', columns: 120, rows: 120 },
  frames: [
    {
      kind: 'element',
      name: 'element-1',
      tag: 'div',
      style: {},
      id: '2effe69e-8ffa-4eb6-a7e8-8a39557e5b06',
      placement: { x: 90, y: 1, width: 31, height: 120 },
    },
  ],
};

const FORM_FIELD_KIND_OPTIONS = [
  'text-field',
  'number-field',
  'textarea-field',
  'boolean-field',
  'select-field',
  'style-map-field',
  'object-list-field',
  'field-group',
].map((k) => ({ value: k, label: k }));

const SCHEMA_EDITOR_JSON = {
  head: { title: 'Schema Editor', meta: [] },
  shell: { width: '100%', height: '100%' },
  grid: { kind: 'grid', columns: 120, rows: 120 },
  frames: [
    {
      kind: 'select',
      id: '51187a62-1c49-4b16-a572-9fd67afceda0',
      placement: { x: 1, y: 1, width: 22, height: 4 },
      name: 'select-1',
      source: {
        kind: 'endpoint',
        url: '/api/component-schemas',
        itemsPath: 'items',
        valueKey: 'value',
        labelKey: 'label',
        headers: {},
      },
      targetComponentId: 'e440c74d-71a6-4bc5-8eaa-f7ce19ebb6a2',
      padding: '',
    },
    {
      kind: 'table',
      id: 'e440c74d-71a6-4bc5-8eaa-f7ce19ebb6a2',
      placement: { x: 1, y: 6, width: 120, height: 115 },
      name: 'table-1',
      schema: {
        version: 1,
        columns: [
          {
            key: 'kind',
            label: 'kind',
            hidden: false,
            required: false,
            nullable: true,
            type: 'select',
            source: { kind: 'inline', options: FORM_FIELD_KIND_OPTIONS },
          },
          { key: 'key', label: 'key', hidden: false, required: false, nullable: true, type: 'string' },
          { key: 'label', label: 'label', hidden: false, required: false, nullable: true, type: 'string' },
          { key: 'options_json', label: 'options', hidden: false, required: false, nullable: true, type: 'string' },
          { key: 'fields_json', label: 'fields', hidden: false, required: false, nullable: true, type: 'string' },
          { key: 'style_json', label: 'style', hidden: false, required: false, nullable: true, type: 'string' },
        ],
      },
      data: { rows: [] },
      padding: '',
    },
  ],
};

const REWRITES = {
  'editor.json': EDITOR_JSON,
  'schema-editor.json': SCHEMA_EDITOR_JSON,
  'sample.json': SAMPLE_JSON,
};

function wranglerDelete(key) {
  const cmd = `wrangler r2 object delete ${BUCKET}/${key}${flags}`;
  console.log(`DELETE ${key}`);
  if (!DRY_RUN) execSync(cmd, { stdio: 'inherit' });
}

function wranglerPut(key, json) {
  const content = JSON.stringify(json, null, 2);
  console.log(`PUT ${key}`);
  if (DRY_RUN) {
    console.log(content);
    return;
  }
  const tmp = join(tmpdir(), `r2-cleanup-${Date.now()}.json`);
  writeFileSync(tmp, content);
  try {
    execSync(
      `wrangler r2 object put ${BUCKET}/${key} --file ${tmp} --content-type application/json${flags}`,
      { stdio: 'inherit' },
    );
  } finally {
    unlinkSync(tmp);
  }
}

if (DRY_RUN) console.log('[dry-run mode]\n');

for (const key of DEAD_KEYS) wranglerDelete(key);
for (const [key, json] of Object.entries(REWRITES)) wranglerPut(key, json);

console.log('\nDone.');
