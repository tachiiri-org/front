import { describe, expect, it } from 'vitest';

import { isIssueDeleteShortcut, isIssueRenameShortcut } from './panel';

describe('issue-panel shortcuts', () => {
  it('starts renaming with F2 only', () => {
    expect(
      isIssueRenameShortcut({ altKey: false, ctrlKey: false, key: 'F2', metaKey: false }),
    ).toBe(true);
    expect(isIssueRenameShortcut({ altKey: true, ctrlKey: false, key: 'F2', metaKey: false })).toBe(
      false,
    );
    expect(
      isIssueRenameShortcut({ altKey: false, ctrlKey: false, key: 'Enter', metaKey: false }),
    ).toBe(false);
  });

  it('deletes with Delete only', () => {
    expect(
      isIssueDeleteShortcut({
        altKey: false,
        ctrlKey: false,
        key: 'Delete',
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe(true);
    expect(
      isIssueDeleteShortcut({
        altKey: false,
        ctrlKey: true,
        key: 'Delete',
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe(false);
    expect(
      isIssueDeleteShortcut({
        altKey: false,
        ctrlKey: false,
        key: 'Backspace',
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe(false);
  });
});
