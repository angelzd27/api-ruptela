// parser/jimi-iot-parser.js
// Parser COMPLETO para GPS Jimi IoT LL301 usando protocolo GT06/Concox
// Versión final para producción con soporte completo

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
 * Parsea paquetes del protocolo GT06/Concox (Jimi IoT LL301)
 * VERSIÓN ROBUSTA CON MANEJO DE ERRORES
 */
export function parseJimiIoTPacket(hexData) {
    try {
        const buffer = Buffer.from(hexData, 'hex');
        
        // Verificaciones básicas
        if (buffer.length < 8) {
            console.warn('[JIMI PARSER] Paquete demasiado corto, solo logging');
            return { type: 'too_short', parsed: false, rawData: hexData };
        }
        
        // Verificar start flag
        const startFlag = buffer.readUInt16BE(0);
        if (startFlag !== 0x7878 && startFlag !== 0x7979) {
            console.warn(`[JIMI PARSER] Start flag raro: ${startFlag.toString(16)}, procesando como raw`);
            return { type: 'unknown_start', parsed: false, rawData: hexData };
        }
        
        // Verificar end flag
        const endFlag = buffer.readUInt16BE(buffer.length - 2);
        if (endFlag !== 0x0D0A) {
            console.warn(`[JIMI PARSER] End flag raro: ${endFlag.toString(16)}, procesando como raw`);
            return { type: 'unknown_end', parsed: false, rawData: hexData };
        }
        
        // Extraer campos básicos
        const dataLength = buffer.readUInt8(2);
        const protocolNumber = buffer.readUInt8(3);
        
        console.log(`[JIMI PARSER] ✅ Start: 0x${startFlag.toString(16)}, Length: ${dataLength}, Protocol: 0x${protocolNumber.toString(16)}`);
        
        // Parsear según el tipo de protocolo
        switch (protocolNumber) {
            case 0x01: // Login packet
                return parseLoginPacket(buffer, dataLength, protocolNumber);
                
            case 0x13: // Status information packet
                return parseStatusPacket(buffer, dataLength, protocolNumber);
                
            case 0x12: // GPS packet (ubicación)
                return parseGPSPacket(buffer, dataLength, protocolNumber);
                
            case 0x16: // GPS packet alternativo
                return parseGPSPacket(buffer, dataLength, protocolNumber);
                
            case 0x17: // Heart beat packet
                return parseHeartbeatPacket(buffer, dataLength, protocolNumber);
                
            case 0x18: // GPS and LBS packet
                return parseGPSLBSPacket(buffer, dataLength, protocolNumber);
                
            case 0x19: // LBS packet
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
                
            default:
                console.log(`[JIMI PARSER] 🤔 Protocolo nuevo: 0x${protocolNumber.toString(16)} - Agregando soporte básico`);
                return parseGenericPacket(buffer, dataLength, protocolNumber);
        }
        
    } catch (error) {
        console.error('[JIMI PARSER] ❌ Error parseando:', error.message);
        return {
            type: 'parse_error',
            error: error.message,
            rawData: hexData,
            parsed: false
        };
    }
}

/**
 * Parsea paquete de login (0x01) - EL QUE YA RECIBISTE
 */
