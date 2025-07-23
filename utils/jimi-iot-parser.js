// utils/jimi-iot-parser.js
// Parser COMPLETO y CORREGIDO para GPS Jimi IoT LL301 usando protocolo GT06/Concox
// Versión final optimizada con IMEI parsing correcto y soporte completo

import { Buffer } from 'buffer';

/**
 * Calcula CRC16 según el protocolo GT06/Concox
 */
function calculateCRC16(data) {
    let crc = 0xFFFF;
    for (let i = 0; i < data.length; i++) {
        crc ^= (data[i] << 8);
        for (let j = 0; j < 8; j++) {
            if ((crc & 0x8000) > 0) {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc <<= 1;
            }
        }
    }
    return crc & 0xFFFF;
}

/**
 * Crea respuesta ACK para el protocolo GT06/Concox
 */
function createJimiIoTACK(serialNumber, protocolNumber) {
    try {
        const buffer = Buffer.alloc(10);

        // Start flag
        buffer.writeUInt16BE(0x7878, 0);

        // Length (5 bytes de datos)
        buffer.writeUInt8(0x05, 2);

        // Protocol number (mismo que recibido)
        buffer.writeUInt8(protocolNumber, 3);

        // Serial number (mismo que recibido) 
        buffer.writeUInt16BE(serialNumber, 4);

        // Calcular CRC16 (desde length hasta serial number)
        const dataForCRC = buffer.slice(2, 6);
        const crc = calculateCRC16(dataForCRC);
        buffer.writeUInt16BE(crc, 6);

        // End flag
        buffer.writeUInt16BE(0x0D0A, 8);

        return buffer;
    } catch (error) {
        console.error('[JIMI ACK] Error creando ACK:', error);
        return null;
    }
}

/**
 * Extrae IMEI de forma correcta desde el buffer - VERSIÓN MEJORADA
 */
function extractIMEI(buffer, offset = 4, length = 8) {
    try {
        const imeiBuffer = buffer.slice(offset, offset + length);

        // Método 1: BCD (Binary Coded Decimal) decoding - MÁS COMÚN EN GT06
        let imei = '';
        for (let i = 0; i < imeiBuffer.length; i++) {
            const byte = imeiBuffer[i];
            const high = (byte >> 4) & 0x0F;
            const low = byte & 0x0F;

            // Validar que sean dígitos válidos (0-9)
            if (high <= 9) imei += high.toString();
            if (low <= 9) imei += low.toString();
        }

        // Método 2: Si BCD no funciona, intentar como ASCII
        if (imei.length < 14 || !/^\d+$/.test(imei)) {
            imei = '';
            for (let i = 0; i < imeiBuffer.length; i++) {
                const byte = imeiBuffer[i];
                if (byte >= 0x30 && byte <= 0x39) { // ASCII digits
                    imei += String.fromCharCode(byte);
                }
            }
        }

        // Método 3: Si ASCII no funciona, convertir byte a string directamente
        if (imei.length < 14 || !/^\d+$/.test(imei)) {
            imei = '';
            for (let i = 0; i < imeiBuffer.length; i++) {
                const byte = imeiBuffer[i];
                const digits = byte.toString(16).padStart(2, '0');
                imei += digits;
            }
            // Intentar extraer solo dígitos numéricos
            const numericOnly = imei.replace(/[^0-9]/g, '');
            if (numericOnly.length >= 14) {
                imei = numericOnly;
            }
        }

        // Método 4: BigInt approach como último recurso
        if (imei.length < 14 || !/^\d+$/.test(imei)) {
            try {
                const bigIntValue = imeiBuffer.readBigUInt64BE();
                imei = bigIntValue.toString();
            } catch (bigIntError) {
                console.warn('[JIMI PARSER] Error en BigInt IMEI extraction:', bigIntError.message);
                imei = imeiBuffer.toString('hex');
            }
        }

        // Limpiar y validar IMEI final
        imei = imei.replace(/[^0-9]/g, '').replace(/^0+/, '');

        // IMEI debe tener entre 14-16 dígitos
        if (imei.length >= 14 && imei.length <= 16) {
            return imei.substring(0, 15); // Tomar exactamente 15 dígitos
        }

        // Si todo falla, devolver representación hex con prefijo
        console.warn('[JIMI PARSER] IMEI no válido, usando hex representation');
        return `hex_${imeiBuffer.toString('hex')}`;

    } catch (error) {
        console.error('[JIMI PARSER] Error extrayendo IMEI:', error);
        return 'unknown_imei';
    }
}

