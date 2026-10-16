# transactions-window-react
React component showing transactions, which are updating selectively using external state, batching. Renders are optimised.

The project includes the implementation of:
* React rendering and reconciliation;
* memoization;
* referential identity;
* external storage;
* subscriptions;
* batching;
* render optimization.

# project-target
The main target is to create table, which:
* stores 5 last transactions
* receives new transactions and updates for existed
* removes old data automatically
* shows transactions average sum
* minimizes react renders amount

**The main requirement**: change in one transaction shouldn't not trigger a re-render of the entire table

============
