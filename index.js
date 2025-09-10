const express = require('express');
const { WebSocketServer } = require('ws');
const { SerialPort } = require('serialport');
const pn532 = require('pn532');
const fs = require('fs');
const path = require('path');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
require('dotenv').config();

// --- Argument Parsing ---
const argv = yargs(hideBin(process.argv))
    .option('rfid-port', { alias: 'rp', type: 'string', describe: 'Serial port for the RFID reader', default: '/dev/ttyS0' })
    .option('rfid-baudrate', { alias: 'rb', type: 'number', describe: 'Baud rate for the RFID serial connection', default: 115200 })
    .option('nfc-port', { alias: 'np', type: 'string', describe: 'Serial port for the NFC reader', default: '/dev/tty.usbserial-210' })
    .option('nfc-baudrate', { alias: 'nb', type: 'number', describe: 'Baud rate for the NFC serial connection', default: 115200 })
    .help()
    .argv;

const app = express();
const server = app.listen(process.env.PORT || 8080, () => {
    console.log(`Web server is listening on port ${process.env.PORT || 8080}`);
});

const wss = new WebSocketServer({ server });

// --- Unified Item List Setup ---
const itemListPath = path.join(__dirname, 'work', 'itemList.csv');
const ITEM_LIST_HEADER = 'ID,EPC,UID,RFID Last Scanned,NFC Last Scanned,Item,description\n';
let itemList = []; // In-memory store for the item list

// --- RFID Constants and State ---
const Constants = {
    HEADER_BYTE: 0xFF, CMD_START_APP: 0x04, CMD_GET_RUNNING_STAGE: 0x0C, CMD_RFID_INVENTORY: 0x21,
    CMD_MULTI_TAG_INVENTORY: 0xAA, STAGE_BOOTLOADER: 0x11, STAGE_APP: 0x12, STATUS_SUCCESS: 0x0000,
    HEX_START_APP: 'ff00041d0b', HEX_GET_RUNNING_STAGE: 'ff000c1d03',
    HEX_SCAN_START: 'ff13aa4d6f64756c6574656368aa480000000000f2bbe1cb', HEX_SCAN_STOP: 'ff0eaa4d6f64756c6574656368aa49f3bb',
};
let rfidPacketBuffer = Buffer.alloc(0);
let isScanningRFID = false;
let currentRfidMode = 'inventory'; // 'inventory' or 'read-rfid-tag'
let rfidAutoModeState = 0; // 0: initial, 1: start_app sent, 2: ready

// --- File System Functions ---
function initializeItemList() {
    if (!fs.existsSync(path.dirname(itemListPath))) {
        fs.mkdirSync(path.dirname(itemListPath));
    }
    if (!fs.existsSync(itemListPath)) {
        fs.writeFileSync(itemListPath, ITEM_LIST_HEADER);
    }
    loadItemList();
}

function loadItemList() {
    const csvData = fs.readFileSync(itemListPath, 'utf8');
    const lines = csvData.trim().split('\n').slice(1);
    itemList = lines.map(line => {
        const [ID, EPC, UID, rfidLastScanned, nfcLastScanned, Item, description] = line.split(',');
        return { ID, EPC, UID, rfidLastScanned, nfcLastScanned, Item, description };
    });
}

function saveItemList() {
    const csvData = [
        'ID,EPC,UID,RFID Last Scanned,NFC Last Scanned,Item,description',
        ...itemList.map(item => `${item.ID},${item.EPC},${item.UID},${item.rfidLastScanned},${item.nfcLastScanned},${item.Item},${item.description}`)
    ].join('\n');
    fs.writeFileSync(itemListPath, csvData);
}

// --- RFID Reader Setup ---
const rfidPort = new SerialPort({ path: argv.rfidPort, baudRate: argv.rfidBaudrate });
rfidPort.on('open', () => {
    console.log(`RFID Reader connected on port: ${argv.rfidPort}`);
    startRfidInitialization();
});
rfidPort.on('data', handleRfidData);
rfidPort.on('error', (err) => console.error(`RFID Port Error: ${err.message}`));

// --- NFC Reader Setup ---
const nfcPort = new SerialPort({ path: argv.nfcPort, baudRate: argv.nfcBaudrate });
const nfcReader = new pn532.PN532(nfcPort);
nfcReader.on('ready', () => {
    console.log('NFC Reader is ready.');
    nfcReader.on('tag', (tag) => {
        const timestamp = new Date().toISOString();
        let itemFound = false;
        itemList.forEach(item => {
            if (item.UID === tag.uid) {
                item.nfcLastScanned = timestamp;
                itemFound = true;
            }
        });
        if (itemFound) {
            saveItemList();
            broadcast({ type: 'item-list-update', payload: itemList });
        }
        broadcast({ type: 'nfc-tag-scanned', uid: tag.uid });
    });
});
nfcPort.on('error', (err) => console.error(`NFC Port Error: ${err.message}`));

// --- WebSocket Server ---
wss.on('connection', ws => {
    console.log('Client connected');
    ws.send(JSON.stringify({ type: 'item-list-update', payload: itemList }));

    ws.on('message', message => {
        const data = JSON.parse(message);
        handleWsMessage(data, ws);
    });

    ws.on('close', () => console.log('Client disconnected'));
});

// --- Main Logic ---
initializeItemList();