/**
 * Convierte coordenadas del formato GT06 a decimal
 */
function convertCoordinates(rawValue, isLongitude = false) {
    try {
        // Método 1: División estándar GT06
        let coordinate = rawValue / 1800000.0;

        // Método 2: Si el valor es muy grande, usar factor diferente
        if (Math.abs(coordinate) > (isLongitude ? 180 : 90)) {
            coordinate = rawValue / 10000000.0;
        }

        // Método 3: Si aún es muy grande, intentar otro factor
        if (Math.abs(coordinate) > (isLongitude ? 180 : 90)) {
            coordinate = rawValue / 100000.0;
        }

        // Para coordenadas de México, ajustar signos
        if (isLongitude && coordinate > 0 && coordinate < 180) {
            coordinate = -coordinate; // México está en longitud oeste (negativa)
        }

        return coordinate;
    } catch (error) {
        console.error('[JIMI PARSER] Error convirtiendo coordenadas:', error);
        return 0;
    }
}

/**
 * Parsea paquetes del protocolo GT06/Concox (Jimi IoT LL301)
 * VERSIÓN FINAL OPTIMIZADA
 */
export function parseJimiIoTPacket(hexData) {
    try {
        const buffer = Buffer.from(hexData, 'hex');

        // Verificaciones básicas
        if (buffer.length < 8) {
            console.warn('[JIMI PARSER] Paquete demasiado corto para procesar');
            return { type: 'too_short', parsed: false, rawData: hexData };
        }

        // Verificar start flag
        const startFlag = buffer.readUInt16BE(0);
        if (startFlag !== 0x7878 && startFlag !== 0x7979) {
            console.warn(`[JIMI PARSER] Start flag inválido: 0x${startFlag.toString(16)}`);
            return { type: 'invalid_start', parsed: false, rawData: hexData };
        }

        // Verificar end flag
        const endFlag = buffer.readUInt16BE(buffer.length - 2);
        if (endFlag !== 0x0D0A) {
            console.warn(`[JIMI PARSER] End flag inválido: 0x${endFlag.toString(16)}`);
            return { type: 'invalid_end', parsed: false, rawData: hexData };
        }

        // Extraer campos básicos
        const dataLength = buffer.readUInt8(2);
        const protocolNumber = buffer.readUInt8(3);

        console.log(`[JIMI PARSER] ✅ Paquete válido - Start: 0x${startFlag.toString(16)}, Length: ${dataLength}, Protocol: 0x${protocolNumber.toString(16)}`);

        // Parsear según el tipo de protocolo
        switch (protocolNumber) {
            case 0x01: // Login packet
                return parseLoginPacket(buffer, dataLength, protocolNumber);

            case 0x13: // Status information packet
                return parseStatusPacket(buffer, dataLength, protocolNumber);

            case 0x12: // GPS packet (ubicación principal)
                return parseGPSPacket(buffer, dataLength, protocolNumber);

            case 0x16: // GPS packet alternativo
                return parseGPSPacket(buffer, dataLength, protocolNumber);

            case 0x17: // Heart beat packet
                return parseHeartbeatPacket(buffer, dataLength, protocolNumber);

            case 0x18: // GPS and LBS packet
                return parseGPSLBSPacket(buffer, dataLength, protocolNumber);

            case 0x19: // LBS packet (Cell tower info)
                return parseLBSPacket(buffer, dataLength, protocolNumber);

            case 0x1A: // GPS positioning packet
                return parseGPSPositioningPacket(buffer, dataLength, protocolNumber);

            // *** PROTOCOLOS ESPECÍFICOS DEL JIMI IoT LL301 ***
            case 0x36: // LL301 GPS + Status data
                return parseJimiLL301Packet(buffer, dataLength, protocolNumber);

            case 0x37: // LL301 GPS + Extended data
                return parseJimiLL301Packet(buffer, dataLength, protocolNumber);

            case 0x38: // LL301 GPS + Additional sensors
                return parseJimiLL301Packet(buffer, dataLength, protocolNumber);

            case 0x39: // LL301 GPS + Full telemetry
                return parseJimiLL301Packet(buffer, dataLength, protocolNumber);

            // *** PROTOCOLOS DE RESPUESTA ***
            case 0x80: // Location response
                return parseLocationResponse(buffer, dataLength, protocolNumber);

            case 0x81: // Command response
                return parseCommandResponse(buffer, dataLength, protocolNumber);

            default:
                console.log(`[JIMI PARSER] 🆕 Protocolo nuevo: 0x${protocolNumber.toString(16)} - Parseando como genérico`);
                return parseGenericPacket(buffer, dataLength, protocolNumber);
        }

    } catch (error) {
        console.error('[JIMI PARSER] ❌ Error crítico parseando:', error.message);
        return {
            type: 'parse_error',
            error: error.message,
            rawData: hexData,
            parsed: false
        };
    }
}

