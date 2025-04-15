import express from 'express';
import http from 'http';
import { Server } from 'socket.io';

class SocketServer {
    static _instance;

    constructor() {
        this.app = express();
        this.port = 4000;
        this.httpServer = http.createServer(this.app);
        this.io = new Server(this.httpServer, {
            cors: {
                origin: "*",
                methods: ["GET", "POST", "PUT", "DELETE"]
            }
        });
    }

    static get instance() {
        if (!this._instance) {
            this._instance = new this();
        }
        return this._instance;
    }

    start(callback) {
        this.io.on('connection', (client) => {
            console.log('client connect...', client.id);

            client.on('disconnect', () => {
                console.log('client disconnect...', client.id);
            });

            client.on('join_room', (data) => {
                client.join(data);
            });
        });

        this.httpServer.listen(this.port, callback);
    }
}

export default SocketServer;
