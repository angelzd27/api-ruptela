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

dotenv.config();

const app = express();
const PORT = 5000;
const TCP_PORT = 6000;
const GETCORS = process.env.CORS;

app.use('/api/admin', router_admin);
app.use('/api/artemis', router_artemis);

// Ruta para recibir los eventos
app.post('/eventRcv', (req, res) => {
  console.log('Evento recibido:', req.body);

  res.status(200).send('OK');
});

// Configuración de CORS
const corsOptions = {
    origin: GETCORS,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.text({ type: 'text/plain' }));

// Crear servidor HTTP
const httpServer = http.createServer(app);

// Crear WebSocket Server
const wss = new WebSocketServer({ server: httpServer });

const clients = new Map(); // Map<ws, { authenticated: boolean }>

// Almacén para los últimos datos por IMEI
const gpsDataCache = new Map();

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

function processAndEmitGpsData(decodedData) {
    if (!decodedData?.imei || !decodedData?.records?.length) return;

    const cleanedData = cleanAndFilterGpsData(decodedData);
    if (cleanedData.records.length === 0) return;

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
                    client.send(JSON.stringify({ type: 'gps-data', data }));
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
                    deviceno: "", // puedes llenar esto dinámicamente si lo tienes
                    carlicense: "", // igual que arriba
                    additionalData: record.ioElements,
                };
                emitToAuthenticated(dataToEmit);
            });
        }

        gpsDataCache.set(cacheKey, dataToStore);
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

// Servidor TCP optimizado y robusto
const tcpServer = net.createServer({ keepAlive: true, allowHalfOpen: false }, (socket) => {
    console.log('Cliente TCP conectado:', socket.remoteAddress, socket.remotePort);

    // Habilita KeepAlive cada 60 segundos para mantener activa la conexión
    socket.setKeepAlive(true, 60000);

    socket.on('data', (data) => {
        try {
            const hexData = data.toString('hex');
            const decodedData = parseRuptelaPacketWithExtensions(hexData);
            processAndEmitGpsData(decodedData);
        } catch (error) {
            console.error('Error procesando datos GPS:', error);
        }
    });

    // Maneja errores específicos en sockets
    socket.on('error', (err) => {
        console.error('TCP socket error:', err.message);
        socket.destroy();  // libera el socket ante un error
    });

    // Maneja correctamente el evento de cierre de conexión
    socket.on('close', (hadError) => {
        if (hadError) {
            console.warn(`Cliente TCP desconectado inesperadamente: ${socket.remoteAddress}:${socket.remotePort}`);
        } else {
            console.log(`Cliente TCP desconectado normalmente: ${socket.remoteAddress}:${socket.remotePort}`);
        }
    });
});

tcpServer.listen(TCP_PORT, () => {
    console.log(`Servidor TCP escuchando en el puerto ${TCP_PORT}`);
});

// Manejo global de errores
process.on('uncaughtException', (err) => {
    console.error('Excepción no capturada:', err.message);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Promesa rechazada sin manejar:', promise, 'Razón:', reason);
});