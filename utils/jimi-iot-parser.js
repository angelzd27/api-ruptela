// Función mejorada para manejar datos del GPS Jimi IoT LL301
// Basada en la documentación oficial del JM-LL301

import { Buffer } from 'buffer';

/**
 * Comandos específicos según la documentación JM-LL301
 */
const JIMI_COMMANDS = {
    LOGIN: 0x01,
    TIME_CALIBRATION: 0x8A,
    HEARTBEAT_STATUS: 0x23,
    HEARTBEAT: 0x36,
    GPS_LOCATION_2G: 0x22,
    GPS_LOCATION_4G: 0xA0,
    LBS_MULTI_2G: 0x28,
    LBS_MULTI_4G: 0xA1,
    WIFI_INFO_2G: 0x2C,
    WIFI_INFO_4G: 0xA2,
    ALARM_2G: 0x27,
    ALARM_4G: 0xA4,
    GPS_ADDRESS_REQUEST: 0x2A,
    ONLINE_COMMAND: 0x80,
    GENERAL_INFO: 0x94
};

/**
 * Calcula CRC16 según documentación (CRC-ITU)
 */
function calculateJimiCRC16(data) {
    const crctab16 = [
        0x0000, 0x1189, 0x2312, 0x329B, 0x4624, 0x57AD, 0x6536, 0x74BF,
        0x8C48, 0x9DC1, 0xAF5A, 0xBED3, 0xCA6C, 0xDBE5, 0xE97E, 0xF8F7,
        0x1081, 0x0108, 0x3393, 0x221A, 0x56A5, 0x472C, 0x75B7, 0x643E,
        0x9CC9, 0x8D40, 0xBFDB, 0xAE52, 0xDAED, 0xCB64, 0xF9FF, 0xE876,
        0x2102, 0x308B, 0x0210, 0x1399, 0x6726, 0x76AF, 0x4434, 0x55BD,
        0xAD4A, 0xBCC3, 0x8E58, 0x9FD1, 0xEB6E, 0xFAE7, 0xC87C, 0xD9F5,
        0x3183, 0x200A, 0x1291, 0x0318, 0x77A7, 0x662E, 0x54B5, 0x453C,
        0xBDCB, 0xAC42, 0x9ED9, 0x8F50, 0xFBEF, 0xEA66, 0xD8FD, 0xC974
    ];

    let fcs = 0xFFFF;
    for (let i = 0; i < data.length; i++) {
        fcs = (fcs >>> 8) ^ crctab16[(fcs ^ data[i]) & 0xFF];
    }
    return (~fcs) & 0xFFFF;
}

/**
 * Crea respuesta ACK según protocolo específico
 */
function createJimiACK(protocolNumber, serialNumber, isPositive = true) {
    const buffer = Buffer.alloc(10);

    // Start flag
    buffer.writeUInt16BE(0x7878, 0);

    // Length (5 bytes de datos)
    buffer.writeUInt8(0x05, 2);

    // Protocol number (mismo que recibido para LOGIN, otros usan número específico)
    if (protocolNumber === JIMI_COMMANDS.LOGIN) {
        buffer.writeUInt8(0x01, 3); // Respuesta de login usa 0x01
    } else {
        buffer.writeUInt8(protocolNumber, 3);
    }

    // Serial number - SIEMPRE usar el serial number recibido
    buffer.writeUInt16BE(serialNumber, 4);

    // Calcular CRC16
    const dataForCRC = buffer.slice(2, 6);
    const crc = calculateJimiCRC16(dataForCRC);
    buffer.writeUInt16BE(crc, 6);

    // End flag
    buffer.writeUInt16BE(0x0D0A, 8);

    return buffer;
}

/**
 * Envía comando de solicitud de ubicación GPS
 */
