type ProviderScript = Pick<
  HTMLScriptElement,
  'async' | 'dataset' | 'defer' | 'id' | 'onerror' | 'onload' | 'remove' | 'src'
>;

type ProviderScriptDocument = {
  createElement: (tagName: 'script') => ProviderScript;
  getElementById: (id: string) => ProviderScript | null;
  head: { appendChild: (script: ProviderScript) => void };
};

export function createWebProviderScriptLoader(documentRef: ProviderScriptDocument | undefined) {
  const inFlight = new Map<string, Promise<void>>();

  return (src: string, id: string): Promise<void> => {
    if (!documentRef) return Promise.reject(new Error('browser_unavailable'));
    const pending = inFlight.get(id);
    if (pending) return pending;

    const existing = documentRef.getElementById(id);
    if (existing?.dataset.loaded === 'true') return Promise.resolve();

    const script = existing ?? documentRef.createElement('script');
    const promise = new Promise<void>((resolve, reject) => {
      script.onload = () => {
        script.dataset.loaded = 'true';
        resolve();
      };
      script.onerror = () => {
        inFlight.delete(id);
        script.remove();
        reject(new Error('provider_script_failed'));
      };

      if (!existing) {
        script.id = id;
        script.src = src;
        script.async = true;
        script.defer = true;
        documentRef.head.appendChild(script);
      }
    });
    inFlight.set(id, promise);
    return promise;
  };
}

const browserDocument: ProviderScriptDocument | undefined =
  typeof document === 'undefined'
    ? undefined
    : {
        createElement: () => document.createElement('script'),
        getElementById: (id) => {
          const element = document.getElementById(id);
          return element instanceof HTMLScriptElement ? element : null;
        },
        head: { appendChild: (script) => void document.head.appendChild(script as HTMLScriptElement) },
      };
const loadProviderScript = createWebProviderScriptLoader(browserDocument);

export function loadWebProviderScript(src: string, id: string): Promise<void> {
  return loadProviderScript(src, id);
}
