const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    pingInterval: 10000,
    pingTimeout: 5000
});

app.use(express.static(path.join(__dirname, 'public')));

const operadores = {};
let transmissorAtual = null;

io.on('connection', (socket) => {
    socket.on('entrar-sala', (nome) => {
        operadores[socket.id] = nome || 'Operador';
        io.emit('lista-operadores', operadores);
        socket.broadcast.emit('novo-usuario-voz', { id: socket.id, nome: operadores[socket.id] });

        if (transmissorAtual && operadores[transmissorAtual]) {
            io.to(transmissorAtual).emit('pedir-tela', { para: socket.id });
        }
    });

    socket.on('chat-msg', (msg) => {
        const textoLimpo = String(msg).slice(0, 400);
        io.emit('chat-msg', {
            usuario: operadores[socket.id] || 'Operador',
            texto: textoLimpo
        });
    });

    socket.on('sinal-voz', (dados) => {
        io.to(dados.para).emit('sinal-voz', {
            de: socket.id,
            sinal: dados.sinal
        });
    });

    socket.on('iniciou-tela', () => {
        transmissorAtual = socket.id;
        Object.keys(operadores).forEach((idOp) => {
            if (idOp !== socket.id) {
                socket.emit('pedir-tela', { para: idOp });
            }
        });
    });

    socket.on('sinal-tela', (dados) => {
        if (dados.para) {
            io.to(dados.para).emit('sinal-tela', {
                de: socket.id,
                sinal: dados.sinal
            });
        }
    });

    socket.on('parou-tela', () => {
        if (transmissorAtual === socket.id) {
            transmissorAtual = null;
        }
        socket.broadcast.emit('parou-tela');
    });

    socket.on('disconnect', () => {
        if (transmissorAtual === socket.id) {
            transmissorAtual = null;
            socket.broadcast.emit('parou-tela');
        }
        delete operadores[socket.id];
        io.emit('lista-operadores', operadores);
        socket.broadcast.emit('usuario-saiu-voz', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor APP G.A.S oficial rodando na porta ${PORT}`);
});
