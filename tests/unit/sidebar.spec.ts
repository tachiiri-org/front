import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const testLayout = {
  id: 'sample',
  viewport: { label: 'Desktop', width: 12, height: 9 },
  grid: { columns: 120, rows: 120 },
  canvas: {
    background: '#252526',
    gridLine: 'rgba(255, 255, 255, 0.04)',
    border: '#4f4f4f',
  },
  editorShell: {
    canvas: {
      outerPadding: 18,
      stagePadding: 40,
      stageBackground: '#2b2b2d',
      stageBorder: '#3c3c3c',
      shellBackground: '#2b2b2d',
      shellGap: 0,
    },
    sidebar: {
      width: 260,
      background: '#252526',
      borderLeft: '1px solid #3c3c3c',
      footerBackground: '#252526',
      sections: [
        { kind: 'selection-summary', title: 'Selection' },
        {
          kind: 'frame',
          title: 'Frame',
          helpText: 'This component controls the editor canvas itself.',
        },
        { kind: 'props', title: 'Props' },
        { kind: 'save', label: 'Save to R2' },
      ],
    },
  },
  editorForms: {
    __editorShell__: {
      sections: [
        {
          kind: 'fields',
          title: 'Canvas Shell',
          fields: [
            { kind: 'number', scope: 'shell', name: 'canvas.outerPadding', label: 'Outer Padding', min: 0 },
            { kind: 'number', scope: 'shell', name: 'canvas.stagePadding', label: 'Stage Padding', min: 0 },
            { kind: 'color', scope: 'shell', name: 'canvas.stageBackground', label: 'Stage Background' },
            { kind: 'color', scope: 'shell', name: 'canvas.stageBorder', label: 'Stage Border' },
            { kind: 'color', scope: 'shell', name: 'canvas.shellBackground', label: 'Shell Background' },
            { kind: 'number', scope: 'shell', name: 'canvas.shellGap', label: 'Shell Gap', min: 0 },
          ],
        },
        {
          kind: 'fields',
          title: 'Sidebar',
          fields: [
            { kind: 'number', scope: 'shell', name: 'sidebar.width', label: 'Width', min: 0 },
            { kind: 'color', scope: 'shell', name: 'sidebar.background', label: 'Background' },
            { kind: 'text', scope: 'shell', name: 'sidebar.borderLeft', label: 'Border Left' },
            { kind: 'color', scope: 'shell', name: 'sidebar.footerBackground', label: 'Footer Background' },
            { kind: 'text', scope: 'shell', name: 'sidebar.sections.0.title', label: 'Selection Title' },
            { kind: 'text', scope: 'shell', name: 'sidebar.sections.1.title', label: 'Frame Title' },
            { kind: 'text', scope: 'shell', name: 'sidebar.sections.1.helpText', label: 'Frame Help' },
            { kind: 'text', scope: 'shell', name: 'sidebar.sections.2.title', label: 'Props Title' },
            { kind: 'text', scope: 'shell', name: 'sidebar.sections.3.label', label: 'Save Label' },
          ],
        },
      ],
    },
    Canvas: {
      sections: [
        {
          kind: 'fields',
          title: 'Props',
          fields: [
            { kind: 'text', scope: 'props', name: 'label', label: 'Label' },
            { kind: 'number', scope: 'props', name: 'width', label: 'Viewport Width', min: 1 },
            { kind: 'number', scope: 'props', name: 'height', label: 'Viewport Height', min: 1 },
            { kind: 'number', scope: 'props', name: 'columns', label: 'Grid Columns', min: 1 },
            { kind: 'number', scope: 'props', name: 'rows', label: 'Grid Rows', min: 1 },
            { kind: 'color', scope: 'props', name: 'background', label: 'Background' },
            { kind: 'text', scope: 'props', name: 'gridLine', label: 'Grid Line' },
            { kind: 'color', scope: 'props', name: 'border', label: 'Border' },
            { kind: 'text', scope: 'props', name: 'shadow', label: 'Shadow' },
          ],
        },
      ],
    },
    Text: {
      sections: [
        {
          kind: 'fields',
          title: 'Frame',
          fields: [
            { kind: 'number', scope: 'frame', name: 'x', label: 'x', min: 0 },
            { kind: 'number', scope: 'frame', name: 'y', label: 'y', min: 0 },
            { kind: 'number', scope: 'frame', name: 'w', label: 'w', min: 1 },
            { kind: 'number', scope: 'frame', name: 'h', label: 'h', min: 1 },
          ],
        },
        {
          kind: 'fields',
          title: 'Props',
          fields: [
            { kind: 'textarea', scope: 'props', name: 'title', label: 'Title' },
            {
              kind: 'select',
              scope: 'props',
              name: 'textAlign',
              label: 'Text Align',
              options: ['left', 'center', 'right'],
            },
            { kind: 'number', scope: 'props', name: 'fontSize', label: 'Font Size', min: 10, max: 48 },
            { kind: 'color', scope: 'props', name: 'color', label: 'Color' },
          ],
        },
      ],
    },
    Heading: {
      sections: [
        {
          kind: 'fields',
          title: 'Frame',
          fields: [
            { kind: 'number', scope: 'frame', name: 'x', label: 'x', min: 0 },
            { kind: 'number', scope: 'frame', name: 'y', label: 'y', min: 0 },
            { kind: 'number', scope: 'frame', name: 'w', label: 'w', min: 1 },
            { kind: 'number', scope: 'frame', name: 'h', label: 'h', min: 1 },
          ],
        },
        {
          kind: 'fields',
          title: 'Props',
          fields: [
            { kind: 'textarea', scope: 'props', name: 'title', label: 'Title' },
            { kind: 'select', scope: 'props', name: 'level', label: 'Level', options: ['1', '2', '3'] },
            {
              kind: 'select',
              scope: 'props',
              name: 'textAlign',
              label: 'Text Align',
              options: ['left', 'center', 'right'],
            },
            { kind: 'number', scope: 'props', name: 'fontSize', label: 'Font Size', min: 10, max: 48 },
            { kind: 'color', scope: 'props', name: 'color', label: 'Color' },
          ],
        },
      ],
    },
  },
  cells: [
    {
      id: 'page-root',
      frame: { x: 0, y: 0, w: 120, h: 120 },
      type: 'Page',
      props: {
        title: 'UI Spec Editor',
        surface: 'canvas',
        textAlign: 'left',
        fontSize: 18,
        color: '#cccccc',
      },
    },
    {
      id: 'canvas-root',
      parentId: 'page-root',
      frame: { x: 0, y: 0, w: 120, h: 120 },
      type: 'Canvas',
      props: {
        label: 'Desktop',
        width: 12,
        height: 9,
        columns: 120,
        rows: 120,
        background: '#252526',
        gridLine: 'rgba(255, 255, 255, 0.04)',
        border: '#4f4f4f',
        shadow: '0 0 0 1px rgba(0, 0, 0, 0.25), 0 16px 40px rgba(0, 0, 0, 0.22)',
      },
    },
    {
      id: 'cell-text',
      frame: { x: 5, y: 5, w: 30, h: 10 },
      type: 'Text',
      props: { title: 'Hello World', textAlign: 'left', fontSize: 16, color: '#cccccc' },
    },
    {
      id: 'cell-heading',
      frame: { x: 5, y: 20, w: 30, h: 10 },
      type: 'Heading',
      props: { title: 'My Heading', level: '1', textAlign: 'left', fontSize: 24, color: '#ffffff' },
    },
  ],
};