function requestGPSLocation(socket, serialNumber = 1) {
    const buffer = Buffer.alloc(10);

    // Start flag
    buffer.writeUInt16BE(0x7878, 0);

    // Length
    buffer.writeUInt8(0x05, 2);

    // Protocol 0x80 - Online command (según documentación)
    buffer.writeUInt8(JIMI_COMMANDS.ONLINE_COMMAND, 3);

    // Serial number
    buffer.writeUInt16BE(serialNumber, 4);

    // CRC
    const dataForCRC = buffer.slice(2, 6);
    const crc = calculateJimiCRC16(dataForCRC);
    buffer.writeUInt16BE(crc, 6);

    // End flag
    buffer.writeUInt16BE(0x0D0A, 8);

    socket.write(buffer);
    console.log(`[JIMI LL301] 📍 Solicitando ubicación GPS - Buffer: ${buffer.toString('hex').toUpperCase()}`);
    return true;
}

/**
 * Envía calibración de tiempo (CRÍTICO según documentación)
 */
function sendTimeCalibration(socket, serialNumber = 1) {
    const buffer = Buffer.alloc(16);

    // Start flag
    buffer.writeUInt16BE(0x7878, 0);

    // Length
    buffer.writeUInt8(0x0B, 2);

    // Protocol 0x8A - Time calibration
    buffer.writeUInt8(JIMI_COMMANDS.TIME_CALIBRATION, 3);

    // UTC time (6 bytes: YY MM DD HH MM SS)
    const now = new Date();
    buffer.writeUInt8(now.getFullYear() - 2000, 4);
    buffer.writeUInt8(now.getMonth() + 1, 5);
    buffer.writeUInt8(now.getDate(), 6);
    buffer.writeUInt8(now.getHours(), 7);
    buffer.writeUInt8(now.getMinutes(), 8);
    buffer.writeUInt8(now.getSeconds(), 9);

    // Serial number
    buffer.writeUInt16BE(serialNumber, 10);

    // CRC
    const dataForCRC = buffer.slice(2, 12);
    const crc = calculateJimiCRC16(dataForCRC);
    buffer.writeUInt16BE(crc, 12);

    // End flag
    buffer.writeUInt16BE(0x0D0A, 14);

    socket.write(buffer);
    console.log(`[JIMI LL301] 🕐 Enviando calibración de tiempo - Buffer: ${buffer.toString('hex').toUpperCase()}`);
    return true;
}

/**
 * Procesa paquete de login según documentación
 */
function processLoginPacket(buffer) {
    console.log('[JIMI LL301] 🔐 Procesando LOGIN packet según documentación');

    // Extraer IMEI (8 bytes desde posición 4)
    const imeiBuffer = buffer.slice(4, 12);
    let imei = '';

    // Decodificar IMEI como BCD (Binary Coded Decimal)
    for (let i = 0; i < imeiBuffer.length; i++) {
        const byte = imeiBuffer[i];
        const high = (byte >>> 4) & 0x0F;
        const low = byte & 0x0F;
        if (high <= 9) imei += high.toString();
        if (low <= 9) imei += low.toString();
    }

    // Type Identifier (2 bytes)
    const typeIdentifier = buffer.readUInt16BE(12);

    // Time Zone/Language (2 bytes)
    const timeZoneLanguage = buffer.readUInt16BE(14);

    // Serial Number
    const serialNumber = buffer.readUInt16BE(buffer.length - 6);

    console.log(`[JIMI LL301] ✅ LOGIN EXITOSO:`);
    console.log(`  - IMEI: ${imei}`);
    console.log(`  - Type ID: 0x${typeIdentifier.toString(16)}`);
    console.log(`  - Time Zone/Lang: 0x${timeZoneLanguage.toString(16)}`);
    console.log(`  - Serial: ${serialNumber}`);

    return {
        type: 'login',
        imei: imei,
        typeIdentifier: typeIdentifier,
        timeZoneLanguage: timeZoneLanguage,
        serialNumber: serialNumber,
        needsACK: true,
        protocolNumber: JIMI_COMMANDS.LOGIN
    };
}

/**
 * Procesa paquete GPS según documentación (0x22 o 0xA0)
 */
