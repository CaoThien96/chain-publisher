'use strict'

const { ethers } = require('ethers')
const { JsonRpcProvider } = require('@ethersproject/providers')
const { AssistedJsonRpcProvider } = require('assisted-json-rpc-provider')

const storage = require('node-persist');
const contractABI = require("./sfarm-abi.json").abi;

const {
    ChainPublisher
} = require('chain-publisher')
const BANK_ADDRESS = '0xc4ffFBf8394b99c383846aA9b0EAf4A8F96Dea8F'
const SFarm = new ethers.Contract(BANK_ADDRESS, contractABI);

const filter = SFarm.filters.AuthorizeAdmin(null, null);

const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000'
const RPC = "https://bsc-dataseed.binance.org"
const event = {
    key: 'consumer_1',
    genesis: 8967359,
    safeDepth: 64,
    filter,
    applyLogs: async (storage, logs) => {
        if (!logs?.length) return

        let value = await storage.getItem('admins') || {};
        // assume that the logs is sorted by blockNumber and transactionIndex
        for (const log of logs) {
            const address = ethers.utils.getAddress('0x' + log.topics[1].slice(26))
            if (log.data != ZERO_HASH) {
                await storage.setItem(address, true)
            } else {
                await storage.removeItem(address)
            }
        }
    }
}

async function main() {
    await storage.init();
    const chainBroker = new ChainPublisher({
        provider: new AssistedJsonRpcProvider(
            new JsonRpcProvider({ url: RPC, timeout: 6000 }),
            {
                rateLimitCount: 1,
                rateLimitDuration: 5000,
                rangeThreshold: 1024,
                maxResults: 1000,
                url: 'https://api.bscscan.com/api'
            }),
        size: 1024,
        storage
    })

    chainBroker.subscribe(event)
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
