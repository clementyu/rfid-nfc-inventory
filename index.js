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
    .option('rfid-port', {
        alias: 'rp',
        type: 'string',
        describe: 'Serial port for the RFID reader',
        default: '/dev/ttyS0'
    })
    .option('rfid-baudrate', {
        alias: 'rb',
        type: 'number',
        describe: 'Baud rate for the RFID serial connection',
        default: 115200
    })
    .option('nfc-port', {
        alias: 'np',
        type: 'string',
        describe: 'Serial port for the NFC reader',
        default: '/dev/tty.usbserial-210'
    })
    .option('nfc-baudrate', {
        alias: 'nb',
        type: 'number',
        describe: 'Baud rate for the NFC serial connection',
        default: 115200
    })
    .option('inventory', {
        alias: 'i',
        type: 'string',
        describe: 'Path to the inventory CSV file for RFID.',
    })
    .option('refresh-period', {
        alias: 'r',
        type: 'number',
        default: 5,
        describe: 'Time interval in seconds for updating the log on the web page.'
    })
    .help()
    .argv;

const app = express();
const server = app.listen(process.env.PORT || 8080, () => {
    console.log(`Web server is listening on port ${process.env.PORT || 8080}`);
});

const wss = new WebSocketServer({ server });

// --- RFID Constants and State ---
const Constants = {
    HEADER_BYTE: 0xFF,
    CMD_START_APP: 0x04,
    CMD_GET_RUNNING_STAGE: 0x0C,
    CMD_RFID_INVENTORY: 0x21,
    CMD_MULTI_TAG_INVENTORY: 0xAA,
    STAGE_BOOTLOADER: 0x11,
    STAGE_APP: 0x12,
    STATUS_SUCCESS: 0x0000,
    HEX_START_APP: 'ff00041d0b',
    HEX_GET_RUNNING_STAGE: 'ff000c1d03',
    HEX_SCAN_START: 'ff13aa4d6f64756c6574656368aa480000000000f2bbe1cb',
    HEX_SCAN_STOP: 'ff0eaa4d6f64756c6574656368aa49f3bb',
};
let rfidPacketBuffer = Buffer.alloc(0);
let isScanningRFID = false;
let currentRfidMode = 'inventory'; // 'inventory' or 'read-tag'
let rfidAutoModeState = 0; // 0: initial, 1: start_app sent, 2: ready
const scannedTagsCumulative = new Map();
const inventoryData = new Map();


// --- NFC Constants and State ---
const booksDbPath = path.join(__dirname, 'work', 'books.tsv');
const DB_HEADER = 'UID\tTitle\tAuthor\tPublisher\tStatus\tLastUpdated\n';
if (!fs.existsSync(path.dirname(booksDbPath))) {
    fs.mkdirSync(path.dirname(booksDbPath));
}
if (!fs.existsSync(booksDbPath)) {
    fs.writeFileSync(booksDbPath, DB_HEADER);
}


// --- RFID Reader Setup ---
const rfidPort = new SerialPort({ path: argv.rfidPort, baudRate: argv.rfidBaudrate });

rfidPort.on('open', () => {
    console.log(`RFID Reader connected on port: ${argv.rfidPort}`);
    if (argv.inventory) {
        loadInventory(argv.inventory);
    }
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
        const book = findBookByUid(tag.uid);
        const title = book ? book.title : 'Unregistered Item';
        const status = book ? book.status : 'N/A';
        broadcast({ type: 'nfc-tag', uid: tag.uid, title, status });
    });
});
nfcPort.on('error', (err) => console.error(`NFC Port Error: ${err.message}`));


// --- WebSocket Server ---
wss.on('connection', ws => {
    console.log('Client connected');
    sendBookList(ws); // Send initial book list for NFC
    const initialInventory = Array.from(inventoryData.values()).map(item => ({...item, count: 0, timestamp: null}));
    ws.send(JSON.stringify({ type: 'rfid-initial-inventory', payload: initialInventory }));


    ws.on('message', message => {
        const data = JSON.parse(message);
        handleWsMessage(data, ws);
    });

    ws.on('close', () => console.log('Client disconnected'));
});

