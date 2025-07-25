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
        0xBDCB, 0xAC42, 0x9ED9, 0x8F50, 0xFBEF, 0xEA66, 0xD8FD, 0xC974,
        0x4204, 0x538D, 0x6116, 0x709F, 0x0420, 0x15A9, 0x2732, 0x36BB,
        0xCE4C, 0xDFC5, 0xED5E, 0xFCD7, 0x8868, 0x99E1, 0xAB7A, 0xBAF3,
        0x5285, 0x430C, 0x7197, 0x601E, 0x14A1, 0x0528, 0x37B3, 0x263A,
        0xDECD, 0xCF44, 0xFDDF, 0xEC56, 0x98E9, 0x8960, 0xBBFB, 0xAA72,
        0x6306, 0x728F, 0x4014, 0x519D, 0x2522, 0x34AB, 0x0630, 0x17B9,
        0xEF4E, 0xFEC7, 0xCC5C, 0xDDD5, 0xA96A, 0xB8E3, 0x8A78, 0x9BF1,
        0x7387, 0x620E, 0x5095, 0x411C, 0x35A3, 0x242A, 0x16B1, 0x0738,
        0xFFCF, 0xEE46, 0xDCDD, 0xCD54, 0xB9EB, 0xA862, 0x9AF9, 0x8B70,
        0x8408, 0x9581, 0xA71A, 0xB693, 0xC22C, 0xD3A5, 0xE13E, 0xF0B7,
        0x0840, 0x19C9, 0x2B52, 0x3ADB, 0x4E64, 0x5FED, 0x6D76, 0x7CFF,
        0x9489, 0x8500, 0xB79B, 0xA612, 0xD2AD, 0xC324, 0xF1BF, 0xE036,
        0x18C1, 0x0948, 0x3BD3, 0x2A5A, 0x5EE5, 0x4F6C, 0x7DF7, 0x6C7E,
        0xA50A, 0xB483, 0x8618, 0x9791, 0xE32E, 0xF2A7, 0xC03C, 0xD1B5,
        0x2942, 0x38CB, 0x0A50, 0x1BD9, 0x6F66, 0x7EEF, 0x4C74, 0x5DFD,
        0xB58B, 0xA402, 0x9699, 0x8710, 0xF3AF, 0xE226, 0xD0BD, 0xC134,
        0x39C3, 0x284A, 0x1AD1, 0x0B58, 0x7FE7, 0x6E6E, 0x5CF5, 0x4D7C,
        0xC60C, 0xD785, 0xE51E, 0xF497, 0x8028, 0x91A1, 0xA33A, 0xB2B3,
        0x4A44, 0x5BCD, 0x6956, 0x78DF, 0x0C60, 0x1DE9, 0x2F72, 0x3EFB,
        0xD68D, 0xC704, 0xF59F, 0xE416, 0x90A9, 0x8120, 0xB3BB, 0xA232,
        0x5AC5, 0x4B4C, 0x79D7, 0x685E, 0x1CE1, 0x0D68, 0x3FF3, 0x2E7A,
        0xE70E, 0xF687, 0xC41C, 0xD595, 0xA12A, 0xB0A3, 0x8238, 0x93B1,
        0x6B46, 0x7ACF, 0x4854, 0x59DD, 0x2D62, 0x3CEB, 0x0E70, 0x1FF9,
        0xF78F, 0xE606, 0xD49D, 0xC514, 0xB1AB, 0xA022, 0x92B9, 0x8330,
        0x7BC7, 0x6A4E, 0x58D5, 0x495C, 0x3DE3, 0x2C6A, 0x1EF1, 0x0F78
    ];

    let fcs = 0xFFFF;
    for (let i = 0; i < data.length; i++) {
        fcs = (fcs >>> 8) ^ crctab16[(fcs ^ data[i]) & 0xFF];
    }
    return (~fcs) & 0xFFFF;
}

/**
 * Sistema de logging avanzado - AGREGADO
 */
class JimiLogger {
    constructor(enableDebug = false) {
        this.enableDebug = enableDebug;
        this.deviceSessions = new Map();
    }

