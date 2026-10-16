import React, { useRef, useEffect, useState, useSyncExternalStore, useCallback } from "react";

/* 
    TransactionRow:
    - recieves only transaction id
    - get transaction data by its own
    - subscribes on exact id update
*/
const TransactionRow = React.memo(function Row({ id, store }) {
    console.log("Render:", id);

    const subscribe = useCallback(
        (callback) => {
            // subscribed on exact id updates + return unsubscribe function
            return store.subscribe(id, callback);
        }, [id, store]
    );

    const getSnapshot = useCallback(
        () => {
            // Get transaction by id
            return store.get(id);
        }, [id, store]
    );

    const transaction = useSyncExternalStore(
        subscribe,
        getSnapshot
    );

    return (
        <div>
            <div>{id}</div>
            <div>{transaction?.amount}</div>
        </div>
    );

});

const AverageAmount = React.memo(function Average({ store }) {
    const subscribe = useCallback(
        (callback) => {
            // subscribed average updates + return unsubscribe function
            return store.subscribeAverage(callback);
        }, [store]
    );

    const getSnapshot = useCallback(
        () => {
            // Get average
            return store.getAverage();
        }, [store]
    );

    const averageSum = useSyncExternalStore(
        subscribe,
        getSnapshot
    );

    return (
        <h1 className="transactions-table__title">Average sum: {averageSum}</h1>
    );
});

const initialStateTx = [
    { id: 1, amount: 100 },
    { id: 2, amount: 120 },
    { id: 3, amount: 20 },
    { id: 4, amount: 10 },
    { id: 5, amount: 200 }
];

/*
    TransactionsStore:
    - stores transactions data in a Map
    - allows updates subscribtion
    - informs subscribers about changed data
*/
class TransactionsStore {
    constructor() {
        this.transactions = new Map();
        this.subscribers = new Map();
        this.averageSubscribers = new Set();
        this.changedIds = new Set();
        this.sum = 0;

        // properties to show if the averge sum is updating
        this.isBatching = false;
        this.averageChanged = false;

        this.idsSnapshot = [];
        this.idsSubscribers = new Set();
        this.idsChanged = false;
    }

    getAverage() {
        return this.transactions.size ? this.sum / this.transactions.size : 0;
    }

    beginBatch() {
        this.isBatching = true;
        this.averageChanged = false;
        this.idsChanged = false;
    }

    endBatch() {
        // finish batching process
        this.isBatching = false;

        for (const id of this.changedIds) {
            const callbacks = this.subscribers.get(id);
            if (callbacks) {
                for (let callback of callbacks) {
                    callback();
                }
            }
        }

        console.log("Changed IDs:", [...this.changedIds]);

        this.changedIds.clear();

        // if there were any changes
        if (this.averageChanged === true) {
            this.notifyAverage();
        }

        // unset changes mark
        this.averageChanged = false;

        if (this.idsChanged === true) {
            this.idsSnapshot = [...this.transactions.keys()];
            this.notifyIdsList();
        }

        this.idsChanged = false;
    }

    get(id) {
        return this.transactions.get(id);
    }

    delete(id) {
        const deletedTransaction = this.transactions.get(id);
        if (deletedTransaction) {
            this.sum -= deletedTransaction.amount;
            this.transactions.delete(id);

            if (this.isBatching) {
                this.averageChanged = true;
                this.idsChanged = true;
            } else {
                this.idsSnapshot = [...this.transactions.keys()];
                this.notifyAverage();
                this.notifyIdsList();
            }

            return true;
        }

        return false;
    }

    subscribe(id, callback) {
        let set;
        if (this.subscribers.has(id)) {
            set = this.subscribers.get(id);
        } else {
            set = new Set();
            this.subscribers.set(id, set);
        }

        set.add(callback);

        return () => {
            // Remove callback from Set
            set.delete(callback);

            // If Set is empty — remove id from Map
            if (set.size === 0) {
                this.subscribers.delete(id);
            }
        };
    }