function handleWsMessage(data, ws) {
    // NFC Commands
    switch (data.command) {
        case 'register':
            registerOrUpdateBook(data.payload);
            break;
        case 'check-out':
            updateBookStatus(data.uid, 'Checked-Out');
            break;
        case 'check-in':
            updateBookStatus(data.uid, 'Available');
            break;
    }

    // RFID Commands
    if (data.command.startsWith('rfid-')) {
        if (rfidAutoModeState !== 2) {
            console.log('RFID reader is not ready. Please wait.');
            ws.send(JSON.stringify({ type: 'rfid-error', message: 'Reader not ready' }));
            return;
        }
        switch (data.command) {
            case 'rfid-start':
                currentRfidMode = 'inventory';
                sendRfidCommand(Buffer.from(Constants.HEX_SCAN_START, 'hex'));
                break;
            case 'rfid-read-tag':
                currentRfidMode = 'read-tag';
                sendRfidCommand(Buffer.from(Constants.HEX_SCAN_START, 'hex'));
                break;
            case 'rfid-stop':
                sendRfidCommand(Buffer.from(Constants.HEX_SCAN_STOP, 'hex'));
                break;
            case 'upload_inventory':
                parseInventoryData(data.payload);
                const newInitialInventory = Array.from(inventoryData.values()).map(item => ({ ...item, count: 0, timestamp: null }));
                broadcast({ type: 'rfid-initial-inventory', payload: newInitialInventory });
                break;
        }
    }
}


