'use strict'

class ChainPublisherError extends Error {
    constructor(message, source=undefined) {
        super(message)
        this.name = 'ChainPublisherError'
        this.source = source
    }
}

module.exports = {
    ChainPublisherError
}
