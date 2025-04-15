import { Buffer } from 'buffer';

let coordinates = { latitude: null, longitude: null }

export const getCoordinates = async (request, response) => {
    response.json(coordinates)
}

export const gpsData = async (request, response) => {
    if (datos) {
        res.json({ data: datos.toString('hex') }) // Devuelve los datos en formato hexadecimal
    } else {
        res.status(404).json({ error: 'No se han recibido datos de GPS.' })
    }
}

export const setCoordinates = async (request, response) => {
    const { latitude, longitude } = req.body
    coordinates = { latitude, longitude }
    res.json({ message: 'Coordenadas guardadas correctamente', coordinates })
}

export const decodeData = async (request, response) => {
    const { hexData } = request.body;
    try {
        const decodedData = parseRuptelaPacketWithExtensions(hexData);
        response.status(200).json({ success: true, data: decodedData });
    } catch (error) {
        response.status(400).json({ success: false, error: error.message });
    }
};

export const parseRuptelaPacketWithExtensions = (hexData) => {
    const buffer = Buffer.from(hexData, 'hex');

    // Step 1: Extract Packet Length (2 bytes)
    const packetLength = buffer.readUInt16BE(0);
    const expectedLength = buffer.length - 4; // Exclude CRC (2 bytes at the end)
    if (packetLength !== expectedLength) {
        throw new Error(`Packet length mismatch: ${packetLength} vs ${expectedLength}`);
    }

    // Step 2: Extract IMEI (8 bytes)
    const imeiBuffer = buffer.slice(2, 10);
    const imei = imeiBuffer.readBigUInt64BE().toString(); // Leer como un entero de 8 bytes

    // Step 3: Extract Command ID (1 byte)
    const commandId = buffer.readUInt8(10);

    // Step 4: Extract Payload
    const payloadStart = 11;
    const payloadEnd = buffer.length - 2;
    const payload = buffer.slice(payloadStart, payloadEnd);

    // Step 5: Parse Payload
    let offset = 0;
    const recordsLeft = payload.readUInt8(offset++);
    const numRecords = payload.readUInt8(offset++);
    const records = [];

    for (let recordIndex = 0; recordIndex < numRecords; recordIndex++) {
        if (offset + 25 > payload.length) throw new Error('Insufficient data for record header');

        const record = { recordIndex };

        // Record Header Parsing
        record.timestamp = new Date(payload.readUInt32BE(offset) * 1000);
        offset += 4;
        record.timestampExtension = payload.readUInt8(offset++);
        record.recordExtension = payload.readUInt8(offset++);
        record.priority = payload.readUInt8(offset++);
        record.longitude = payload.readInt32BE(offset) / 10_000_000;
        offset += 4;
        record.latitude = payload.readInt32BE(offset) / 10_000_000;
        offset += 4;
        record.altitude = payload.readUInt16BE(offset) / 10;
        offset += 2;
        record.angle = payload.readUInt16BE(offset) / 100;
        offset += 2;
        record.satellites = payload.readUInt8(offset++);
        record.speed = payload.readUInt16BE(offset);
        offset += 2;
        record.hdop = payload.readUInt8(offset++) / 10;
        record.eventId = payload.readUInt16BE(offset);
        offset += 2;

        // IO Elements Parsing
        const ioElements = {};
        [1, 2, 4, 8].forEach((size) => {
            if (offset >= payload.length) throw new Error('Unexpected end of payload while parsing IO elements');

            const count = payload.readUInt8(offset++);
            ioElements[size] = {};

            for (let i = 0; i < count; i++) {
                const ioId = payload.readUInt16BE(offset);
                offset += 2;
                let value;
                if (size === 1) {
                    value = payload.readUInt8(offset);
                    offset += 1;
                } else if (size === 2) {
                    value = payload.readUInt16BE(offset);
                    offset += 2;
                } else if (size === 4) {
                    value = payload.readUInt32BE(offset);
                    offset += 4;
                } else if (size === 8) {
                    value = Number(BigInt(payload.readBigUInt64BE(offset)));
                    offset += 8;
                }
                ioElements[size][ioId] = value;
            }
        });

        record.ioElements = ioElements;
        records.push(record);
    }

    // Step 6: Extract CRC (2 bytes at the end)
    const receivedCrc = buffer.readUInt16BE(buffer.length - 2);

    return {
        packetLength,
        imei,
        commandId,
        recordsLeft,
        numberOfRecords: numRecords,
        records,
        crc: receivedCrc,
        remainingPayloadOffset: offset, // Add debug info
    };
};