    startSession(imei, socket) {
        const sessionId = `${imei}_${Date.now()}`;
        this.deviceSessions.set(imei, {
            sessionId,
            startTime: new Date(),
            socket,
            packetsReceived: 0,
            gpsPacketsReceived: 0,
            lastActivity: new Date(),
            protocols: new Set()
        });

        console.log(`[JIMI SESSION] 🚀 Nueva sesión - IMEI: ${imei}`);
        return sessionId;
    }

    logPacket(imei, protocolNumber, packetSize, isValid = true) {
        const session = this.deviceSessions.get(imei);
        if (session) {
            session.packetsReceived++;
            session.lastActivity = new Date();
            session.protocols.add(`0x${protocolNumber.toString(16)}`);

            if (protocolNumber === 0xA0 || protocolNumber === 0x22) {
                session.gpsPacketsReceived++;
            }
        }

        const status = isValid ? '✅' : '❌';
        console.log(`[JIMI PACKET] ${status} ${imei} | Proto: 0x${protocolNumber.toString(16)} | ${packetSize}b`);
    }

    logGPSData(imei, latitude, longitude, valid, satellites) {
        const status = valid ? '🌍' : '🚫';
        console.log(`[JIMI GPS] ${status} ${imei} | Lat: ${latitude.toFixed(6)} | Lon: ${longitude.toFixed(6)} | Sats: ${satellites || 'N/A'}`);
    }

    getActiveDevices() {
        return Array.from(this.deviceSessions.keys());
    }

    getSessionInfo(imei) {
        return this.deviceSessions.get(imei);
    }

    endSession(imei) {
        const session = this.deviceSessions.get(imei);
        if (session) {
            const duration = Math.round((Date.now() - session.startTime.getTime()) / 60000);
            console.log(`[JIMI SESSION] 📊 Fin ${imei} - ${duration}min, ${session.packetsReceived} paquetes, ${session.gpsPacketsReceived} GPS`);
            this.deviceSessions.delete(imei);
        }
    }
}

// Instancia global del logger - AGREGADO
const jimiLogger = new JimiLogger(process.env.NODE_ENV === 'development');

/**
 * GPS Manager inteligente - AGREGADO
 */
class JimiGPSManager {
    constructor(socket, imei, baseSerial = 1) {
        this.socket = socket;
        this.imei = imei;
        this.serialCounter = baseSerial;
        this.lastGPSReceived = null;
        this.requestInterval = null;
        this.isDeviceResponding = false;

        this.startGPSManagement();
    }

    startGPSManagement() {
        console.log(`[JIMI GPS Manager] 🚀 Iniciando gestión para ${this.imei}`);
        this.aggressivePhase();
    }

    aggressivePhase() {
        console.log(`[JIMI GPS Manager] ⚡ Fase agresiva - solicitudes cada 15s`);

        let aggressiveCount = 0;
        const maxAggressive = 6;

        // Primera solicitud inmediata
        this.requestGPS();
        aggressiveCount++;

        const aggressiveInterval = setInterval(() => {
            if (!this.socket || this.socket.destroyed) {
                clearInterval(aggressiveInterval);
                return;
            }

            if (aggressiveCount >= maxAggressive) {
                clearInterval(aggressiveInterval);
                this.normalPhase();
                return;
            }

            this.requestGPS();
            aggressiveCount++;
        }, 15000);
    }

    normalPhase() {
        console.log(`[JIMI GPS Manager] 🔄 Fase normal - solicitudes cada 60s`);

        this.requestInterval = setInterval(() => {
            if (!this.socket || this.socket.destroyed) {
                this.cleanup();
                return;
            }

            const timeSinceLastGPS = this.lastGPSReceived ?
                Date.now() - this.lastGPSReceived.getTime() : null;

            if (!timeSinceLastGPS || timeSinceLastGPS > 90000) {
                this.requestGPS();
            } else {
                console.log(`[JIMI GPS Manager] ✅ Dispositivo respondiendo automáticamente`);
                this.isDeviceResponding = true;
            }
        }, 60000);
    }

