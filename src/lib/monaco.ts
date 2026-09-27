import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import editorWorker from 'monaco-editor/editor/editor.worker?worker';

type MonacoEnvironmentWithWorkers = {
  getWorker: (_moduleId: string, label: string) => Worker;
};

(globalThis as typeof globalThis & { MonacoEnvironment?: MonacoEnvironmentWithWorkers }).MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

monaco.editor.defineTheme('private-bin', {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#18181b',
    'editorLineNumber.foreground': '#c4c4cc',
    'editorLineNumber.activeForeground': '#71717a',
    'editor.lineHighlightBackground': '#fafafa',
    'editor.lineHighlightBorder': '#00000000',
    'editorCursor.foreground': '#18181b',
    'editor.selectionBackground': '#e4e4e7',
    'editor.inactiveSelectionBackground': '#efeff1',
    'editorIndentGuide.background1': '#efeff1',
    'scrollbarSlider.background': '#71717a26',
    'scrollbarSlider.hoverBackground': '#71717a40',
    'scrollbarSlider.activeBackground': '#71717a59',
  },
});

loader.config({ monaco });
