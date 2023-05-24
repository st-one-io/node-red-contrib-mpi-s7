//@ts-check
/*
  Copyright: (c) 2020-2021, ST-One Ltda., Guilherme Francescon Cittolin <guilherme@st-one.io>
  GNU General Public License v3.0+ (see LICENSE or https://www.gnu.org/licenses/gpl-3.0.txt)
*/

const mpis7 = require('@protocols/mpi-s7');

class Tools {

    constructor() {}

    /**
     * @returns {string[]}
     */
    getAvailableAdapters() {
        return mpis7.AdapterManager.getAvailableAdapters();
    }
}

module.exports = new Tools();