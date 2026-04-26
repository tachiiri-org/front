import { componentCatalogMap } from '../catalog/components';
import { editorCatalogMap } from './editor-cells';
import type { GridCell, GridLayout } from './schema';

const allCatalogMap: Record<string, (typeof componentCatalogMap)[string]> = {
  ...componentCatalogMap,
  ...editorCatalogMap,
};

type GridCanvasProps = {
  readonly layout: GridLayout;
  readonly cells: GridCell[];
};

export const GridCanvas = ({ layout, cells }: GridCanvasProps) => {
  const { columns, rows } = layout.grid;
  const topLevelCells = cells.filter((c) => !c.parentId);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {topLevelCells.map((cell) => {
        const definition = allCatalogMap[cell.type];
        return (
          <div
            key={cell.id}
            style={{
              position: 'absolute',
              left: `${(cell.frame.x / columns) * 100}%`,
              top: `${(cell.frame.y / rows) * 100}%`,
              width: `${(cell.frame.w / columns) * 100}%`,
              height: `${(cell.frame.h / rows) * 100}%`,
              overflow: 'hidden',
            }}
          >
            {definition ? (
              definition.render(cell.props)
            ) : (
              <div style={{ color: 'var(--editor-text-muted)', fontSize: 11, padding: 4 }}>
                {cell.type}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