function processGPSLocationPacket(buffer, protocolNumber) {
    console.log(`[JIMI LL301] 🌍 Procesando GPS Location (Protocol: 0x${protocolNumber.toString(16)})`);

    let offset = 4;

    // Date & Time (6 bytes: YY MM DD HH MM SS)
    const year = 2000 + buffer.readUInt8(offset++);
    const month = buffer.readUInt8(offset++);
    const day = buffer.readUInt8(offset++);
    const hour = buffer.readUInt8(offset++);
    const minute = buffer.readUInt8(offset++);
    const second = buffer.readUInt8(offset++);

    const timestamp = new Date(year, month - 1, day, hour, minute, second);

    // GPS info & satellites
    const gpsInfo = buffer.readUInt8(offset++);
    const gpsLength = (gpsInfo >>> 4) & 0x0F;
    const satellites = gpsInfo & 0x0F;

    // Latitude (4 bytes) - División por 1,800,000 según documentación
    const latitudeRaw = buffer.readUInt32BE(offset);
    offset += 4;
    let latitude = latitudeRaw / 1800000.0;

    // Longitude (4 bytes) - División por 1,800,000 según documentación
    const longitudeRaw = buffer.readUInt32BE(offset);
    offset += 4;
    let longitude = longitudeRaw / 1800000.0;

    // Para México, ajustar longitud (debe ser negativa)
    if (longitude > 0 && longitude < 180) {
        longitude = -longitude;
    }

    // Speed (1 byte)
    const speed = buffer.readUInt8(offset++);

    // Course and Status (2 bytes)
    const courseStatus = buffer.readUInt16BE(offset);
    offset += 2;

    const course = courseStatus & 0x03FF; // 10 bits para curso
    const gpsRealTime = (courseStatus >>> 5) & 0x01;
    const positioned = (courseStatus >>> 4) & 0x01;
    const eastWest = (courseStatus >>> 3) & 0x01;
    const northSouth = (courseStatus >>> 2) & 0x01;

    // MCC (2 bytes)
    const mcc = buffer.readUInt16BE(offset);
    offset += 2;

    // MNC (1 o 2 bytes según MSB de MCC)
    const mncLength = (mcc & 0x8000) ? 2 : 1;
    const mnc = mncLength === 2 ? buffer.readUInt16BE(offset) : buffer.readUInt8(offset);
    offset += mncLength;

    // LAC
    const lacLength = protocolNumber === JIMI_COMMANDS.GPS_LOCATION_4G ? 4 : 2;
    const lac = lacLength === 4 ? buffer.readUInt32BE(offset) : buffer.readUInt16BE(offset);
    offset += lacLength;

    // Cell ID
    const cellIdLength = protocolNumber === JIMI_COMMANDS.GPS_LOCATION_4G ? 8 : 3;
    let cellId = 0;
    if (cellIdLength === 8) {
        cellId = Number(buffer.readBigUInt64BE(offset));
    } else {
        cellId = (buffer.readUInt8(offset) << 16) | buffer.readUInt16BE(offset + 1);
    }
    offset += cellIdLength;

    // Serial number
    const serialNumber = buffer.readUInt16BE(buffer.length - 6);

    // Validar coordenadas
    const validCoords = latitude >= -90 && latitude <= 90 &&
        longitude >= -180 && longitude <= 180 &&
        Math.abs(latitude) > 0.0001 && Math.abs(longitude) > 0.0001;

    console.log(`[JIMI LL301] ✅ GPS DATOS:`);
    console.log(`  - Timestamp: ${timestamp.toISOString()}`);
    console.log(`  - Lat: ${latitude.toFixed(6)}, Lon: ${longitude.toFixed(6)}`);
    console.log(`  - Speed: ${speed} km/h, Course: ${course}°`);
    console.log(`  - Satellites: ${satellites}, Positioned: ${positioned}`);
    console.log(`  - Válido: ${validCoords}`);

    return {
        type: 'gps',
        timestamp: timestamp,
        latitude: latitude,
        longitude: longitude,
        speed: speed,
        course: course,
        satellites: satellites,
        gpsRealTime: gpsRealTime,
        positioned: positioned,
        valid: validCoords,
        serialNumber: serialNumber,
        needsACK: false, // GPS packets no requieren ACK según documentación
        protocolNumber: protocolNumber,
        cellInfo: {
            mcc: mcc & 0x7FFF, // Quitar MSB
            mnc: mnc,
            lac: lac,
            cellId: cellId
        }
    };
}

