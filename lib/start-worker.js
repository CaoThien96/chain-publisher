'use strict'

const mongoose = require('./mongoose')
const {standardizeStartConfiguration} = require('./validator')
const chainlogHeadProcessor = require('./service/chainlog-head-processor')
const chainlogPastProcessor = require('./service/chainlog-past-processor')
const { delay, rpcKnownError } = require('./util')

// Description
//  * Start a worker that retrieve and store data from Binance Smart Chain
//    network.
//
// Input
//  * config {Object}
//  * config.consumerConstructors {Array<ConsumerConstructor>}
//  * config.mongoose {mongoose.Mongoose} There are reserved model's names and
//    must not use by outside of this function: 'Config', 'LogsState'.
//  * config.processorConfigs {Object}
//  * config.safeDepth {number=0} RPC can return bad result, such as empty
//    logs, or missing logs from the newly mined blocks. The `lastHead` only
//    advance pass block N if either:
//      1. got some logs with blockNumber >= N
//      2. N >= head-safeDepth
//
// Errors
//  * ChainBackendError
async function startWorker(config) {
    let validConfig = standardizeStartConfiguration(config)

    await _startWorker(validConfig)
}

// Input
//  * config {WorkerConfiguration}
async function _startWorker(config) {
    mongoose.applySchemaList(config.mongoose)

    const consumers = _createConsumers(
        config.consumerConstructors, 
        config.mongoose
    )
    const headProcessor = chainlogHeadProcessor({
        consumers: consumers,
        configs: config.processorConfigs,
        safeDepth: config.safeDepth,
        mongoose: config.mongoose
    })
    const pastProcessor = chainlogPastProcessor({
        consumers: consumers,
        configs: config.processorConfigs,
        indexerEndpoint: config.indexerEndpoint,
        mongoose: config.mongoose
    })
    const provider = config.processorConfigs.merge.getProvider()
    const context = {
        latency: config.latency,
        safeDepth: config.safeDepth,
        provider,
        headProcessor: headProcessor,
        pastProcessor: pastProcessor,
        lastProcessed: undefined,
        head: await provider.getBlockNumber(),
    }

    provider.on('block', blockNumber => {
        context.head = blockNumber
    })

    _startProcessingLoop(context)
}

function _createConsumers(constructors, mongoose) {
    return Object.entries(constructors).map(([key, constructor]) => {
        return constructor({key, mongoose})
    })
}

async function _startProcessingLoop(context) {
    let nextPastProcess = Date.now()

    while (true) {
        // HEAD
        if ((context.lastHead ?? 0) < context.head) {
            const head = context.head
            try {
                context.lastHead = await context.headProcessor.process(head)
                context.lastProcessed = head
            }
            catch (error) {
                if (!rpcKnownError(error)) {
                    console.error('unexpected error: ', error)
                }
                console.log('[WARNING] head processing loop:', error.code)
            }
        }

        // PAST
        while (true) {
            const head = context.head
            const depth = context.head - context.lastHead
            if (depth > context.safeDepth) {
                console.log('safe depth reached', depth)
                break
            }

            const latency = context.head - context.lastProcessed
            if (latency > context.latency) {
                console.log('latency reached', latency)
                break
            }

            if (Date.now() < nextPastProcess) {
                await delay(Math.min(1000, nextPastProcess-Date.now()))
                continue
            }

            try {
                const nextDelay = await context.pastProcessor.process(head)
                if (!!nextDelay) {
                    console.log(`next past processing in ${nextDelay/1000}s`)
                    nextPastProcess = Date.now() + nextDelay
                    break
                }
            }
            catch (error) {
                if (!rpcKnownError(error)) {
                    console.error('unexpected error: ', error)
                }
                console.log('[WARNING] past processing loop:', error.code)
                nextPastProcess = Date.now() + 1000
            }
        }
    }
}

module.exports = startWorker
