const { rpcKnownError, delay } = require('./util')
const Bluebird = require('bluebird')
const _ = require('lodash')
const { standardizeStartConfiguration } = require('./validator')
const { mergeRequests, partitionRequests, filterLogs, mergeTwoUniqSortedLogs } = require("./ethers-log-filter")

class ChainPublisher {
    config = {}
    context = {}
    constructor(config) {
        let validConfig = standardizeStartConfiguration(config)
        this.subscribers = new Map()
        this.memories = new Map()
        this.config = validConfig
        const provider = this._getProvider()
        provider.on('block', blockNumber => {
            this.context.head = blockNumber
        })
        this._startProcessingLoop()
    }

    _getProvider = (seed) => {
        const i = Math.floor(this.config?.provider.length * (seed ?? Math.random()))
        return this.config?.provider[i]
    }

    async _startProcessingLoop() {
        let nextPastProcess = Date.now()
        while (true) {
            if (this.subscribers.size == 0 || !this.context.head) {
                console.info('Waiting subcriber...');
                await delay(3000)
                continue
            }

            try {
                if (Date.now() < nextPastProcess) {
                    await delay(Math.min(1000, nextPastProcess - Date.now()))
                    continue
                }
                if (this.context.lastProcessed == this.context.head) {
                    const nextDelay = 3 * 1000
                    console.log(`next processor processing in ${nextDelay / 1000}s`, 'head', this.context.head, Date.now())
                    nextPastProcess = Date.now() + 3000
                    continue
                }
                const head = this.context.head
                this.context.lastProcessed = await this._processor(head)

            } catch (error) {
                if (!rpcKnownError(error)) {
                    console.error('unexpected error: ', error)
                }
                console.log('[WARNING] past processing loop:', error.code)
                nextPastProcess = Date.now() + 1000
            }
        }
    }
    _getRange() {
        return this.config?.size || 1000
    }

    async _processor(head) {
        const consumerRequests = await Bluebird.map(Array.from(this.subscribers.values()), async ({ key, filter, genesis }) => {
            const state = await this.config.storage.getItem(key) || {
                changes: {},
                range: genesis - 1,
            }
            const from = (state.range) + 1
            return [({ key, address: filter.address, topics: filter.topics, from })]
        })

        const requests = consumerRequests.flat()

        const fromBlock = Math.min(...requests.map(r => r.from))

        if (fromBlock > head) {
            return head // nothing to do
        }

        // When fromBlock to head is too large, scanApi will be used, otherwise getLogs will be used
        let toBlock = head - fromBlock > this._getRange() ? head : undefined

        // filter each consumer's requests and flatten again

        // partition similar requests base on the same combination of address and each topic
        const parts = partitionRequests(consumerRequests.flat())
        let logs = []
        logs = await Bluebird.map(parts, async requests => {
            const merged = mergeRequests({ requests, fromBlock, toBlock })
            if (merged) {
                const ret = await this._getLogs(merged)
                return ret
            }
        }).then((logss) => logss.reduce((result, next) => {
            result = mergeTwoUniqSortedLogs(result, next)
            return result
        }, []))
        logs = logs.map(log => ({
            ...log,
            blockNumber: Number(log.blockNumber),
            logIndex: Number(log.logIndex) || 0,
            transactionIndex: Number(log.transactionIndex) || 0
        }))

        console.log('---- PROCESSOR', { fromBlock, range: _.min([toBlock, head]) - fromBlock + 1, behind: this.context.head - _.min([toBlock, head]), logs: logs.length })

        // group and sort by order
        const groups = _.chain(Array.from(this.subscribers.values()))
            .groupBy(o => o.order ?? 0)
            .map((consumers, order) => ({ order, consumers }))
            .sortBy('order')
            .value()
            .map(o => o.consumers)

        const requestsByKey = _.zipObject(Array.from(this.subscribers.keys()), consumerRequests)


        for (const consumers of groups) {
            await Bluebird.map(consumers, async consumer => {
                const key = consumer.key
                const requests = requestsByKey[key]

                if (!requests || !requests.length) {
                    return
                }

                const consumerLogs = _.chain(requests)
                    .map(request => filterLogs(logs, request))
                    .flatten()
                    .sort((a, b) => (a.blockNumber - b.blockNumber) || (a.logIndex - b.logIndex))
                    .sortedUniqBy(a => `${a.blockNumber} ${a.logIndex}`)
                    .value()

                const state = await this.config?.storage.getItem(key) || {
                    changes: {},
                    range: this.subscribers.get(key).genesis - 1,
                }

                const subcriber = this.subscribers.get(key)

                const safeBlock = _.min([
                    toBlock,
                    _.max([
                        state.range,
                        _.min([
                            toBlock,
                            this.context.head - subcriber.safeDepth
                        ]),
                    ])
                ])

                console.log(`\t${state.range + 1} +${_.min([toBlock, head]) - state.range} :${consumerLogs.length}\t${key}`)

                return this._processLogs({ key, logs: consumerLogs, safeBlock })
            })
        }
        return head
    }