    update(transaction) {
        let previousTransaction = this.transactions.get(transaction.id);

        if (previousTransaction?.amount === transaction.amount) {
            return false;
        }

        if (previousTransaction) {
            this.sum += transaction.amount - previousTransaction?.amount;
        } else {
            this.sum += transaction.amount;
        }

        this.transactions.set(transaction.id, transaction);

        if (!previousTransaction) {
            // this.idsSnapshot = [...this.idsSnapshot, transaction.id];
            if (this.isBatching) {
                this.idsChanged = true;
            } else {
                this.idsSnapshot = [...this.transactions.keys()];
                this.notifyIdsList();
            }
        }

        if (this.isBatching) {
            this.changedIds.add(transaction.id);
            this.averageChanged = true;
        } else {
            const callbacks = this.subscribers.get(transaction.id);
            if (callbacks) {
                for (let callback of callbacks) {
                    callback();
                }
            }

            this.notifyAverage();
        }

        return this.transactions;
    }

    subscribeAverage(callback) {
        // Add callback to averageSubscribers
        this.averageSubscribers.add(callback);
        // Return unsubscribe function
        return () => {
            // Remove callback from Set
            this.averageSubscribers.delete(callback);
        };
    }

    notifyAverage() {
        // Call all the callbacks from averageSubscribers
        for (let callback of this.averageSubscribers) {
            callback()
        }
    }

    getIdsSnapshot() {
        return this.idsSnapshot;
    }

    subscribeIdsList(callback) {
        this.idsSubscribers.add(callback);
        // Return unsubscribe function
        return () => {
            // Remove callback from Set
            this.idsSubscribers.delete(callback);
        };
    }

    notifyIdsList() {
        for (let callback of this.idsSubscribers) {
            callback()
        }
    }
}

/* 
    TransactionsTable:
    - stores the list of transactions ids
    - adds and removes rows
    - do noting with average sum
*/
export default function TransactionsTable() {
    console.log("Render: TransactionsTable");
    const LIMIT = 5;

    const storeRef = useRef(null);
    if (storeRef.current === null) {
        storeRef.current = new TransactionsStore();
    }

    const subscribe = useCallback(
        callback => storeRef.current.subscribeIdsList(callback),
        []
    );

    const getSnapshot = useCallback(
        () => storeRef.current.getIdsSnapshot(),
        []
    );

    const transactionIds = useSyncExternalStore(
        subscribe,
        getSnapshot
    );

    const handlingData = (txUpdates) => {
        const store = storeRef.current;
        store.beginBatch();

        try {
            for (const tx of txUpdates) {
                store.update(tx);

                // if window size is more then LIMIT, remove the oldest ID
                if (store.transactions.size > LIMIT) {
                    const oldestId = store.transactions.keys().next().value;
                    store.delete(oldestId);
                }
            }
        } finally {
            store.endBatch();
        }
    };

    /* 
        This function will be used for data requesting
    */
    const getTransactionsData = () => {
        // TransactionsRequester.getTransactionsData()
        //     .then((info) => {
        //         handlingData(info);
        //     })
        //     .catch((e) => {});
    };

    useEffect(() => {
        const store = storeRef.current;

        store.beginBatch();

        try {
            for (const tx of initialStateTx) {
                store.update(tx);
            }
        } finally {
            store.endBatch();
        }
    }, []);

    /* 
        This data change is just an example
        In real project some intervals with data requesting (getTransactionsData function) will be used
    */
    useEffect(() => {
        const timer = setTimeout(() => {
            handlingData([
                { id: 3, amount: 100 },
                { id: 3, amount: 200 },
                { id: 3, amount: 300 },
                { id: 4, amount: 500 }
            ]);
        }, 3000);

        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        // get new data 
        const timer = setTimeout(getTransactionsData, 10000);
        return () => clearTimeout(timer);
    }, []);



    return (
        <div className="transactions-table">
            <AverageAmount store={storeRef.current} />
            <div className="transactions-table__row">
                {transactionIds.map((id) => (
                    <TransactionRow
                        key={`tr_${id}`}
                        id={id}
                        store={storeRef.current}
                    />
                ))}
            </div>
        </div>
    );
}
