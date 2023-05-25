//@ts-check
/*
  Copyright: (c) 2020-2021, ST-One Ltda., Guilherme Francescon Cittolin <guilherme@st-one.io>
  GNU General Public License v3.0+ (see LICENSE or https://www.gnu.org/licenses/gpl-3.0.txt)
*/

const tools = require('../src/tools.js');

module.exports = function (RED) {
    "use strict";

    const { EventEmitter } = require('events');

    // Discovery Endpoints
    RED.httpAdmin.get('/__node-red-contrib-mpi-s7/available-adapters', RED.auth.needsPermission('mpi-s7.discover'), function (req, res) {
        try {
            const adapters = tools.getAvailableAdapters();
            res.json(adapters).end();
        } catch (e) {
            res.status(500).json(e && e.toString()).end();
        }
    });

    RED.httpAdmin.get('/__node-red-contrib-mpi-s7/available-nodes', RED.auth.needsPermission('mpi-s7.discover'), function (req, res) {
        tools.getNodesForAdapter().then(nodes => {
            res.json(nodes).end();
        }).catch(e => {
            res.status(500).json(e && e.toString()).end()
        });
    });

    RED.httpAdmin.get('/__node-red-contrib-mpi-s7/available-nodes/:adapter', RED.auth.needsPermission('mpi-s7.discover'), function (req, res) {
        tools.getNodesForAdapter(req.params.adapter).then(nodes => {
            res.json(nodes).end();
        }).catch(e => {
            res.status(500).json(e && e.toString()).end()
        });
    });

    /**
     * @typedef {object} ConnOpts
     * @param {number} [maxBusAddress=15]
     * @param {number} [selfBusAddress=0]
     * @param {BusSpeed} [busSpeed=BusSpeed.BAUD_AUTO]
     * @param {'s7-200'|'s7-300/400'} [plcType='s7-300/400']
     * @param {import('@protocols/mpi-s7/src/mpi/constants').BusParameters} [connectionParams]
     */

    /**
     * @typedef {object} NodeRedNode
     * @property {(err: string, msg?: function) => void} error
     * @property {(event: string, cb?: function) => void} on
     */

    /**
     * 
     * @param {object} config 
     * @param {string} config.name 
     * @param {string} config.timeout 
     * @param {string} config.adapter 
     * @param {string} config.busconfigmode 
     * @param {string} config.busaddr 
     * @param {string} config.maxbusaddr 
     * @param {string} config.busspeed 
     * @param {string} config.busparams 
     * @this NodeRedNode
     */
    function MPIS7Adapter(config) {
        EventEmitter.call(this);
        const node = this;

        //avoids warnings when we have a lot of S7In nodes
        //@ts-ignore
        this.setMaxListeners(0);

        RED.nodes.createNode(this, config);

        const adapterOpenTimeout = 5000;
        const wantedAdapterPath = config.adapter || '';
        let currentAdapterPath = null;
        let closing = false;

        /** @type {MpiAdapter|undefined} */
        let adapter = undefined;
        /** @type {ConnOpts} */
        let connOpts;
        /** @type {NodeJS.Timeout|undefined} */
        let adapterOpenTimer = undefined;

        //@ts-expect-error
        node.getStream = async addr => {
            if (!adapter) throw new Error(RED._('mpi-s7.error.noadapter'));
            if (!adapter.connected) throw new Error(RED._('mpi-s7.error.adapter-not-connected'));

            return await adapter.createStream(addr);
        };

        const mpiS7 = require('@protocols/mpi-s7');
        if (!mpiS7) {
            node.error('Missing "@protocols/mpi-s7" dependency, avaliable only on ST-One hardware. Please contact us at "st-one.io" for more information.');
            return;
        }

        const { AdapterManager, BusSpeed, MpiAdapter } = mpiS7;

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
            const baud = BusSpeed[config.busspeed];
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

        const tryAdapterConnect = () => {
            clearTimeout(adapterOpenTimer);
            if (!adapter) return;

            adapter.connect(connOpts).catch(err => {
                node.error(err);
                scheduleReopen();
            })
        }

        const tryAdapterOpen = () => {
            clearTimeout(adapterOpenTimer);
            if (!adapter) return;

            if (adapter.opened) {
                tryAdapterConnect();
            } else {
                try {
                    adapter.open();
                    //"connect" event is already bound
                } catch (err) {
                    node.error(err);
                    scheduleReopen();
                }
            }
        }

        const scheduleReopen = () => {
            clearTimeout(adapterOpenTimer);
            if (closing) return;

            adapterOpenTimer = setTimeout(tryAdapterOpen, adapterOpenTimeout);
        }

        // try its best to find the desired adapter
        const onAttach = path => {
            // skip if we want a specific adapter and it's not what we want
            if (wantedAdapterPath && (path != wantedAdapterPath)) return;
            // skip if we already have an adapter set
            if (adapter) return;

            adapter = AdapterManager.getAdapter(wantedAdapterPath);

            // skip if we for any reason couldn't get the adapter we want
            if (!adapter) return;
            currentAdapterPath = path;

            adapter.on('open', tryAdapterConnect);
            adapter.on('close', scheduleReopen);
            adapter.on('disconnect', scheduleReopen);
            adapter.on('error', e => node.error(e));

            tryAdapterOpen();
        }

        const onDetach = path => {
            if (path === currentAdapterPath) {
                if (adapter) {
                    adapter.removeListener('open', tryAdapterConnect);
                    adapter.removeListener('close', scheduleReopen);
                    adapter.removeListener('disconnect', scheduleReopen);
                }
                adapter = undefined;
                currentAdapterPath = null;
            }
        }

        AdapterManager.on('attach', onAttach);
        AdapterManager.on('detach', onDetach);
        AdapterManager.getAvailableAdapters().forEach(onAttach);

        node.on('close', done => {
            closing = true;
            AdapterManager.removeListener('attach', onAttach);
            AdapterManager.removeListener('detach', onDetach);

            if (adapter) {
                adapter.once('close', done);
                adapter.close();
            } else {
                done();
            }
        })
    }

    // register types
    RED.nodes.registerType("mpi-s7 adapter", MPIS7Adapter);
};