const emptyLayout = { ...testLayout, cells: [] };

test.beforeEach(async ({ request }) => {
  const res = await request.put('/api/layouts/sample', { data: testLayout });
  expect(res.ok()).toBeTruthy();
});

test('サイドバーは初期状態でキャンバスルートが選択されて表示される', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.grid-canvas__cell');

  await expect(page.locator('.cell-sidebar')).toBeVisible();
  await expect(page.locator('.sidebar-cell-id')).toHaveText('canvas-root');
  await expect(page.locator('.sidebar-cell-type')).toHaveText('キャンバス');
});

test('Canvas がないレイアウトでも Canvas ルートが補われる', async ({ page, request }) => {
  await request.put('/api/layouts/sample', { data: emptyLayout });

  await page.goto('/');
  await page.waitForSelector('.grid-canvas__cell');

  await expect(page.locator('.cell-sidebar')).toBeVisible();
  await expect(page.locator('.sidebar-cell-id')).toHaveText('canvas-root');
});

test('サイドバーにクリックしたセルの情報が表示される', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.grid-canvas__cell');

  await page.locator('.grid-canvas__cell').nth(2).click();

  await expect(page.locator('.sidebar-cell-type')).toHaveText('テキスト');
  await expect(page.locator('.sidebar-cell-id')).toHaveText('cell-text');
});