// --- RFID Logic ---
function startRfidInitialization() {
    console.log('Starting RFID reader initialization...');
    sendRfidCommand(Buffer.from(Constants.HEX_START_APP, 'hex'), 'Attempting to start App firmware...');
    rfidAutoModeState = 1; // State: start_app sent

    setTimeout(() => {
        if (rfidAutoModeState === 1) { 
            console.log('RFID reader did not confirm app start, checking running stage...');
            sendRfidCommand(Buffer.from(Constants.HEX_GET_RUNNING_STAGE, 'hex'), 'Requesting current running stage');
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
    const statusCode = buffer.readUInt16BE(3);
    const payload = buffer.slice(5, 5 + buffer[1]);

    if (commandCode === Constants.CMD_START_APP) {
        rfidAutoModeState = 2;
        console.log('RFID Reader is in application mode and ready.');
        return;
    }
    
    if (commandCode === Constants.CMD_GET_RUNNING_STAGE) {
        const runningStage = payload[0];
        if (runningStage === Constants.STAGE_APP) {
            rfidAutoModeState = 2;
            console.log('RFID Reader is in application mode and ready.');
        } else if (runningStage === Constants.STAGE_BOOTLOADER) {
            console.log('RFID Reader is in bootloader mode. Sending command to switch to app mode...');
            rfidAutoModeState = 0;
            sendRfidCommand(Buffer.from(Constants.HEX_START_APP, 'hex'), 'Switching to App Mode');
        }
        return;
    }

    if (isScanningRFID && (commandCode === Constants.CMD_RFID_INVENTORY || commandCode === Constants.CMD_MULTI_TAG_INVENTORY) && statusCode === Constants.STATUS_SUCCESS) {
        const epcData = payload.slice(5, payload.length - 2);
        const epcHex = epcData.toString('hex').toUpperCase();

        if (currentRfidMode === 'read-tag') {
            broadcast({ type: 'rfid-single-tag', epc: epcHex });
            return;
        }

        if (argv.inventory && !inventoryData.has(epcHex)) {
            return;
        }

        const cumulativeEntry = scannedTagsCumulative.get(epcHex) || { count: 0, timestamp: '' };
        cumulativeEntry.count++;
        cumulativeEntry.timestamp = new Date().toISOString();
        scannedTagsCumulative.set(epcHex, cumulativeEntry);
        
        broadcastRfidUpdates();
    }
}
function broadcastRfidUpdates() {
    const inventoryUpdates = [];
    scannedTagsCumulative.forEach((data, epc) => {
        const item = inventoryData.get(epc);
        if (item) {
            inventoryUpdates.push({ id: item.id, timestamp: data.timestamp, epc, item: item.item, count: data.count, expiration_date: item.expiration_date });
        } else {
             inventoryUpdates.push({ id: 'N/A', timestamp: data.timestamp, epc, item: 'N/A', count: data.count, expiration_date: 'N/A' });
        }
    });

    if (inventoryUpdates.length > 0) {
        broadcast({ type: 'rfid-update', payload: inventoryUpdates });
    }
}


function sendRfidCommand(data, logMessage = '') {
    if (logMessage) console.log(logMessage);
    const crcCalculator = new CRC();
    const calculatedCrc = crcCalculator.calculate(data.slice(1));
    const crcBuffer = Buffer.alloc(2);
    crcBuffer.writeUInt16BE(calculatedCrc);
    const packetToSend = Buffer.concat([data, crcBuffer]);
    rfidPort.write(packetToSend);

     if (data.toString('hex').startsWith(Constants.HEX_SCAN_START)) {
        isScanningRFID = true;
    } else if (data.toString('hex').startsWith(Constants.HEX_SCAN_STOP)) {
        isScanningRFID = false;
    }
}

function loadInventory(filePath) {
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        parseInventoryData(data);
    } catch (err) {
        console.error('Failed to read inventory file:', err);
    }
}

function parseInventoryData(csvData) {
    inventoryData.clear();
    const lines = csvData.split('\n').filter(line => line.trim() !== '');
    if (lines.length === 0) return;
    const headers = lines[0].split(',');
    const epcIndex = headers.indexOf('EPC');
    const itemIndex = headers.indexOf('item');
    const idIndex = headers.indexOf('id');
    const expirationDateIndex = headers.indexOf('expiration_date');

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        const epc = values[epcIndex].trim();
        const item = values[itemIndex].trim();
        const id = parseInt(values[idIndex], 10);
        const expiration_date = values[expirationDateIndex] ? values[expirationDateIndex].trim() : null;
        if (epc) {
            inventoryData.set(epc, { id, epc, item, expiration_date });
        }
    }
}


// --- NFC Logic ---
function findBookByUid(uid) {
    const books = fs.readFileSync(booksDbPath, 'utf-8').split('\n');
    const bookLine = books.find(line => line.startsWith(uid));
    if (bookLine) {
        const [uid, title, author, publisher, status, lastUpdated] = bookLine.split('\t');
        return { uid, title, author, publisher, status, lastUpdated };
    }
    return null;
}

function registerOrUpdateBook(book) {
    let books = fs.readFileSync(booksDbPath, 'utf-8').split('\n').filter(line => line.trim() !== '');
    const bookIndex = books.findIndex(line => line.startsWith(book.uid));
    const bookLine = `${book.uid}\t${book.title}\t${book.author}\t${book.publisher}\tAvailable\t${new Date().toISOString()}`;

    if (bookIndex > -1 && books[bookIndex]) {
        books[bookIndex] = bookLine;
    } else {
        books.push(bookLine);
    }
    fs.writeFileSync(booksDbPath, books.join('\n') + '\n');
    broadcastBookList();
}

function updateBookStatus(uid, status) {
    let books = fs.readFileSync(booksDbPath, 'utf-8').split('\n').filter(line => line.trim() !== '');
    const bookIndex = books.findIndex(line => line.startsWith(uid));

    if (bookIndex > -1 && books[bookIndex]) {
        let bookData = books[bookIndex].split('\t');
        bookData[4] = status;
        bookData[5] = new Date().toISOString();
        books[bookIndex] = bookData.join('\t');
        fs.writeFileSync(booksDbPath, books.join('\n') + '\n');
        broadcastBookList();
    }
}

function sendBookList(ws) {
    const books = fs.readFileSync(booksDbPath, 'utf-8');
    ws.send(JSON.stringify({ type: 'nfc-book-list', data: books }));
}

function broadcastBookList() {
    const books = fs.readFileSync(booksDbPath, 'utf-8');
    broadcast({ type: 'nfc-book-list', data: books });
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
  constructor(poly_value = 0x1021, init_value = 0xFFFF) {
    this.init_value = init_value;
    this.poly_value = poly_value;
    this.value = 0;
    this.reset();
  }
  reset() { this.value = this.init_value; }
  crc8(v) {
    let xorFlag = 0;
    let bit = 0;
    let dcdBitMask = 0x80;
    for (let i = 0; i < 8; i++) {
      xorFlag = this.value & 0x8000;
      this.value = (this.value << 1) & 0xFFFF;
      bit = ((v & dcdBitMask) === dcdBitMask);
      this.value = this.value | bit;
      if (xorFlag > 0) {
        this.value = this.value ^ this.poly_value;
      }
      dcdBitMask = dcdBitMask >> 1;
    }
  }
  calculate(data) {
    this.reset();
    for (const b of data) { this.crc8(b); }
    return this.value;
  }
}


app.use(express.static('web-app'));
app.get('/download-inventory', (req, res) => {
    const filePath = argv.inventory;
    if(filePath && fs.existsSync(filePath)) {
        res.download(filePath);
    } else {
        res.status(404).send("Inventory file not found.");
    }
});

