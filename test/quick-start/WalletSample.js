'use strict'
/**
 * Example with hot-wallet
 * Compare the number of logs found with scan api
 */


const { JsonRpcProvider } = require('@ethersproject/providers')
const storage = require('node-persist');
const _ = require('lodash')
const { AssistedJsonRpcProvider } = require('assisted-json-rpc-provider')

const {
    ChainPublisher
} = require('../../lib/index');
const { equalLog } = require('../../lib/ethers-log-filter');


const scanApiKeys = [
    'JHJMRMD22RVUMHKFM1KRNXCYI2S6M85Y22',
    'ZK82FBHZBUD9BDSB9SCS1NVT3K7Y8R2TKF',
    'YD1424ACBTAZBRJWEIHAPHFZMT69MZXBBI',
]
const event = {
    topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        "0x0000000000000000000000008894e0a0c962cb723c1976a4421c95949be2d4e3" // Hot Wallet
    ]
}
const RPCs = [
    "https://bsc-dataseed.binance.org",
    "https://bsc-dataseed1.defibit.io",
    "https://bsc-dataseed1.ninicoin.io",
    "https://bsc-dataseed2.defibit.io",
    "https://bsc-dataseed3.defibit.io",
    "https://bsc-dataseed4.defibit.io",
    "https://bsc-dataseed2.ninicoin.io",
    "https://bsc-dataseed3.ninicoin.io",
    "https://bsc-dataseed4.ninicoin.io",
    "https://bsc-dataseed1.binance.org",
    "https://bsc-dataseed2.binance.org",
    "https://bsc-dataseed3.binance.org",
    "https://bsc-dataseed4.binance.org",
]


const Provider = new AssistedJsonRpcProvider(
    new JsonRpcProvider({ url: "https://bsc-dataseed1.defibit.io", timeout: 6000 }),
    {
        rateLimitCount: 5,
        rateLimitDuration: 1000,
        rangeThreshold: 4000,
        maxResults: 1000,
        url: 'https://api.bscscan.com/api',
        apiKeys: scanApiKeys,
    }
)

const providers = RPCs.map(rpc => new AssistedJsonRpcProvider(
    new JsonRpcProvider(rpc),
    {
        url: 'https://api.bscscan.com/api',
        maxResults: 1000,
        rangeThreshold: 1500,
        rateLimitCount: 1,
        rateLimitDuration: 5000
    }
))

async function main() {
    await storage.init();

    const chainBroker = new ChainPublisher({
        provider: providers,
        size: 1500,
        storage
    })

    var genesis = await storage.getItem('genesis') || await providers[0].getBlockNumber() - 2333
    await storage.setItem('genesis', genesis)

    chainBroker.subscribe({
        key: 'hot-wallet',
        filter: event,
        genesis,
        safeDepth: 64,
        applyLogs: async (storage, logs, unSafe) => {
            const state = await storage.getItem('hot-wallet') || {
                range: 0,
                changes: []
            }
            const range = state.range
            let changes = [...state.changes]

            if (!logs.length) {
                return changes
            }

            if (range < genesis) {
                return changes.concat(logs.map(log => ({ logIndex: log.logIndex, transactionHash: log.transactionHash })))
            }

            if (!unSafe && process.env.NODE_ENV !== 'production') {
                // Compare the logs found from genesis to safeHead with scan api
                let logCompare = await Provider.getLogs({
                    ...event,
                    fromBlock: genesis,
                    toBlock: range,

                })

                logCompare.forEach(log => {
                    log.blockNumber = Number(log.blockNumber)
                    log.logIndex = Number(log.logIndex) || 0
                    log.transactionIndex = Number(log.transactionIndex) || 0
                });

                // Check the number of logs
                if (changes.length != logCompare.length) {
                    console.error('ERRORED', ':', genesis, ':', range, `EXPECTED: ${logCompare.length} BUT RECEIVE: ${changes.length}`)
                } else {

                    let error = false
                    // Check index of log
                    for (let index = 0; index < logCompare.length; index++) {
                        const isEqual = equalLog(logCompare[index], changes[index])
                        if (!isEqual) {
                            error = {
                                index,
                                log: changes[index]
                            }
                            break
                        }
                    }

                    console.info(!error ? `CHECK ${logCompare.length} LOGS MATCHED` : `NOT MATCH LOG AT ${error}`)
                }
            }

            return changes.concat(logs.map(log => ({ logIndex: log.logIndex, transactionHash: log.transactionHash })))

        }
    })

}


main().catch(error => {
    console.error(error)
    process.exit(1)
})

