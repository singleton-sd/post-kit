import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

import { EMPTY_EMAIL } from '../../getConfiguration';

import { TEditorConfiguration } from './core';

type TValue = {
  document: TEditorConfiguration;

  selectedBlockId: string | null;
  selectedSidebarTab: 'block-configuration' | 'styles';
  selectedMainTab: 'editor' | 'preview' | 'json' | 'html';
  selectedScreenSize: 'desktop' | 'mobile';

  inspectorDrawerOpen: boolean;
  samplesDrawerOpen: boolean;
};

const editorStateStore = createStore<TValue>(() => ({
  document: EMPTY_EMAIL,
  selectedBlockId: null,
  selectedSidebarTab: 'styles',
  selectedMainTab: 'editor',
  selectedScreenSize: 'desktop',

  inspectorDrawerOpen: true,
  samplesDrawerOpen: true,
}));

/**
 * Zustand's SSR path uses `getInitialState` unless `getServerState` is set on
 * the vanilla store API. Without this, `resetDocument` updates `getState()` but
 * hooks still see EMPTY under `renderToStaticMarkup` / SSR.
 */
(
  editorStateStore as typeof editorStateStore & {
    getServerState: () => TValue;
  }
).getServerState = () => editorStateStore.getState();

export function useDocument() {
  return useStore(editorStateStore, (s) => s.document);
}

export function useSelectedBlockId() {
  return useStore(editorStateStore, (s) => s.selectedBlockId);
}

export function useSelectedScreenSize() {
  return useStore(editorStateStore, (s) => s.selectedScreenSize);
}

export function useSelectedMainTab() {
  return useStore(editorStateStore, (s) => s.selectedMainTab);
}

export function setSelectedMainTab(selectedMainTab: TValue['selectedMainTab']) {
  return editorStateStore.setState({ selectedMainTab });
}

export function useSelectedSidebarTab() {
  return useStore(editorStateStore, (s) => s.selectedSidebarTab);
}

export function useInspectorDrawerOpen() {
  return useStore(editorStateStore, (s) => s.inspectorDrawerOpen);
}

export function useSamplesDrawerOpen() {
  return useStore(editorStateStore, (s) => s.samplesDrawerOpen);
}

export function setSelectedBlockId(selectedBlockId: TValue['selectedBlockId']) {
  const selectedSidebarTab = selectedBlockId === null ? 'styles' : 'block-configuration';
  const options: Partial<TValue> = {};
  if (selectedBlockId !== null) {
    options.inspectorDrawerOpen = true;
  }
  return editorStateStore.setState({
    selectedBlockId,
    selectedSidebarTab,
    ...options,
  });
}

export function setSidebarTab(selectedSidebarTab: TValue['selectedSidebarTab']) {
  return editorStateStore.setState({ selectedSidebarTab });
}

export function getDocument(): TEditorConfiguration {
  return editorStateStore.getState().document;
}

export function resetDocument(document: TValue['document']) {
  return editorStateStore.setState({
    document,
    selectedSidebarTab: 'styles',
    selectedBlockId: null,
  });
}

export function setDocument(document: TValue['document']) {
  const originalDocument = editorStateStore.getState().document;
  return editorStateStore.setState({
    document: {
      ...originalDocument,
      ...document,
    },
  });
}

export function toggleInspectorDrawerOpen() {
  const inspectorDrawerOpen = !editorStateStore.getState().inspectorDrawerOpen;
  return editorStateStore.setState({ inspectorDrawerOpen });
}

export function toggleSamplesDrawerOpen() {
  const samplesDrawerOpen = !editorStateStore.getState().samplesDrawerOpen;
  return editorStateStore.setState({ samplesDrawerOpen });
}

export function setSelectedScreenSize(selectedScreenSize: TValue['selectedScreenSize']) {
  return editorStateStore.setState({ selectedScreenSize });
}

/**
 * Subscribe to document changes in the editor store.
 * Returns an unsubscribe function.
 */
export function subscribeDocument(listener: (document: TEditorConfiguration) => void): () => void {
  return editorStateStore.subscribe((state, prevState) => {
    if (state.document !== prevState.document) {
      listener(state.document);
    }
  });
}
