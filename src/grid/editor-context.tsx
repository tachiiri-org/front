import { createContext, useContext, type ReactNode } from 'react';
import type { GridCell, GridLayout } from './schema';

export type EditorContextValue = {
  readonly layout: GridLayout;
  readonly cells: GridCell[];
  readonly selectedCellId: string | null;
  readonly saving: boolean;
  readonly onCellSelect: (id: string | null) => void;
  readonly onCellChange: (cell: GridCell) => void;
  readonly onCellsChange: (cells: GridCell[]) => void;
  readonly onSave: () => void;
};

const EditorContext = createContext<EditorContextValue | null>(null);

export const EditorProvider = ({
  value,
  children,
}: {
  value: EditorContextValue;
  children: ReactNode;
}) => <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;

export const useEditorContext = (): EditorContextValue => {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useEditorContext must be used within EditorProvider');
  return ctx;
};
