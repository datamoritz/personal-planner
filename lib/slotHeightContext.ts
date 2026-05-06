import { createContext, useContext } from 'react';
import { SLOT_HEIGHT } from './timeGrid';

const SlotHeightContext = createContext<number>(SLOT_HEIGHT);

export const useSlotHeight = () => useContext(SlotHeightContext);
export const SlotHeightProvider = SlotHeightContext.Provider;