    async _processLogs({ key, logs, safeBlock }) {

        const subcriber = this.subscribers.get(key)

        const changes = await subcriber.applyLogs(this.config.storage, logs.filter(({ blockNumber }) => Number(blockNumber) <= safeBlock))

        const unsafeChanges = await subcriber.applyLogs(this.config.storage, logs.filter(({ blockNumber }) => Number(blockNumber) > safeBlock), true)
        this.memories.set(key, unsafeChanges)

        await this.config.storage.set(key, {
            changes,
            range: safeBlock,
        })

    }

    _getLogs = async ({ address, fromBlock, toBlock, topics }) => {
        const logs = await this._tryGetLogs({
            address,
            topics,
            fromBlock,
            toBlock
        });

        if (!Array.isArray(logs)) {
            throw new Error('unexpected logs response: ' + JSON.stringify(logs));
        }

        return logs;
    }

    _tryGetLogs = async (params, seed) => {
        const RETRY = 8
        for (let i = 0; true; ++i) {
            try {
                return await this._getProvider(seed).getLogs(params);
            } catch (err) {
                if (i < RETRY) {
                    const duration = Math.round((i + 1) * (333 + Math.random() * 1000))
                    console.warn(`retry after ${duration / 1000}s: `, err.reason ?? err.code ?? err.message)
                    await delay(duration)
                    continue
                }
                console.error('unable to get logs: out of retries', params)
                throw err
            }
        }
    }

    _eventExist(key) {
        return this.subscribers.has(key)
    }

    _validateKey(event, name) {
        try {
            return event[name]
        } catch (error) {
            return undefined
        }
    }

    _validateEvent(event) {
        const key = this._validateKey(event, 'key')
        if (key === undefined) {
            throw 'Missing key event'
        }

        const filter = this._validateKey(event, 'filter')
        if (filter === undefined) {
            throw 'Missing filter'
        }

        const safeDepth = this._validateKey(event, 'safeDepth')
        if (safeDepth === undefined) {
            throw 'Missing safeDepth'
        }

        let validGenesis = this._validateKey(event, 'genesis')
        if (validGenesis === undefined) {
            console.warn('Missing genesis use default genesis = 0')
            validGenesis = 0
        }

        const applyLogs = this._validateKey(event, 'applyLogs')
        if (filter === undefined) {
            throw 'Missing applyLogs'
        }
        if (typeof applyLogs !== 'function') {
            throw `applyLogs of ${event.key} is not function`
        }

        return {
            key,
            filter,
            genesis: validGenesis,
            applyLogs,
            safeDepth,
            order: event.order
        }
    }

    subscribe(event) {
        let validEvent = this._validateEvent(event)
        this.subscribers.set(validEvent.key, validEvent)
    }

    unSubscribe(key) {
        if (this.subscribers.has(key)) {
            this.subscribers.delete(key)
        }
    }
    async getState(key) {
        const state = await this.config.storage.getItem(key) || {
            changes: {}
        }
        const unsafeChanges = this.memories.get(key)
        return {
            changes: state.changes,
            unsafeChanges
        }
    }

}
module.exports = ChainPublisher