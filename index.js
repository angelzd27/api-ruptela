import express from 'express';
import cors from 'cors';
import net from 'net';
import http from 'http';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import { parseRuptelaPacketWithExtensions } from './controller/ruptela.js';
import { decrypt } from './utils/encrypt.js';
import { router_admin } from './routes/admin.js';
import { router_artemis } from './routes/artemis.js';
import { handlePacketResponse } from './controller/ruptela-ack.js';
// Importar las funciones del parser Jimi IoT
import { parseJimiIoTPacket, handleJimiIoTResponse } from './utils/jimi-iot-parser.js';

dotenv.config();

const app = express();
const PORT = 5000;
const TCP_PORT = 6000;
const TCP_PORT_2 = 6001; // Ruptela ECO5 Lite
const TCP_PORT_3 = 7000; // Jimi IoT LL301
const GETCORS = process.env.CORS;

// Configuración de CORS
const corsOptions = {
    origin: GETCORS,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
}

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.text({ type: 'text/plain' }));

app.use('/api/admin', router_admin);
app.use('/api/artemis', router_artemis);

// Crear servidor HTTP
const httpServer = http.createServer(app);

// Crear WebSocket Server
const wss = new WebSocketServer({ server: httpServer });

const clients = new Map(); // Map<ws, { authenticated: boolean }>

// Almacén para los últimos datos por IMEI
const gpsDataCache = new Map();

