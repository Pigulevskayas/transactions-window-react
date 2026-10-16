# transactions-window-react
React component showing transactions, which are updating selectively using external state, batching. Renders are optimised. Incremental average calculation, and verification with React DevTools Profiler.

The project includes the implementation of:
* React rendering and reconciliation;
* memoization;
* referential identity;
* external storage;
* subscriptions;
* batching;
* render optimization.

# project goal
A stream periodically inserts, updates, and removes transactions. The main target is to create table, which:
* stores 5 last transactions
* receives new transactions and updates for existed
* removes old data automatically
* shows transactions average sum
* minimizes react renders amount

**The main requirement**: change in one transaction should not trigger a re-render of the entire table

**Expected behavior:**

- Changing amounts for `tr_3` and `tr_4` does **not** re-render `TransactionsTable` or unrelated rows. Only those rows and, if its value changes, `AverageAmount` update.
- Inserting `tr_6` into a full window evicts the oldest `tr_1`: the table renders once to reconcile the ID list, `tr_1` unmounts, `tr_6` mounts, and other row instances remain stable.
- A batch of store operations should not notify subscribers separately for every intermediate operation.

The key topic is **subscription granularity and referential identity**, not merely making `Array.map()` faster.

## 2. Component architecture

```text
TransactionsTable
├── Row (React.memo), key=tr_2
├── Row (React.memo), key=tr_3
├── Row (React.memo), key=tr_4
├── Row (React.memo), key=tr_5
├── Row (React.memo), key=tr_6
└── AverageAmount (React.memo)

TransactionsStore (external to React state)
├── transactions: Map<id, transaction>
├── subscribers: Map<id, Set<callback>>
├── idsSubscribers: Set<callback>
└── averageSubscribers: Set<callback>
```

`TransactionsTable` keeps a **stable** `TransactionsStore` instance in `useRef`. Each row subscribes to its own transaction ID, the table subscribes only to the ID list, and the average has a separate subscription.

## 3. Store state and operations

| Field | Responsibility |
| --- | --- |
| `transactions = new Map()` | Current transactions; insertion order identifies the oldest entry. |
| `subscribers = new Map()` | Per-ID transaction subscribers. |
| `idsSubscribers = new Set()` | Subscribers to changes in window membership. |
| `averageSubscribers = new Set()` | Subscribers to the average value. |
| `idsSnapshot = []` | Stable snapshot of transaction IDs. |
| `sum = 0` | Running sum for O(1) average calculation. |
| `isBatching`, `changedIds`, `idsChanged`, `averageChanged` | Pending changes accumulated within a batch. |

### `update(transaction)`

1. Find the previous transaction by ID.
2. Adjust the running sum by the **delta**: `sum += newAmount - oldAmount` (use `0` for a new entry).
3. Store a **new transaction object** in the `Map`.
4. Mark the ID as changed and notify its subscribers immediately or at batch completion.
5. If this is a new ID, update the ID snapshot and notify table subscribers.
6. Notify average subscribers **only if the observed average changes**.

If other fields such as status or name can change, the update logic must detect them too. Unchanged amounts do not necessarily mean unchanged transactions.

### `delete(id)`

Remove the entry, subtract its amount from `sum`, and mark ID membership and average as changed. Deleting an unknown ID should be a no-op.

### `getAverage()`

```js
getAverage() {
    return this.transactions.size === 0
        ? 0
        : this.sum / this.transactions.size;
}
```

This is **O(1)** instead of reducing the entire collection on every update. For real financial amounts, use integer minor units or decimal arithmetic rather than relying blindly on floating-point `Number`.

## 4. The five-transaction sliding window

For every incoming transaction, update the store; if its size exceeds `LIMIT`, remove the oldest key:

```js
const LIMIT = 5;

store.beginBatch();
try {
    for (const transaction of incomingTransactions) {
        store.update(transaction);
        while (store.transactions.size > LIMIT) {
            const oldestId = store.transactions.keys().next().value;
            store.delete(oldestId);
        }
    }
} finally {
    store.endBatch();
}
```

