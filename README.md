# **Combined RFID/NFC Management System**

This project integrates two distinct functionalities into a single, web-based application: an RFID inventory tracking system and an NFC-based library management system. The unified interface allows for seamless management of both RFID-tagged items and NFC-tagged books.

## **Features**

  * **Dual-Reader Support**: Connects to both an RFID and an NFC reader simultaneously via separate serial ports.
  * **Unified Web Interface**: A single webpage provides distinct sections for managing RFID inventory and the NFC library.
  * **Real-Time Updates**: Both systems use WebSockets to deliver instant updates to all connected clients.
  * **Data Export**: Supports downloading inventory lists and book databases directly from the browser.

### **RFID Inventory**

  * **Inventory Mode**: Filters scanned tags against a predefined inventory list from a CSV file.
  * **Item Summaries**: Displays real-time counts and last-scanned timestamps for each item type.
  * **Detailed EPC Tracking**: Lists all unique EPCs, their scan counts, and last-seen times.

### **NFC Library Management**

  * **Book Registration**: Add new books to the library by scanning an NFC tag and entering details.
  * **Check-In/Check-Out**: Easily update a book's status with a simple tag scan.
  * **Live Scan Display**: Shows the title, UID, and status of the most recently scanned book tag.

-----

## **Hardware Requirements**

  * Raspberry Pi 4
  * An RFID reader module (e.g., model SLR1100) and UHF RFID tags
  * PN532 NFC Reader Module and NFC Tags (e.g., NTAG215)
  * USB to Serial (UART) adapter for the NFC reader

-----

## **Software Setup**

1.  **Install Raspberry Pi Imager**: Download and install the [Raspberry Pi Imager](https://www.raspberrypi.com/software/) on your computer.

2.  **Flash the OS Image**: Use the imager to flash **Raspberry Pi OS (64-bit)** onto your microSD card. Before writing, configure the OS to:

      * Set a hostname (e.g., `rfid-nfc-inventory.local`).
      * Configure your Wi-Fi SSID and password.

3.  **Boot the Pi**: Insert the microSD card and power on the Raspberry Pi.

4.  **Login to the Pi**: Connect to your Raspberry Pi via SSH using the hostname you configured (the default password is `raspberry`).

    ```bash
    # Run this command on your host PC
    ssh pi@rfid-nfc-inventory.local
    ```

5.  **Enable the Serial Port Hardware:**

      * Open the Raspberry Pi Configuration tool:

        ```bash
        # Run this command on your Raspberry Pi
        sudo raspi-config
        ```

      * Navigate to **3 Interface Options** -\> **I6 Serial Port**.

      * When asked "Would you like a login shell to be accessible over serial?", select **No**.

      * When asked "Would you like the serial port hardware to be enabled?", select **Yes**.

      * Select **Finish** and reboot when prompted.

### **Setup the software on Raspberry Pi 4**

First, clone the code with the following command:

```bash
git clone https://github.com/clementyu/rfid-nfc-inventory.git
```

After cloning, navigate to the project directory:

```bash
cd rfid-nfc-inventory
```

Next, install **nvm (Node Version Manager)** to manage your Node.js versions.

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
```

After installation, reload your terminal. Then, install Node.js v22 and set it as the default.

```bash
nvm install 22
nvm use 22
```

Finally, install the required npm packages:

```bash
npm install
```

-----

## **Running the Application**

To start the application, run the `index.js` file with Node.js, specifying the correct serial ports for your RFID and NFC readers.

```bash
node index.js --rfid-port /dev/ttyS0 --nfc-port /dev/ttyUSB0 --inventory=./work/inventory.csv
```

The web interface will be available at `http://rfid-nfc-inventory.local:8080` .