// Ruta para recibir los eventos
app.post('/eventRcv', (req, res) => {
    try {
        const event = req.body?.params?.events?.[0];

        if (!event) {
            console.warn('No se encontró el evento en el cuerpo');
            return res.status(400).send('Evento inválido');
        }

        console.log("Event", event)

        // Emitir a los clientes WebSocket autenticados
        for (const [client, info] of clients.entries()) {
            if (client.readyState === 1 && info.authenticated) {
                client.send(JSON.stringify({
                    type: 'alert-data',
                    data: event
                }));
            }
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error('Error al procesar evento HikCentral:', error.message);
        res.status(500).send('Error interno');
    }
});

function cleanAndFilterGpsData(decodedData) {
    if (!decodedData?.records?.length) return decodedData;

    const isValidCoordinate = (lat, lon) => {
        if (lat === 0 && lon === 0) return false;
        if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
        if (lat % 90 === 0 && lon % 180 === 0) return false;

        const coordStr = `${lat}${lon}`;
        if (/(\d{3})\1/.test(coordStr)) return false;
        if (lat.toFixed(4) === lon.toFixed(4)) return false;

        return true;
    };

    const isGarbageValue = (value) => {
        if (value === Number.MAX_VALUE || value === Number.MIN_VALUE) return true;
        if (Math.log2(Math.abs(value)) % 1 === 0) return true;

        const str = Math.abs(value).toString().replace('.', '');
        if (new Set(str.split('')).size === 1) return true;

        return false;
    };

    const validRecords = [];
    const seenRecords = new Set();

    for (const record of decodedData.records) {
        if (isGarbageValue(record.latitude) || isGarbageValue(record.longitude) ||
            !isValidCoordinate(record.latitude, record.longitude)) {
            continue;
        }

        if (record.speed < 0 || record.speed > 1000) continue;
        if (record.altitude < -1000 || record.altitude > 20000) continue;

        const precision = 6;
        const latKey = record.latitude.toFixed(precision);
        const lonKey = record.longitude.toFixed(precision);
        const recordKey = `${record.timestamp}_${latKey}_${lonKey}`;

        if (!seenRecords.has(recordKey)) {
            seenRecords.add(recordKey);

            const cleanedRecord = {
                ...record,
                speed: Math.max(0, Math.min(record.speed, 1000)),
                altitude: Math.max(-1000, Math.min(record.altitude, 20000)),
                angle: record.angle % 360
            };

            validRecords.push(cleanedRecord);
        }
    }

    return {
        ...decodedData,
        records: validRecords,
        numberOfRecords: validRecords.length,
        recordsLeft: Math.min(decodedData.recordsLeft, validRecords.length)
    };
}

// Función específica para manejar datos del GPS Jimi IoT LL301
function processJimiIoTData(rawData, port, socket) {
    try {
        const hexData = rawData.toString('hex').toUpperCase();
        console.log(`[JIMI IoT LL301] 📡 Datos recibidos (${rawData.length} bytes):`, hexData);

        // SEGURIDAD: Intentar parsear, si falla, solo hacer logging
        let parsedData;
        try {
            parsedData = parseJimiIoTPacket(hexData);
        } catch (parseError) {
            console.error(`[JIMI IoT LL301] ❌ Error en parser, fallback a logging:`, parseError.message);

            // Fallback: solo mostrar datos básicos
            const asciiData = rawData.toString('ascii').replace(/[^\x20-\x7E]/g, '.');
            console.log(`[JIMI IoT LL301] 📝 ASCII: ${asciiData}`);
            console.log(`[JIMI IoT LL301] 📝 Primeros bytes: ${rawData.slice(0, Math.min(8, rawData.length)).toString('hex').toUpperCase()}`);
            return; // Salir sin crashear
        }

        if (parsedData && parsedData.parsed) {
            console.log(`[JIMI IoT LL301] ✅ Paquete parseado exitosamente:`, {
                tipo: parsedData.type,
                protocolo: `0x${parsedData.protocolNumber.toString(16)}`,
                imei: parsedData.imei || 'N/A',
                timestamp: parsedData.timestamp ? parsedData.timestamp.toISOString() : 'N/A',
                latitude: parsedData.latitude || 'N/A',
                longitude: parsedData.longitude || 'N/A',
                speed: parsedData.speed !== undefined ? `${parsedData.speed} km/h` : 'N/A',
                satellites: parsedData.satellites || 'N/A',
                serialNumber: parsedData.serialNumber || 'N/A',
                valid: parsedData.valid !== undefined ? parsedData.valid : 'N/A',
                batteryLevel: parsedData.batteryLevel ? `${parsedData.batteryLevel}%` : 'N/A',
                deviceModel: parsedData.deviceModel || 'N/A'
            });

            // SEGURIDAD: Intentar enviar ACK, si falla, continuar
            if (parsedData.needsACK) {
                try {
                    const ackSent = handleJimiIoTResponse(socket, parsedData);
                    if (!ackSent) {
                        console.warn(`[JIMI IoT LL301] ⚠️  No se pudo enviar ACK, pero continuando...`);
                    }
                } catch (ackError) {
                    console.error(`[JIMI IoT LL301] ❌ Error enviando ACK:`, ackError.message);
                    // No hacer return, continuar procesando
                }
            }

            // Si es un paquete GPS con coordenadas válidas, emitir a WebSocket
            if (parsedData.type === 'gps' && parsedData.latitude && parsedData.longitude && parsedData.valid) {
                try {
                    const dataToEmit = {
                        imei: parsedData.imei || 'jimi_unknown',
                        lat: parsedData.latitude,
                        lng: parsedData.longitude,
                        timestamp: parsedData.timestamp || new Date(),
                        speed: parsedData.speed || 0,
                        altitude: 0, // No disponible en protocolo básico
                        angle: parsedData.course || null,
                        satellites: parsedData.satellites || null,
                        hdop: null, // No disponible en protocolo básico
                        deviceno: "",
                        carlicense: "",
                        additionalData: {
                            protocol: 'jimi_iot_gt06',
                            protocolNumber: `0x${parsedData.protocolNumber.toString(16)}`,
                            serialNumber: parsedData.serialNumber,
                            batteryLevel: parsedData.batteryLevel,
                            batteryVoltage: parsedData.batteryVoltage,
                            gsmSignal: parsedData.gsmSignal,
                            deviceModel: parsedData.deviceModel
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
                                console.error(`[JIMI IoT LL301] Error enviando a WebSocket:`, wsError.message);
                            }
                        }
                    }

                    console.log(`[JIMI IoT LL301] 🌍 Datos GPS enviados a ${clientsSent} clientes WebSocket - Lat: ${parsedData.latitude}, Lng: ${parsedData.longitude}`);
                } catch (emitError) {
                    console.error(`[JIMI IoT LL301] ❌ Error procesando datos GPS:`, emitError.message);
                }
            }

            // Si es login, guardar IMEI para referencia
            if (parsedData.type === 'login' && parsedData.imei) {
                console.log(`[JIMI IoT LL301] 🔐 Dispositivo conectado - IMEI: ${parsedData.imei}`);
            }

        } else {
            console.warn(`[JIMI IoT LL301] ⚠️  Paquete no parseado correctamente:`, parsedData?.error || 'Razón desconocida');

            // Mostrar información básica para debugging
            const asciiData = rawData.toString('ascii').replace(/[^\x20-\x7E]/g, '.');
            console.log(`[JIMI IoT LL301] 📝 Datos como ASCII:`, asciiData);

            if (rawData.length >= 4) {
                console.log(`[JIMI IoT LL301] 📝 Primeros 4 bytes: ${rawData.slice(0, 4).toString('hex').toUpperCase()}`);
            }
            if (rawData.length >= 8) {
                console.log(`[JIMI IoT LL301] 📝 Primeros 8 bytes: ${rawData.slice(0, 8).toString('hex').toUpperCase()}`);
            }
        }

        console.log(`[JIMI IoT LL301] 📏 Longitud total del mensaje: ${rawData.length} bytes`);

    } catch (error) {
        console.error(`[JIMI IoT LL301] 💥 Error crítico procesando datos:`, error.message);
        console.error(`[JIMI IoT LL301] 💥 Stack:`, error.stack);

        // Fallback completo: solo mostrar hex data
        try {
            const hexData = rawData.toString('hex').toUpperCase();
            console.log(`[JIMI IoT LL301] 🆘 Fallback - HEX: ${hexData}`);
        } catch (fallbackError) {
            console.error(`[JIMI IoT LL301] 💀 Error en fallback:`, fallbackError.message);
        }
    }
}

