const _ = require('lodash')
const { filterLogs } = require('../ethers-log-filter')
const { diff } = require('jsondiffpatch')

// Input
//  * config {Object}
//  * config.key {String}
//  * config.filter {ethers.Contract.Filter}
//  * config.genesis {String}
//  * config.applyLogs {applyLogsFunction}
//  * config.mongoose {ChainBackendMongoose}
//
// Output {Consumer}
function accumulationConsumer({key, filter, genesis, applyLogs, mongoose}) {
    // reset the state
    // LogsStateModel.deleteOne({ key }).then(console.error).catch(console.error)

    let LogsStateModel = mongoose.model('LogsState')

    const processLogs = async ({ logs, fromBlock, toBlock, lastHead, head }) => {
        // TODO: handle synchronization

        const state = await LogsStateModel.findOne({ key }).lean() || {
            value: null,
            range: genesis-1,
        };
        // console.log('processLogs', {state, logs, fromBlock, toBlock, freshBlock})
        const oldState = {
            value: state.value,
            range: state.range,
        }
        const newState = {...oldState}
        try {
            // write ahead log for failed head update
            if (head && !state.range) {
                newState.range = lastHead
            }

            if (!state.range) {
                if (head) {
                    // write ahead log for failed head update
                    newState.range = lastHead
                } else {
                    throw new Error(`wrong logs range: need ${lastHead+1}, has ${fromBlock}`)
                }
            } else {
                if (newState.range+1 < fromBlock) {
                    throw new Error(`missing range ${newState.range+1}-${fromBlock}`)
                }
            }

            // if (Math.random() < 0.5) {
            //     throw new Error(`${key} is SCREWED`)
            // }

            // APPLY LOGS TO OLD VALUE
            newState.value = await applyLogs(oldState.value, logs)
            newState.range = toBlock

        } catch (err) {
            if (head) {
                console.error(`ERROR in ${key}.processLogs, tracking last synced block ${lastHead}`, err)
            } else {
                console.error(`ERROR in ${key}.processLogs, skip!`, err)
            }
        } finally {
            if (JSON.stringify(newState) == JSON.stringify(oldState)) {
                return // no data change
            }

            const delta = diff(oldState.value, newState.value)
            if (delta) {
                const changes = Object.keys(delta).length
                console.log(`ac:${key} update db`, {changes})
            }
            return LogsStateModel.updateOne(
                { key },
                newState,
                { upsert: true },
            );
        }
    }

    return {
        key,
        processLogs,
        getRequests: async () => {
            const state = await LogsStateModel.findOne({ key }).lean() || {
                value: null,
                range: genesis-1,
            }
            const from = (state.range) + 1
            return _.flatten([filter]).map(({ address, topics }) => ({ key, address, topics, from }))
        },
    }
}

module.exports = accumulationConsumer
