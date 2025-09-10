# UART Echo Test on Raspberry Pi 4 TX0 and RX0

Of course. You can perform a UART echo test on a Raspberry Pi 4 using the `serialport` library in Node.js. The following guide provides the necessary setup and a complete code sample.

The core idea is to physically connect the transmit pin (TXD0) to the receive pin (RXD0). This creates a loopback, so any data your Node.js script sends out through the UART's transmit line is immediately received on its own receive line.

-----

## Prerequisites & Configuration

Before running the code, you need to configure your Raspberry Pi to free up the primary UART port. By default, it's often used for the Linux serial console.

### Hardware

  * **Raspberry Pi 4**
  * **1x Jumper Wire** (Female-to-Female)

### Software Configuration

1.  **Enable the Serial Port Hardware:**

      * Open the Raspberry Pi Configuration tool from the terminal:
        ```bash
        sudo raspi-config
        ```
      * Navigate to **3 Interface Options** -\> **I6 Serial Port**.
      * When asked "Would you like a login shell to be accessible over serial?", select **No**.
      * When asked "Would you like the serial port hardware to be enabled?", select **Yes**.
      * Select **Finish** and reboot your Raspberry Pi when prompted.

2.  **Install Node.js & npm:**
    If you don't have them installed, you can use NodeSource:

    ```bash
    # Downloads and executes the NodeSource setup script for Node.js 20.x
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    # Installs Node.js and npm
    sudo apt-get install -y nodejs
    ```

-----

## Physical Setup & Code Installation

### Wiring

Connect **GPIO14 (TXD0)** to **GPIO15 (RXD0)** using a single jumper wire. This is the physical loop that will create the echo.

### Node.js Library Installation

cd to this folder and install the `serialport` library.

```bash
cd /home/pi/smart-fridge/test/
npm init -y
npm install serialport
```

-----

## Execution and Expected Output

Run the script from your terminal. You might need to use `sudo` if your user doesn't have permissions to access the serial port.

```bash
node echo.js
# Or, if you get a permission error:
sudo node echo.js
```

You should see output similar to this, demonstrating that the messages you send are being received (echoed) back:

```
✅ Serial port /dev/serial0 opened successfully.

🚀 Sending initial message: "Hello from Pi! The time is 8:34:00 AM"
⬅️  Data received: "Hello from Pi! The time is 8:34:00 AM"
➡️  Echo sent.
⬅️  Data received: "Echoing back: Hello from Pi! The time is 8:34:00 AM"
➡️  Echo sent.

🚀 Sending initial message: "Hello from Pi! The time is 8:34:05 AM"
⬅️  Data received: "Hello from Pi! The time is 8:34:05 AM"
➡️  Echo sent.
⬅️  Data received: "Echoing back: Hello from Pi! The time is 8:34:05 AM"
➡️  Echo sent.
```

This confirms that your UART transmit and receive functions are working correctly.