/**
 * Parsea paquete de login (0x01) - VERSIÓN FINAL CORREGIDA
 */
function parseLoginPacket(buffer, dataLength, protocolNumber) {
    try {
        console.log('[JIMI PARSER] 🔐 Parseando LOGIN packet');

        // IMEI: 8 bytes a partir del byte 4 - MÉTODO CORREGIDO
        const imei = extractIMEI(buffer, 4, 8);

        // Software version: 2 bytes después del IMEI (bytes 12-13)
        const softwareVersion = buffer.length > 14 ? buffer.readUInt16BE(12) : 0;

        // Serial number: 2 bytes antes del CRC
        const serialNumber = buffer.readUInt16BE(buffer.length - 6);

        // CRC: 2 bytes antes del end flag
        const crc = buffer.readUInt16BE(buffer.length - 4);

        console.log(`[JIMI PARSER] ✅ LOGIN EXITOSO - IMEI: ${imei}, Software: 0x${softwareVersion.toString(16)}, Serial: ${serialNumber}`);

        // Debug detallado del IMEI
        const imeiBuffer = buffer.slice(4, 12);
        console.log(`[JIMI PARSER] 🔍 IMEI Debug:`);
        console.log(`  - Raw bytes: [${Array.from(imeiBuffer).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(', ')}]`);
        console.log(`  - Hex string: ${imeiBuffer.toString('hex').toUpperCase()}`);
        console.log(`  - Extracted IMEI: ${imei}`);

        return {
            type: 'login',
            protocolNumber: protocolNumber,
            imei: imei,
            softwareVersion: softwareVersion,
            serialNumber: serialNumber,
            crc: crc,
            parsed: true,
            needsACK: true,
            timestamp: new Date()
        };
    } catch (error) {
        console.error('[JIMI PARSER] Error en login packet:', error);
        return parseGenericPacket(buffer, dataLength, protocolNumber);
    }
}

/**
 * Parsea paquete de heartbeat (0x17)
 */
function parseHeartbeatPacket(buffer, dataLength, protocolNumber) {
    try {
        console.log('[JIMI PARSER] 💓 Parseando HEARTBEAT');

        const serialNumber = buffer.readUInt16BE(buffer.length - 6);
        const crc = buffer.readUInt16BE(buffer.length - 4);

        return {
            type: 'heartbeat',
            protocolNumber: protocolNumber,
            serialNumber: serialNumber,
            crc: crc,
            parsed: true,
            needsACK: true,
            timestamp: new Date()
        };
    } catch (error) {
        console.error('[JIMI PARSER] Error en heartbeat:', error);
        return parseGenericPacket(buffer, dataLength, protocolNumber);
    }
}

