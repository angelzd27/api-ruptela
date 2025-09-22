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
// Importar las funciones mejoradas del parser Jimi IoT
import { processJimiIoTDataImproved, jimiLogger } from './utils/jimi-iot-parser.js';

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

app.use('/alarm', express.raw({ type: "multipart/form-data", limit: "1mb" }));
app.post('/alarm', async (request, response) => {
    const bodyText = request.body.toString();
    const channelName = extractChannelName(bodyText);

    console.log(`Alerta recibida en el canal: ${channelName}`);
    console.log(`Contenido de la alerta: ${bodyText}`);

    if (!channelName) {
        return response.status(400).json({ error: "No se encontró channelName en la alerta." });
    }

    response.status(200).json({ msg: 'alert_received', channelName });
});

// Ruta para recibir los eventos
app.post('/eventRcv', (req, res) => {
    try {
        const event = req.body?.params?.events?.[0];

        if (!event) {
            return res.status(400).send('Evento inválido');
        }

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
        res.status(500).send('Error interno');
    }
});

// Función para limpiar y filtrar datos GPS (para Ruptela)
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

// Función para procesar y emitir datos GPS (para Ruptela)
function processAndEmitGpsData(decodedData, port = null, socket = null) {
    let processingSuccess = false;

    try {
        // Para paquetes que no son de records, enviar ACK inmediatamente
        if (decodedData.type === 'identification') {
            handlePacketResponse(socket, decodedData, true);
            return;
        }

        if (decodedData.type === 'heartbeat') {
            handlePacketResponse(socket, decodedData, true);
            return;
        }

        if (decodedData.type === 'dynamic_identification') {
            handlePacketResponse(socket, decodedData, true);
            return;
        }

        // Para paquetes de records
        if (!decodedData?.imei || !decodedData?.records?.length) {
            if (socket && decodedData?.commandId) {
                handlePacketResponse(socket, decodedData, false);
            }
            return;
        }

        const cleanedData = cleanAndFilterGpsData(decodedData);
        processingSuccess = cleanedData.records.length > 0;

        // Enviar ACK inmediatamente después de procesar
        if (socket && decodedData.commandId) {
            handlePacketResponse(socket, decodedData, processingSuccess);
        }

        if (cleanedData.records.length === 0) {
            return;
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
        }

    } catch (error) {
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
            // Mensaje malformado, cerrar conexión
            ws.close();
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

        // Solo mostrar conexiones del puerto 7000 (Jimi IoT)
        if (port === TCP_PORT_3) {
            console.log(`[${serverName}] Nueva conexión desde: ${clientInfo}`);
        }

        // Configuración de timeouts más robusta
        socket.setTimeout(300000); // 5 minutos
        socket.setKeepAlive(true, 30000); // KeepAlive cada 30 segundos
        socket.setNoDelay(true);

        // Buffer para manejar datos fragmentados (solo para Ruptela)
        let dataBuffer = Buffer.alloc(0);

        socket.on('data', (data) => {
            if (port === TCP_PORT_3) {
                // Para Jimi IoT LL301 - procesamiento directo y mejorado
                processJimiIoTDataImproved(data, port, socket, clients);
                return;
            }

            // Para puertos Ruptela (6000 y 6001)
            try {
                dataBuffer = Buffer.concat([dataBuffer, data]);

                while (dataBuffer.length > 0) {
                    const hexData = dataBuffer.toString('hex');

                    if (hexData.length >= 22) {
                        try {
                            const decodedData = parseRuptelaPacketWithExtensions(hexData);

                            if (decodedData) {
                                processAndEmitGpsData(decodedData, port, socket);
                                dataBuffer = Buffer.alloc(0);
                                break;
                            }
                        } catch (parseError) {
                            if (dataBuffer.length > 10000) {
                                dataBuffer = Buffer.alloc(0);
                            }
                            break;
                        }
                    } else {
                        break;
                    }
                }
            } catch (error) {
                dataBuffer = Buffer.alloc(0);
            }
        });

        // Manejo de timeout
        socket.on('timeout', () => {
            if (port === TCP_PORT_3) {
                console.warn(`[${serverName}] Timeout en conexión: ${clientInfo}`);
            }
            socket.end();
        });

        // Manejo de errores
        socket.on('error', (err) => {
            if (port === TCP_PORT_3) {
                switch (err.code) {
                    case 'ETIMEDOUT':
                        break;
                    case 'ECONNRESET':
                        console.warn(`[${serverName}] Conexión reiniciada: ${clientInfo}`);
                        break;
                    case 'EPIPE':
                        console.warn(`[${serverName}] Pipe roto: ${clientInfo}`);
                        break;
                    default:
                        console.error(`[${serverName}] Error TCP (${err.code}): ${err.message} - ${clientInfo}`);
                }
            }

            if (!socket.destroyed) {
                socket.destroy();
            }
        });

        // Manejo de cierre de conexión
        socket.on('close', (hadError) => {
            if (port === TCP_PORT_3) {
                if (hadError) {
                    console.warn(`[${serverName}] Cliente desconectado con error: ${clientInfo}`);
                } else {
                    console.log(`[${serverName}] Cliente desconectado: ${clientInfo}`);
                }

                // Limpiar sesión Jimi si existe
                if (socket.imei) {
                    jimiLogger.endSession(socket.imei);

                    if (socket.gpsManager) {
                        socket.gpsManager.cleanup();
                    }
                }
            }
        });

        socket.on('end', () => {
            if (port === TCP_PORT_3) {
                console.log(`[${serverName}] Cliente terminó conexión: ${clientInfo}`);
            }
        });
    });

    // Configuración del servidor TCP
    tcpServer.maxConnections = 100;

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

// Ruta API para obtener estadísticas de dispositivos Jimi
app.get('/api/jimi/stats', (req, res) => {
    try {
        const activeDevices = jimiLogger.getActiveDevices();
        const stats = {
            activeDevicesCount: activeDevices.length,
            devices: activeDevices.map(imei => jimiLogger.getSessionInfo(imei))
        };
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: 'Error obteniendo estadísticas' });
    }
});

// Función para limpiar conexiones inactivas periódicamente
setInterval(() => {
    const connections1 = tcpServer1.connections || 0;
    const connections2 = tcpServer2.connections || 0;
    const connections3 = tcpServer3.connections || 0;
    const totalConnections = connections1 + connections2 + connections3;

    // Solo mostrar si hay conexiones del puerto 7000 (Jimi IoT)
    if (connections3 > 0) {
        console.log(`[STATS] Conexiones TCP - Jimi LL301: ${connections3}, Total: ${totalConnections}`);
    }
}, 60000); // Cada minuto

// Manejo de errores globales
process.on('uncaughtException', (err) => {
    console.error('❌ Excepción no capturada:', err.message);
    console.error('Stack:', err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promesa rechazada sin manejar:', reason);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🔄 Recibida señal SIGTERM, cerrando servidores...');
    tcpServer1.close(() => {
        tcpServer2.close(() => {
            tcpServer3.close(() => {
                httpServer.close(() => {
                    console.log('✅ Todos los servidores cerrados');
                    process.exit(0);
                });
            });
        });
    });
});

process.on('SIGINT', () => {
    console.log('🔄 Recibida señal SIGINT, cerrando servidores...');
    tcpServer1.close(() => {
        tcpServer2.close(() => {
            tcpServer3.close(() => {
                httpServer.close(() => {
                    console.log('✅ Todos los servidores cerrados');
                    process.exit(0);
                });
            });
        });
    });
});