/**
 * The callable fetch boundary used by app sources and test doubles.
 *
 * React DOM augments the global fetch object with static helpers such as
 * `preconnect`. Injected request functions only need the standard call
 * signature, so they must not be coupled to those host-specific properties.
 */
type AppFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