/**
 * Parsea paquete GPS (0x12, 0x16) - COORDENADAS MEJORADAS
 */
function parseGPSPacket(buffer, dataLength, protocolNumber) {
    try {
        console.log('[JIMI PARSER] 🌍 Parseando GPS packet');

        if (buffer.length < 25) {
            console.warn('[JIMI PARSER] GPS packet muy corto para procesar completamente');
            return parseGenericPacket(buffer, dataLength, protocolNumber);
        }

        let offset = 4;

        // Date & Time: 6 bytes (YYMMDDHHMMSS)
        const year = 2000 + buffer.readUInt8(offset++);
        const month = buffer.readUInt8(offset++);
        const day = buffer.readUInt8(offset++);
        const hour = buffer.readUInt8(offset++);
        const minute = buffer.readUInt8(offset++);
        const second = buffer.readUInt8(offset++);

        const timestamp = new Date(year, month - 1, day, hour, minute, second);

        // GPS info byte
        const gpsInfo = buffer.readUInt8(offset++);
        const gpsLength = (gpsInfo >> 4) & 0x0F;
        const satellites = gpsInfo & 0x0F;

        // Latitude: 4 bytes - CONVERSIÓN MEJORADA
        const latitudeRaw = buffer.readUInt32BE(offset);
        offset += 4;
        const latitude = convertCoordinates(latitudeRaw, false);

        // Longitude: 4 bytes - CONVERSIÓN MEJORADA
        const longitudeRaw = buffer.readUInt32BE(offset);
        offset += 4;
        const longitude = convertCoordinates(longitudeRaw, true);

        // Speed: 1 byte (km/h)
        const speed = buffer.readUInt8(offset++);

        // Status and Course: 2 bytes
        const statusCourse = buffer.readUInt16BE(offset);
        offset += 2;

        const course = statusCourse & 0x03FF; // 10 bits para curso
        const gpsStatus = (statusCourse >> 10) & 0x3F; // 6 bits para status

        // Serial number y CRC
        const serialNumber = buffer.readUInt16BE(buffer.length - 6);
        const crc = buffer.readUInt16BE(buffer.length - 4);

        // Validar coordenadas
        const validCoords = latitude >= -90 && latitude <= 90 &&
            longitude >= -180 && longitude <= 180 &&
            latitude !== 0 && longitude !== 0;

        console.log(`[JIMI PARSER] ✅ GPS PARSEADO:`);
        console.log(`  - Timestamp: ${timestamp.toISOString()}`);
        console.log(`  - Lat: ${latitude.toFixed(6)} (raw: ${latitudeRaw})`);
        console.log(`  - Lon: ${longitude.toFixed(6)} (raw: ${longitudeRaw})`);
        console.log(`  - Speed: ${speed} km/h`);
        console.log(`  - Course: ${course}°`);
        console.log(`  - Satellites: ${satellites}`);
        console.log(`  - Válido: ${validCoords}`);

        return {
            type: 'gps',
            protocolNumber: protocolNumber,
            timestamp: timestamp,
            latitude: latitude,
            longitude: longitude,
            speed: speed,
            course: course,
            satellites: satellites,
            gpsStatus: gpsStatus,
            valid: validCoords,
            serialNumber: serialNumber,
            crc: crc,
            parsed: true,
            needsACK: true,
            rawLatitude: latitudeRaw,
            rawLongitude: longitudeRaw
        };
    } catch (error) {
        console.error('[JIMI PARSER] Error en GPS packet:', error);
        return parseGenericPacket(buffer, dataLength, protocolNumber);
    }
}

/**
 * Parsea paquetes específicos del Jimi IoT LL301 (0x36, 0x37, 0x38, 0x39)
 */