function processAndEmitGpsData(decodedData, port = null, socket = null) {
    // IMPORTANTE: Manejar respuesta ACK primero
    let processingSuccess = false;

    try {
        // Para paquetes que no son de records, enviar ACK inmediatamente
        if (decodedData.type === 'identification') {
            console.log(`[GPS] Paquete de identificación de IMEI: ${decodedData.imei}`);
            handlePacketResponse(socket, decodedData, true);
            return;
        }

        if (decodedData.type === 'heartbeat') {
            console.log(`[GPS] Heartbeat de IMEI: ${decodedData.imei}`);
            handlePacketResponse(socket, decodedData, true);
            return;
        }

        if (decodedData.type === 'dynamic_identification') {
            console.log(`[GPS] Dynamic identification de IMEI: ${decodedData.imei}`);
            handlePacketResponse(socket, decodedData, true);
            return;
        }

        // Para paquetes de records
        if (!decodedData?.imei || !decodedData?.records?.length) {
            console.warn(`[GPS] Datos inválidos o sin records de IMEI: ${decodedData?.imei || 'unknown'}`);
            // Enviar ACK negativo si no hay records válidos
            if (socket && decodedData?.commandId) {
                handlePacketResponse(socket, decodedData, false);
            }
            return;
        }

        const cleanedData = cleanAndFilterGpsData(decodedData);

        // Determinar si el procesamiento fue exitoso
        processingSuccess = cleanedData.records.length > 0;

        // Enviar ACK inmediatamente después de procesar
        if (socket && decodedData.commandId) {
            handlePacketResponse(socket, decodedData, processingSuccess);
        }

        if (cleanedData.records.length === 0) {
            console.warn(`[GPS] No hay records válidos después de filtrar para IMEI: ${decodedData.imei}`);
            return;
        }

        // Solo imprimir datos del puerto 6001
        if (port === TCP_PORT_2) {
            console.log(`[PUERTO 6001] Datos recibidos:`, {
                imei: cleanedData.imei,
                numberOfRecords: cleanedData.numberOfRecords,
                commandId: cleanedData.commandId,
                records: cleanedData.records.map(record => ({
                    timestamp: record.timestamp,
                    latitude: record.latitude,
                    longitude: record.longitude,
                    speed: record.speed,
                    altitude: record.altitude,
                    angle: record.angle,
                    satellites: record.satellites,
                    hdop: record.hdop,
                    ioElements: record.ioElements
                }))
            });
        }

        cleanedData.records.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        const cacheKey = cleanedData.imei;
        const cachedData = gpsDataCache.get(cacheKey);

        const getRecordKey = (record) => {
            return `${record.timestamp}_${record.latitude.toFixed(6)}_${record.longitude.toFixed(6)}`;
        };

        let hasNewData = false;
        const newRecordsToEmit = [];

        for (const record of cleanedData.records) {
            const recordKey = getRecordKey(record);

            if (!cachedData?.recordsMap || !cachedData.recordsMap[recordKey]) {
                hasNewData = true;
                newRecordsToEmit.push(record);
            }
        }

        if (hasNewData) {
            const allRecords = [...newRecordsToEmit, ...(cachedData?.records || [])];
            const recordsMap = {};

            const uniqueRecords = [];
            for (const record of allRecords) {
                const recordKey = getRecordKey(record);
                if (!recordsMap[recordKey]) {
                    recordsMap[recordKey] = true;
                    uniqueRecords.push(record);
                }
            }

            const limitedRecords = uniqueRecords.slice(0, 100);

            const dataToStore = {
                imei: cleanedData.imei,
                records: limitedRecords,
                recordsMap: limitedRecords.reduce((map, record) => {
                    map[getRecordKey(record)] = true;
                    return map;
                }, {}),
                lastUpdated: new Date(),
            };

            const emitToAuthenticated = (data) => {
                for (const [client, info] of clients.entries()) {
                    if (client.readyState === 1 && info.authenticated) {
                        client.send(JSON.stringify({
                            type: 'gps-data',
                            data: {
                                ...data,
                                source_port: port
                            }
                        }));
                    }
                }
            };

            const allZeroSpeed = newRecordsToEmit.every((record) => record.speed === 0);
            if (allZeroSpeed) {
                const mostRecentRecord = newRecordsToEmit[newRecordsToEmit.length - 1];
                const dataToEmit = {
                    imei: cleanedData.imei,
                    lat: mostRecentRecord.latitude,
                    lng: mostRecentRecord.longitude,
                    timestamp: mostRecentRecord.timestamp,
                    speed: mostRecentRecord.speed,
                    altitude: mostRecentRecord.altitude,
                    angle: mostRecentRecord.angle ?? null,
                    satellites: mostRecentRecord.satellites ?? null,
                    hdop: mostRecentRecord.hdop ?? null,
                    deviceno: "",
                    carlicense: "",
                    additionalData: mostRecentRecord.ioElements,
                };
                emitToAuthenticated(dataToEmit);
            } else {
                newRecordsToEmit.forEach((record) => {
                    const dataToEmit = {
                        imei: cleanedData.imei,
                        lat: record.latitude,
                        lng: record.longitude,
                        timestamp: record.timestamp,
                        speed: record.speed,
                        altitude: record.altitude,
                        angle: record.angle ?? null,
                        satellites: record.satellites ?? null,
                        hdop: record.hdop ?? null,
                        deviceno: "",
                        carlicense: "",
                        additionalData: record.ioElements,
                    };
                    emitToAuthenticated(dataToEmit);
                });
            }

            gpsDataCache.set(cacheKey, dataToStore);
            console.log(`[GPS] Procesados ${newRecordsToEmit.length} nuevos records para IMEI: ${cleanedData.imei}`);
        } else {
            console.log(`[GPS] No hay nuevos datos para IMEI: ${cleanedData.imei}`);
        }

    } catch (error) {
        console.error(`[GPS] Error procesando datos GPS:`, error);

        // Enviar ACK negativo en caso de error
        if (socket && decodedData?.commandId) {
            handlePacketResponse(socket, decodedData, false);
        }
    }
}