    requestGPS() {
        try {
            const buffer = Buffer.alloc(10);

            buffer.writeUInt16BE(0x7878, 0);
            buffer.writeUInt8(0x05, 2);
            buffer.writeUInt8(0x80, 3);
            buffer.writeUInt16BE(this.serialCounter++, 4);

            const dataForCRC = buffer.slice(2, 6);
            const crc = calculateJimiCRC16(dataForCRC);
            buffer.writeUInt16BE(crc, 6);
            buffer.writeUInt16BE(0x0D0A, 8);

            this.socket.write(buffer);
            console.log(`[JIMI GPS Manager] 📍 Solicitando GPS (Serial: ${this.serialCounter - 1})`);

        } catch (error) {
            console.error(`[JIMI GPS Manager] Error solicitando GPS:`, error);
        }
    }

    onGPSReceived() {
        this.lastGPSReceived = new Date();
        console.log(`[JIMI GPS Manager] 📍 GPS recibido para ${this.imei}`);

        if (this.isDeviceResponding && this.requestInterval) {
            clearInterval(this.requestInterval);
            this.reducedPhase();
        }
    }

    reducedPhase() {
        console.log(`[JIMI GPS Manager] 😴 Fase reducida - solicitudes cada 5 minutos`);

        this.requestInterval = setInterval(() => {
            if (!this.socket || this.socket.destroyed) {
                this.cleanup();
                return;
            }

            const timeSinceLastGPS = this.lastGPSReceived ?
                Date.now() - this.lastGPSReceived.getTime() : null;

            if (!timeSinceLastGPS || timeSinceLastGPS > 300000) {
                this.requestGPS();
            }
        }, 300000);
    }

    cleanup() {
        if (this.requestInterval) {
            clearInterval(this.requestInterval);
            this.requestInterval = null;
        }
        console.log(`[JIMI GPS Manager] 🧹 Limpieza completada para ${this.imei}`);
    }
}

/**
 * Crea respuesta ACK específica para LOGIN según documentación
 */
function createLoginACK(serialNumber) {
    const buffer = Buffer.alloc(10);

    // Start flag
    buffer.writeUInt16BE(0x7878, 0);

    // Length (5 bytes de datos)
    buffer.writeUInt8(0x05, 2);

    // Protocol number - 0x01 (same as login)
    buffer.writeUInt8(0x01, 3);

    // Serial number (2 bytes) - EXACTAMENTE el mismo que recibimos
    buffer.writeUInt16BE(serialNumber, 4);

    // Calcular CRC16 - desde length hasta serial number
    const dataForCRC = buffer.slice(2, 6);
    const crc = calculateJimiCRC16(dataForCRC);
    buffer.writeUInt16BE(crc, 6);

    // End flag
    buffer.writeUInt16BE(0x0D0A, 8);

    return buffer;
}

/**
 * Crea respuesta ACK según protocolo específico  
 */
