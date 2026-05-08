export type FieldStyleContext = {
  wrapper: Record<string, string>;
  label: Record<string, string>;
  input: Record<string, string>;
};

const DEFAULT_WRAPPER: Record<string, string> = {
  display: 'flex',
  alignItems: 'center',
  padding: '2px 8px',
  gap: '4px',
  minHeight: '24px',
};

const DEFAULT_LABEL: Record<string, string> = {
  fontSize: '10px',
  color: 'rgba(0,0,0,0.65)',
  width: '80px',
  flexShrink: '0',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const DEFAULT_INPUT: Record<string, string> = {
  flex: '1',
  fontSize: '12px',
  border: 'none',
  borderBottom: '1px solid rgba(0,0,0,0.12)',
  background: 'transparent',
  padding: '1px 2px',
  minWidth: '0',
  outline: 'none',
};

export const SUMMARY_STYLE: Record<string, string> = {
  fontSize: '10px',
  fontWeight: '500',
  color: 'rgba(0,0,0,0.7)',
  padding: '2px 8px',
  cursor: 'pointer',
  listStyle: 'none',
  userSelect: 'none',
};

export function buildFieldStyleContext(override?: {
  wrapper?: Record<string, string>;
  label?: Record<string, string>;
  input?: Record<string, string>;
}): FieldStyleContext {
  return {
    wrapper: { ...DEFAULT_WRAPPER, ...(override?.wrapper ?? {}) },
    label: { ...DEFAULT_LABEL, ...(override?.label ?? {}) },
    input: { ...DEFAULT_INPUT, ...(override?.input ?? {}) },
  };
}
