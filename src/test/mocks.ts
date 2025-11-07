// Common test mocks & polyfills with firebase-mock backed storage
import { vi } from 'vitest';
import * as firebaseMock from 'firebase-mock';

// Polyfills
const htmlProto: any = HTMLElement.prototype;
if (!htmlProto.hasPointerCapture) htmlProto.hasPointerCapture = () => false;
if (!htmlProto.setPointerCapture) htmlProto.setPointerCapture = () => {};
if (!htmlProto.releasePointerCapture) htmlProto.releasePointerCapture = () => {};
const elProto: any = Element.prototype;
if (!elProto.scrollIntoView) elProto.scrollIntoView = () => {};

// In-memory Firestore via firebase-mock
const mockFirestore: any = new (firebaseMock as any).MockFirestore();
mockFirestore.autoFlush();

// Internal collection store
const _collections: Map<string, Map<string, any>> = new Map();
function ensureCollection(name: string) {
    if (!_collections.has(name)) {
        _collections.set(name, new Map());
    }
    return _collections.get(name)!;
}

// Exports to inspect & reset
export function getCollectionDocs(name: string) {
  const coll = _collections.get(name);
  if (!coll) {
      return [];
  }
  return Array.from(coll.entries()).map(([id, data]) => ({ id, ...data }));
}
export function resetMockData() { _collections.clear(); }

vi.mock('@/db/firebase', () => ({ db: mockFirestore }));

vi.mock('firebase/firestore', () => {
  const genId = () => Math.random().toString(36).slice(2);
  interface DocRef { __type: 'doc'; id: string; collection: string; }
  interface CollectionRef { __type: 'collection'; name: string; }
  const collection = (_db: any, name: string): CollectionRef => ({ __type: 'collection', name });
  const doc = (dbOrColl: any, nameOrId?: string, maybeId?: string): DocRef => {
    let collectionName: string; let id: string | undefined;
    if (dbOrColl && dbOrColl.__type === 'collection') { collectionName = dbOrColl.name; id = nameOrId || genId(); }
    else { collectionName = nameOrId as string; id = maybeId || genId(); }
    return { __type: 'doc', id, collection: collectionName };
  };
  const serverTimestamp = () => new Date();
  const getDoc = async (ref: DocRef) => { const coll = ensureCollection(ref.collection); const data = coll.get(ref.id); return { exists: () => data !== undefined, data: () => data, id: ref.id, ref }; };
  const getDocFromCache = getDoc;
  const runTransaction = async (_db: any, fn: (tx: any) => any) => {
    const writes: Array<() => void> = [];
    const tx = {
      async get(ref: DocRef) { return await getDoc(ref); },
      set(ref: DocRef, data: any) { writes.push(() => { const coll = ensureCollection(ref.collection); coll.set(ref.id, data); }); },
      update(ref: DocRef, data: any) { writes.push(() => { const coll = ensureCollection(ref.collection); const existing = coll.get(ref.id) || {}; coll.set(ref.id, { ...existing, ...data }); }); },
      delete(ref: DocRef) { writes.push(() => { const coll = ensureCollection(ref.collection); coll.delete(ref.id); }); }
    };
    const result = await fn(tx); for (const w of writes) {
          w();
      } return result;
  };
  return { collection, doc, serverTimestamp, getDoc, getDocFromCache, runTransaction };
});