A JavaScript `Map` preserves **insertion order**. Calling `set()` for an existing key does **not** move it to the end. Updating an amount therefore does not make a transaction the newest. Sorting by `createdAt` or last-updated time would require separate logic.

## 5. `useSyncExternalStore`: subscriptions and snapshots

```js
useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot?);
```

- `subscribe(callback)` registers a listener and **returns an unsubscribe function**.
- `getSnapshot()` returns the current value React compares to decide whether a render is needed.
- `getServerSnapshot()` is required for SSR and must provide a hydration-compatible initial value.

### Table: subscribe to IDs only

```jsx
const subscribeIds = useCallback(
    (notify) => store.subscribeIds(notify),
    [store],
);
const getIdsSnapshot = useCallback(
    () => store.getIdsSnapshot(),
    [store],
);

const ids = useSyncExternalStore(subscribeIds, getIdsSnapshot);
```

When membership has not changed, `getIdsSnapshot()` must return **the same array reference**. Avoid returning `[...this.transactions.keys()]` on every call: creating a new snapshot each time can trigger unnecessary updates and even render loops.

### Row: subscribe by ID

```jsx
const Row = React.memo(function Row({ id, store }) {
    const subscribe = useCallback(
        (notify) => store.subscribeTransaction(id, notify),
        [id, store],
    );
    const getSnapshot = useCallback(
        () => store.getTransaction(id),
        [id, store],
    );
    const transaction = useSyncExternalStore(subscribe, getSnapshot);

    if (!transaction) return null;
    return <div>{transaction.id}: {transaction.amount}</div>;
});
```

This is **illustrative code**; adapt method names to the actual Store implementation. Changed transactions should be represented by **new objects** while unchanged ones retain their references. In-place mutation can be invisible to React because snapshot comparisons use `Object.is`.

### Average: independent subscription

`AverageAmount` uses its own `subscribeAverage()` and `getAverage()` methods. Amount changes notify this subscription without notifying the ID-list subscription when membership is unchanged.

### SSR considerations

When using SSR, provide an appropriate third argument to every `useSyncExternalStore` call. For an **initially empty** store, a **stable** empty IDs snapshot could be:

```js
const EMPTY_IDS = [];
const getServerIdsSnapshot = () => EMPTY_IDS;
```

Do not use `() => []` when a stable array reference is required. Server-rendered and hydration-time initial snapshots must agree. The standalone client-only React + Vite training app does not need this third argument.

## 6. `React.memo`, `useCallback`, `useMemo`, and `useRef`

- **`React.memo(Row)`** can skip rendering a row when its props are unchanged. Define `Row` outside `TransactionsTable` to keep the component type stable.
- **`useCallback`** stabilizes `subscribe` and `getSnapshot` function references, avoiding unnecessary resubscriptions.
- **`useMemo`** caches a computed value or object reference; **it does not by itself stop a child from rendering**.
- **`useRef`** preserves the Store across renders without triggering renders when `.current` changes.
- **`key={id}`** preserves row identity as window membership changes. Array indices are poor keys for this case.

An anti-pattern:

```jsx
<Row transaction={{ ...item }} />
```

This creates a fresh object whenever the parent renders, defeating shallow prop comparison in `React.memo`. Prefer stable transaction references or, in our design, `id` and `store`.

## 7. Batching notifications

`beginBatch()` switches the Store into accumulation mode. `update/delete` collect IDs in `changedIds` and set `idsChanged` / `averageChanged`, without notifying immediately.

At `endBatch()`:

1. Create **one** new `idsSnapshot` if final membership changed.
2. Notify each affected transaction ID's subscribers at most once.
3. Notify ID-list subscribers if final membership changed.
4. Notify average subscribers if the final average actually changed.