// WebSocket connection logic
wss.on('connection', (ws) => {
    clients.set(ws, { authenticated: false });

    ws.on('message', (message) => {
        try {
            const { type, token } = JSON.parse(message);

            if (type === 'authenticate') {
                const decoded = decrypt(token);
                const JWT_SECRET = process.env.ENCRPT_KEY;

                if (decoded === JWT_SECRET) {
                    clients.set(ws, { authenticated: true });
                    ws.send(JSON.stringify({ type: 'authentication-success', message: 'Autenticación exitosa' }));
                } else {
                    ws.send(JSON.stringify({ type: 'authentication-error', message: 'Token inválido' }));
                    ws.close();
                }
            }
        } catch (error) {
            console.error('Mensaje malformado o error:', error.message);
        }
    });

    ws.on('close', () => {
        clients.delete(ws);
    });
});

// Iniciar servidor HTTP
httpServer.listen(PORT, () => {
    console.log(`Servidor HTTP y WebSocket escuchando en el puerto ${PORT}`);
});

// Función para crear un servidor TCP (reutilizable)
function createTcpServer(port, serverName) {
    const tcpServer = net.createServer({
        keepAlive: true,
        allowHalfOpen: false
    }, (socket) => {
        const clientInfo = `${socket.remoteAddress}:${socket.remotePort}`;
        console.log(`[${serverName}] Nueva conexión desde: ${clientInfo}`);

        // Configuración de timeouts más robusta
        socket.setTimeout(300000); // 5 minutos de timeout
        socket.setKeepAlive(true, 30000); // KeepAlive cada 30 segundos
        socket.setNoDelay(true); // Desactiva el algoritmo de Nagle para mejor rendimiento

        // Buffer para manejar datos fragmentados
        let dataBuffer = Buffer.alloc(0);

        socket.on('data', (data) => {
            // Mostrar datos recibidos según el puerto
            if (port === TCP_PORT_2) {
                console.log(`[${serverName}] Datos recibidos (${data.length} bytes):`, data.toString('hex').toUpperCase());
            } else if (port === TCP_PORT_3) {
                // Para el puerto 7000 (Jimi IoT), procesar directamente
                processJimiIoTData(data, port, socket);
                return; // No continuar con el procesamiento de Ruptela
            }

            try {
                // Concatenar datos al buffer (solo para puertos Ruptela)
                dataBuffer = Buffer.concat([dataBuffer, data]);

                // Procesar paquetes completos (solo para puertos Ruptela)
                while (dataBuffer.length > 0) {
                    const hexData = dataBuffer.toString('hex');

                    // Verificar si tenemos un paquete completo mínimo
                    if (hexData.length >= 22) { // Mínimo: packet length (4) + IMEI (16) + command (2) = 22 hex chars
                        try {
                            // Intentar parsear el paquete
                            const decodedData = parseRuptelaPacketWithExtensions(hexData);

                            if (decodedData) {
                                console.log(`[${serverName}] Paquete decodificado exitosamente - IMEI: ${decodedData.imei}, Command: ${decodedData.commandId}, Type: ${decodedData.type || 'records'}`);

                                // IMPORTANTE: Pasar el socket para enviar ACK
                                processAndEmitGpsData(decodedData, port, socket);

                                // Limpiar buffer después del procesamiento exitoso
                                dataBuffer = Buffer.alloc(0);
                                break;
                            }
                        } catch (parseError) {
                            console.warn(`[${serverName}] Error parseando paquete (${parseError.message}), esperando más datos...`);

                            // Si el buffer es muy grande y no podemos parsearlo, descartarlo
                            if (dataBuffer.length > 10000) {
                                console.error(`[${serverName}] Buffer demasiado grande (${dataBuffer.length} bytes), descartando datos`);
                                dataBuffer = Buffer.alloc(0);
                            }
                            break; // Esperar más datos
                        }
                    } else {
                        // No hay suficientes datos para un paquete completo
                        if (port === TCP_PORT_2 && dataBuffer.length > 0) {
                            console.log(`[${serverName}] Esperando más datos... Buffer actual: ${dataBuffer.length} bytes`);
                        }
                        break;
                    }
                }
            } catch (error) {
                console.error(`[${serverName}] Error procesando datos TCP:`, error.message);
                dataBuffer = Buffer.alloc(0); // Limpiar buffer en caso de error
            }
        });

        // Manejo de timeout
        socket.on('timeout', () => {
            console.warn(`[${serverName}] Timeout en conexión TCP: ${clientInfo}`);
            socket.end(); // Cierra la conexión de manera elegante
        });

        // Manejo de errores más específico
        socket.on('error', (err) => {
            switch (err.code) {
                case 'ETIMEDOUT':
                    // console.warn(`[${serverName}] Timeout de lectura para cliente ${clientInfo}`);
                    break;
                case 'ECONNRESET':
                    console.warn(`[${serverName}] Conexión reiniciada por el cliente ${clientInfo}`);
                    break;
                case 'EPIPE':
                    console.warn(`[${serverName}] Pipe roto para cliente ${clientInfo}`);
                    break;
                default:
                    console.error(`[${serverName}] Error TCP socket (${err.code}):`, err.message, `Cliente: ${clientInfo}`);
            }

            // Limpiar el socket
            if (!socket.destroyed) {
                socket.destroy();
            }
        });

        // Manejo de cierre de conexión
        socket.on('close', (hadError) => {
            if (hadError) {
                console.warn(`[${serverName}] Cliente TCP desconectado con error: ${clientInfo}`);
            } else {
                console.log(`[${serverName}] Cliente TCP desconectado: ${clientInfo}`);
            }
        });

        socket.on('end', () => {
            console.log(`[${serverName}] Cliente TCP terminó la conexión: ${clientInfo}`);
        });
    });

    // Configuración del servidor TCP
    tcpServer.maxConnections = 100; // Limitar conexiones concurrentes

    tcpServer.on('error', (err) => {
        console.error(`[${serverName}] Error en servidor TCP:`, err.message);
        if (err.code === 'EADDRINUSE') {
            console.error(`[${serverName}] Puerto ${port} ya está en uso`);
            process.exit(1);
        }
    });

    tcpServer.listen(port, () => {
        console.log(`[${serverName}] Servidor TCP escuchando en el puerto ${port}`);
    });

    return tcpServer;
}

