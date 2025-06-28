// ruptela-ack.js
// Funciones para crear respuestas ACK según el protocolo Ruptela

/**
 * Calcula CRC16 usando el algoritmo CRC-CCITT (Kermit) usado por Ruptela
 * @param {Buffer} data - Datos para calcular CRC
 * @returns {number} - Valor CRC16
 */
function calculateCRC16(data) {
    let crc = 0;
    const poly = 0x8408; // Polinomio reverso de 0x1021
    
    for (let i = 0; i < data.length; i++) {
        crc ^= data[i];
        for (let bit = 0; bit < 8; bit++) {
            const carry = crc & 1;
            crc >>= 1;
            if (carry) {
                crc ^= poly;
            }
        }
    }
    return crc;
}

/**
 * Crea respuesta ACK para Command 1/100 (Records) y Command 68/100 (Extended Records)
 * @param {boolean} isPositive - true para ACK positivo, false para negativo
 * @returns {Buffer} - Buffer con la respuesta ACK
 */
function createRecordsACK(isPositive = true) {
    // Estructura: Packet length (2B) + Command (1B) + ACK (1B) + CRC16 (2B)
    const buffer = Buffer.alloc(6);
    
    // Packet length (2 bytes) - longitud sin incluir packet length y CRC16
    buffer.writeUInt16BE(2, 0);
    
    // Command ID (1 byte) - 100 (0x64) para respuesta de records
    buffer.writeUInt8(100, 2);
    
    // ACK (1 byte) - 1 para ACK positivo, 0 para negativo
    buffer.writeUInt8(isPositive ? 1 : 0, 3);
    
    // Calcular CRC16 (excluyendo packet length)
    const dataForCRC = buffer.slice(2, 4); // Solo command y ACK
    const crc = calculateCRC16(dataForCRC);
    
    // Escribir CRC16
    buffer.writeUInt16BE(crc, 4);
    
    return buffer;
}

/**
 * Crea respuesta ACK para Command 15/115 (Identification packet)
 * @param {boolean} isAuthorized - true si el dispositivo está autorizado
 * @param {number} delayMinutes - minutos de delay si no está autorizado (0-255)
 * @returns {Buffer} - Buffer con la respuesta ACK
 */
function createIdentificationACK(isAuthorized = true, delayMinutes = 0) {
    const bufferSize = isAuthorized ? 4 : 5;
    const buffer = Buffer.alloc(bufferSize + 2); // +2 para CRC
    
    // Packet length
    buffer.writeUInt16BE(bufferSize - 2, 0);
    
    // Command ID - 115 (0x73) para respuesta de identificación
    buffer.writeUInt8(115, 2);
    
    if (isAuthorized) {
        // ACK positivo
        buffer.writeUInt8(1, 3);
    } else {
        // ACK negativo con delay
        buffer.writeUInt8(2, 3);
        buffer.writeUInt8(delayMinutes, 4);
    }
    
    // Calcular CRC16
    const dataForCRC = buffer.slice(2, bufferSize);
    const crc = calculateCRC16(dataForCRC);
    buffer.writeUInt16BE(crc, bufferSize);
    
    return buffer;
}

/**
 * Crea respuesta ACK para Command 16/116 (Heartbeat)
 * @returns {Buffer} - Buffer con la respuesta ACK
 */
function createHeartbeatACK() {
    const buffer = Buffer.alloc(6);
    
    // Packet length
    buffer.writeUInt16BE(2, 0);
    
    // Command ID - 116 (0x74)
    buffer.writeUInt8(116, 2);
    
    // ACK
    buffer.writeUInt8(1, 3);
    
    // Calcular CRC16
    const dataForCRC = buffer.slice(2, 4);
    const crc = calculateCRC16(dataForCRC);
    buffer.writeUInt16BE(crc, 4);
    
    return buffer;
}

/**
 * Envía respuesta ACK apropiada según el tipo de comando
 * @param {net.Socket} socket - Socket TCP del dispositivo
 * @param {number} commandId - ID del comando recibido
 * @param {boolean} isPositive - true para ACK positivo
 * @param {Object} options - Opciones adicionales
 */
function sendACKResponse(socket, commandId, isPositive = true, options = {}) {
    try {
        let ackBuffer;
        
        switch (commandId) {
            case 1: // Records
                ackBuffer = createRecordsACK(isPositive);
                console.log(`[ACK] Enviando ACK ${isPositive ? 'positivo' : 'negativo'} para Records (Command 1)`);
                break;
                
            case 68: // Extended Protocol Records  
                ackBuffer = createRecordsACK(isPositive);
                console.log(`[ACK] Enviando ACK ${isPositive ? 'positivo' : 'negativo'} para Extended Records (Command 68)`);
                break;
                
            case 15: // Identification packet
                const isAuthorized = options.isAuthorized !== undefined ? options.isAuthorized : true;
                const delayMinutes = options.delayMinutes || 0;
                ackBuffer = createIdentificationACK(isAuthorized, delayMinutes);
                console.log(`[ACK] Enviando ACK ${isAuthorized ? 'autorizado' : 'no autorizado'} para Identification (Command 15)`);
                break;
                
            case 16: // Heartbeat
                ackBuffer = createHeartbeatACK();
                console.log(`[ACK] Enviando ACK para Heartbeat (Command 16)`);
                break;
                
            default:
                console.warn(`[ACK] No hay respuesta ACK definida para command ${commandId}`);
                return false;
        }
        
        // Enviar respuesta al dispositivo
        socket.write(ackBuffer);
        
        // Log del buffer enviado (útil para debugging)
        console.log(`[ACK] Buffer enviado: ${ackBuffer.toString('hex').toUpperCase()}`);
        
        return true;
        
    } catch (error) {
        console.error('[ACK] Error enviando ACK:', error);
        return false;
    }
}

/**
 * Maneja diferentes tipos de paquetes y envía la respuesta apropiada
 * @param {net.Socket} socket - Socket TCP del dispositivo
 * @param {Object} decodedData - Datos decodificados del paquete
 * @param {boolean} processingSuccess - Si el procesamiento fue exitoso
 */
export function handlePacketResponse(socket, decodedData, processingSuccess = true) {
    if (!socket || !decodedData || decodedData.commandId === undefined) {
        return false;
    }
    
    const options = {};
    
    // Para paquetes de identificación, puedes configurar autorización aquí
    if (decodedData.commandId === 15) {
        options.isAuthorized = true; // Cambiar según tu lógica de autorización
        options.delayMinutes = 180; // Solo se usa si isAuthorized = false
    }
    
    return sendACKResponse(socket, decodedData.commandId, processingSuccess, options);
}
