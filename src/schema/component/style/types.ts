export type StyleValueTarget = string | string[];

export type StyleEntrySpec = {
  key: string;
  label?: string;
  target: StyleValueTarget;
  placeholder?: string;
};

export type StyleSpec = {
  key: string;
  label?: string;
  entries: StyleEntrySpec[];
  allowCustom?: boolean;
};
