// ruptela.js
import { Buffer } from 'buffer';

let coordinates = { latitude: null, longitude: null }

export const getCoordinates = async (request, response) => {
    response.json(coordinates)
}

export const gpsData = async (request, response) => {
    if (datos) {
        response.json({ data: datos.toString('hex') }) // Devuelve los datos en formato hexadecimal
    } else {
        response.status(404).json({ error: 'No se han recibido datos de GPS.' })
    }
}

export const setCoordinates = async (request, response) => {
    const { latitude, longitude } = request.body
    coordinates = { latitude, longitude }
    response.json({ message: 'Coordenadas guardadas correctamente', coordinates })
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
    const imei = imeiBuffer.readBigUInt64BE().toString();

    // Step 3: Extract Command ID (1 byte) - IMPORTANTE PARA ACK
    const commandId = buffer.readUInt8(10);

    // Step 4: Extract Payload
    const payloadStart = 11;
    const payloadEnd = buffer.length - 2;
    const payload = buffer.slice(payloadStart, payloadEnd);

    // Manejar diferentes tipos de comandos
    if (commandId === 15) { // Identification packet
        console.log(`[PARSER] Paquete de identificación recibido de IMEI: ${imei}`);
        
        // Para paquetes de identificación, parsear el payload específico
        if (payload.length >= 37) {
            const deviceType = payload.slice(0, 4).toString('ascii');
            const firmwareVersion = payload.slice(4, 15).toString('ascii');
            const imsiBuffer = payload.slice(15, 23);
            const imsi = imsiBuffer.readBigUInt64BE().toString();
            const gsmOperator = payload.readUInt32BE(23);
            const distanceCoeff = payload.readUInt32BE(27);
            const timeCoeff = payload.readUInt32BE(31);
            const angleCoeff = payload.readUInt16BE(35);
            
            return {
                packetLength,
                imei,
                commandId,
                type: 'identification',
                deviceType,
                firmwareVersion,
                imsi,
                gsmOperator,
                distanceCoeff,
                timeCoeff,
                angleCoeff,
                crc: buffer.readUInt16BE(buffer.length - 2)
            };
        }
        
        return {
            packetLength,
            imei,
            commandId,
            type: 'identification',
            payload: payload,
            crc: buffer.readUInt16BE(buffer.length - 2)
        };
    }
    
    if (commandId === 16) { // Heartbeat
        console.log(`[PARSER] Heartbeat recibido de IMEI: ${imei}`);
        return {
            packetLength,
            imei,
            commandId,
            type: 'heartbeat',
            crc: buffer.readUInt16BE(buffer.length - 2)
        };
    }

    if (commandId === 18) { // Dynamic identification packet
        console.log(`[PARSER] Dynamic identification packet recibido de IMEI: ${imei}`);
        return {
            packetLength,
            imei,
            commandId,
            type: 'dynamic_identification',
            payload: payload,
            crc: buffer.readUInt16BE(buffer.length - 2)
        };
    }

    // Para comandos 1 (Records) y 68 (Extended Records)
    if (commandId === 1 || commandId === 68) {
        console.log(`[PARSER] ${commandId === 1 ? 'Records' : 'Extended Records'} recibido de IMEI: ${imei}`);
        
        // Step 5: Parse Payload para records
        let offset = 0;
        
        if (payload.length < 2) {
            throw new Error('Payload too short for records');
        }
        
        const recordsLeft = payload.readUInt8(offset++);
        const numRecords = payload.readUInt8(offset++);
        const records = [];

        console.log(`[PARSER] Procesando ${numRecords} records, ${recordsLeft} records restantes en dispositivo`);

        for (let recordIndex = 0; recordIndex < numRecords; recordIndex++) {
            // Para extended records (command 68), el header es de 25 bytes
            // Para records normales (command 1), el header es de 23 bytes
            const headerSize = commandId === 68 ? 25 : 23;
            
            if (offset + headerSize > payload.length) {
                console.warn(`[PARSER] Datos insuficientes para record ${recordIndex}, saltando...`);
                break;
            }

            const record = { recordIndex };

            // Record Header Parsing
            record.timestamp = new Date(payload.readUInt32BE(offset) * 1000);
            offset += 4;
            record.timestampExtension = payload.readUInt8(offset++);
            
            if (commandId === 68) {
                // Extended records tienen un byte adicional
                record.recordExtension = payload.readUInt8(offset++);
            }
            
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
            
            if (commandId === 68) {
                // Extended records tienen event ID de 2 bytes
                record.eventId = payload.readUInt16BE(offset);
                offset += 2;
            } else {
                // Records normales tienen event ID de 1 byte
                record.eventId = payload.readUInt8(offset++);
            }

            // IO Elements Parsing
            const ioElements = {};
            
            try {
                [1, 2, 4, 8].forEach((size) => {
                    if (offset >= payload.length) {
                        console.warn(`[PARSER] Fin inesperado de payload al parsear IO elements de tamaño ${size}`);
                        return;
                    }

                    const count = payload.readUInt8(offset++);
                    ioElements[size] = {};

                    for (let i = 0; i < count; i++) {
                        if (offset + 2 > payload.length) {
                            console.warn(`[PARSER] Datos insuficientes para IO ID`);
                            return;
                        }
                        
                        let ioId;
                        if (commandId === 68) {
                            // Extended records tienen IO ID de 2 bytes
                            ioId = payload.readUInt16BE(offset);
                            offset += 2;
                        } else {
                            // Records normales tienen IO ID de 1 byte
                            ioId = payload.readUInt8(offset++);
                        }
                        
                        if (offset + size > payload.length) {
                            console.warn(`[PARSER] Datos insuficientes para IO value de tamaño ${size}`);
                            return;
                        }
                        
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
            } catch (ioError) {
                console.warn(`[PARSER] Error parseando IO elements para record ${recordIndex}:`, ioError.message);
                // Continuar con el record sin IO elements completos
            }

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
            remainingPayloadOffset: offset,
            type: commandId === 1 ? 'records' : 'extended_records'
        };
    }

    // Para otros comandos, retornar estructura básica
    console.log(`[PARSER] Comando no manejado: ${commandId} de IMEI: ${imei}`);
    return {
        packetLength,
        imei,
        commandId,
        type: 'unknown',
        payload: payload,
        crc: buffer.readUInt16BE(buffer.length - 2)
    };
};