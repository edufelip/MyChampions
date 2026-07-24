export type AppFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

/**
 * Late-bound application fetch default.
 *
 * Firefox treats `fetch` as a receiver-sensitive browser host function. Always
 * resolve it at call time and invoke it with the global object as its receiver.
 * Injectable fetch dependencies remain plain standalone functions.
 */
export const defaultAppFetch: AppFetch = (input, init) =>
  Reflect.apply(globalThis.fetch, globalThis, [input, init]);
