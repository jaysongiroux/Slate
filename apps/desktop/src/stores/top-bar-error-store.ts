import { create } from "zustand";

export type TopBarError = {
  id: string;
  title: string;
  message: string;
  updatedAt: number;
};

type TopBarErrorState = {
  errors: Record<string, TopBarError>;
  upsertError: (error: TopBarError) => void;
  clearError: (id: string) => void;
  topBarErrorIndicatorPaused: boolean;
  setTopBarErrorIndicatorPaused: (paused: boolean) => void;
};

export const useTopBarErrorStore = create<TopBarErrorState>((set) => ({
  errors: {},
  upsertError: (error) =>
    set((state) => ({
      errors: { ...state.errors, [error.id]: error },
      topBarErrorIndicatorPaused: false,
    })),
  clearError: (id) =>
    set((state) => {
      const { [id]: _, ...rest } = state.errors;
      return {
        errors: rest,
        topBarErrorIndicatorPaused:
          Object.keys(rest).length > 0 ? state.topBarErrorIndicatorPaused : false,
      };
    }),
  topBarErrorIndicatorPaused: false,
  setTopBarErrorIndicatorPaused: (topBarErrorIndicatorPaused) =>
    set({ topBarErrorIndicatorPaused }),
}));
