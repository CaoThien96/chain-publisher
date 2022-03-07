'use strict'

const assert = require('assert')
const { JsonRpcProvider } = require('@ethersproject/providers')
const { standardizeStartConfiguration } = require('../lib/validator')
const { AssistedJsonRpcProvider } = require('assisted-json-rpc-provider')
const storage = require('node-persist');

const RPC = '"https://bsc-dataseed.binance.org"'
const provider = new AssistedJsonRpcProvider(
    new JsonRpcProvider(RPC),
    {
        url: 'https://api.bscscan.com/api',
        maxResults: 1000,
        rangeThreshold: 1500,
        rateLimitCount: 1,
        rateLimitDuration: 5000
    }
)

const getProvider = () => provider

describe('validator.standardizeStartConfiguration', () => {
    it('return valid config', async () => {
        await storage.init();
        let config = {
            provider,
            size: 1500,
            storage
        }
        let validConfig = standardizeStartConfiguration(config)
    })

    it('config is undefined throws error', () => {
        assert.throws(
            () => {
                standardizeStartConfiguration(undefined)
            },
            {
                name: 'ChainPublisherError',
                message: 'undefined configuration'
            }
        )
    })

    it('config.provider is not an AssistedJsonRpcProvider throws error', async () => {
        await storage.init();
        assert.throws(
            () => {
                standardizeStartConfiguration({
                    provider: new JsonRpcProvider(RPC),
                    size: 1500,
                    storage
                })
            },
            {
                name: 'ChainPublisherError',
                message: 'invalid configuration "provider". Please use lib assisted-json-rpc-provider'
            }
        )
        assert.throws(
            () => {
                standardizeStartConfiguration({
                    provider: undefined,
                    size: 1500,
                    storage
                })
            },
            {
                name: 'ChainPublisherError',
                message: 'invalid configuration "provider". Please use lib assisted-json-rpc-provider'
            }
        )
    })

    it('config.provider[0] is not a AssistedJsonRpcProvider throws error', async () => {
        await storage.init();
        assert.throws(
            () => {
                standardizeStartConfiguration({
                    provider: [
                        {}
                    ],
                    size: 1500,
                    storage
                })
            },
            {
                name: 'ChainPublisherError',
                message: 'invalid configuration "provider". Please use lib assisted-json-rpc-provider'
            }
        )
    })

    it('config.storage is invalid throws error', () => {
        assert.throws(
            () => {
                standardizeStartConfiguration({
                    provider,
                    storage: undefined,
                    size: 1500
                })
            },
            {
                name: 'ChainPublisherError',
                message: 'invalid configuration "storage"'
            }
        )
    })

    it('config.storage.getItem or config.storage.setItem is not function throws error', () => {
        assert.throws(
            () => {
                standardizeStartConfiguration({
                    provider,
                    storage: {
                        getItem: undefined,
                        setItem: undefined
                    },
                    size: 1500
                })
            },
            {
                name: 'ChainPublisherError',
                message: 'invalid configuration "storage"'
            }
        )
    })

})
