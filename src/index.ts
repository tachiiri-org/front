import '@fontsource/noto-sans-jp/400.css';
import '@fontsource/noto-sans-jp/500.css';
import '@fontsource/noto-sans-jp/700.css';

import './editor/editor.css';
import './editor/shared.css';
import './editor/ui/canvas.css';
import './editor/ui/component-tree.css';
import './editor/ui/inspector.css';
import './editor/ui/runtime-diagnostics-panel.css';
import './editor/ui/searchable-select.css';
import './editor/ui/screen-inspector.css';
import './editor/spec/outline-tree.css';
import './catalog/components/css/spec-preview.css';

import { mountRenderer } from './bootstrap/mount-renderer';

void mountRenderer();