/**
 * Función principal mejorada para procesar datos Jimi IoT LL301
 */
export function processJimiIoTDataImproved(rawData, port, socket, clients) {
    try {
        const hexData = rawData.toString('hex').toUpperCase();
        console.log(`[JIMI LL301] 📡 Datos recibidos (${rawData.length} bytes):`, hexData);

        // Verificar estructura básica
        if (rawData.length < 8) {
            console.warn('[JIMI LL301] Paquete muy corto');
            return;
        }

        // Verificar start flag
        const startFlag = rawData.readUInt16BE(0);
        if (startFlag !== 0x7878 && startFlag !== 0x7979) {
            console.warn(`[JIMI LL301] Start flag inválido: 0x${startFlag.toString(16)}`);
            return;
        }

        // Verificar end flag
        const endFlag = rawData.readUInt16BE(rawData.length - 2);
        if (endFlag !== 0x0D0A) {
            console.warn(`[JIMI LL301] End flag inválido: 0x${endFlag.toString(16)}`);
            return;
        }

        const dataLength = rawData.readUInt8(2);
        const protocolNumber = rawData.readUInt8(3);

        console.log(`[JIMI LL301] Protocolo: 0x${protocolNumber.toString(16)}, Longitud: ${dataLength}`);

        let parsedData;

        switch (protocolNumber) {
            case JIMI_COMMANDS.LOGIN:
                parsedData = processLoginPacket(rawData);

                // Enviar ACK de login
                const loginACK = createJimiACK(JIMI_COMMANDS.LOGIN, parsedData.serialNumber, true);
                socket.write(loginACK);
                console.log(`[JIMI LL301] ✅ ACK Login enviado: ${loginACK.toString('hex').toUpperCase()}`);

                // SECUENCIA CRÍTICA: Configuración post-login según documentación
                setTimeout(() => {
                    console.log('[JIMI LL301] 🚀 Iniciando secuencia de configuración post-login...');

                    // 1. NO enviar calibración automáticamente - esperar que el dispositivo la solicite
                    // sendTimeCalibration(socket, parsedData.serialNumber + 1);

                    // 2. Solicitar ubicación GPS cada 15 segundos (más frecuente)
                    const locationInterval = setInterval(() => {
                        if (socket && !socket.destroyed) {
                            requestGPSLocation(socket, parsedData.serialNumber + Math.floor(Math.random() * 100));
                        } else {
                            clearInterval(locationInterval);
                        }
                    }, 15000);

                    // 3. Solicitud inicial inmediata
                    setTimeout(() => {
                        requestGPSLocation(socket, parsedData.serialNumber + 2);
                    }, 5000);

                }, 1000); // Reducir delay inicial
                break;

            case JIMI_COMMANDS.TIME_CALIBRATION:
                console.log('[JIMI LL301] 🕐 Time calibration request recibido');

                // Responder con tiempo UTC según documentación
                const timeBuffer = Buffer.alloc(16);
                timeBuffer.writeUInt16BE(0x7878, 0);
                timeBuffer.writeUInt8(0x0B, 2);
                timeBuffer.writeUInt8(0x8A, 3); // UTC response

                const now = new Date();
                timeBuffer.writeUInt8(now.getFullYear() - 2000, 4);
                timeBuffer.writeUInt8(now.getMonth() + 1, 5);
                timeBuffer.writeUInt8(now.getDate(), 6);
                timeBuffer.writeUInt8(now.getHours(), 7);
                timeBuffer.writeUInt8(now.getMinutes(), 8);
                timeBuffer.writeUInt8(now.getSeconds(), 9);

                const timeSerial = rawData.readUInt16BE(rawData.length - 6);
                timeBuffer.writeUInt16BE(timeSerial, 10);

                const timeCRC = calculateJimiCRC16(timeBuffer.slice(2, 12));
                timeBuffer.writeUInt16BE(timeCRC, 12);
                timeBuffer.writeUInt16BE(0x0D0A, 14);

                socket.write(timeBuffer);
                console.log(`[JIMI LL301] ✅ Respuesta de tiempo enviada: ${timeBuffer.toString('hex').toUpperCase()}`);
                break;

            case JIMI_COMMANDS.HEARTBEAT_STATUS:
            case JIMI_COMMANDS.HEARTBEAT:
                console.log('[JIMI LL301] 💓 Heartbeat recibido');

                // Enviar ACK
                const heartbeatACK = createJimiACK(protocolNumber, rawData.readUInt16BE(rawData.length - 6));
                socket.write(heartbeatACK);

                // Aprovechar heartbeat para solicitar ubicación
                setTimeout(() => {
                    requestGPSLocation(socket, rawData.readUInt16BE(rawData.length - 6) + 1);
                }, 1000);
                break;

            case JIMI_COMMANDS.GPS_LOCATION_2G:
            case JIMI_COMMANDS.GPS_LOCATION_4G:
                parsedData = processGPSLocationPacket(rawData, protocolNumber);

                // Emitir datos GPS si son válidos
                if (parsedData && parsedData.valid) {
                    emitGPSData(parsedData, port, clients);
                }
                break;

            default:
                console.log(`[JIMI LL301] 📦 Protocolo no manejado: 0x${protocolNumber.toString(16)}`);
                console.log(`[JIMI LL301] 📦 Datos completos: ${hexData}`);

                // Solo enviar ACK genérico si no es un comando que no requiere respuesta
                if (protocolNumber !== 0x13 && protocolNumber !== 0x12 && protocolNumber !== 0x16) {
                    const genericACK = createJimiACK(protocolNumber, rawData.readUInt16BE(rawData.length - 6));
                    socket.write(genericACK);
                    console.log(`[JIMI LL301] ✅ ACK genérico enviado: ${genericACK.toString('hex').toUpperCase()}`);
                }
                break;
        }

    } catch (error) {
        console.error('[JIMI LL301] Error procesando datos:', error.message);
    }
}

