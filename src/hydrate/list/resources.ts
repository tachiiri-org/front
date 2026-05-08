export type ResourceDef = {
  listUrl: string;
  itemBaseUrl: string;
};

export const RESOURCES: Record<string, ResourceDef> = {
  layouts: {
    listUrl: '/api/layouts/json-files',
    itemBaseUrl: '/api/layouts',
  },
};
