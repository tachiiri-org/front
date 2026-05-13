export type StyleValueTarget = string | string[];

export type StyleEntrySpec = {
  key: string;
  label?: string;
  target: StyleValueTarget;
  placeholder?: string;
  defaultValue?: string;
};