/**
 * Emite datos GPS a los clientes WebSocket
 */
function emitGPSData(parsedData, port, clients) {
    const dataToEmit = {
        imei: parsedData.imei || 'jimi_ll301',
        lat: parsedData.latitude,
        lng: parsedData.longitude,
        timestamp: parsedData.timestamp,
        speed: parsedData.speed,
        altitude: 0, // No disponible en este protocolo
        angle: parsedData.course,
        satellites: parsedData.satellites,
        hdop: null,
        deviceno: "",
        carlicense: "",
        additionalData: {
            protocol: 'jimi_iot_ll301',
            protocolNumber: `0x${parsedData.protocolNumber.toString(16)}`,
            serialNumber: parsedData.serialNumber,
            positioned: parsedData.positioned,
            gpsRealTime: parsedData.gpsRealTime,
            cellInfo: parsedData.cellInfo
        },
        source_port: port
    };

    // Emitir a clientes WebSocket autenticados
    let clientsSent = 0;
    for (const [client, info] of clients.entries()) {
        if (client.readyState === 1 && info.authenticated) {
            try {
                client.send(JSON.stringify({
                    type: 'gps-data',
                    data: dataToEmit
                }));
                clientsSent++;
            } catch (wsError) {
                console.error(`[JIMI LL301] Error enviando a WebSocket:`, wsError.message);
            }
        }
    }

    console.log(`[JIMI LL301] 🌍 Datos GPS enviados a ${clientsSent} clientes WebSocket - Lat: ${parsedData.latitude}, Lng: ${parsedData.longitude}`);
}