export type ResourceDef = {
  listUrl: string;
  itemBaseUrl: string;
};

export const RESOURCES: Record<string, ResourceDef> = {
  layouts: {
    listUrl: '/api/v1/layouts/json-files',
    itemBaseUrl: '/api/v1/layouts',
  },
};
