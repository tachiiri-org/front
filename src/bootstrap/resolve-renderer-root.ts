export const resolveRendererRoot = (): HTMLElement => {
  const root = document.getElementById('app-root');

  if (!root) {
    throw new Error('Renderer root is unavailable.');
  }

  return root;
};