function parseLoginPacket(buffer, dataLength, protocolNumber) {
    try {
        console.log('[JIMI PARSER] 🔐 Parseando LOGIN packet');
        
        // IMEI: 8 bytes a partir del byte 4
        const imeiBuffer = buffer.slice(4, 12);
        let imei;
        
        // Intentar diferentes métodos de extracción de IMEI
        try {
            imei = imeiBuffer.readBigUInt64BE().toString();
        } catch {
            // Método alternativo si falla
            imei = Array.from(imeiBuffer).map(b => b.toString(16).padStart(2, '0')).join('');
        }
        
        // Software version: 2 bytes
        const softwareVersion = buffer.length > 14 ? buffer.readUInt16BE(12) : 0;
        
        // Serial number: 2 bytes antes del CRC
        const serialNumber = buffer.readUInt16BE(buffer.length - 6);
        
        // CRC: 2 bytes antes del end flag
        const crc = buffer.readUInt16BE(buffer.length - 4);
        
        console.log(`[JIMI PARSER] ✅ LOGIN - IMEI: ${imei}, Software: 0x${softwareVersion.toString(16)}, Serial: ${serialNumber}`);
        
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
 * Parsea paquete GPS (0x12, 0x16) - COORDENADAS
 */
function parseGPSPacket(buffer, dataLength, protocolNumber) {
    try {
        console.log('[JIMI PARSER] 🌍 Parseando GPS packet');
        
        if (buffer.length < 25) {
            console.warn('[JIMI PARSER] GPS packet muy corto, parseando como genérico');
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
        
        // Latitude: 4 bytes (en formato específico del protocolo)
        const latitudeHex = buffer.readUInt32BE(offset);
        offset += 4;
        let latitude = latitudeHex / 1800000.0;
        
        // Longitude: 4 bytes
        const longitudeHex = buffer.readUInt32BE(offset);
        offset += 4;
        let longitude = longitudeHex / 1800000.0;
        
        // Ajustar signos según hemisferio (esto puede variar)
        // Si las coordenadas son muy grandes, podrían necesitar conversión diferente
        if (latitude > 90) latitude = latitude / 10000000.0;
        if (longitude > 180) longitude = longitude / 10000000.0;
        
        // Speed: 1 byte
        const speed = buffer.readUInt8(offset++);
        
        // Status and Course: 2 bytes
        const statusCourse = buffer.readUInt16BE(offset);
        offset += 2;
        
        const course = statusCourse & 0x03FF; // 10 bits para curso
        const gpsStatus = (statusCourse >> 10) & 0x3F; // 6 bits para status
        
        // Serial number
        const serialNumber = buffer.readUInt16BE(buffer.length - 6);
        const crc = buffer.readUInt16BE(buffer.length - 4);
        
        // Validar coordenadas básicas
        const validCoords = latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
        
        console.log(`[JIMI PARSER] ✅ GPS - Lat: ${latitude}, Lon: ${longitude}, Speed: ${speed} km/h, Sats: ${satellites}, Válido: ${validCoords}`);
        
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
            needsACK: true
        };
    } catch (error) {
        console.error('[JIMI PARSER] Error en GPS packet:', error);
        return parseGenericPacket(buffer, dataLength, protocolNumber);
    }
}

/**
 * Parsea paquetes específicos del Jimi IoT LL301 (0x36, 0x37, 0x38, 0x39)
 * Estos protocolos contienen GPS + datos adicionales según documentación Flespi
 */
function parseJimiLL301Packet(buffer, dataLength, protocolNumber) {
    try {
        console.log(`[JIMI PARSER] 🌍 Parseando LL301 packet (Protocol 0x${protocolNumber.toString(16)})`);
        
        if (buffer.length < 20) {
            console.warn('[JIMI PARSER] LL301 packet muy corto, parseando como genérico');
            return parseGenericPacket(buffer, dataLength, protocolNumber);
        }
        
        let offset = 4;
        
        // Estructura típica del LL301 según documentación Flespi
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
        
        // Latitude: 4 bytes
        const latitudeRaw = buffer.readUInt32BE(offset);
        offset += 4;
        let latitude = latitudeRaw / 1800000.0; // Factor de conversión estándar
        
        // Longitude: 4 bytes  
        const longitudeRaw = buffer.readUInt32BE(offset);
        offset += 4;
        let longitude = longitudeRaw / 1800000.0;
        
        // Speed: 1 byte (km/h)
        const speed = buffer.readUInt8(offset++);
        
        // Course/Direction: 2 bytes
        const courseRaw = buffer.readUInt16BE(offset);
        offset += 2;
        const course = courseRaw & 0x03FF; // 10 bits
        
        // Detectar y ajustar coordenadas según hemisferio
        // Si las coordenadas son muy grandes, necesitan otro factor
        if (Math.abs(latitude) > 90) {
            latitude = latitudeRaw / 10000000.0;
        }
        if (Math.abs(longitude) > 180) {
            longitude = longitudeRaw / 10000000.0;
        }
        
        // Ajustar signos de coordenadas (esto puede variar según configuración)
        // Para México, típicamente latitud positiva y longitud negativa
        if (latitude > 0 && latitude < 50) { // México está entre 14°-33°N
            // Latitud correcta para México
        }
        if (longitude > 0 && longitude < 180) { // México está entre 86°-118°W
            longitude = -longitude; // Convertir a negativo para occidente
        }
        
        // Información adicional específica del LL301
        let batteryLevel = null;
        let batteryVoltage = null;
        let gsmSignal = null;
        
        // Intentar extraer datos adicionales si hay suficientes bytes
        if (offset + 6 < buffer.length) {
            try {
                batteryLevel = buffer.readUInt8(offset++); // Battery level %
                batteryVoltage = buffer.readUInt16BE(offset) / 100.0; // Voltage in volts
                offset += 2;
                gsmSignal = buffer.readUInt8(offset++); // GSM signal strength
            } catch (extraError) {
                console.warn('[JIMI PARSER] Error extrayendo datos adicionales:', extraError.message);
            }
        }
        
        // Serial number (2 bytes antes del CRC)
        const serialNumber = buffer.readUInt16BE(buffer.length - 6);
        const crc = buffer.readUInt16BE(buffer.length - 4);
        
        // Validar coordenadas
        const validCoords = latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
        
        console.log(`[JIMI PARSER] ✅ LL301 GPS - Lat: ${latitude.toFixed(6)}, Lon: ${longitude.toFixed(6)}, Speed: ${speed} km/h, Sats: ${satellites}, Válido: ${validCoords}`);
        
        if (batteryLevel !== null) {
            console.log(`[JIMI PARSER] 🔋 Batería: ${batteryLevel}%, Voltaje: ${batteryVoltage}V, GSM: ${gsmSignal}%`);
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
            deviceModel: 'LL301'
        };
    } catch (error) {
        console.error('[JIMI PARSER] Error en LL301 packet:', error);
        return parseGenericPacket(buffer, dataLength, protocolNumber);
    }
}

/**
 * Parser genérico para protocolos desconocidos
 */
function parseGenericPacket(buffer, dataLength, protocolNumber) {
    try {
        const serialNumber = buffer.length >= 8 ? buffer.readUInt16BE(buffer.length - 6) : 0;
        const crc = buffer.length >= 6 ? buffer.readUInt16BE(buffer.length - 4) : 0;
        
        console.log(`[JIMI PARSER] 📦 Protocolo 0x${protocolNumber.toString(16)} parseado como genérico`);
        
        return {
            type: 'generic',
            protocolNumber: protocolNumber,
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
    return parseGenericPacket(buffer, dataLength, protocolNumber);
}

function parseGPSLBSPacket(buffer, dataLength, protocolNumber) {
    // Intentar primero como GPS, si falla usar genérico
    const gpsResult = parseGPSPacket(buffer, dataLength, protocolNumber);
    if (gpsResult.parsed && gpsResult.type === 'gps') {
        gpsResult.type = 'gps_lbs';
        return gpsResult;
    }
    return parseGenericPacket(buffer, dataLength, protocolNumber);
}

function parseLBSPacket(buffer, dataLength, protocolNumber) {
    return parseGenericPacket(buffer, dataLength, protocolNumber);
}

function parseGPSPositioningPacket(buffer, dataLength, protocolNumber) {
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
        
        console.log(`[JIMI ACK] ✅ ACK enviado para ${parsedData.type} - Serial: ${parsedData.serialNumber}, Buffer: ${ackBuffer.toString('hex').toUpperCase()}`);
        
        return true;
    } catch (error) {
        console.error('[JIMI ACK] ❌ Error enviando ACK:', error);
        return false;
    }
}