import { Timestamp } from '@google-cloud/firestore';

type DocumentData = Record<string, unknown>;

type DocRecord = {
  data?: DocumentData;
  subcollections: Map<string, CollectionData>;
};

type CollectionData = Map<string, DocRecord>;

type WhereOp = '==' | '>=' | '<=' | '>' | '<';

type QueryFilter = {
  field: string;
  op: WhereOp;
  value: unknown;
};

type QueryOrder = {
  field: string;
  direction: 'asc' | 'desc';
};

class DocumentSnapshot {
  constructor(
    public readonly ref: DocumentReference,
    private readonly record: DocRecord | undefined,
  ) {}

  get exists(): boolean {
    return this.record?.data !== undefined;
  }

  data(): DocumentData | undefined {
    return this.record?.data;
  }
}

class QuerySnapshot {
  constructor(public readonly docs: DocumentSnapshot[]) {}

  get size(): number {
    return this.docs.length;
  }
}

class DocumentReference {
  constructor(
    private readonly firestore: InMemoryFirestore,
    public readonly id: string,
    private readonly collectionData: CollectionData,
    public readonly path: string,
  ) {}

  collection(name: string): CollectionReference {
    const record = this.firestore.ensureDocRecord(this.collectionData, this.id);
    const subcollection = this.firestore.getSubcollection(record, name);
    return new CollectionReference(
      this.firestore,
      name,
      subcollection,
      `${this.path}/${name}`,
    );
  }

  getRecord(): DocRecord | undefined {
    return this.collectionData.get(this.id);
  }

  setData(data: DocumentData): void {
    const record = this.firestore.ensureDocRecord(this.collectionData, this.id);
    record.data = { ...data };
  }

  delete(): void {
    this.collectionData.delete(this.id);
  }
}

class CollectionReference {
  constructor(
    private readonly firestore: InMemoryFirestore,
    public readonly id: string,
    private readonly collectionData: CollectionData,
    public readonly path: string,
  ) {}

  doc(id: string): DocumentReference {
    return new DocumentReference(
      this.firestore,
      id,
      this.collectionData,
      `${this.path}/${id}`,
    );
  }

  where(field: string, op: WhereOp, value: unknown): Query {
    return new Query(this).where(field, op, value);
  }

  orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): Query {
    return new Query(this).orderBy(field, direction);
  }

  limit(count: number): Query {
    return new Query(this).limit(count);
  }

  async get(): Promise<QuerySnapshot> {
    return new Query(this).get();
  }

  getEntries(): Array<[string, DocRecord]> {
    return Array.from(this.collectionData.entries());
  }
}

class Query {
  constructor(
    private readonly collectionRef: CollectionReference,
    private readonly filters: QueryFilter[] = [],
    private readonly order?: QueryOrder,
    private readonly limitCount?: number,
  ) {}

  where(field: string, op: WhereOp, value: unknown): Query {
    return new Query(
      this.collectionRef,
      [...this.filters, { field, op, value }],
      this.order,
      this.limitCount,
    );
  }

  orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): Query {
    return new Query(this.collectionRef, this.filters, { field, direction }, this.limitCount);
  }

  limit(count: number): Query {
    return new Query(this.collectionRef, this.filters, this.order, count);
  }

  async get(): Promise<QuerySnapshot> {
    let entries = this.collectionRef
      .getEntries()
      .filter(([, record]) => record.data !== undefined);

    for (const filter of this.filters) {
      entries = entries.filter(([, record]) => matchesFilter(record.data!, filter));
    }

    if (this.order) {
      const { field, direction } = this.order;
      entries.sort((a, b) => compareValues(a[1].data?.[field], b[1].data?.[field], direction));
    }

    if (this.limitCount !== undefined) {
      entries = entries.slice(0, this.limitCount);
    }

    const docs = entries.map(
      ([id, record]) => new DocumentSnapshot(this.collectionRef.doc(id), record),
    );

    return new QuerySnapshot(docs);
  }
}

class InMemoryTransaction {
  async get(docRef: DocumentReference): Promise<DocumentSnapshot> {
    return new DocumentSnapshot(docRef, docRef.getRecord());
  }

  set(docRef: DocumentReference, data: DocumentData): void {
    docRef.setData(data);
  }
}

class WriteBatch {
  private readonly deletes: DocumentReference[] = [];

  delete(docRef: DocumentReference): void {
    this.deletes.push(docRef);
  }

  async commit(): Promise<void> {
    for (const ref of this.deletes) {
      ref.delete();
    }
  }
}

export class InMemoryFirestore {
  static Timestamp = Timestamp;

  private readonly collections = new Map<string, CollectionData>();
  private transactionChain: Promise<unknown> = Promise.resolve();

  collection(name: string): CollectionReference {
    return new CollectionReference(this, name, this.getCollection(name), name);
  }

  async listCollections(): Promise<CollectionReference[]> {
    const collections = Array.from(this.collections.entries())
      .filter(([, data]) => data.size > 0)
      .map(([name, data]) => new CollectionReference(this, name, data, name));

    return collections;
  }

  batch(): WriteBatch {
    return new WriteBatch();
  }

  async runTransaction<T>(
    updateFunction: (transaction: InMemoryTransaction) => Promise<T>,
  ): Promise<T> {
    const run = async () => updateFunction(new InMemoryTransaction());
    const resultPromise = this.transactionChain.then(run, run);
    this.transactionChain = resultPromise.then(
      () => undefined,
      () => undefined,
    );
    return resultPromise;
  }

  async terminate(): Promise<void> {
    return;
  }

  getCollection(name: string): CollectionData {
    let collection = this.collections.get(name);
    if (!collection) {
      collection = new Map();
      this.collections.set(name, collection);
    }
    return collection;
  }

  ensureDocRecord(collectionData: CollectionData, id: string): DocRecord {
    let record = collectionData.get(id);
    if (!record) {
      record = { data: undefined, subcollections: new Map() };
      collectionData.set(id, record);
    }
    return record;
  }

  getSubcollection(record: DocRecord, name: string): CollectionData {
    let subcollection = record.subcollections.get(name);
    if (!subcollection) {
      subcollection = new Map();
      record.subcollections.set(name, subcollection);
    }
    return subcollection;
  }
}

function matchesFilter(data: DocumentData, filter: QueryFilter): boolean {
  const value = data[filter.field];
  if (value === undefined) {
    return false;
  }

  switch (filter.op) {
    case '==':
      return value === filter.value;
    case '>=':
      return (value as number) >= (filter.value as number);
    case '<=':
      return (value as number) <= (filter.value as number);
    case '>':
      return (value as number) > (filter.value as number);
    case '<':
      return (value as number) < (filter.value as number);
    default:
      return false;
  }
}

function compareValues(a: unknown, b: unknown, direction: 'asc' | 'desc'): number {
  const order = direction === 'asc' ? 1 : -1;
  if (a === b) {
    return 0;
  }
  if (a === undefined || a === null) {
    return 1 * order;
  }
  if (b === undefined || b === null) {
    return -1 * order;
  }
  return a > b ? order : -order;
}
