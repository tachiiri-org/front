export type ViewportId = 'desktop' | 'tablet' | 'mobile';

export type Frame = {
  readonly h: number;
  readonly w: number;
  readonly x: number;
  readonly y: number;
};

export type EditorMetadata = {
  readonly note: string;
};

export type ComponentInstance = {
  readonly editorMetadata: EditorMetadata;
  readonly frame: Frame;
  readonly id: string;
  readonly nameEn: string;
  readonly nameJa: string;
  readonly parentId?: string;
  readonly props: Record<string, unknown>;
  readonly type: string;
  readonly zIndex: number;
};

export type ViewportSpec = {
  readonly components: ComponentInstance[];
  readonly id: ViewportId;
};

export type ScreenSpec = {
  readonly id: string;
  readonly nameEn: string;
  readonly nameJa: string;
  readonly viewports: Record<ViewportId, ViewportSpec>;
  readonly goals?: string[];
  readonly hints?: string[];
  readonly constraints?: string[];
};

export type NamedOption = {
  readonly id: string;
  readonly nameEn: string;
  readonly nameJa: string;
};

export type SpecNodeKind =
  | 'global'
  | 'tool'
  | 'concern'
  | 'issue'
  | 'screen'
  | 'component'
  | 'contract'
  | 'state'
  | 'interaction'
  | 'todo';

export type TraceLinkKind = 'file' | 'symbol' | 'screen' | 'component' | 'contract';

export type SpecNodeDocItemKind = 'heading' | 'item' | 'task';
export type SpecNodeDocHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type SpecNodeTaskStatus = 'open' | 'proposed' | 'accepted' | 'done';

export type SpecNodeDocItem = {
  readonly children: SpecNodeDocItem[];
  readonly headingLevel?: SpecNodeDocHeadingLevel;
  readonly id?: string;
  readonly kind: SpecNodeDocItemKind;
  readonly status?: SpecNodeTaskStatus;
  readonly text: string;
};

export type SpecNodeDoc = {
  readonly items: SpecNodeDocItem[];
};

export type TraceLink = {
  readonly id: string;
  readonly kind: TraceLinkKind;
  readonly label: string;
  readonly target: string;
};

export type SpecNodeMetadata = {
  readonly componentId?: string;
  readonly concernId?: string;
  readonly managed?: 'manual' | 'synced';
  readonly screenId?: string;
  readonly toolId?: string;
  readonly viewportId?: ViewportId;
};

export type SpecNode = {
  readonly doc: SpecNodeDoc;
  readonly id: string;
  readonly kind: SpecNodeKind;
  readonly links: TraceLink[];
  readonly metadata?: SpecNodeMetadata;
  readonly order: number;
  readonly parentId?: string;
  readonly titleEn: string;
  readonly titleJa: string;
};

export type SpecIssue = {
  readonly componentId?: string;
  readonly createdAt: string;
  readonly id: string;
  readonly screenId?: string;
  readonly sourceItemId: string;
  readonly sourceNodeId: string;
  readonly status: SpecNodeTaskStatus;
  readonly text: string;
  readonly toolId?: string;
  readonly updatedAt: string;
};

export type SpecDocument = {
  readonly concerns: NamedOption[];
  readonly issues?: SpecIssue[];
  readonly screens: ScreenSpec[];
  readonly specNodes?: SpecNode[];
  readonly tools: NamedOption[];
};
