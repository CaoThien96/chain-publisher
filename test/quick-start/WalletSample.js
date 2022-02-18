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
const events = [
    {
        key: 'hotwallet-out',
        filter: {
            topics: [
                "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
                "0x0000000000000000000000008894e0a0c962cb723c1976a4421c95949be2d4e3" // Hot Wallet
            ]
        },
        safeDepth: 32
    },
    {
        key: 'hotwallet-in',
        filter: {
            topics: [
                "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
                null,
                "0x0000000000000000000000008894e0a0c962cb723c1976a4421c95949be2d4e3" // Hot Wallet
            ]
        },
        safeDepth: 16
    },
]
const RPCs = [
    "https://bsc-dataseed.binance.org"
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
async function applyLogs(storage, logs, unSafe, genesis, key, event) {
    logs = logs.map(log => ({
        blockNumber: Number(log.blockNumber),
        logIndex: Number(log.logIndex) || 0,
        transactionIndex: Number(log.transactionIndex) || 0,
        transactionHash: log.transactionHash
    }))

    const state = await storage.getItem(key) || { range: genesis - 1 }
    const range = state.range

    let hotWalletLogs = await storage.getItem('hot-wallet-history' + key) || []

    if (!logs.length) {
        return {}
    }

    if (range < genesis) {
        !unSafe && await storage.setItem('hot-wallet-history' + key, hotWalletLogs.concat(logs))
        return {}
    }

    if (!unSafe && process.env.NODE_ENV !== 'production') {
        // Compare the logs found from genesis to safeHead with scan api
        let logCompare = await Provider.getLogs({
            ...event.filter,
            fromBlock: genesis,
            toBlock: range,

        })


        logCompare.forEach(log => {
            log.blockNumber = Number(log.blockNumber)
            log.logIndex = Number(log.logIndex) || 0
            log.transactionIndex = Number(log.transactionIndex) || 0
        });

        // Check the number of logs
        if (hotWalletLogs.length != logCompare.length) {
            // refetch for log accuracy
            for (let index = 0; index < 5; index++) {
                console.info('refetch for log accuracy')
                logCompare = await Provider.getLogs({
                    ...event.filter,
                    fromBlock: genesis,
                    toBlock: range,

                })
                if (logCompare.length == hotWalletLogs.length) {
                    console.info(`${key}: ${logCompare.length} LOGS MATCHED`)
                    break
                }
            }
            hotWalletLogs.length != logCompare.length && console.error('ERRORED ', key, ':', genesis, ':', range, `EXPECTED: ${logCompare.length} BUT RECEIVE: ${hotWalletLogs.length}`)
        } else {

            let error = false
            // Check index of log
            for (let index = 0; index < logCompare.length; index++) {
                const isEqual = equalLog(logCompare[index], hotWalletLogs[index])
                if (!isEqual) {
                    error = {
                        index,
                        log: hotWalletLogs[index]
                    }
                    break
                }
            }

            console.info(!error ? `${key}: ${logCompare.length} LOGS MATCHED` : `NOT MATCH LOG AT ${error}`)
        }
        await storage.setItem('hot-wallet-history' + key, hotWalletLogs.concat(logs))
    }
    return {}
}
async function main() {
    await storage.init();

    const chainBroker = new ChainPublisher({
        provider: providers,
        size: 1500,
        storage
    })

    var genesis = await storage.getItem('genesis') || await providers[0].getBlockNumber() - 5000
    await storage.setItem('genesis', genesis)
    events.forEach(event => chainBroker.subscribe({
        ...event,
        genesis,
        applyLogs: async (storage, logs, unSafe) => {
            return applyLogs(storage, logs, unSafe, genesis, event.key, event)
        }
    }))
}


main().catch(error => {
    console.error(error)
    process.exit(1)
})

