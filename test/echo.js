// Import the necessary classes from the serialport library
const { SerialPort, ReadlineParser } = require('serialport');

// On Raspberry Pi 4, the primary hardware UART is typically /dev/ttyS0.
// /dev/serial0 is a stable symbolic link to the primary UART.
const portPath = '/dev/serial0';

// Create a new SerialPort instance
const port = new SerialPort({
  path: portPath,
  baudRate: 9600, // Baud rate must match on both ends, but here it's the same device
});

// Create a parser to read data line by line
const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

// --- Event Listeners ---

// 1. Fired when the port is successfully opened
port.on('open', () => {
  console.log(`✅ Serial port ${portPath} opened successfully.`);
});

// 2. The core of the echo test: Fired when data is received
parser.on('data', (data) => {
  // We received data from the serial port (which we sent ourselves via the loopback)
  console.log(`⬅️  Data received: "${data}"`);
  
  // Echo the received data back to the serial port
  const echoMessage = `Echoing back: ${data}\n`;
  port.write(echoMessage, (err) => {
    if (err) {
      return console.log('Error on write: ', err.message);
    }
    console.log(`➡️  Echo sent.`);
  });
});

// 3. Fired on any error
port.on('error', (err) => {
  console.error('❌ Error: ', err.message);
  console.log('\nIs the serial port enabled? Run "sudo raspi-config"');
  console.log('Do you have the correct permissions? Try running with "sudo".');
});


// --- Sending Test Data ---

// Function to send a test message to initiate the echo
function sendTestData() {
  const message = `Hello from Pi! The time is ${new Date().toLocaleTimeString()}\n`;
  console.log(`\n🚀 Sending initial message: "${message.trim()}"`);
  port.write(message);
}

// Send a message every 5 seconds to keep the test running
setInterval(sendTestData, 5000);