test('別のセルをクリックするとサイドバーの表示が切り替わる', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.grid-canvas__cell');

  await page.locator('.grid-canvas__cell').nth(1).click();
  await expect(page.locator('.sidebar-cell-id')).toHaveText('cell-text');

  await page.locator('.grid-canvas__cell').nth(3).click();
  await expect(page.locator('.sidebar-cell-id')).toHaveText('cell-heading');
  await expect(page.locator('.sidebar-cell-type')).toHaveText('見出し');
});

test('キャンバス背景をクリックするとサイドバーが閉じる', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.grid-canvas__cell');

  await page.locator('.grid-canvas__cell').nth(1).click();
  await expect(page.locator('.cell-sidebar')).toBeVisible();

  await page.locator('.grid-canvas').click({ position: { x: 5, y: 5 } });

  await expect(page.locator('.cell-sidebar')).not.toBeVisible();
});

test('サイドバーにSave to R2ボタンがある', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.grid-canvas__cell');

  await expect(page.locator('.sidebar-save-btn')).toBeVisible();
  await expect(page.locator('.sidebar-save-btn')).toHaveText('Save to R2');
});

test('サイドバーでpropsを編集するとキャンバスに反映される', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.grid-canvas__cell');

  const titleField = page.locator('.sidebar-label').filter({ hasText: 'Title' }).locator('textarea');
  await titleField.fill('Updated Text');

  await expect(page.locator('.grid-canvas__cell').nth(1)).toContainText('Updated Text');
});

test('Save to R2ボタンで変更がサーバーに保存される', async ({ page, request }) => {
  await page.goto('/');
  await page.waitForSelector('.grid-canvas__cell');

  const widthField = page.locator('.sidebar-label').filter({ hasText: 'Viewport Width' }).locator('input');
  await widthField.fill('16');

  await page.locator('.sidebar-save-btn').click();
  await page.waitForTimeout(500);

  const res = await request.get('/api/layouts/sample');
  const body = await res.json() as {
    viewport: { width: number };
    cells: { props: { width: number } }[];
  };
  expect(body.viewport.width).toBe(16);
  expect(body.cells[1].props.width).toBe(16);
});

test('サイドバーでキャンバス設定を編集するとエディタのグリッドが変わる', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.grid-canvas__cell');

  const widthField = page.locator('.sidebar-label').filter({ hasText: 'Viewport Width' }).locator('input');
  await widthField.fill('16');

  await expect(page.locator('.grid-canvas')).toHaveAttribute(
    'style',
    /aspect-ratio: 1\.7777777777777777/,
  );
});

test('Canvas のラベルは viewport 内に表示される', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.grid-canvas__cell');

  await expect(page.locator('.spec-canvas__viewport .spec-canvas__chrome')).toBeVisible();
});

test('選択中のセルは枠線で分かる', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.grid-canvas__cell--selected');

  await expect(page.locator('.grid-canvas__cell--selected').first()).toHaveCSS('outline-width', '2px');
});

test('Canvas ルートの選択中は青い枠で分かる', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.grid-canvas__cell--surface-selected');

  await expect(page.locator('.grid-canvas__cell--surface-selected')).toHaveCSS(
    'outline-color',
    'rgb(14, 99, 156)',
  );
  await expect(page.locator('.grid-canvas__cell--surface-selected')).toHaveCSS(
    'box-shadow',
    /rgb\(14, 99, 156\)/,
  );
});

test('Canvas ルートを選ぶと editorShell の見た目設定を編集できる', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.grid-canvas__cell--surface-selected');

  const outerPaddingField = page
    .locator('.sidebar-label')
    .filter({ hasText: 'Outer Padding' })
    .locator('input');

  await outerPaddingField.fill('28');

  await expect(page.locator('.grid-canvas-shell')).toHaveCSS('padding-top', '28px');

  const saveLabelField = page
    .locator('.sidebar-label')
    .filter({ hasText: 'Save Label' })
    .locator('input');

  await saveLabelField.fill('保存');

  await expect(page.locator('.sidebar-save-btn')).toHaveText('保存');
});
