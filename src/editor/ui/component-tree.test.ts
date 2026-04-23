import { describe, expect, it } from 'vitest';

import { isOutlineRenameShortcut } from './component-tree';

describe('component-tree rename shortcut', () => {
  it('starts renaming with F2 only', () => {
    expect(
      isOutlineRenameShortcut({ altKey: false, ctrlKey: false, key: 'F2', metaKey: false }),
    ).toBe(true);
    expect(
      isOutlineRenameShortcut({ altKey: true, ctrlKey: false, key: 'F2', metaKey: false }),
    ).toBe(false);
    expect(
      isOutlineRenameShortcut({ altKey: false, ctrlKey: false, key: 'Enter', metaKey: false }),
    ).toBe(false);
  });
});
