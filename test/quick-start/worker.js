'use strict'

const { ethers } = require('ethers')
const {JsonRpcProvider} = require('@ethersproject/providers')
const {Mongoose} = require('mongoose')
const sfarmAbi = require('./sfarm-abi.json').abi
const {
    startWorker,
    accumulationConsumerFactory,
    chainlogProcessorConfig
} = require('chain-backend')

const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000'

async function createMongoose() {
    let mongoose = new Mongoose()
    let endpoint = 'mongodb://localhost/sfarm'

    await mongoose.connect(endpoint, { 
        useNewUrlParser: true, 
        useUnifiedTopology: true
    })

    return mongoose
}

function createConsumer(config) {
    let sfarmContract = new ethers.Contract(
        '0x8141AA6e0f40602550b14bDDF1B28B2a0b4D9Ac6', 
        sfarmAbi
    )

    return accumulationConsumerFactory({
        key: 'consumer_1',
        filter: sfarmContract.filters.AuthorizeAdmin(null, null),
        genesis: 8967359,
        mongoose: config.mongoose,
        applyLogs: (value, logs) => {
            value = {...value}
            logs.forEach(log => {
                const address = ethers.utils.getAddress(
                    '0x'+log.topics[1].slice(26)
                )

                if (log.data != ZERO_HASH) {
                    value[address] = true
                } else {
                    delete value[address]
                }
            })

            return value
        }
    })
}

async function main() {
    let mongoose = await createMongoose()
    let ethersProvider = new JsonRpcProvider(
        'https://bsc-dataseed.binance.org'
    )
    let headProcessorConfig = chainlogProcessorConfig({
        type: 'HEAD',
        config: {
            provider: ethersProvider,
            size: 6,
            concurrency: 1,
        },
        hardCap: 4000,
        target: 500,
    })
    let pastProcessorConfig = chainlogProcessorConfig({
        type: 'PAST',
        config: {
            provider: ethersProvider,
            size: 4000,
            concurrency: 10,
        },
        hardCap: 4000,
        target: 500,
    })

    await startWorker({
        consumerConstructors: [
            createConsumer
        ],
        mongoose: mongoose,
        ethersProvider: ethersProvider,
        headProcessorConfig: headProcessorConfig,
        pastProcessorConfig: pastProcessorConfig
    })
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