function handleWsMessage(data, ws) {
    if (data.command.startsWith('rfid-') && rfidAutoModeState !== 2) {
        ws.send(JSON.stringify({ type: 'rfid-error', message: 'RFID reader is not ready. Please wait.' }));
        return;
    }

    switch (data.command) {
        case 'register-item':
            const existingIndex = itemList.findIndex(item => item.ID === data.payload.ID);
            const newItem = { ...data.payload, rfidLastScanned: '', nfcLastScanned: '' };
            if (existingIndex > -1) {
                itemList[existingIndex] = { ...itemList[existingIndex], ...data.payload };
            } else {
                itemList.push(newItem);
            }
            saveItemList();
            broadcast({ type: 'item-list-update', payload: itemList });
            break;
        case 'rfid-start':
            currentRfidMode = 'inventory';
            sendRfidCommand(Buffer.from(Constants.HEX_SCAN_START, 'hex'));
            break;
        case 'read-rfid-tag':
            currentRfidMode = 'read-rfid-tag';
            sendRfidCommand(Buffer.from(Constants.HEX_SCAN_START, 'hex'));
            break;
        case 'rfid-stop':
            sendRfidCommand(Buffer.from(Constants.HEX_SCAN_STOP, 'hex'));
            break;
        case 'upload-item-list':
            const lines = data.payload.trim().split('\n').slice(1);
            itemList = lines.map(line => {
                const [ID, EPC, UID, rfidLastScanned, nfcLastScanned, Item, description] = line.split(',');
                return { ID, EPC, UID, rfidLastScanned, nfcLastScanned, Item, description };
            });
            saveItemList();
            broadcast({ type: 'item-list-update', payload: itemList });
            break;
    }
}

// --- RFID Functions ---
function startRfidInitialization() {
    console.log('Starting RFID reader initialization...');
    sendRfidCommand(Buffer.from(Constants.HEX_START_APP, 'hex'));
    rfidAutoModeState = 1;
    setTimeout(() => {
        if (rfidAutoModeState === 1) {
            console.log('RFID start command timed out, checking stage...');
            sendRfidCommand(Buffer.from(Constants.HEX_GET_RUNNING_STAGE, 'hex'));
        }
    }, 2000);
}

function handleRfidData(data) {
    rfidPacketBuffer = Buffer.concat([rfidPacketBuffer, data]);
    while (rfidPacketBuffer.length >= 5) {
        if (rfidPacketBuffer[0] !== Constants.HEADER_BYTE) {
            rfidPacketBuffer = rfidPacketBuffer.slice(1);
            continue;
        }
        const dataLength = rfidPacketBuffer[1];
        const totalPacketLength = 1 + 1 + 1 + 2 + dataLength + 2;
        if (rfidPacketBuffer.length < totalPacketLength) break;
        const packet = rfidPacketBuffer.slice(0, totalPacketLength);
        parseRfidResponse(packet);
        rfidPacketBuffer = rfidPacketBuffer.slice(totalPacketLength);
    }
}

function parseRfidResponse(buffer) {
    const commandCode = buffer[2];
    const payload = buffer.slice(5, 5 + buffer[1]);

    if (commandCode === Constants.CMD_START_APP || (commandCode === Constants.CMD_GET_RUNNING_STAGE && payload[0] === Constants.STAGE_APP)) {
        rfidAutoModeState = 2;
        console.log('RFID Reader is in application mode and ready.');
    } else if (commandCode === Constants.CMD_GET_RUNNING_STAGE && payload[0] === Constants.STAGE_BOOTLOADER) {
        console.log('RFID reader in bootloader mode, attempting to switch.');
        startRfidInitialization();
    }

    if (isScanningRFID && (commandCode === Constants.CMD_RFID_INVENTORY || commandCode === Constants.CMD_MULTI_TAG_INVENTORY)) {
        const epcData = payload.slice(5, payload.length - 2);
        const epcHex = epcData.toString('hex').toUpperCase();
        if (currentRfidMode === 'read-rfid-tag') {
            broadcast({ type: 'rfid-tag-scanned', epc: epcHex });
        } else {
            const timestamp = new Date().toISOString();
            let updated = false;
            itemList.forEach(item => {
                if (item.EPC === epcHex) {
                    item.rfidLastScanned = timestamp;
                    updated = true;
                }
            });
            if (updated) {
                saveItemList();
                broadcast({ type: 'item-list-update', payload: itemList });
            }
        }
    }
}

function sendRfidCommand(data) {
    const crcCalculator = new CRC();
    const calculatedCrc = crcCalculator.calculate(data.slice(1));
    const crcBuffer = Buffer.alloc(2);
    crcBuffer.writeUInt16BE(calculatedCrc);
    const packetToSend = Buffer.concat([data, crcBuffer]);
    rfidPort.write(packetToSend);
    isScanningRFID = data.toString('hex').startsWith(Constants.HEX_SCAN_START);
}

// --- Utility Functions ---
function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === client.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}
class CRC {
  constructor(p=0x1021, i=0xFFFF){this.poly_value=p;this.init_value=i;this.value=0;this.reset();}
  reset(){this.value=this.init_value;}
  crc8(v){let x,b,d=0x80;for(let i=0;i<8;i++){x=this.value&0x8000;this.value=(this.value<<1)&0xFFFF;b=((v&d)===d);this.value|=b;if(x){this.value^=this.poly_value;}d>>=1;}}
  calculate(d){this.reset();for(const b of d){this.crc8(b);}return this.value;}
}

// --- Express Routes ---
app.use(express.static('web-app'));
app.get('/download-inventory', (req, res) => {
    if (fs.existsSync(itemListPath)) {
        res.download(itemListPath);
    } else {
        res.status(404).send("Item list file not found.");
    }
});

