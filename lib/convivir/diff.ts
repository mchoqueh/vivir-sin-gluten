export type ComparableItem = {
  id?: string;
  normalized: string;
  rowHash: string;
  name: string;
};

export type ConvivirDiffResult = {
  added: ComparableItem[];
  removed: ComparableItem[];
  modified: Array<{
    previous: ComparableItem;
    next: ComparableItem;
  }>;
};

export function diffConvivirRows(
  previousItems: ComparableItem[],
  nextItems: ComparableItem[],
): ConvivirDiffResult {
  const previousByNormalized = new Map(
    previousItems.map((item) => [item.normalized, item]),
  );
  const nextByNormalized = new Map(
    nextItems.map((item) => [item.normalized, item]),
  );

  const added = nextItems.filter(
    (item) => !previousByNormalized.has(item.normalized),
  );
  const removed = previousItems.filter(
    (item) => !nextByNormalized.has(item.normalized),
  );
  const modified = nextItems.flatMap((next) => {
    const previous = previousByNormalized.get(next.normalized);
    if (!previous || previous.rowHash === next.rowHash) return [];
    return [{ previous, next }];
  });

  return { added, removed, modified };
}
