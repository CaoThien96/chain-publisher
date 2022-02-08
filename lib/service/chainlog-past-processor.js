const Bluebird = require('bluebird')
const _ = require('lodash')
const { mergeRequests, partitionRequests, filterLogs } = require("../ethers-log-filter")
const { splitChunks } = require("../util")
const createIndexedLogsFetcher = require("./indexed-logs-fetcher")

// Input
//  * config {ChainlogProcessorConfig}
//  * consumers {Array<Consumer>}
//  * mongoose {ChainBackendMongoose}
const chainlogPastProcessor = ({configs, consumers, mongoose, indexerEndpoint}) => {
    const config = configs.partition    // past processor always use partition config
    const ConfigModel = mongoose.model('Config')
    const fetcher = indexerEndpoint ? createIndexedLogsFetcher(indexerEndpoint, config) : undefined

    return {
        // return number of milliseconds for the next call
        process: async (head) => {
            
            const concurrency = config.getConcurrency()
            const maxRange = fetcher ? Number.MAX_VALUE : concurrency * config.getSize()
            const consumerRequestsUnfiltered = await Bluebird.map(consumers, c => c.getRequests({ maxRange }))
            const requests = consumerRequestsUnfiltered.flat()
        
            if (!requests.length) {
                return 3000 // no more requests, wait for 3s
            }
    
            const fromBlock = Math.min(...requests.map(r => r.from))
            const toBlock = fromBlock + maxRange - 1
    
            // filter each consumer's requests and flatten again
            const consumerRequests = consumerRequestsUnfiltered.map(requests =>
                requests.filter(r => r.from <= toBlock && (!r.to || r.to >= fromBlock))
            )
    
            // partition similar requests base on the same combination of address and each topic
            const parts = partitionRequests(consumerRequests.flat())
    
            const logs = await Bluebird.map(parts, requests => {
                if (fetcher) {
                    const filters = requests.map(r => {
                        const { from, to, ...filter } = r
                        if (from != null) {
                            filter.fromBlock = from
                        }
                        if (to != null) {
                            filter.toBlock = to
                        }
                        return filter
                    })
                    return fetcher.fetchLogs({filters, fromBlock, toBlock})
                }
                const chunks = splitChunks(fromBlock, toBlock, concurrency);
                return Bluebird.map(chunks, ({ fromBlock, toBlock }) => {
                    const merged = mergeRequests({requests, fromBlock, toBlock})
                    if (merged) {
                        return config.getLogs(merged, concurrency * parts.length)
                    }
                }).then(_.flatten).filter(l => l);
            }).then(_.flatten)
    
            console.log('---- PAST', { fromBlock, range: toBlock-fromBlock+1, behind: head-toBlock, logs: logs.length })
    
            // group and sort by order
            const groups = _.chain(consumers)
                .groupBy(o => o.order ?? 0)
                .map((consumers, order) => ({order, consumers}))
                .sortBy('order')
                .value()
                .map(o => o.consumers)
    
            const requestsByKey = _.zipObject(consumers.map(c => c.key), consumerRequests)

            for (const consumers of groups) {
                await Bluebird.map(consumers, consumer => {
                    const requests = requestsByKey[consumer.key]
                    if (!requests || !requests.length) {
                        return
                    }

                    const consumerLogs = _.chain(requests)
                        .map(request => filterLogs(logs, request))
                        .flatten()
                        .sort((a, b) => (a.blockNumber - b.blockNumber) || (a.logIndex - b.logIndex))
                        .sortedUniqBy(a => `${a.blockNumber} ${a.logIndex}`)
                        .value()

                    console.log(`\t${fromBlock} +${toBlock-fromBlock+1} :${consumerLogs.length}\t${consumer.key}`)

                    return consumer.processLogs({ logs: consumerLogs, fromBlock, toBlock })
                })
            }

            return 0
        },
    }
}

module.exports = chainlogPastProcessor
