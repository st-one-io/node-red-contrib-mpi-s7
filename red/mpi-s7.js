//@ts-check
/*
  Copyright: (c) 2020, ST-One Ltda., Guilherme Francescon Cittolin <guilherme@st-one.io>
  GNU General Public License v3.0+ (see LICENSE or https://www.gnu.org/licenses/gpl-3.0.txt)
*/

var tools = require('../src/tools.js');

/** @typedef {import('mpi-s7').MpiAdapter} MpiAdapter*/

module.exports = function (RED) {
    "use strict";

    var mpis7 = require('mpi-s7');
    var { EventEmitter } = require('events');

    // Discovery Endpoints
    RED.httpAdmin.get('/__node-red-contrib-mpi-s7/available-adapters', RED.auth.needsPermission('mpi-s7.discover'), function (req, res) {
        try {
            let adapters = tools.getAvailableAdapters();
            res.json(adapters).end();
        } catch (e) {
            res.status(500).json(e && e.toString()).end();
        }
    });

    /**
     * 
     * @param {object} config 
     * @param {string} config.name 
     * @param {number} config.timeout 
     * @param {string} config.adapter 
     * @param {string} config.busconfigmode 
     * @param {number} config.busaddr 
     * @param {number} config.maxbusaddr 
     * @param {string} config.busspeed 
     * @param {string} config.busparams 
     */
    function MPIS7Adapter(config) {
        EventEmitter.call(this);
        const node = this;

        //avoids warnings when we have a lot of S7In nodes
        this.setMaxListeners(0);

        RED.nodes.createNode(this, config);

        const adapterPath = config.adapter || '';
        /** @type {MpiAdapter} */
        let adapter = null;
        let connOpts;

        node.getStream = async addr => {
            if (!adapter) throw new Error(RED._('mpi-s7.error.noadapter'));

            await adapter.open(connOpts);
            return adapter.createStream(addr);
        };

        if (config.busconfigmode === 'expert') {
            try {
                connOpts = {
                    connectionParams: JSON.parse(config.busparams)
                }
            } catch (e) {
                node.error(RED._('mpi-s7.error.invalid-json-params'));
                return;
            }
        } else {
            let baud = mpis7.MpiAdapter.BusSpeed[config.busspeed];
            if (baud === undefined) {
                node.error(RED._('mpi-s7.error.invalid-bus-speed'));
                return;
            }

            connOpts = {
                selfBusAddress: config.busaddr,
                maxBusAddress: config.maxbusaddr,
                busspeed: baud,
                plcType: config.busconfigmode
            }
        }

        // try its best to find the desired adapter
        const onAttach = path => {
            // skip if we want a specific adapter and it's not what we want
            if (adapterPath && (path != adapterPath)) return;
            // skip if we already have an adapter set
            if (adapter) return;

            adapter = mpis7.AdapterManager.getAdapter(adapterPath);
            
            // skip if we for any reason couldn't get the adapter we want
            if (!adapter) return;
            
            adapter.on('error', e => node.error(e));
            adapter.on('detach', () => {
                adapter = null;
            });
        }

        onAttach(adapterPath);
        mpis7.AdapterManager.on('attach', onAttach);

        node.on('close', done => {
            mpis7.AdapterManager.removeListener('attach', onAttach);
            if (adapter) {
                adapter.close().then(() => {
                    done();
                }).catch(e => {
                    node.error(e);
                    done();
                })
            } else {
                done();
            }
        })
    }

    // register types
    RED.nodes.registerType("mpi-s7 adapter", MPIS7Adapter);
};