function parseJimiLL301Packet(buffer, dataLength, protocolNumber) {
    try {
        console.log(`[JIMI PARSER] 🌍 Parseando LL301 packet (Protocol 0x${protocolNumber.toString(16)})`);

        if (buffer.length < 20) {
            console.warn('[JIMI PARSER] LL301 packet muy corto');
            return parseGenericPacket(buffer, dataLength, protocolNumber);
        }

        let offset = 4;

        // Date & Time: 6 bytes (YYMMDDHHMMSS)
        const year = 2000 + buffer.readUInt8(offset++);
        const month = buffer.readUInt8(offset++);
        const day = buffer.readUInt8(offset++);
        const hour = buffer.readUInt8(offset++);
        const minute = buffer.readUInt8(offset++);
        const second = buffer.readUInt8(offset++);

        const timestamp = new Date(year, month - 1, day, hour, minute, second);

        // GPS info y cantidad de satélites
        const gpsInfo = buffer.readUInt8(offset++);
        const satellites = gpsInfo & 0x0F;

        // Latitude y Longitude: 4 bytes cada uno
        const latitudeRaw = buffer.readUInt32BE(offset);
        offset += 4;
        const latitude = convertCoordinates(latitudeRaw, false);

        const longitudeRaw = buffer.readUInt32BE(offset);
        offset += 4;
        const longitude = convertCoordinates(longitudeRaw, true);

        // Speed: 1 byte (km/h)
        const speed = buffer.readUInt8(offset++);

        // Course/Direction: 2 bytes
        const courseRaw = buffer.readUInt16BE(offset);
        offset += 2;
        const course = courseRaw & 0x03FF; // 10 bits

        // Información adicional específica del LL301
        let batteryLevel = null;
        let batteryVoltage = null;
        let gsmSignal = null;

        // Intentar extraer datos adicionales si hay suficientes bytes
        if (offset + 6 < buffer.length) {
            try {
                batteryLevel = buffer.readUInt8(offset++);
                batteryVoltage = buffer.readUInt16BE(offset) / 100.0;
                offset += 2;
                gsmSignal = buffer.readUInt8(offset++);
            } catch (extraError) {
                console.warn('[JIMI PARSER] Error extrayendo datos adicionales del LL301:', extraError.message);
            }
        }

        // Serial number y CRC
        const serialNumber = buffer.readUInt16BE(buffer.length - 6);
        const crc = buffer.readUInt16BE(buffer.length - 4);

        // Validar coordenadas
        const validCoords = latitude >= -90 && latitude <= 90 &&
            longitude >= -180 && longitude <= 180 &&
            latitude !== 0 && longitude !== 0;

        console.log(`[JIMI PARSER] ✅ LL301 GPS:`);
        console.log(`  - Lat: ${latitude.toFixed(6)}, Lon: ${longitude.toFixed(6)}`);
        console.log(`  - Speed: ${speed} km/h, Course: ${course}°, Sats: ${satellites}`);
        console.log(`  - Válido: ${validCoords}`);

        if (batteryLevel !== null) {
            console.log(`  - Batería: ${batteryLevel}%, Voltaje: ${batteryVoltage}V, GSM: ${gsmSignal}%`);
        }

        return {
            type: 'gps',
            protocolNumber: protocolNumber,
            timestamp: timestamp,
            latitude: latitude,
            longitude: longitude,
            speed: speed,
            course: course,
            satellites: satellites,
            batteryLevel: batteryLevel,
            batteryVoltage: batteryVoltage,
            gsmSignal: gsmSignal,
            valid: validCoords,
            serialNumber: serialNumber,
            crc: crc,
            parsed: true,
            needsACK: true,
            deviceModel: 'LL301',
            rawLatitude: latitudeRaw,
            rawLongitude: longitudeRaw
        };
    } catch (error) {
        console.error('[JIMI PARSER] Error en LL301 packet:', error);
        return parseGenericPacket(buffer, dataLength, protocolNumber);
    }
}

