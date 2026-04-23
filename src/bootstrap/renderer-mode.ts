export type RendererMode = 'editor' | 'diagnostics';

export const resolveRendererMode = (search: string): RendererMode => {
  const params = new URLSearchParams(search);

  return params.get('mode') === 'diagnostics' ? 'diagnostics' : 'editor';
};
