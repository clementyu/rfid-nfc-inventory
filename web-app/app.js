document.addEventListener('DOMContentLoaded', () => {
    const ws = new WebSocket(`ws://${window.location.host}`);

    // NFC Elements
    const titleInput = document.getElementById('title');
    const authorInput = document.getElementById('author');
    const publisherInput = document.getElementById('publisher');
    const registerBtn = document.getElementById('register-btn');
    const checkInBtn = document.getElementById('check-in-btn');
    const checkOutBtn = document.getElementById('check-out-btn');
    const downloadBtn = document.getElementById('download-btn');
    const scannedTagP = document.getElementById('scanned-tag');
    const bookListBody = document.getElementById('book-list-body');
    let lastScannedUid = null;
    let currentBookListData = '';

    // RFID Elements
    const connectionStatus = document.getElementById('connection-status');
    const scanningStatus = document.getElementById('scanning-status');
    const rfidStartBtn = document.getElementById('rfid-start-btn');
    const rfidReadTagBtn = document.getElementById('rfid-read-tag-btn');
    const rfidStopBtn = document.getElementById('rfid-stop-btn');
    const importBtn = document.getElementById('import-btn');
    const importFileInput = document.getElementById('import-file');
    const exportBtn = document.getElementById('export-btn');
    const lastScannedEpc = document.getElementById('last-scanned-epc');
    const readTagContainer = document.querySelector('.read-tag-container');
    const itemSummaryTableBody = document.getElementById('item-summary-table-body');
    const epcTableBody = document.getElementById('epc-table-body');
    let inventoryData = [];

    ws.onopen = () => {
        connectionStatus.textContent = 'Connected';
        connectionStatus.classList.remove('disconnected');
        connectionStatus.classList.add('connected');
    };

    ws.onmessage = event => {
        const message = JSON.parse(event.data);
        switch (message.type) {
            case 'nfc-tag':
                handleNfcTag(message);
                break;
            case 'nfc-book-list':
                currentBookListData = message.data;
                displayBookList(currentBookListData);
                break;
            case 'rfid-initial-inventory':
                inventoryData = message.payload.map(item => ({...item, count: 0, timestamp: null}));
                renderRfidTables();
                break;
            case 'rfid-update':
                readTagContainer.classList.remove('visible');
                handleRfidUpdate(message.payload);
                break;
            case 'rfid-single-tag':
                lastScannedEpc.textContent = message.epc;
                readTagContainer.classList.add('visible');
                break;
        }
    };
    
    ws.onclose = () => {
        connectionStatus.textContent = 'Disconnected';
        connectionStatus.classList.remove('connected');
        connectionStatus.classList.add('disconnected');
    };

    // NFC Event Listeners
    registerBtn.addEventListener('click', () => {
        const book = {
            uid: lastScannedUid,
            title: titleInput.value,
            author: authorInput.value,
            publisher: publisherInput.value,
        };
        if (book.uid && book.title) {
            ws.send(JSON.stringify({ command: 'register', payload: book }));
        }
    });
    checkInBtn.addEventListener('click', () => {
        if (lastScannedUid) ws.send(JSON.stringify({ command: 'check-in', uid: lastScannedUid }));
    });
    checkOutBtn.addEventListener('click', () => {
        if (lastScannedUid) ws.send(JSON.stringify({ command: 'check-out', uid: lastScannedUid }));
    });
    downloadBtn.addEventListener('click', () => {
         const blob = new Blob([currentBookListData], { type: 'text/tab-separated-values' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'books.tsv';
        a.click();
        URL.revokeObjectURL(url);
    });

    // RFID Event Listeners
    rfidStartBtn.addEventListener('click', () => {
        scanningStatus.textContent = 'Scanning';
        scanningStatus.classList.remove('idle');
        scanningStatus.classList.add('scanning');
        readTagContainer.classList.remove('visible');
        ws.send(JSON.stringify({ command: 'rfid-start' }));
    });
    rfidReadTagBtn.addEventListener('click', () => {
        scanningStatus.textContent = 'Scanning';
        scanningStatus.classList.remove('idle');
        scanningStatus.classList.add('scanning');
        lastScannedEpc.textContent = 'Scanning...';
        readTagContainer.classList.add('visible');
        ws.send(JSON.stringify({ command: 'rfid-read-tag' }));
    });

    rfidStopBtn.addEventListener('click', () => {
        scanningStatus.textContent = 'Idle';
        scanningStatus.classList.remove('scanning');
        scanningStatus.classList.add('idle');
        ws.send(JSON.stringify({ command: 'rfid-stop' }));
    });
    importBtn.addEventListener('click', () => {
        importFileInput.click();
    });
    importFileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            ws.send(JSON.stringify({ command: 'upload_inventory', payload: e.target.result }));
        };
        reader.readAsText(file);
        event.target.value = null;
    });

    exportBtn.addEventListener('click', () => {
        window.location.href = '/download-inventory';
    });


    // NFC Functions
    function handleNfcTag(message) {
        lastScannedUid = message.uid;
        scannedTagP.innerHTML = `<strong>Title:</strong> ${message.title} <br> <strong>UID:</strong> ${lastScannedUid} <br> <strong>Status:</strong> ${message.status}`;
    }

    function displayBookList(data) {
        bookListBody.innerHTML = '';
        const rows = data.trim().split('\n').slice(1);
        rows.forEach(row => {
            const columns = row.split('\t');
            const tr = document.createElement('tr');
            columns.forEach(col => {
                const td = document.createElement('td');
                td.textContent = col;
                tr.appendChild(td);
            });
            bookListBody.appendChild(tr);
        });
    }

    // RFID Functions
    function handleRfidUpdate(updates) {
        updates.forEach(update => {
            const existingItem = inventoryData.find(item => item.epc === update.epc);
            if (existingItem) {
                existingItem.count = update.count;
                existingItem.timestamp = update.timestamp;
            } else {
                inventoryData.push(update);
            }
        });
        renderRfidTables();
    }

    function renderRfidTables() {
        const itemSummary = new Map();
        inventoryData.forEach(item => {
             if (item.count > 0) {
                const currentItemSummary = itemSummary.get(item.item) || { count: 0, lastScanned: null };
                currentItemSummary.count++;
                if (!currentItemSummary.lastScanned || item.timestamp > currentItemSummary.lastScanned) {
                    currentItemSummary.lastScanned = item.timestamp;
                }
                itemSummary.set(item.item, currentItemSummary);
             }
        });

        itemSummaryTableBody.innerHTML = '';
        itemSummary.forEach((data, item) => {
            const row = itemSummaryTableBody.insertRow();
            row.insertCell().textContent = data.count;
            row.insertCell().textContent = item;
            row.insertCell().textContent = data.lastScanned ? new Date(data.lastScanned).toLocaleTimeString() : 'N/A';
        });

        epcTableBody.innerHTML = '';
        inventoryData.forEach(item => {
            const row = epcTableBody.insertRow();
            row.innerHTML = `
                <td>${item.id}</td>
                <td>${item.epc}</td>
                <td>${item.item}</td>
                <td>${item.count || 0}</td>
                <td>${item.timestamp ? new Date(item.timestamp).toLocaleTimeString() : 'N/A'}</td>
            `;
        });
    }
});
