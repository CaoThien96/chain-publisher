'use strict'

const { ethers } = require('ethers')
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

const isBidirectional = (transactionHash, logs) => {
    const txLogs = logs.filter(l => l.transactionHash == transactionHash)
    return txLogs.some(log => txLogs.some(other => {
        let check = log.address == other.address && (
            (log.topics[1] == topicFarm && other.topics[2] == topicFarm) ||
            (log.topics[2] == topicFarm && other.topics[1] == topicFarm))
        if (check) {
            console.info('')
        }
        return check
    }))
}

const applyLogsBalance = async (storage, logs) => {
    let lpTokens = await storage.getItem('tokens') || {}

    _.forEach(lpTokens, (value, key) => {
        if (value != 1) {
            delete lpTokens[key]
        }
    })

    const changes = new Map()
    const txIn = new Map()
    const txOut = new Map()

    function getKey(address, token) {
        return ['balances', address == token ? ZERO_ADDRESS : address, token].join(SEPARATOR)
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

            if (isBidirectional(transactionHash, logs)) {
                // skip updating txIn/txOut of bidirectional LP transfer
                console.error("SKIP: bidirectional tx", transactionHash)
            } else {
                if (isFrom) {
                    txOut.set(otherKey, transactionHash)
                } else {
                    txIn.set(otherKey, transactionHash)
                }
            }
        }
    }

    for (const [key, change] of changes) {
        let beforeVal = await storage.getItem(key)

        const [prefix, address, token] = key.split(SEPARATOR)

        const liquidity = {}
        if (txIn.has(key)) {
            liquidity.txIn = txIn.get(key)
        }
        if (txOut.has(key)) {
            liquidity.txOut = txOut.get(key)
        }
        

        beforeVal = bn(beforeVal ?? 0)

        await Promise.all([
            storage.setItem(key, beforeVal.add(change).toString()),
            storage.setItem(['liquidity', address, token].join(SEPARATOR), {
                address,
                token,
                liquidity
            })
        ]) 
    }
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
            let tokens = await storage.getItem('tokens') || {}
            // assume that the logs is sorted by blockNumber and transactionIndex
            for (const log of logs) {
                const address = ethers.utils.getAddress('0x' + log.topics[1].slice(26))
                const level = parseInt(log.data, 16)

                if (level) {
                    tokens[address] = level
                } else {
                    delete tokens[address]
                }
            }
            await storage.setItem('tokens', tokens)
            return
        },
        safeDepth: 64
    },
    {
        key: 'sfarm-balances',
        filter: filters,
        genesis,
        applyLogs: async (storage, logs) => {
            const changes = await applyLogsBalance(storage, logs)
            return changes
        },
        safeDepth: 32
    }
]




const RPCs = [
    "https://bsc-dataseed.binance.org"
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