// Crear los tres servidores TCP
const tcpServer1 = createTcpServer(TCP_PORT, 'TCP-6000-Ruptela-Pro5');
const tcpServer2 = createTcpServer(TCP_PORT_2, 'TCP-6001-Ruptela-ECO5');
const tcpServer3 = createTcpServer(TCP_PORT_3, 'TCP-7000-Jimi-LL301');

// Función para limpiar conexiones inactivas periódicamente
setInterval(() => {
    const connections1 = tcpServer1.connections || 0;
    const connections2 = tcpServer2.connections || 0;
    const connections3 = tcpServer3.connections || 0;
    const totalConnections = connections1 + connections2 + connections3;

    if (totalConnections > 0) {
        console.log(`Conexiones TCP activas - Puerto 6000: ${connections1}, Puerto 6001: ${connections2}, Puerto 7000: ${connections3}, Total: ${totalConnections}`);
    }
}, 60000); // Cada minuto

// Manejo más robusto de errores globales
process.on('uncaughtException', (err) => {
    console.error('Excepción no capturada:', err.message);
    console.error('Stack:', err.stack);
    // No hacer process.exit() aquí para mantener el servidor funcionando
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Promesa rechazada sin manejar en:', promise);
    console.error('Razón:', reason);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Recibida señal SIGTERM, cerrando servidores...');
    tcpServer1.close(() => {
        console.log('Servidor TCP 6000 cerrado');
        tcpServer2.close(() => {
            console.log('Servidor TCP 6001 cerrado');
            tcpServer3.close(() => {
                console.log('Servidor TCP 7000 cerrado');
                httpServer.close(() => {
                    console.log('Servidor HTTP cerrado');
                    process.exit(0);
                });
            });
        });
    });
});

process.on('SIGINT', () => {
    console.log('Recibida señal SIGINT, cerrando servidores...');
    tcpServer1.close(() => {
        console.log('Servidor TCP 6000 cerrado');
        tcpServer2.close(() => {
            console.log('Servidor TCP 6001 cerrado');
            tcpServer3.close(() => {
                console.log('Servidor TCP 7000 cerrado');
                httpServer.close(() => {
                    console.log('Servidor HTTP cerrado');
                    process.exit(0);
                });
            });
        });
    });
});