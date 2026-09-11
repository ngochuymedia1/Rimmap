export {};

declare global {
  interface Window {
    __MY_BOARD_TEST__?: {
      ready(): boolean;
      snapshot(): any;
      addNote(overrides?: Record<string, unknown>): string;
      addRectangle(overrides?: Record<string, unknown>): string;
      addRectangleGrid(count: number, columns?: number, spacingX?: number, spacingY?: number): string[];
      addStressBoard(count?: number, columns?: number): string[];
      sceneCandidateIds(bounds: { x: number; y: number; width: number; height: number }): string[];
      connectionAt(point: { x: number; y: number }): any;
      performanceStats(): any;
      enablePerformanceInstrumentation(enabled?: boolean): void;
      resetPerformanceCaches(): void;
      addText(overrides?: Record<string, unknown>): string;
      addArrow(overrides?: Record<string, unknown>): string;
      arrowRenderPoints(id: string): Array<{ x: number; y: number }>;
      arrowLabelBox(id: string): { x: number; y: number; width: number; height: number } | null;
      arrowLabelLayout(id: string): any;
      editArrowLabel(id: string): void;
      editElement(id: string): void;
      closeEditor(commit?: boolean): void;
      measureLines(lines: any[], maxWidth: number, fontSize?: number): any;
    };
  }
}