/**
 * Parsea respuesta de ubicación (0x80)
 */
function parseLocationResponse(buffer, dataLength, protocolNumber) {
    console.log('[JIMI PARSER] 📍 Parseando respuesta de ubicación');
    // Intentar como GPS packet primero
    return parseGPSPacket(buffer, dataLength, protocolNumber);
}

/**
 * Parsea respuesta de comando (0x81)
 */
function parseCommandResponse(buffer, dataLength, protocolNumber) {
    console.log('[JIMI PARSER] 📋 Parseando respuesta de comando');
    return parseGenericPacket(buffer, dataLength, protocolNumber);
}

/**
 * Parser genérico para protocolos desconocidos
 */
function parseGenericPacket(buffer, dataLength, protocolNumber) {
    try {
        const serialNumber = buffer.length >= 8 ? buffer.readUInt16BE(buffer.length - 6) : 0;
        const crc = buffer.length >= 6 ? buffer.readUInt16BE(buffer.length - 4) : 0;

        console.log(`[JIMI PARSER] 📦 Protocolo 0x${protocolNumber.toString(16)} parseado como genérico`);

        // Intentar extraer IMEI si es posible
        let imei = 'unknown';
        if (buffer.length >= 12) {
            imei = extractIMEI(buffer, 4, 8);
        }

        return {
            type: 'generic',
            protocolNumber: protocolNumber,
            imei: imei,
            serialNumber: serialNumber,
            crc: crc,
            dataLength: dataLength,
            rawData: buffer.slice(4, buffer.length - 4).toString('hex'),
            parsed: true,
            needsACK: true,
            timestamp: new Date()
        };
    } catch (error) {
        console.error('[JIMI PARSER] Error en generic packet:', error);
        return {
            type: 'error',
            protocolNumber: protocolNumber,
            error: error.message,
            parsed: false
        };
    }
}

// Funciones auxiliares para otros tipos de paquetes
function parseStatusPacket(buffer, dataLength, protocolNumber) {
    console.log('[JIMI PARSER] 📊 Parseando status packet');
    return parseGenericPacket(buffer, dataLength, protocolNumber);
}

function parseGPSLBSPacket(buffer, dataLength, protocolNumber) {
    console.log('[JIMI PARSER] 🌍📡 Parseando GPS+LBS packet');
    const gpsResult = parseGPSPacket(buffer, dataLength, protocolNumber);
    if (gpsResult.parsed && gpsResult.type === 'gps') {
        gpsResult.type = 'gps_lbs';
        return gpsResult;
    }
    return parseGenericPacket(buffer, dataLength, protocolNumber);
}

function parseLBSPacket(buffer, dataLength, protocolNumber) {
    console.log('[JIMI PARSER] 📡 Parseando LBS packet');
    return parseGenericPacket(buffer, dataLength, protocolNumber);
}

function parseGPSPositioningPacket(buffer, dataLength, protocolNumber) {
    console.log('[JIMI PARSER] 🎯 Parseando GPS positioning packet');
    return parseGPSPacket(buffer, dataLength, protocolNumber);
}

/**
 * Maneja respuestas ACK de forma segura
 */
export function handleJimiIoTResponse(socket, parsedData) {
    if (!socket || !parsedData || !parsedData.needsACK) {
        return false;
    }

    try {
        const ackBuffer = createJimiIoTACK(parsedData.serialNumber, parsedData.protocolNumber);

        if (!ackBuffer) {
            console.error('[JIMI ACK] No se pudo crear ACK buffer');
            return false;
        }

        socket.write(ackBuffer);

        console.log(`[JIMI ACK] ✅ ACK enviado para ${parsedData.type} - Serial: ${parsedData.serialNumber}, Protocol: 0x${parsedData.protocolNumber.toString(16)}, Buffer: ${ackBuffer.toString('hex').toUpperCase()}`);

        return true;
    } catch (error) {
        console.error('[JIMI ACK] ❌ Error enviando ACK:', error);
        return false;
    }
}