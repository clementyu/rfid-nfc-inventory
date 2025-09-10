document.addEventListener('DOMContentLoaded', () => {
    const ws = new WebSocket(`ws://${window.location.host}`);

    // --- Global State ---
    let itemList = [];
    let currentPage = 1;
    let rowsPerPage = 10;
    let uidScanned = false;
    let epcScanned = false;


    // --- UI Elements ---
    const connectionStatus = document.getElementById('connection-status');
    const scanningStatus = document.getElementById('scanning-status');

    // Registration
    const regIdInput = document.getElementById('reg-id');
    const regEpcInput = document.getElementById('reg-epc');
    const regUidInput = document.getElementById('reg-uid');
    const regItemInput = document.getElementById('reg-item');
    const regDescInput = document.getElementById('reg-desc');
    const registerBtn = document.getElementById('register-btn');
    const readRfidTagBtn = document.getElementById('read-rfid-tag-btn');
    const stopBtn = document.getElementById('rfid-stop-btn');

    // Item List
    const itemListBody = document.getElementById('item-list-body');
    const importBtn = document.getElementById('import-btn');
    const importFileInput = document.getElementById('import-file');
    const exportBtn = document.getElementById('export-btn');

    // Pagination
    const rowsPerPageSelect = document.getElementById('rows-per-page');
    const prevPageBtn = document.getElementById('prev-page-btn');
    const nextPageBtn = document.getElementById('next-page-btn');
    const pageInfo = document.getElementById('page-info');


    // --- WebSocket Handlers ---
    ws.onopen = () => {
        connectionStatus.textContent = 'Connected';
        connectionStatus.classList.remove('disconnected');
        connectionStatus.classList.add('connected');
    };

    ws.onmessage = event => {
        const message = JSON.parse(event.data);
        switch (message.type) {
            case 'item-list-update':
                itemList = message.payload;
                renderItemList();
                break;
            case 'nfc-tag-scanned':
                if (!uidScanned) {
                    regUidInput.value = message.uid;
                    uidScanned = true;
                }
                break;
            case 'rfid-tag-scanned':
                 if (!epcScanned) {
                    regEpcInput.value = message.epc;
                    epcScanned = true;
                }
                break;
            case 'rfid-error':
                alert(message.message);
                break;
        }
    };
    
    ws.onclose = () => {
        connectionStatus.textContent = 'Disconnected';
        connectionStatus.classList.add('disconnected');
        connectionStatus.classList.add('connected');
    };

    // --- Event Listeners ---
    registerBtn.addEventListener('click', () => {
        const item = {
            ID: regIdInput.value,
            EPC: regEpcInput.value,
            UID: regUidInput.value,
            Item: regItemInput.value,
            description: regDescInput.value,
        };
        if (item.ID && item.Item) {
            ws.send(JSON.stringify({ command: 'register-item', payload: item }));
            // Clear fields after registration
            [regIdInput, regEpcInput, regUidInput, regItemInput, regDescInput].forEach(input => input.value = '');
            uidScanned = false;
            epcScanned = false;

        } else {
            alert('Item ID and Item Name are required.');
        }
    });

    readRfidTagBtn.addEventListener('click', () => {
        epcScanned = false; // Allow new EPC to be populated
        scanningStatus.textContent = 'Scanning';
        scanningStatus.classList.remove('idle');
        scanningStatus.classList.add('scanning');
        ws.send(JSON.stringify({ command: 'read-rfid-tag' }));
    });
    
    stopBtn.addEventListener('click', () => {
        scanningStatus.textContent = 'Idle';
        scanningStatus.classList.remove('scanning');
        scanningStatus.classList.add('idle');
        ws.send(JSON.stringify({ command: 'rfid-stop' }));
    });

    importBtn.addEventListener('click', () => importFileInput.click());
    importFileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => ws.send(JSON.stringify({ command: 'upload-item-list', payload: e.target.result }));
        reader.readAsText(file);
        event.target.value = null;
    });

    exportBtn.addEventListener('click', () => window.location.href = '/download-inventory');

    rowsPerPageSelect.addEventListener('change', (e) => {
        rowsPerPage = parseInt(e.target.value, 10);
        currentPage = 1;
        renderItemList();
    });

    prevPageBtn.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderItemList();
        }
    });

    nextPageBtn.addEventListener('click', () => {
        const totalPages = Math.ceil(itemList.length / rowsPerPage);
        if (currentPage < totalPages) {
            currentPage++;
            renderItemList();
        }
    });

    // --- Rendering Functions ---
    function renderItemList() {
        itemListBody.innerHTML = '';
        const totalPages = Math.ceil(itemList.length / rowsPerPage) || 1;
        pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;

        const start = (currentPage - 1) * rowsPerPage;
        const end = start + rowsPerPage;
        const paginatedItems = itemList.slice(start, end);

        paginatedItems.forEach(item => {
            const row = itemListBody.insertRow();
            row.innerHTML = `
                <td>${item.ID || ''}</td>
                <td>${item.EPC || ''}</td>
                <td>${item.UID || ''}</td>
                <td>${item.rfidLastScanned || 'N/A'}</td>
                <td>${item.nfcLastScanned || 'N/A'}</td>
                <td>${item.Item || ''}</td>
                <td>${item.description || ''}</td>
            `;
        });
        
        prevPageBtn.disabled = currentPage === 1;
        nextPageBtn.disabled = currentPage === totalPages;
    }
});

