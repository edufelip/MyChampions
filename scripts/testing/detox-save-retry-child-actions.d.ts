import type {
  DetoxSaveRetryCommand,
  DetoxSaveRetryPlatform,
} from './detox-save-retry-child-protocol.mjs';
export type DetoxSaveRetryChildRuntime = {
  platform: DetoxSaveRetryPlatform;
  artifactRoot: string;
  childIdentity: { pid: number; pgid: number; started: string };
  deadlineAt?: number;
  signal?: AbortSignal;
  selectorObservations?: {
    selector: string;
    selectorKind: 'id' | 'text';
    attributes: Record<string, unknown>;
    source: 'detox.element.getAttributes';
  }[];
  by: { id(value: string): unknown; text(value: string): unknown };
  element(matcher: Record<string, unknown>): {
    getAttributes(): Promise<Record<string, unknown>>;
    tap(): Promise<void>;
    replaceText(value: string): Promise<void>;
  };
  waitFor(target: unknown): {
    toBeVisible(): {
      withTimeout(timeout: number): Promise<void>;
      whileElement(container: unknown): { scroll(...args: unknown[]): Promise<void> };
    };
    not: { toBeVisible(): { withTimeout(timeout: number): Promise<void> } };
  };
  device: {
    generateViewHierarchyXml(includeWebView?: boolean): Promise<string>;
    takeScreenshot(name: string): Promise<string>;
  };
  parseHierarchy(xml: string, platform: DetoxSaveRetryPlatform): Promise<object> | object;
  shutdown?: () => Promise<void>;
};
export declare function runDetoxSaveRetryChildCommand(
  command: DetoxSaveRetryCommand,
  runtime: DetoxSaveRetryChildRuntime,
): Promise<Record<string, unknown>>;
