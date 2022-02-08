const Bluebird = require('bluebird')
const _ = require('lodash')
const { mergeRequests, partitionRequests, filterLogs } = require("../ethers-log-filter")

// Input
//  * config {ChainlogProcessorConfig}
//  * consumers {Array<Consumer>}
//  * mongoose {ChainBackendMongoose}
function chainlogHeadProcessor({configs, consumers, mongoose, safeDepth}) {
    // rollback the lastHead
    // mongoose.model('Config').updateOne(
    //     { key: 'lastHead' },
    //     { value: 8000000 },
    //     { upsert: true },
    // ).then(console.log).catch(console.error)

    let ConfigModel = mongoose.model('Config')

    // return the last processed block number (lastHead)
    const process = async (head) => {


        const isMerged = false
        const config = isMerged ? configs.merge : configs.partition
        const consumerRequests = await Bluebird.map(consumers, c => c.getRequests())
        const maxRange = config.getSize()
        let requests = consumerRequests.flat()
    
        if (!requests.length) {
            return head
        }
    
        const fromBlock = Math.min(...requests.map(r => r.from))
        if (fromBlock + maxRange <= head) {
            var toBlock = fromBlock + maxRange - 1
        }

        let logs = []

        if (isMerged) {
            const merged = mergeRequests({requests, fromBlock, toBlock})
            if (merged) {
                logs = await config.getLogs(merged)
            }
            var safestLogBlock = _.maxBy(logs, 'blockNumber')?.blockNumber
        } else {
            // partition similar requests base on the same combination of address and each topic
            const parts = partitionRequests(requests)
            // generate a seed to stick with one provider in unsafe depth
            const seed = toBlock < head-safeDepth ? undefined : Math.random()

            const logss = await Bluebird.map(parts, requests => {
                const merged = mergeRequests({requests, fromBlock, toBlock})
                return config.getLogs(merged, parts.length, seed)
            })
            var safestLogBlock = _.min(logss.map(logs => _.maxBy(logs, 'blockNumber')?.blockNumber))
            logs = _.flatten(logss)
        }

        toBlock = _.max([
            safestLogBlock,
            _.min([
                toBlock,
                head-safeDepth,
            ]),
        ])

        if (logs && logs.length) {
            // truncate all log higher than toBlock to prevent missing head
            const lenBefore = logs.length
            logs = logs.filter(log => log.blockNumber <= toBlock)
            if (logs.length != lenBefore) {
                console.warn('TRUNCATED', lenBefore - logs.length)
            }
        }

        console.log('++++ HEAD ' + (isMerged ? '(MERGE)' : '(PARTITION)'),
            { fromBlock, range: toBlock-fromBlock+1, behind: head-toBlock, logs: logs.length }
        )

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

                return consumer.processLogs({ logs: consumerLogs, fromBlock, toBlock, head })
            })
        }


        return toBlock
    }

    return {
        process,
    }
}

module.exports = chainlogHeadProcessor
