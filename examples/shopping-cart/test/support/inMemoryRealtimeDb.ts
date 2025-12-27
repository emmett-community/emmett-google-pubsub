type DataNode = Record<string, unknown>;

const isRecord = (value: unknown): value is DataNode =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const normalizePath = (path: string): string[] =>
  path.split('/').filter((segment) => segment.length > 0);

class DataSnapshot {
  constructor(private readonly value: unknown) {}

  val(): unknown {
    return this.value === undefined ? null : this.value;
  }

  exists(): boolean {
    return this.value !== null && this.value !== undefined;
  }
}

class DatabaseReference {
  constructor(
    private readonly database: InMemoryRealtimeDb,
    private readonly path: string,
  ) {}

  async once(eventType: 'value'): Promise<DataSnapshot> {
    if (eventType !== 'value') {
      throw new Error(`Unsupported event type: ${eventType}`);
    }

    return new DataSnapshot(this.database.get(this.path));
  }

  async set(value: unknown): Promise<void> {
    this.database.set(this.path, value);
  }

  async remove(): Promise<void> {
    this.database.remove(this.path);
  }
}

export class InMemoryRealtimeDb {
  private root: DataNode = {};

  ref(path = ''): DatabaseReference {
    return new DatabaseReference(this, path);
  }

  reset(): void {
    this.root = {};
  }

  get(path: string): unknown {
    const segments = normalizePath(path);
    if (segments.length === 0) {
      return Object.keys(this.root).length === 0 ? null : this.root;
    }

    let node: unknown = this.root;
    for (const segment of segments) {
      if (!isRecord(node) || !(segment in node)) {
        return null;
      }
      node = node[segment];
    }

    return node === undefined ? null : node;
  }

  set(path: string, value: unknown): void {
    const segments = normalizePath(path);
    if (segments.length === 0) {
      this.root = isRecord(value) ? { ...value } : {};
      return;
    }

    let node: DataNode = this.root;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index]!;
      const current = node[segment];
      if (!isRecord(current)) {
        node[segment] = {};
      }
      node = node[segment] as DataNode;
    }

    node[segments[segments.length - 1]!] = value;
  }

  remove(path: string): void {
    const segments = normalizePath(path);
    if (segments.length === 0) {
      this.root = {};
      return;
    }

    let node: unknown = this.root;
    for (let index = 0; index < segments.length - 1; index += 1) {
      if (!isRecord(node)) {
        return;
      }
      const segment = segments[index]!;
      if (!(segment in node)) {
        return;
      }
      node = node[segment];
    }

    if (isRecord(node)) {
      delete node[segments[segments.length - 1]!];
    }
  }
}
