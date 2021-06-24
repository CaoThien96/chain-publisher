// Descriptions
//  * Validate processing flow: process head log, loop of process past log
//    works properly.
//
// Pre-conditions
//  * Database has no state.
//  * Blockchain network already has 5000 logs.
//
// Actions
//  * Perform head log processing.
//  * Perform loop of past log processing.

'use strict'

const assert = require('assert')
const LogsStateModel = require('../models/LogsStateModel')
const ConfigModel = require('../models/ConfigModel')
const chainlogHeadProcessor = require('../services/chainlog-head-processor')
const chainlogPastProcessor = require('../services/chainlog-past-processor')
const {createConfig} = require('../services/chainlog-config')
const {
    EthersProviderMock,
    mongooseMock,
    loadConsumer,
} = require('./lib')

describe('consumer/pc-usdt-busd: custom head and past processing', () => {
    let pastProcessor
    let headProcessor
    let ethersProvider
    let key = 'pc-usdt-busd'
    let chunkSize = 1000
    let lastBlockNumber = 5000

    before(async () => {
        let consumers = loadConsumer(['consumers/pc-usdt-busd'])

        await mongooseMock.open()
        ethersProvider = new EthersProviderMock()
        ethersProvider.mockGetLogs('worker-test/log/pc-usdt-busd-4000')
        ethersProvider.mockGetBlockNumber(lastBlockNumber)
        pastProcessor = chainlogPastProcessor.createProccesor({
            consumers,
            config: createConfig({
                type: 'PAST',
                config: {
                    provider: ethersProvider,
                    size: chunkSize,
                    concurrency: 1,
                },
                hardCap: chunkSize,
                target: chunkSize,
            })
        })
        headProcessor = chainlogHeadProcessor.createProccesor({
            consumers,
            config: createConfig({
                type: 'HEAD',
                config: {
                    provider: ethersProvider,
                    size: chunkSize,
                    concurrency: 1,
                },
                hardCap: chunkSize,
                target: chunkSize,
            })
        })
    })

    after(async () => {
        await mongooseMock.close()
        ethersProvider.removeAllListeners()
    })

    it('should be succeed', async () => {
        await processHeadBlock()
        await processPastLogLoop()
    })

    async function processHeadBlock() {
        await headProcessor.process(lastBlockNumber)

        let state = await LogsStateModel.findOne({key}).lean()
        let config = await ConfigModel.findOne({key: 'lastHead'}).lean()

        assert.strictEqual(state.value, null)
    }

    async function processPastLogLoop() {
        for (let n = 0; n < 5; ++n) {
            await pastProcessor.process()
        }

        let state = await LogsStateModel.findOne({key}).lean()
        let config = await ConfigModel.findOne({key: 'lastHead'}).lean()

        assert.strictEqual(state.value, '4000')
    }
})