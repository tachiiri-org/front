import { useEffect, useRef, useState } from 'react';

import type { NamedOption } from '../../spec/editor-schema';

export const filterOptions = (items: readonly NamedOption[], search: string): NamedOption[] => {
  const value = search.trim().toLowerCase();

  if (!value) {
    return [...items];
  }

  return items.filter(
    (item) =>
      item.nameJa.toLowerCase().includes(value) || item.nameEn.toLowerCase().includes(value),
  );
};

type SearchableSelectProps<T extends { id: string; nameEn: string; nameJa: string }> = {
  readonly addLabel: string;
  readonly items: readonly T[];
  readonly label: string;
  readonly onAdd: () => void;
  readonly onDelete: () => void;
  readonly onSearchChange: (value: string) => void;
  readonly onSelect: (id: string) => void;
  readonly search: string;
  readonly selectedId: string;
  readonly selectedLabel: string;
};

export const SearchableSelect = <T extends { id: string; nameEn: string; nameJa: string }>({
  addLabel,
  items,
  label,
  onAdd,
  onDelete,
  onSearchChange,
  onSelect,
  search,
  selectedId,
  selectedLabel,
}: SearchableSelectProps<T>) => {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isOpen]);

  return (
    <section className="editor-select-control" ref={rootRef}>
      <button
        type="button"
        className="editor-dropdown__trigger"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className="editor-dropdown__summary">
          <span className="editor-dropdown__label">{label}</span>
          <span className="editor-dropdown__value">{selectedLabel || `Select ${label}`}</span>
        </span>
        <span className="editor-dropdown__chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {isOpen ? (
        <div className="editor-dropdown">
          <div className="editor-dropdown__topbar">
            <input
              className="editor-input"
              type="search"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={`Search ${label}`}
              autoFocus
            />
            <div className="editor-dropdown__actions">
              <button
                type="button"
                className="editor-dropdown__icon-button"
                aria-label={`Add ${addLabel}`}
                onClick={onAdd}
              >
                <svg aria-hidden="true" viewBox="0 0 16 16">
                  <path d="M3 1.5h6l4 4V14.5H3z" fill="none" stroke="currentColor" />
                  <path d="M9 1.5v4h4" fill="none" stroke="currentColor" />
                  <path d="M8 7v4M6 9h4" fill="none" stroke="currentColor" strokeLinecap="square" />
                </svg>
              </button>
              <button
                type="button"
                className="editor-dropdown__icon-button"
                aria-label={`Delete ${label}`}
                onClick={onDelete}
                disabled={items.length <= 1}
              >
                <svg aria-hidden="true" viewBox="0 0 16 16">
                  <path d="M3.5 4.5h9" fill="none" stroke="currentColor" />
                  <path d="M6 2.5h4" fill="none" stroke="currentColor" />
                  <path d="M5 4.5v8h6v-8" fill="none" stroke="currentColor" />
                </svg>
              </button>
            </div>
          </div>
          <div className="editor-select-list" role="listbox" aria-label={label}>
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`editor-select-list__item${selectedId === item.id ? ' is-selected' : ''}`}
                onClick={() => {
                  onSelect(item.id);
                  setIsOpen(false);
                }}
              >
                <span>{item.nameJa}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
};
