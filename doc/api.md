# APIs

* [ChainPublisher](#ChainPublisher)
* [subscribe](#subscribe)
* [unSubscribe](#unSubscribe)
* [getState](#getState)

## new ChainPublisher()

```js
const {ChainPublisher} = require('chain-publisher')

// Description
//  * Start a worker that retrieve and store data from Binance Smart Chain
//    network.
//
// Input
//  * config {Object}
//  * config.provider {AssistedJsonRpcProvider || AssistedJsonRpcProvider[]}
//  * config.storage {localStorage}
//  * size {Number}
//
// Errors
//  * ChainPublisherError
new ChainPublisher(config)
```

## new ChainPublisher(config).subscribe()

```js
const {ChainPublisher} = require('chain-publisher')
const chainPublisher = new ChainPublisher(config)
// Input
//  * event {Object}
//  * event.key {String}
//  * event.filter {ethers.Contract.Filter}
//  * event.genesis {Number}
//  * event.safeDepth {Number}
//  * event.applyLogs {applyLogsFunction}
// Output {}
chainPublisher.subscribe(event)
```
## new ChainPublisher(config).unSubscribe()

```js
const {ChainPublisher} = require('chain-publisher')
const chainPublisher = new ChainPublisher(config)
// Input
//  * key {string}
// Output {}
chainPublisher.unSubscribe(key)
```
## new ChainPublisher(config).getState()
```js
const {ChainPublisher} = require('chain-publisher')
const chainPublisher = new ChainPublisher(config)
// Type async function
// Input
//  * key {string}
// Output {
//    changes: {any},
//    unsafeChanges: {any}
// }
chainPublisher.getState(key)
```
## Types

```js
// Type applyLogsFunction {function}
//
// Input
//  * storage {localStorage}
//  * logs {Array<ethers.providers.Log>}
//
// Output any

// Type AssistedJsonRpcProvider {Object}
// Description
//  * It is an instance of lib AssistedJsonRpcProvider.
//  * npm i assisted-json-rpc-provider.
```
