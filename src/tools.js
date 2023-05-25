//@ts-check
/*
  Copyright: (c) 2020-2021, ST-One Ltda., Guilherme Francescon Cittolin <guilherme@st-one.io>
  GNU General Public License v3.0+ (see LICENSE or https://www.gnu.org/licenses/gpl-3.0.txt)
*/

const mpis7 = require('@protocols/mpi-s7');

class Tools {

    constructor() { }

    /**
     * @returns {string[]}
     */
    getAvailableAdapters() {
        return mpis7 ? mpis7.AdapterManager.getAvailableAdapters() : [];
    }


    /**
     * 
     * @param {string} [adapterPath]
     * @returns {Promise<{mode: string?, nodes: number[]}>}
     */
    async getNodesForAdapter(adapterPath) {
        /** @type {{mode: string?, nodes: number[]}} */
        const response = {
            mode: null,
            nodes: []
        }

        if (!mpis7) return response;

        const adapter = mpis7.AdapterManager.getAdapter(adapterPath);
        if (!adapter) return response;

        const sleep = ms => new Promise(res => setTimeout(res, ms));

        async function getBusNodes() {
            try {
                const scan = await adapter.busScan();
                const nodes = scan.nodes.filter(e => e.address !== scan.selfAddress).map(e => e.address);
                response.nodes.push(...nodes);
            } catch (e) {
                //ignore connect/scan errors
            }
        }

        async function testPlcType(plcType) {
            try {
                await adapter.connect({ plcType });
                await getBusNodes();
            } catch (err) {
                //ignore connect/scan errors
            } finally {
                await adapter.disconnect();
            }
        }

        async function testConnection() {
            if (!adapter.connected) {
                await testPlcType('s7-300/400');

                if (response.nodes.length) {
                    response.mode = 's7-300/400';
                } else {
                    //just test s7-200 mode if no nodes were found
                    await sleep(500);
                    await testPlcType('s7-200');

                    if (response.nodes.length) {
                        response.mode = 's7-200';
                    }
                }
            } else {
                await getBusNodes();
            }
        }

        if (!adapter.opened) {
            try {
                await new Promise((res, rej) => {
                    adapter.open();
                    adapter.on('open', res)
                    adapter.on('error', rej)
                });

                await testConnection();

            } catch (e) {
                console.error('Error processing adapter:', e);
            } finally {
                if (adapter.opened) {
                    adapter.close();
                }
            }
        } else {
            await testConnection();
        }

        return response;
    }

}

module.exports = new Tools();