'use strict'

const { ethers } = require('ethers')
const Bluebird = require('bluebird')
const abiIERC20 = require('./IERC20.json').abi
const { JsonRpcProvider } = require('@ethersproject/providers')
const storage = require('node-persist');
const _ = require('lodash')
const {
    ChainPublisher
} = require('../../lib/index')
const { addressFromTopic } = require('../../lib/util')
const bn = ethers.BigNumber.from
const { AssistedJsonRpcProvider } = require('assisted-json-rpc-provider')

var genesis = 10068323

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const IERC20 = new ethers.Contract(ZERO_ADDRESS, abiIERC20)
const SEPARATOR = ','
const BANK_ADDRESS = '0xc4ffFBf8394b99c383846aA9b0EAf4A8F96Dea8F'

const filters = [
    IERC20.filters.Transfer(BANK_ADDRESS, null),
    IERC20.filters.Transfer(null, BANK_ADDRESS),
]

filters.forEach(f => delete f.address)
const topicFarm = filters[0].topics[1]

const applyLogsBalance = async (storage, logs, key) => {
    const sfarmTokenState = await storage.get('sfarm-tokens') || {
        range: genesis - 1,
        changes: {}
    }

    const state = await storage.getItem(key) || {
        range: genesis - 1,
        changes: {}
    }
    let value = { ...state.changes }

    const lpTokens = _.pickBy(sfarmTokenState.changes, (level) => level === 1)

    const changes = new Map()

    function getKey(address, token) {
        return [address == token ? ZERO_ADDRESS : address, token].join(SEPARATOR)
    }

    // assume that the logs is sorted by blockNumber and transactionIndex
    for (const log of logs) {
        const { topics, address: token, transactionHash } = log

        const isFrom = topics[1] === topicFarm
        const isTo = topics[2] === topicFarm
        if (!isFrom && !isTo) {
            throw new Error('unexpected log', log)
        }

        const { data } = log
        const amount = isTo ? bn(data) : bn(0).sub(data)

        const key = getKey(BANK_ADDRESS, token)
        changes.set(key, bn(changes.get(key) ?? 0).add(amount))

        if (lpTokens[token]) {
            const other = addressFromTopic(topics[isFrom ? 2 : 1])
            const otherKey = getKey(other, token)
            changes.set(otherKey, bn(changes.get(otherKey) ?? 0).sub(amount))
        }
    }

    for (const [key, change] of changes) {
        const [address, token] = key.split(SEPARATOR)
        value[`${address}#${token}`] = bn(value[`${address}#${token}`] ?? 0).add(change)
    }

    return value    // untouched
}

const events = [
    {
        key: 'sfarm-tokens',
        filter: {
            address: BANK_ADDRESS,
            topics: [
                "0x1464b325679b3d6e47425f6f128fa127a13e437cd0614dc73559bf67ab24f08d",
            ]
        },
        genesis,
        applyLogs: async (storage, logs) => {
            const state = await storage.getItem('sfarm-tokens') || {
                range: genesis - 1,
                changes: {}
            }
            let changes = { ...state.changes }

            // assume that the logs is sorted by blockNumber and transactionIndex
            logs.forEach(log => {
                const address = ethers.utils.getAddress('0x' + log.topics[1].slice(26))
                const level = parseInt(log.data, 16)
                if (level) {
                    changes[address] = level
                } else {
                    delete changes[address]
                }
            })

            return changes
        },
        safeDepth: 64
    },
    {
        key: 'sfarm-balances-out',
        filter: filters[0],
        genesis,
        applyLogs: async (storage, logs) => {
            const changes = await applyLogsBalance(storage, logs, 'sfarm-balances-out')
            return changes
        },
        safeDepth: 64,
        order: 2
    },
    {
        key: 'sfarm-balances-in',
        filter: filters[1],
        genesis,
        applyLogs: async (storage, logs) => {
            const changes = await applyLogsBalance(storage, logs, 'sfarm-balances-in')
            return changes
        },
        safeDepth: 64,
        order: 1
    }
]




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
const providers = RPCs.map(rpc => new AssistedJsonRpcProvider(
    new JsonRpcProvider(rpc),
    {
        url: 'https://api.bscscan.com/api',
        maxResults: 1000,
        rangeThreshold: 1000,
        rateLimitCount: 1,
        rateLimitDuration: 5000
    }
))
async function main() {
    await storage.init();
    const chainBroker = new ChainPublisher({
        provider: providers,
        size: 1000,
        storage
    })
    
    chainBroker.subscribe(events[0])
    for (let index = 1; index < events.length; index++) {
        await new Promise(resolve=>{
            setTimeout(() => {
                resolve()
            }, 20000);
        })
        const event = events[index];
        chainBroker.subscribe(event)
    }
}


main().catch(error => {
    console.error(error)
    process.exit(1)
})
module.exports = {
    filters
}