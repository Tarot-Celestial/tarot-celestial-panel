'use client';

import { createContext, useContext } from 'react';

// Share the gate's exact decision: background dialogs must not enter the
// browser top layer while the workspace is locked or still being verified.
export const PanelInteractionContext = createContext(true);
export const usePanelInteraction = () => useContext(PanelInteractionContext);
