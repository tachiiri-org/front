export type UiTopicSettings = {
  readonly notes: string;
  readonly reference: string;
  readonly summary: string;
  readonly title: string;
};

export type UiShellSettings = {
  readonly topics: Record<string, UiTopicSettings>;
};