function createJimiACK(protocolNumber, serialNumber, isPositive = true) {
    // Para LOGIN, usar función específica
    if (protocolNumber === JIMI_COMMANDS.LOGIN) {
        return createLoginACK(serialNumber);
    }

    const buffer = Buffer.alloc(10);

    // Start flag
    buffer.writeUInt16BE(0x7878, 0);

    // Length (5 bytes de datos)
    buffer.writeUInt8(0x05, 2);

    // Protocol number (mismo que recibido)
    buffer.writeUInt8(protocolNumber, 3);

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
 * NO enviar comandos GPS automáticamente - según documentación,
 * el dispositivo debe enviar datos automáticamente después del login
 */
function waitForAutomaticGPSData(socket, imei) {
    console.log(`[JIMI LL301] ⏳ Esperando datos GPS automáticos del dispositivo ${imei}`);

    // Solo configurar un heartbeat periódico muy básico
    const heartbeatInterval = setInterval(() => {
        if (socket && !socket.destroyed) {
            console.log(`[JIMI LL301] 💓 Conexión activa para ${imei}`);
        } else {
            clearInterval(heartbeatInterval);
        }
    }, 60000); // Cada minuto

    return heartbeatInterval;
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
 * Procesa protocolo 0x7D - Información general del dispositivo - AGREGADO
 */
function processGeneralInfo(buffer) {
    try {
        console.log('[JIMI LL301] 📊 Procesando información general (0x7D)');

        const payload = buffer.slice(4, buffer.length - 6);
        const infoString = payload.toString('ascii');

        console.log('[JIMI LL301] 📋 Info:', infoString.substring(0, 100) + '...');

        const serialNumber = buffer.readUInt16BE(buffer.length - 6);

        return {
            type: 'device_info',
            infoString: infoString,
            serialNumber: serialNumber,
            needsACK: true,
            protocolNumber: 0x7D
        };

    } catch (error) {
        console.error('[JIMI LL301] Error procesando info general:', error);
        return null;
    }
}

/**
 * Procesa protocolo 0x20 - Estado del dispositivo - AGREGADO
 */
function processDeviceStatus(buffer) {
    try {
        console.log('[JIMI LL301] 📈 Procesando estado del dispositivo (0x20)');

        const serialNumber = buffer.readUInt16BE(buffer.length - 6);

        return {
            type: 'device_status',
            serialNumber: serialNumber,
            needsACK: true,
            protocolNumber: 0x20
        };

    } catch (error) {
        console.error('[JIMI LL301] Error procesando estado:', error);
        return null;
    }
}

/**
 * Función principal mejorada para procesar datos Jimi IoT LL301
 */
export function processJimiIoTDataImproved(rawData, port, socket, clients) {
    let imei = null; // AGREGADO para logging

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

        // Agregar tracking de login por socket para evitar bucles
        if (!socket.jimiLoginCompleted && protocolNumber === JIMI_COMMANDS.LOGIN) {
            console.log('[JIMI LL301] 🔐 Primer LOGIN de esta conexión');
            socket.jimiLoginCompleted = true;
        } else if (socket.jimiLoginCompleted && protocolNumber === JIMI_COMMANDS.LOGIN) {
            console.log('[JIMI LL301] ⚠️ LOGIN duplicado ignorado - conexión ya autenticada');
            return;
        }

        // Agregar más protocolos específicos del LL301
        switch (protocolNumber) {
            case JIMI_COMMANDS.LOGIN:
                parsedData = processLoginPacket(rawData);
                imei = parsedData.imei; // AGREGADO para logging

                // AGREGADO: Iniciar sesión de logging
                jimiLogger.startSession(imei, socket);
                jimiLogger.logPacket(imei, protocolNumber, rawData.length, true);
                socket.imei = imei; // AGREGADO para tracking

                // Enviar ACK de login
                const loginACK = createJimiACK(JIMI_COMMANDS.LOGIN, parsedData.serialNumber, true);
                socket.write(loginACK);
                console.log(`[JIMI LL301] ✅ ACK Login enviado: ${loginACK.toString('hex').toUpperCase()}`);

                // AGREGADO: Configurar GPS manager inteligente
                setTimeout(() => {
                    socket.gpsManager = new JimiGPSManager(socket, imei, parsedData.serialNumber);
                    console.log('[JIMI LL301] ✅ Login completado. GPS Manager configurado.');
                }, 2000);
                break;

            case 0x8A: // Time calibration REQUEST from device
                imei = socket.imei || 'unknown'; // AGREGADO
                console.log('[JIMI LL301] 🕐 Dispositivo solicita calibración de tiempo');

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
                console.log(`[JIMI LL301] ✅ Calibración de tiempo enviada: ${timeBuffer.toString('hex').toUpperCase()}`);
                break;

            case JIMI_COMMANDS.TIME_CALIBRATION:
                // Este caso ya no se necesita porque lo manejamos arriba
                break;

            case JIMI_COMMANDS.HEARTBEAT_STATUS:
            case JIMI_COMMANDS.HEARTBEAT:
                imei = socket.imei || 'unknown'; // AGREGADO
                jimiLogger.logPacket(imei, protocolNumber, rawData.length, true); // AGREGADO
                console.log(`[JIMI LL301] 💓 Heartbeat recibido (0x${protocolNumber.toString(16)})`);

                // Enviar ACK
                const heartbeatACK = createJimiACK(protocolNumber, rawData.readUInt16BE(rawData.length - 6));
                socket.write(heartbeatACK);
                console.log(`[JIMI LL301] ✅ Heartbeat ACK enviado: ${heartbeatACK.toString('hex').toUpperCase()}`);
                break;

            case JIMI_COMMANDS.GPS_LOCATION_2G:
            case JIMI_COMMANDS.GPS_LOCATION_4G:
                imei = socket.imei || 'unknown'; // AGREGADO
                parsedData = processGPSLocationPacket(rawData, protocolNumber);

                // AGREGADO: Logging de GPS
                jimiLogger.logPacket(imei, protocolNumber, rawData.length, parsedData?.valid);
                if (parsedData) {
                    jimiLogger.logGPSData(imei, parsedData.latitude, parsedData.longitude,
                        parsedData.valid, parsedData.satellites);

                    // AGREGADO: Notificar al GPS manager
                    if (socket.gpsManager) {
                        socket.gpsManager.onGPSReceived();
                    }
                }

                // Emitir datos GPS si son válidos - MODIFICADO formato
                if (parsedData && parsedData.valid) {
                    emitGPSData(parsedData, port, clients, socket);  // 🔧 AGREGADO: socket parameter
                }
                break;

            case 0x7D: // AGREGADO: General info
                imei = socket.imei || 'unknown';
                parsedData = processGeneralInfo(rawData);
                jimiLogger.logPacket(imei, protocolNumber, rawData.length, !!parsedData);

                console.log(`[JIMI LL301] 📊 Info general de ${imei}`);

                const infoACK = createJimiACK(0x7D, rawData.readUInt16BE(rawData.length - 6));
                socket.write(infoACK);
                console.log(`[JIMI LL301] ✅ Info ACK enviado: ${infoACK.toString('hex').toUpperCase()}`);
                break;

            case 0x20: // AGREGADO: Device status
                imei = socket.imei || 'unknown';
                parsedData = processDeviceStatus(rawData);
                jimiLogger.logPacket(imei, protocolNumber, rawData.length, !!parsedData);

                console.log(`[JIMI LL301] 📈 Estado de ${imei}`);

                const statusACK = createJimiACK(0x20, rawData.readUInt16BE(rawData.length - 6));
                socket.write(statusACK);
                console.log(`[JIMI LL301] ✅ Status ACK enviado: ${statusACK.toString('hex').toUpperCase()}`);
                break;

            default:
                imei = socket.imei || 'unknown'; // AGREGADO
                jimiLogger.logPacket(imei, protocolNumber, rawData.length, false); // AGREGADO
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
        if (imei) { // AGREGADO: mejor logging de errores
            console.error(`[JIMI LL301] ❌ Error para ${imei}:`, error.message);
        } else {
            console.error('[JIMI LL301] Error procesando datos:', error.message);
        }
    }
}

/**
 * Emite datos GPS a los clientes WebSocket - MODIFICADO formato - CORREGIDO IMEI
 */
function emitGPSData(parsedData, port, clients, socket) {  // 🔧 AGREGADO: socket parameter
    // MODIFICADO: Ajustar timestamp restando 6 horas (UTC-6 para México)
    const utcTimestamp = new Date(parsedData.timestamp);
    const localTimestamp = new Date(utcTimestamp.getTime() - (6 * 60 * 60 * 1000));

    // MODIFICADO: Formato específico solicitado
    const dataToEmit = {
        timestamp: localTimestamp.toISOString(), // UTC-6
        latitude: parsedData.latitude,           // Por separado
        longitude: parsedData.longitude,         // Por separado  
        speed: parsedData.speed,                 // Por separado
        course: parsedData.course,               // Por separado
        satellites: parsedData.satellites,       // Por separado
        positioned: parsedData.positioned,       // Por separado
        imei: socket.imei || parsedData.imei || 'jimi_ll301',  // 🔧 CORREGIDO: Usar socket.imei primero
        valid: parsedData.valid,
        protocolNumber: `0x${parsedData.protocolNumber.toString(16)}`,
        serialNumber: parsedData.serialNumber,
        gpsRealTime: parsedData.gpsRealTime,
        cellInfo: parsedData.cellInfo,
        source_port: port
    };

    // Emitir a clientes WebSocket autenticados
    let clientsSent = 0;
    for (const [client, info] of clients.entries()) {
        if (client.readyState === 1 && info.authenticated) {
            try {
                client.send(JSON.stringify({
                    type: 'jimi-data',  // MODIFICADO: Cambió de 'gps-data' a 'jimi-data'
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

// AGREGADO: Exportar logger y GPS manager para uso en index.js
export { jimiLogger, JimiGPSManager };