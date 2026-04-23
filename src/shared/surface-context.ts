import type {
  ComponentInstance,
  ScreenSpec,
  SpecDocument,
  ViewportId,
  ViewportSpec,
} from './spec-document';

export type SurfaceRuntime = 'electron' | 'cloudflare-pages';

export type SurfaceIntentAction = 'review' | 'implement' | 'generate';

export type SurfaceReference = {
  readonly componentId: string;
  readonly label: string;
  readonly token: string;
  readonly type: string;
};

export type SurfaceSelection = {
  readonly component: ComponentInstance;
};

export type SurfaceContext = {
  readonly version: 1;
  readonly sourceApp: string;
  readonly runtime: SurfaceRuntime;
  readonly intent: {
    readonly goal: string;
    readonly requestedAction: SurfaceIntentAction;
  };
  readonly surface: {
    readonly screenId: string;
    readonly screenNameEn: string;
    readonly screenNameJa: string;
    readonly selectedComponentId: string | null;
    readonly viewportId: ViewportId;
  };
  readonly currentScreen: ScreenSpec;
  readonly currentViewport: ViewportSpec;
  readonly document: SpecDocument;
  readonly references: readonly SurfaceReference[];
  readonly selection: SurfaceSelection | null;
  readonly summary: string;
};