Batching reduces repeated notifications. However, **subscriber notification counts and React commit counts are different concepts**: React can batch updates as well.

Implementation details matter: use `try/finally`; either support nested batches with a depth counter or explicitly disallow them; compare the **final state** with the pre-batch state to avoid notifying for transient changes (e.g., an ID inserted and removed in the same batch).

## 8. Expected render behavior

### Scenario A: update amounts for `tr_3` and `tr_4`

| Component | Expected renders |
| --- | ---: |
| `TransactionsTable` | 0 |
| `Row(tr_3)` | 1 |
| `Row(tr_4)` | 1 |
| Other `Row` components | 0 |
| `AverageAmount` | 1 if the average changed |

The ID snapshot retains its reference; only the two affected row subscriptions and the average subscription receive meaningful updates.

### Scenario B: insert `tr_6`, evict `tr_1` (`LIMIT = 5`)

| Component | Expected behavior |
| --- | --- |
| `TransactionsTable` | One render because the ID list changed |
| `Row(tr_1)` | Unmounts |
| `Row(tr_6)` | Mounts |
| `Row(tr_2..tr_5)` | No re-render if props and snapshots are unchanged |
| `AverageAmount` | Renders if the average changed |

## 9. Verifying with React DevTools Profiler

1. Open **Profiler** and click **Record**.
2. Trigger one controlled update (e.g., amounts for `tr_3` and `tr_4` only).
3. Stop recording, select the relevant **commit**, and open **Flamegraph**.
4. **Colored** components rendered in that commit; **gray** components did not.
5. **Ranked** lists rendered components by render duration.
6. Inspect **What caused this update?** for the components that triggered the update.

During the exercise, the Profiler showed `TransactionsTable` in gray while `Row(tr_3)`, `Row(tr_4)`, and `AverageAmount` triggered the update. That confirmed subscription isolation. In a separate capture, adding `tr_6` rendered the table and the new row, as expected.

**Important distinction:** Profiler reports commits; `console.count()` counts component-function invocations. Development `StrictMode` can cause more invocations than completed commits.

## 10. Lifecycle and common pitfalls

**Render → Commit → Effects:** React calculates the tree, applies changes to the DOM, then runs effects. `useEffect` does not execute during server rendering. Effect cleanup runs before rerunning an effect with changed dependencies and on unmount.

**Common mistakes:**

- Creating a new Store on every component render instead of keeping it in `useRef`.
- Returning fresh arrays/objects from `getSnapshot()` even when nothing changed.
- Mutating transaction objects in place instead of replacing references.
- Using array indices as keys in an evicting list.
- Passing newly spread objects into memoized rows on every parent render.
- Forgetting to return an unsubscribe function from `subscribe`.
- Reading stale state from a timer callback captured by an effect with `[]` dependencies; use functional state updates or an appropriate ref.
- Accessing `window` during SSR module evaluation (`window is not defined`); initialize browser-only functionality on the client.
- Omitting `getServerSnapshot` during SSR (`Missing getServerSnapshot`).

## 11. Complexity

| Operation | Typical complexity |
| --- | --- |
| `Map.get/set/delete` | Average O(1) |
| Oldest key via `Map.keys().next()` | O(1) |
| Running-sum update and `getAverage()` | O(1) |
| Rebuilding the ID snapshot | O(LIMIT) |
| Subscriber notification | O(number of relevant subscribers) |
| Rendering a changed ID list | O(LIMIT) traversal; memo can skip unchanged row renders |

With `LIMIT = 5`, absolute work is small. The point is learning **fine-grained subscriptions**, predictable UI updates, and measurement.

## 12. Takeaways

The UI has three independent update dimensions: **one transaction's data**, **window membership**, and **the average**. `useSyncExternalStore` connects an external Store to React; `React.memo`, stable props/snapshots, and stable keys avoid unnecessary work; batching coalesces notifications; Profiler validates the behavior at the commit level.
